/**
 * Слой 0 — поймать всё, что падает.
 *
 * На докладе полезно показать, что одного window.onerror мало:
 *  - промисы падают мимо него;
 *  - битые картинки/скрипты не всплывают, ловятся только в фазе перехвата;
 *  - нарушения CSP — отдельное событие;
 *  - ошибки внутри Vue-компонентов гасятся самим Vue.
 */
import { flags } from './flags'
import { capture } from './transport'
import { addBreadcrumb, getBreadcrumbs } from './breadcrumbs'
import { getReplayBuffer, flushReplay } from './replay'

function report(kind, data, error) {
  if (!flags.errors) return
  const payload = {
    kind,
    message: data.message || String(error?.message || error || 'unknown'),
    stack: error?.stack || null,
    ...data,
    breadcrumbs: getBreadcrumbs(),
  }
  capture('error', payload, {
    level: 'error',
    fingerprint: `${kind}:${payload.message}:${data.source || ''}`,
  })
  // Ошибка — триггер выгрузки буфера записи сессии
  if (flags.replay && getReplayBuffer().length) flushReplay('error')
}

export function installErrorCapture(app) {
  addEventListener('error', (event) => {
    // Битый ресурс: у события нет message, зато есть target
    if (event.target && event.target !== window && event.target.tagName) {
      report('resource', {
        message: `не загрузился ${event.target.tagName.toLowerCase()}`,
        source: event.target.src || event.target.href || null,
      })
      return
    }
    report('js', {
      message: event.message,
      source: event.filename,
      position: `${event.lineno}:${event.colno}`,
    }, event.error)
  }, true) // capture: true — иначе ресурсы не поймаем

  addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    report('promise', { message: reason?.message || String(reason) }, reason)
  })

  addEventListener('securitypolicyviolation', (event) => {
    report('csp', {
      message: `CSP заблокировал ${event.violatedDirective}`,
      source: event.blockedURI,
    })
  })

  if (app) {
    const previous = app.config.errorHandler
    app.config.errorHandler = (error, instance, info) => {
      report('vue', {
        message: error?.message,
        component: instance?.$options?.name || instance?.$?.type?.__name || 'anonymous',
        lifecycle: info,
      }, error)
      previous?.(error, instance, info)
      if (import.meta.env?.DEV) console.error(error)
    }
    app.config.warnHandler = (msg, _instance, trace) => {
      addBreadcrumb({ kind: 'vue.warn', message: msg, trace: String(trace).slice(0, 300) })
    }
  }
}

/** Ручная отправка: `reportHandled(e, { where: 'оформление заказа' })` */
export function reportHandled(error, context = {}) {
  report('handled', { message: error?.message, ...context }, error)
}
