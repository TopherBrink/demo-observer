/**
 * Слой 5 — доставка. Собственная очередь (IndexedDB + батчи + sendBeacon)
 * не изменилась НИ СТРОЧКОЙ по сравнению с оригиналом — это ровно то, что
 * заточено под нестабильную мобильную сеть, и переписывать это не нужно.
 *
 * Изменилось только то, ЧТО именно уходит на сервер: вместо своего JSON
 * ({events: [...]}) на свой /collect — теперь envelope-формат Sentry на
 * DSN Bugsink/GlitchTip/Sentry, без официального SDK, только fetch/XHR.
 *
 * Честная цена этого решения (в отличие от @sentry/vue):
 *  - стек ошибки уходит СЫРОЙ строкой в extra.stack, а не разобранным по
 *    кадрам stacktrace.frames — Bugsink покажет "message"-issue с текстом
 *    стека внутри, а не кликабельные фреймы с привязкой к source map;
 *  - формат envelope и авторизация (X-Sentry-Auth) — недокументированный
 *    публично контракт вендора, а не стабильная спека; если Sentry когда-то
 *    поменяет протокол, чинить совместимость придётся тут, руками;
 *  - никакого release health / crash-free sessions — это отдельный вид
 *    envelope-айтема (session), который сюда не реализован.
 */
import { reactive } from 'vue'
import { config, flags } from './flags'
import { baseContext, hex, nextId, redact } from './session'

const DB_NAME = 'obs-queue'
const STORE = 'events'
const BATCH = 20
const FLUSH_MS = 5000
const MAX_QUEUE = 500

export const stats = reactive({ queued: 0, sent: 0, dropped: 0, failed: 0, lastError: null })

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

let dbPromise = null
const db = () => (dbPromise ||= openDb())

async function tx(mode, fn) {
  const database = await db()
  return new Promise((resolve, reject) => {
    const t = database.transaction(STORE, mode)
    const store = t.objectStore(STORE)
    const result = fn(store)
    t.oncomplete = () => resolve(result?.result ?? result)
    t.onerror = () => reject(t.error)
  })
}

const listeners = new Set()
export const onEvent = (fn) => (listeners.add(fn), () => listeners.delete(fn))

const seen = new Map()
function isDuplicate(event) {
  if (!event.fingerprint) return false
  const now = Date.now()
  const prev = seen.get(event.fingerprint)
  seen.set(event.fingerprint, now)
  if (prev && now - prev < 10_000) {
    stats.dropped += 1
    return true
  }
  return false
}

export async function capture(type, payload, options = {}) {
  const event = {
    id: nextId(),
    ts: Date.now(),
    type,
    level: options.level || 'info',
    fingerprint: options.fingerprint || null,
    payload: redact(payload),
    ctx: baseContext(),
  }

  listeners.forEach((fn) => {
    try {
      fn(event)
    } catch {
      /* слушатель дев-панели не должен ломать сбор */
    }
  })

  if (isDuplicate(event)) return event
  if (!flags.transport) return event

  try {
    await tx('readwrite', (store) => store.put(event))
    stats.queued += 1
    if (stats.queued >= BATCH) flush()
  } catch (e) {
    stats.lastError = String(e)
  }
  return event
}

/** DSN вида https://<public_key>@<host>[/<path-prefix>]/<project_id> — как у Sentry SDK. */
function parseDsn(dsn) {
  const url = new URL(dsn)
  const segments = url.pathname.replace(/^\//, '').split('/')
  const projectId = segments.pop()
  const prefix = segments.length ? `/${segments.join('/')}` : ''
  return {
    publicKey: url.username,
    envelopeUrl: `${url.protocol}//${url.host}${prefix}/api/${projectId}/envelope/`,
  }
}

function authHeader(publicKey) {
  return `Sentry sentry_version=7, sentry_client=obs-demo-native/1.0, sentry_key=${publicKey}`
}

/** Наша breadcrumb → breadcrumb в формате Sentry: {timestamp в секундах, category, message}. */
function toSentryBreadcrumb(crumb) {
  const { ts, kind, ...rest } = crumb
  return {
    timestamp: ts / 1000,
    category: kind,
    level: 'info',
    message: Object.keys(rest).length ? JSON.stringify(rest) : undefined,
  }
}

/**
 * Наше внутреннее событие → событие в схеме Sentry. Здесь и происходит
 * "потеря в переводе": message вместо разобранного exception, contexts.client
 * вместо специфичных top-level полей типа browser/os.
 */
function toSentryEvent(event) {
  const payload = event.payload || {}
  const breadcrumbs = Array.isArray(payload.breadcrumbs)
    ? { values: payload.breadcrumbs.map(toSentryBreadcrumb) }
    : undefined

  return {
    event_id: hex(16),
    timestamp: event.ts / 1000,
    platform: 'javascript',
    level: event.level,
    release: event.ctx?.release,
    tags: { kind: event.type },
    fingerprint: event.fingerprint ? [event.fingerprint] : undefined,
    message: payload.message || `событие типа ${event.type}`,
    breadcrumbs,
    contexts: { client: event.ctx },
    // Всё остальное (issues/raw/stack/repaired и т.п.) — как есть, "плоско".
    extra: { ...payload, breadcrumbs: undefined },
  }
}

function buildEnvelope(events, dsnString) {
  const { publicKey, envelopeUrl } = parseDsn(dsnString)
  const lines = [
    JSON.stringify({ event_id: hex(16), sent_at: new Date().toISOString(), dsn: dsnString }),
  ]
  for (const event of events) {
    lines.push(JSON.stringify({ type: 'event' }))
    lines.push(JSON.stringify(toSentryEvent(event)))
  }
  return { body: `${lines.join('\n')}\n`, envelopeUrl, publicKey }
}

let flushing = false
let backoff = 0

export async function flush({ beacon = false } = {}) {
  if (flushing || !flags.transport) return
  flushing = true
  try {
    if (!config.sentryDsn) {
      // Очередь не теряется — просто ждёт, пока DSN не пропишут в панели.
      stats.lastError = 'DSN не задан — события копятся в очереди'
      return
    }

    const batch = await tx('readonly', (store) => store.getAll(undefined, BATCH))
    if (!batch.length) return

    const { body, envelopeUrl, publicKey } = buildEnvelope(batch, config.sentryDsn)
    let ok = false

    if (beacon && navigator.sendBeacon) {
      ok = navigator.sendBeacon(envelopeUrl, new Blob([body], { type: 'application/x-sentry-envelope' }))
    } else {
      const res = await fetch(envelopeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-sentry-envelope',
          'X-Sentry-Auth': authHeader(publicKey),
        },
        body,
        keepalive: body.length < 60_000,
        obsIgnore: true,
      })
      ok = res.ok
    }

    if (ok) {
      await tx('readwrite', (store) => batch.forEach((e) => store.delete(e.id)))
      stats.sent += batch.length
      stats.queued = Math.max(0, stats.queued - batch.length)
      backoff = 0
    } else {
      throw new Error('Bugsink отклонил envelope')
    }
  } catch (e) {
    stats.failed += 1
    stats.lastError = String(e)
    backoff = Math.min(backoff ? backoff * 2 : 2000, 60_000)
    setTimeout(flush, backoff)
  } finally {
    flushing = false
    await trim()
  }
}

async function trim() {
  const count = await tx('readonly', (store) => store.count())
  const total = typeof count === 'number' ? count : 0
  stats.queued = total
  if (total <= MAX_QUEUE) return
  const all = await tx('readonly', (store) => store.getAll())
  const excess = all.sort((a, b) => a.ts - b.ts).slice(0, total - MAX_QUEUE)
  await tx('readwrite', (store) => excess.forEach((e) => store.delete(e.id)))
  stats.dropped += excess.length
}

export function startTransport() {
  setInterval(() => flush(), FLUSH_MS)
  addEventListener('online', () => flush())
  addEventListener('pagehide', () => flush({ beacon: true }))
  document.addEventListener('pause', () => flush({ beacon: true }), false)
  document.addEventListener('resume', () => flush(), false)
  flush()
}
