/**
 * Идентификаторы и контекст. Одна сессия = один запуск приложения.
 *
 * Важное для мобилок: sessionId нужен ещё и для того, чтобы понять,
 * что предыдущий запуск завершился аварийно (см. native.js).
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

/** W3C Trace Context: 00-<32 hex trace-id>-<16 hex span-id>-01 */
export function newTraceparent() {
  const traceId = hex(16)
  const spanId = hex(8)
  return { traceparent: `00-${traceId}-${spanId}-01`, traceId, spanId }
}

function parseWebViewVersion(ua) {
  const chrome = /Chrome\/(\d+)/.exec(ua)
  if (chrome) return { engine: 'chromium', version: chrome[1] }
  const wk = /Version\/([\d.]+).*Safari/.exec(ua)
  if (wk) return { engine: 'webkit', version: wk[1] }
  return { engine: 'unknown', version: null }
}

/**
 * cordova-plugin-device — не UA-эвристика, а то, что реально сказала ОС:
 * модель, производитель, версия Android. Появляется только после
 * deviceready, поэтому до него device будет null — это нормально, событий
 * настолько рано в жизни сессии почти не бывает.
 *
 * Намеренно НЕ берём device.uuid: это устойчивый идентификатор устройства,
 * а не диагностика — ему нечего делать в отчёте об ошибке.
 */
function deviceContext() {
  const d = globalThis.device
  if (!d) return null
  return {
    platform: d.platform || null,
    osVersion: d.version || null,
    model: d.model || null,
    manufacturer: d.manufacturer || null,
    isVirtual: d.isVirtual ?? null,
  }
}

export function baseContext() {
  const ua = navigator.userAgent
  return {
    sessionId,
    release: config.release,
    url: location.href,
    origin: location.origin, // https://localhost в cordova-android 10+
    webview: parseWebViewVersion(ua),
    device: deviceContext(),
    screen: `${screen.width}x${screen.height}@${devicePixelRatio}`,
    lang: navigator.language,
    online: navigator.onLine,
    // Есть не везде, но на Android даёт понять, что устройство слабое
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
