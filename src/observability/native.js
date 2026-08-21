/**
 * Слой 4 — то, что JS о себе не знает.
 *
 * JS-мониторинг не видит:
 *  - падение самого WebView,
 *  - убийство процесса системой по нехватке памяти,
 *  - ANR,
 *  - ошибки внутри нативной части плагинов.
 *
 * Полностью это закрывают только нативные SDK (Sentry Android/iOS, Firebase
 * Crashlytics). Но 80% пользы даёт простой приём: heartbeat + флаг «сессия
 * закрыта штатно». Если при старте видим незакрытую сессию — предыдущий запуск
 * умер аварийно. Это позволяет хотя бы СЧИТАТЬ такие случаи и видеть,
 * на каких устройствах они происходят.
 */
import { flags } from './flags'
import { capture } from './transport'
import { addBreadcrumb } from './breadcrumbs'
import { sessionId } from './session'

const KEY = 'obs.session.open'

export function installNativeContext() {
  detectUncleanShutdown()
  markSessionOpen()

  document.addEventListener('deviceready', () => {
    const device = globalThis.device || {}
    capture('native', {
      kind: 'deviceready',
      platform: device.platform || null,
      osVersion: device.version || null,
      model: device.model || null,
      manufacturer: device.manufacturer || null,
      cordova: device.cordova || null,
      isVirtual: device.isVirtual ?? null,
    })
  }, false)

  document.addEventListener('pause', () => {
    addBreadcrumb({ kind: 'app.pause' })
    touch({ paused: true })
  }, false)

  document.addEventListener('resume', () => {
    addBreadcrumb({ kind: 'app.resume' })
    touch({ paused: false })
  }, false)

  document.addEventListener('backbutton', () => addBreadcrumb({ kind: 'app.backbutton' }), false)

  addEventListener('pagehide', markSessionClosed)
  addEventListener('beforeunload', markSessionClosed)

  // Heartbeat: раз в 5 секунд обновляем «последний признак жизни».
  // Разница между ним и стартом следующей сессии = момент смерти.
  setInterval(() => touch(), 5000)

  // Память: есть только в Chromium, но именно там и происходят OOM-киллы
  if (performance.memory) {
    setInterval(() => {
      const used = performance.memory.usedJSHeapSize / 1048576
      const limit = performance.memory.jsHeapSizeLimit / 1048576
      if (used / limit > 0.85) {
        capture('native', {
          kind: 'memory.pressure',
          usedMb: Math.round(used),
          limitMb: Math.round(limit),
        }, { level: 'warning', fingerprint: 'memory.pressure' })
      }
    }, 15_000)
  }
}

function markSessionOpen() {
  write({ sessionId, startedAt: Date.now(), lastSeen: Date.now(), paused: false })
}

function touch(patch = {}) {
  const current = read()
  if (!current || current.sessionId !== sessionId) return
  write({ ...current, ...patch, lastSeen: Date.now() })
}

function markSessionClosed() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

function detectUncleanShutdown() {
  const previous = read()
  if (!previous) return
  markSessionClosed()
  if (!flags.native) return

  capture(
    'native',
    {
      kind: 'session.unclean_shutdown',
      previousSessionId: previous.sessionId,
      // Свернули и убили — это ожидаемо. Убили в активном состоянии — подозрительно.
      wasPaused: previous.paused,
      aliveMs: previous.lastSeen - previous.startedAt,
      deadForMs: Date.now() - previous.lastSeen,
    },
    { level: previous.paused ? 'info' : 'error', fingerprint: 'session.unclean_shutdown' },
  )
}

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null')
  } catch {
    return null
  }
}

function write(value) {
  try {
    localStorage.setItem(KEY, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}
