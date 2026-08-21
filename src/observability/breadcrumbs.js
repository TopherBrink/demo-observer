/**
 * Хлебные крошки — это ваша нынешняя «очередь действий», только:
 *  1) она не отправляется сама по себе, а прикрепляется к ошибке;
 *  2) в неё пишут не только клики, но и сеть, навигация, консоль, состояние.
 *
 * Это ключевая мысль доклада: список действий полезен как КОНТЕКСТ к ошибке,
 * а не как самостоятельный лог. Сам по себе он отвечает на вопрос «что нажимали»,
 * а не на вопрос «какие данные при этом были».
 */
import { config } from './flags'

const ring = []

export function addBreadcrumb(crumb) {
  ring.push({ ts: Date.now(), ...crumb })
  if (ring.length > config.breadcrumbLimit) ring.shift()
}

export const getBreadcrumbs = () => ring.slice()

export function installBreadcrumbs(router) {
  // Клики: сохраняем «путь» до элемента, а не текст (в тексте бывают ФИО и телефоны)
  addEventListener(
    'click',
    (e) => {
      const el = e.target?.closest?.('button, a, [role="button"], .q-item')
      if (!el) return
      addBreadcrumb({
        kind: 'ui.click',
        selector: describe(el),
        label: el.dataset?.obsLabel || null,
      })
    },
    { capture: true, passive: true },
  )

  // Консоль: warn/error попадают в контекст, но не в отправку сами по себе
  for (const level of ['warn', 'error']) {
    const original = console[level].bind(console)
    console[level] = (...args) => {
      addBreadcrumb({ kind: `console.${level}`, message: args.map(safeString).join(' ').slice(0, 500) })
      original(...args)
    }
  }

  if (router) {
    router.afterEach((to, from) => {
      addBreadcrumb({ kind: 'navigation', from: from.fullPath, to: to.fullPath })
    })
  }

  addEventListener('online', () => addBreadcrumb({ kind: 'net.online' }))
  addEventListener('offline', () => addBreadcrumb({ kind: 'net.offline' }))
  document.addEventListener('visibilitychange', () =>
    addBreadcrumb({ kind: 'app.visibility', state: document.visibilityState }),
  )
}

function describe(el) {
  const parts = []
  let node = el
  for (let i = 0; node && i < 3; i += 1) {
    let part = node.tagName?.toLowerCase() || ''
    if (node.id) part += `#${node.id}`
    else if (node.className && typeof node.className === 'string') {
      const cls = node.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.')
      if (cls) part += `.${cls}`
    }
    parts.unshift(part)
    node = node.parentElement
  }
  return parts.join(' > ')
}

function safeString(v) {
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}
