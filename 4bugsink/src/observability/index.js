import { installSentry } from './sentry'

export { flags, resetFlags, resetEndpoints, config } from './flags'
export { onEvent, reportHandled } from './sentry'
export { validate, ProductsStrict, ProductsLenient } from './contracts'

/**
 * Раньше initObservability() ставила пять перехватчиков (errors/network/native)
 * и стартовала свой транспорт — вручную, строчка за строчкой. Теперь это
 * один вызов installSentry(), который внутри себя делает то же самое через
 * Sentry.init(). Сравните с оригинальным src/observability/index.js — там
 * этот файл был "дирижёром" пяти модулей, здесь дирижировать почти нечем.
 */
export function initObservability({ app, router }) {
  installSentry({ app, router })
}
