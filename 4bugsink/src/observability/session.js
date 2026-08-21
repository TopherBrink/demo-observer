/**
 * Идентификаторы и контекст. Одна сессия = один запуск приложения.
 *
 * traceparent здесь больше нет: W3C trace-заголовок теперь генерирует сам
 * @sentry/vue (заголовок sentry-trace) через tracePropagationTargets в
 * sentry.js — вручную его собирать не нужно.
 */
import { config } from './flags'

export const hex = (bytes) => {
  const arr = new Uint8Array(bytes)
  ;(globalThis.crypto || {}).getRandomValues?.(arr) ||
    arr.forEach((_, i) => (arr[i] = Math.floor(Math.random() * 256)))
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
}

export const sessionId = hex(8)

let seq = 0
export const nextId = () => `${sessionId}-${(seq++).toString(36)}`

function parseWebViewVersion(ua) {
  const chrome = /Chrome\/(\d+)/.exec(ua)
  if (chrome) return { engine: 'chromium', version: chrome[1] }
  const wk = /Version\/([\d.]+).*Safari/.exec(ua)
  if (wk) return { engine: 'webkit', version: wk[1] }
  return { engine: 'unknown', version: null }
}

/**
 * То же самое, что раньше уходило в поле ctx каждого события транспорта.
 * В версии с Sentry это передаётся через Sentry.setContext() — см. installSentry().
 */
export function baseContext() {
  const ua = navigator.userAgent
  return {
    sessionId,
    release: config.release,
    url: location.href,
    webview: parseWebViewVersion(ua),
    screen: `${screen.width}x${screen.height}@${devicePixelRatio}`,
    lang: navigator.language,
    online: navigator.onLine,
    memoryGb: navigator.deviceMemory ?? null,
    cores: navigator.hardwareConcurrency ?? null,
    connection: navigator.connection
      ? {
          type: navigator.connection.effectiveType,
          downlink: navigator.connection.downlink,
          saveData: navigator.connection.saveData,
        }
      : null,
  }
}

const RE_LONG_DIGITS = /\b\d{10,}\b/g
const RE_EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g

/** Рекурсивно вырезает чувствительные значения. Работает и по ключу, и по виду значения. */
export function redact(value, depth = 0) {
  if (depth > 6) return '[deep]'
  if (value == null) return value
  if (typeof value === 'string') {
    return value.replace(RE_EMAIL, '[email]').replace(RE_LONG_DIGITS, '[digits]')
  }
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1))

  const out = {}
  for (const [k, v] of Object.entries(value)) {
    out[k] = config.redactKeys.includes(k.toLowerCase()) ? '[redacted]' : redact(v, depth + 1)
  }
  return out
}

export function truncate(text, limit = config.maxBodyChars) {
  if (typeof text !== 'string') return text
  return text.length > limit ? `${text.slice(0, limit)}…[+${text.length - limit} симв.]` : text
}
