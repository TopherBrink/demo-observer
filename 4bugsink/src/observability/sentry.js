/**
 * Слои 0 + 1 на @sentry/vue — то, что раньше было errors.js + network.js + breadcrumbs.js
 * (около 250 строк вручную) сжимается до Sentry.init() с парой интеграций.
 *
 * Что Sentry.init() даёт бесплатно, без единой строчки своего кода:
 *  - window.onerror + unhandledrejection (интеграция GlobalHandlers);
 *  - app.config.errorHandler для Vue (передаём `app` прямо в init);
 *  - console.warn/error, клики, навигация роутера — как breadcrumbs (Breadcrumbs-интеграция);
 *  - перехват fetch/XHR как breadcrumbs + автоматическая простановка заголовка
 *    трассировки (sentry-trace/baggage) через browserTracingIntegration — это
 *    прямой аналог самодельного traceparent из старой версии, только формат
 *    заголовка sentry-trace: "<trace_id>-<span_id>-<sampled>", а не W3C traceparent;
 *  - дедупликация одинаковых ошибок (интеграция Dedupe) — заменяет наш fingerprint
 *    в transport.js;
 *  - надёжная доставка с ретраями, а при желании и офлайн-очередь в IndexedDB
 *    через makeBrowserOfflineTransport — аналог самодельной очереди из transport.js.
 *
 * Что придётся дописать руками — этих вещей нет "из коробки":
 *  - битые ресурсы (картинки/скрипты) и CSP-violations Sentry не ловит сам;
 *  - тела запросов/ответов в breadcrumbs не попадают (сознательное решение
 *    вендора ради приватности по умолчанию) — для слоя 1 это самое ценное поле,
 *    поэтому ниже есть отдельная тонкая обёртка именно для тел;
 *  - живое включение/выключение слоя без перезагрузки (наша фишка для доклада)
 *    не встроено в SDK — реализовано через beforeSend/beforeBreadcrumb, см. ниже.
 *    Глубокая инструментация fetch/XHR внутри browserTracingIntegration при этом
 *    переключить на лету нельзя — это честное ограничение по сравнению со старой
 *    версией, где мы патчили fetch/XHR сами и полностью управляли патчем.
 */
import * as Sentry from '@sentry/vue'
import { config, flags } from './flags'
import { baseContext, truncate } from './session'
import { redact } from './session'

const recentListeners = new Set()
/** Живой поток событий для DevPanel — аналог onEvent() из старого transport.js. */
export const onEvent = (fn) => (recentListeners.add(fn), () => recentListeners.delete(fn))

export function installSentry({ app, router }) {
  Sentry.init({
    app,
    dsn: config.sentryDsn || undefined, // без DSN SDK работает вхолостую — удобно, пока Bugsink не поднят
    release: config.release,
    tracesSampleRate: 1.0,
    tracePropagationTargets: config.traceTargets,

    integrations: [
      Sentry.browserTracingIntegration({ router }),
    ],

    // Резервная офлайн-очередь на случай нестабильной мобильной сети —
    // opt-in, в отличие от нашей IndexedDB-очереди, которая была включена всегда.
    transport: Sentry.makeBrowserOfflineTransport(Sentry.makeFetchTransport),

    beforeBreadcrumb(breadcrumb) {
      // http-breadcrumbs шлёт browserTracingIntegration сам; здесь только гасим
      // их, если слой 1 выключен флагом — тела запросов добавляет attachBody() ниже.
      if (breadcrumb.category === 'fetch' && !flags.network) return null
      return breadcrumb
    },

    // Единая точка, где флаги решают, отправлять ли то, что уже перехвачено.
    // Это прямой аналог `if (!flags.X) return` в начале каждой функции report()
    // старой версии — просто собранный в одном месте, а не размазанный по файлам.
    beforeSend(event) {
      recentListeners.forEach((fn) => fn(event))
      if (!flags.transport) return null
      const isContract = event.tags?.kind === 'contract'
      if (isContract) return flags.contracts ? event : null
      return flags.errors ? event : null
    },
  })

  Sentry.setContext('client', baseContext())
  installResourceAndCspCapture()
  if (flags.network) attachBodyCapture()
}

/**
 * Sentry не ловит битые ресурсы и CSP — это события уровня window, а не
 * исключения/промисы, которые слушает GlobalHandlers. Раньше это было
 * частью errors.js, здесь — единственный кусок слоя 0, который остался ручным.
 */
function installResourceAndCspCapture() {
  addEventListener(
    'error',
    (event) => {
      if (!(event.target && event.target !== window && event.target.tagName)) return
      Sentry.captureMessage(`не загрузился ${event.target.tagName.toLowerCase()}`, {
        level: 'error',
        tags: { kind: 'resource' },
        extra: { source: event.target.src || event.target.href || null },
      })
    },
    true,
  )

  addEventListener('securitypolicyviolation', (event) => {
    Sentry.captureMessage(`CSP заблокировал ${event.violatedDirective}`, {
      level: 'error',
      tags: { kind: 'csp' },
      extra: { source: event.blockedURI },
    })
  })
}

/**
 * Тела запросов/ответов Sentry не добавляет в breadcrumbs по умолчанию —
 * это тот самый минимум ручного кода, без которого слой 1 теряет смысл
 * (см. комментарий в оригинальном network.js: "без тела ответа разбор невозможен").
 * Патчим только fetch: XHR-эквивалент (для axios) делается тем же приёмом
 * на XMLHttpRequest.prototype.send, здесь опущен ради краткости демо-версии.
 */
function attachBodyCapture() {
  const original = globalThis.fetch
  if (!original || original.__obsPatched) return

  const patched = async function (input, init = {}) {
    if (init.obsIgnore) return original(input, init)
    const url = typeof input === 'string' ? input : input.url
    const method = (init.method || input?.method || 'GET').toUpperCase()

    try {
      const response = await original(input, init)
      if (flags.network && contentTypeIsText(response.headers)) {
        const clone = response.clone()
        clone
          .text()
          .then((text) => {
            Sentry.addBreadcrumb({
              category: 'http.body',
              level: response.ok ? 'info' : 'warning',
              message: `${method} ${url} → ${response.status}`,
              data: { responseBody: truncate(redact(text)) },
            })
          })
          .catch(() => {})
      }
      return response
    } catch (error) {
      Sentry.addBreadcrumb({
        category: 'http.body',
        level: 'error',
        message: `${method} ${url} → сеть недоступна`,
      })
      throw error
    }
  }

  patched.__obsPatched = true
  globalThis.fetch = patched
}

function contentTypeIsText(headers) {
  const ct = headers?.get?.('content-type') || ''
  return /json|text|xml|javascript/.test(ct)
}

/** Замена reportHandled() из errors.js — та же роль, другой SDK под капотом. */
export function reportHandled(error, context = {}) {
  Sentry.captureException(error, { extra: context })
}

/** Замена capture('contract', ...) из transport.js — используется contracts.js. */
export function captureContractIssue(payload, { fingerprint } = {}) {
  Sentry.captureMessage(`расхождение контракта: ${payload.endpoint}`, {
    level: 'warning',
    tags: { kind: 'contract' },
    fingerprint: fingerprint ? [fingerprint] : undefined,
    extra: payload,
  })
}
