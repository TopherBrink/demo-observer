/**
 * Слой 1 — сеть как источник событий.
 *
 * Это тот самый слой, которого не хватало: в очереди действий видно
 * «открыл каталог», но не видно, ЧТО пришло с бэкенда.
 *
 * Два ключевых момента для доклада:
 *  1. Тело ответа. Обрезаем, чистим — но сохраняем. Без него разбор невозможен.
 *  2. traceparent. Клиент генерирует id и шлёт его на бэкенд; бэкенд пишет
 *     тот же id в свои логи. После этого от ошибки на телефоне вы попадаете
 *     в серверный лог конкретного запроса. Это стык клиента и сервера.
 */
import { config, flags } from './flags'
import { capture } from './transport'
import { addBreadcrumb } from './breadcrumbs'
import { newTraceparent, truncate } from './session'

const shouldTrace = (url) => config.traceTargets.some((re) => re.test(url))

function contentTypeIsText(headers) {
  const ct = headers?.get?.('content-type') || ''
  return /json|text|xml|javascript/.test(ct)
}

function record(entry) {
  const level = entry.status === 0 || entry.status >= 500 ? 'error' : entry.status >= 400 ? 'warning' : 'info'
  addBreadcrumb({
    kind: 'http',
    method: entry.method,
    url: entry.url,
    status: entry.status,
    ms: entry.durationMs,
    traceId: entry.traceId,
  })
  if (!flags.network) return
  capture('network', entry, { level })
}

export function installNetworkCapture() {
  patchFetch()
  patchXhr()
}

function patchFetch() {
  const original = globalThis.fetch
  if (!original || original.__obsPatched) return

  const patched = async function (input, init = {}) {
    // Собственные запросы коллектора не перехватываем — иначе бесконечный цикл
    if (init.obsIgnore || (input?.obsIgnore ?? false)) return original(input, init)

    const url = typeof input === 'string' ? input : input.url
    const method = (init.method || input?.method || 'GET').toUpperCase()
    const started = performance.now()

    let traceId = null
    if (flags.network && shouldTrace(url)) {
      const trace = newTraceparent()
      traceId = trace.traceId
      // Внимание: кастомный заголовок = preflight. Бэкенд должен разрешить
      // traceparent в Access-Control-Allow-Headers, иначе запрос упадёт.
      const headers = new Headers(init.headers || input?.headers || {})
      headers.set('traceparent', trace.traceparent)
      init = { ...init, headers }
    }

    const entry = {
      method,
      url,
      traceId,
      requestBody: flags.network ? truncate(readBody(init.body)) : undefined,
    }

    try {
      const response = await original(input, init)
      entry.status = response.status
      entry.durationMs = Math.round(performance.now() - started)
      entry.serverTraceId = response.headers.get('x-trace-id') || null

      if (flags.network && contentTypeIsText(response.headers)) {
        // clone() обязателен: тело можно прочитать только один раз
        const clone = response.clone()
        try {
          entry.responseBody = truncate(await clone.text())
        } catch {
          entry.responseBody = '[не удалось прочитать]'
        }
      }
      record(entry)
      return response
    } catch (error) {
      entry.status = 0
      entry.durationMs = Math.round(performance.now() - started)
      entry.error = String(error?.message || error)
      record(entry)
      throw error
    }
  }

  patched.__obsPatched = true
  globalThis.fetch = patched
}

/**
 * XHR патчим отдельно: axios в браузере ходит через XHR, а Quasar-приложения
 * почти всегда на axios. Забудете — половина запросов останется невидимой.
 */
function patchXhr() {
  const XHR = globalThis.XMLHttpRequest
  if (!XHR || XHR.prototype.__obsPatched) return

  const open = XHR.prototype.open
  const send = XHR.prototype.send
  const setHeader = XHR.prototype.setRequestHeader

  XHR.prototype.open = function (method, url, ...rest) {
    this.__obs = { method: String(method).toUpperCase(), url: String(url), headers: {} }
    return open.call(this, method, url, ...rest)
  }

  XHR.prototype.setRequestHeader = function (name, value) {
    if (this.__obs) this.__obs.headers[name.toLowerCase()] = value
    return setHeader.call(this, name, value)
  }

  XHR.prototype.send = function (body) {
    const meta = this.__obs
    if (!meta) return send.call(this, body)

    const started = performance.now()
    if (flags.network && shouldTrace(meta.url)) {
      const trace = newTraceparent()
      meta.traceId = trace.traceId
      try {
        setHeader.call(this, 'traceparent', trace.traceparent)
      } catch {
        /* заголовок мог быть уже отправлен */
      }
    }

    const finish = () => {
      const entry = {
        method: meta.method,
        url: meta.url,
        traceId: meta.traceId || null,
        status: this.status,
        durationMs: Math.round(performance.now() - started),
        requestBody: flags.network ? truncate(readBody(body)) : undefined,
      }
      if (flags.network) {
        const type = this.getResponseHeader?.('content-type') || ''
        if (/json|text|xml/.test(type) && typeof this.responseText === 'string') {
          entry.responseBody = truncate(this.responseText)
        }
        entry.serverTraceId = this.getResponseHeader?.('x-trace-id') || null
      }
      record(entry)
    }

    this.addEventListener('loadend', finish, { once: true })
    return send.call(this, body)
  }

  XHR.prototype.__obsPatched = true
}

function readBody(body) {
  if (!body) return undefined
  if (typeof body === 'string') return body
  if (body instanceof URLSearchParams) return body.toString()
  if (body instanceof FormData) return '[FormData]'
  if (body instanceof Blob) return `[Blob ${body.size} байт]`
  try {
    return JSON.stringify(body)
  } catch {
    return '[не сериализуется]'
  }
}
