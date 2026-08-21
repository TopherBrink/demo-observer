/**
 * Один процесс, три роли:
 *   1) мок-API каталога, который умеет ломаться предсказуемым образом;
 *   2) коллектор событий и записей сессий;
 *   3) дашборд для разбора на докладе.
 *
 * Никаких зависимостей — только стандартная библиотека Node. Запуск:
 *   node collector/server.mjs
 *
 * Данные лежат в памяти и в ./collector/data. Это демо, не прод.
 */
import http from 'node:http'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, extname } from 'node:path'
import { randomUUID } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, 'data')
const PORT = Number(process.env.PORT || 8787)

/** 'off' | 'types' | 'chaos' */
let mode = 'off'

const sessions = new Map() // sessionId -> { events: [], replays: [] }

const CATALOG = [
  { id: 1, title: 'Кроссовки беговые', price: 6490, discount: 0, stock: 12, sale: false },
  { id: 2, title: 'Куртка зимняя', price: 12900, discount: 1500, stock: 3, sale: true },
  { id: 3, title: 'Рюкзак городской', price: 3290, discount: 0, stock: 27, sale: false },
  { id: 4, title: 'Термос 0,75 л', price: 1290, discount: 200, stock: 8, sale: true },
  { id: 5, title: 'Перчатки флисовые', price: 890, discount: 0, stock: 41, sale: false },
]

/**
 * Вот он, баг из реальной жизни.
 *
 * Для акционных товаров бэкенд отдаёт price строкой (так вернул 1С),
 * а поле discount вообще пропадает из ответа — сериализатор выкидывает
 * пустые значения (omitempty). На стенде акций нет, локально всё зелёное.
 *
 * ВАЖНАЯ ДЕТАЛЬ ДЛЯ ДОКЛАДА — почему пропавшее поле хуже, чем null:
 *   "12900.00" - null      === 12900   ← молча работает
 *   "12900.00" - undefined === NaN     ← ломается
 * То есть один и тот же «пустой» discount ведёт себя противоположно
 * в зависимости от того, прислали его как null или не прислали вовсе.
 * Ровно поэтому глазами такое не ловится.
 */
function serveCatalog() {
  if (mode === 'off') return CATALOG
  return CATALOG.map((product) => {
    if (!product.sale) return product
    const { discount, ...rest } = product
    return {
      ...rest,
      price: product.price.toFixed(2), // "12900.00" — строка!
      // discount не пришёл вообще
      stock: mode === 'chaos' ? String(product.stock) : product.stock,
    }
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  // Без traceparent здесь preflight не пройдёт и слой 1 сломается
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,traceparent,baggage')
  res.setHeader('Access-Control-Expose-Headers', 'x-trace-id')
}

function json(res, code, body, extraHeaders = {}) {
  cors(res)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders })
  res.end(JSON.stringify(body))
}

async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

function bucket(sessionId) {
  if (!sessions.has(sessionId)) sessions.set(sessionId, { events: [], replays: [] })
  return sessions.get(sessionId)
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const path = url.pathname

  if (req.method === 'OPTIONS') {
    cors(res)
    res.writeHead(204)
    return res.end()
  }

  // --- Мок-API ---------------------------------------------------------

  if (path === '/api/products') {
    // Тот самый traceparent: сервер вытаскивает trace-id из заголовка
    // и кладёт его в свой лог. Это и есть стык клиента и сервера.
    const traceparent = req.headers.traceparent || ''
    const traceId = traceparent.split('-')[1] || randomUUID().replace(/-/g, '')
    console.log(`[api] GET /api/products trace=${traceId} mode=${mode}`)

    if (mode === 'chaos') {
      await sleep(200 + Math.random() * 1500)
      if (Math.random() < 0.25) return json(res, 502, { error: 'upstream недоступен' }, { 'x-trace-id': traceId })
    }
    return json(res, 200, serveCatalog(), { 'x-trace-id': traceId })
  }

  if (path === '/api/orders' && req.method === 'POST') {
    const body = await readJson(req)
    const traceId = (req.headers.traceparent || '').split('-')[1] || randomUUID()
    const bad = (body?.items || []).some((i) => !Number.isFinite(i.sum))
    console.log(`[api] POST /api/orders trace=${traceId} валидна=${!bad}`)
    if (bad) {
      // Пользователь увидит «Не удалось оформить заказ». И всё.
      return json(res, 422, { error: 'сумма позиции не является числом' }, { 'x-trace-id': traceId })
    }
    return json(res, 200, { orderId: randomUUID().slice(0, 8) }, { 'x-trace-id': traceId })
  }

  if (path === '/api/admin/mode' && req.method === 'POST') {
    mode = url.searchParams.get('value') || 'off'
    console.log(`[admin] режим бэкенда: ${mode}`)
    return json(res, 200, { mode })
  }

  // --- Коллектор -------------------------------------------------------

  if (path === '/collect' && req.method === 'POST') {
    const body = await readJson(req)
    for (const event of body?.events || []) {
      bucket(event.ctx?.sessionId || 'unknown').events.push(event)
    }
    await persist()
    return json(res, 200, { accepted: body?.events?.length || 0 })
  }

  if (path === '/collect/replay' && req.method === 'POST') {
    const body = await readJson(req)
    if (body?.sessionId) {
      bucket(body.sessionId).replays.push({
        id: randomUUID().slice(0, 8),
        reason: body.reason,
        startedAt: body.startedAt,
        endedAt: body.endedAt,
        events: body.events,
      })
      console.log(`[replay] сессия ${body.sessionId}: ${body.events.length} событий, причина: ${body.reason}`)
    }
    await persist()
    return json(res, 200, { ok: true })
  }

  // --- Данные для дашборда ---------------------------------------------

  if (path === '/api/sessions') {
    const list = [...sessions.entries()].map(([id, data]) => ({
      id,
      events: data.events.length,
      replays: data.replays.length,
      errors: data.events.filter((e) => e.level === 'error').length,
      contracts: data.events.filter((e) => e.type === 'contract').length,
      lastSeen: data.events.at(-1)?.ts || null,
      device: data.events.at(-1)?.ctx || null,
    }))
    return json(res, 200, list.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0)))
  }

  if (path.startsWith('/api/sessions/')) {
    const id = path.split('/')[3]
    const data = sessions.get(id)
    if (!data) return json(res, 404, { error: 'нет такой сессии' })
    const replayId = url.searchParams.get('replay')
    if (replayId) {
      const replay = data.replays.find((r) => r.id === replayId)
      return json(res, replay ? 200 : 404, replay || { error: 'нет такой записи' })
    }
    return json(res, 200, {
      events: data.events,
      replays: data.replays.map(({ events, ...meta }) => ({ ...meta, count: events.length })),
    })
  }

  if (path === '/api/reset' && req.method === 'POST') {
    sessions.clear()
    await persist()
    return json(res, 200, { ok: true })
  }

  // --- Статика дашборда -------------------------------------------------

  const file = join(__dirname, 'public', path === '/' ? 'index.html' : path.replace(/^\//, ''))
  if (existsSync(file) && file.startsWith(join(__dirname, 'public'))) {
    cors(res)
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' })
    return res.end(await readFile(file))
  }

  json(res, 404, { error: 'не найдено' })
})

let persistTimer = null
async function persist() {
  clearTimeout(persistTimer)
  persistTimer = setTimeout(async () => {
    await mkdir(DATA_DIR, { recursive: true })
    const dump = Object.fromEntries(sessions)
    await writeFile(join(DATA_DIR, 'sessions.json'), JSON.stringify(dump), 'utf8')
  }, 1000)
}

async function restore() {
  const file = join(DATA_DIR, 'sessions.json')
  if (!existsSync(file)) return
  try {
    const dump = JSON.parse(await readFile(file, 'utf8'))
    for (const [id, data] of Object.entries(dump)) sessions.set(id, data)
    console.log(`[store] восстановлено сессий: ${sessions.size}`)
  } catch {
    /* битый дамп — не беда */
  }
}

await restore()
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Коллектор и мок-API: http://localhost:${PORT}`)
  console.log('Дашборд там же. Телефон должен ходить на IP машины, не на localhost.')
})
