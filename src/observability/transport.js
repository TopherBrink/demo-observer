/**
 * Слой 5 — доставка.
 *
 * Мобильное приложение живёт в лифте, в метро и в режиме энергосбережения.
 * Поэтому события сначала ложатся в IndexedDB, и только потом уходят пачками.
 * Если приложение убьют — очередь переживёт перезапуск.
 */
import { reactive } from 'vue'
import { config, flags } from './flags'
import { baseContext, nextId, redact } from './session'

const DB_NAME = 'obs-queue'
const STORE = 'events'
const BATCH = 20
const FLUSH_MS = 5000
const MAX_QUEUE = 500

export const stats = reactive({ queued: 0, sent: 0, dropped: 0, failed: 0, lastError: null })

/** Мини-обёртка над IndexedDB: тащить idb-keyval ради трёх операций не нужно. */
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

/** Схлопывание одинаковых событий: 200 одинаковых ошибок в цикле нам не нужны. */
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

let flushing = false
let backoff = 0

export async function flush({ beacon = false } = {}) {
  if (flushing || !flags.transport) return
  flushing = true
  try {
    const batch = await tx('readonly', (store) => store.getAll(undefined, BATCH))
    if (!batch.length) return

    const body = JSON.stringify({ events: batch })
    let ok = false

    if (beacon && navigator.sendBeacon) {
      // На pagehide обычный fetch уже могут не дать доделать
      ok = navigator.sendBeacon(`${config.collectorUrl}/collect`, new Blob([body], { type: 'application/json' }))
    } else {
      const res = await fetch(`${config.collectorUrl}/collect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: body.length < 60_000,
        // важно: этот запрос не должен попасть в собственный перехватчик сети
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
      throw new Error('collector отклонил пачку')
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

/** Очередь не должна расти бесконечно, если коллектор недоступен неделю. */
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

/** Реплей уходит отдельным каналом: он тяжёлый и его не надо смешивать с событиями. */
export async function sendReplay(events, meta) {
  if (!flags.transport || !events.length) return
  try {
    await fetch(`${config.collectorUrl}/collect/replay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...meta, events }),
      obsIgnore: true,
    })
  } catch (e) {
    stats.lastError = String(e)
  }
}

export function startTransport() {
  setInterval(() => flush(), FLUSH_MS)
  addEventListener('online', () => flush())
  addEventListener('pagehide', () => flush({ beacon: true }))
  // Cordova: приложение свернули — момент, когда его вот-вот убьёт система
  document.addEventListener('pause', () => flush({ beacon: true }), false)
  document.addEventListener('resume', () => flush(), false)
  flush()
}
