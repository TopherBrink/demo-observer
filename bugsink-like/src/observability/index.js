import { installBreadcrumbs } from './breadcrumbs'
import { installErrorCapture } from './errors'
import { installNetworkCapture } from './network'
import { startTransport, capture } from './transport'

export { flags, resetFlags, resetEndpoints, config } from './flags'
export { capture, stats, onEvent, flush } from './transport'
export { reportHandled } from './errors'
export { addBreadcrumb, getBreadcrumbs } from './breadcrumbs'
export { validate, ProductsStrict, ProductsLenient } from './contracts'

/**
 * Перехватчики ставятся ВСЕГДА, а флаги решают, отправлять ли событие.
 * Единственное отличие от оригинала — нет ветки на flags.replay: слоя 3
 * в этой версии нет вообще, включая watch() на его включение/выключение.
 */
export function initObservability({ app, router }) {
  installBreadcrumbs(router)
  installNetworkCapture()
  installErrorCapture(app)
  startTransport()

  capture('session', { kind: 'session.start' })
}
