/**
 * Урезанная версия collector/server.mjs: только мок-API каталога.
 *
 * Коллектор и дашборд убраны — события теперь идут напрямую в Bugsink по
 * envelope-протоколу (см. transport.js), без промежуточного сервера.
 * traceparent здесь остался — сеть (network.js) не менялась, это тот же
 * механизм W3C Trace Context, что и в оригинале, никак не связанный с DSN Bugsink.
 *
 * Запуск: node mock-api/server.mjs
 */
import http from 'node:http'
import { randomUUID } from 'node:crypto'

const PORT = Number(process.env.PORT || 8787)

/** 'off' | 'types' | 'chaos' */
let mode = 'off'

const CATALOG = [
  { id: 1, title: 'Кроссовки беговые', price: 6490, discount: 0, stock: 12, sale: false },
  { id: 2, title: 'Куртка зимняя', price: 12900, discount: 1500, stock: 3, sale: true },
  { id: 3, title: 'Рюкзак городской', price: 3290, discount: 0, stock: 27, sale: false },
  { id: 4, title: 'Термос 0,75 л', price: 1290, discount: 200, stock: 8, sale: true },
  { id: 5, title: 'Перчатки флисовые', price: 890, discount: 0, stock: 41, sale: false },
]

function serveCatalog() {
  if (mode === 'off') return CATALOG
  return CATALOG.map((product) => {
    if (!product.sale) return product
    const { discount, ...rest } = product
    return {
      ...rest,
      price: product.price.toFixed(2),
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const path = url.pathname

  if (req.method === 'OPTIONS') {
    cors(res)
    res.writeHead(204)
    return res.end()
  }

  if (path === '/api/products') {
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
      return json(res, 422, { error: 'сумма позиции не является числом' }, { 'x-trace-id': traceId })
    }
    return json(res, 200, { orderId: randomUUID().slice(0, 8) }, { 'x-trace-id': traceId })
  }

  if (path === '/api/admin/mode' && req.method === 'POST') {
    mode = url.searchParams.get('value') || 'off'
    console.log(`[admin] режим бэкенда: ${mode}`)
    return json(res, 200, { mode })
  }

  json(res, 404, { error: 'не найдено' })
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Мок-API: http://localhost:${PORT}`)
  console.log('События идут в Bugsink напрямую из браузера по DSN, не через этот сервер.')
})
