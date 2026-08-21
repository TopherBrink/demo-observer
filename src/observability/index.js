import { watch } from 'vue'
import { flags } from './flags'
import { installBreadcrumbs } from './breadcrumbs'
import { installErrorCapture } from './errors'
import { installNetworkCapture } from './network'
import { installNativeContext } from './native'
import { startReplay, stopReplay } from './replay'
import { startTransport, capture } from './transport'

export { flags, resetFlags, config } from './flags'
export { capture, stats, onEvent, flush } from './transport'
export { reportHandled } from './errors'
export { addBreadcrumb, getBreadcrumbs } from './breadcrumbs'
export { validate, ProductsStrict, ProductsLenient } from './contracts'
export { replayStatus, flushReplay } from './replay'

/**
 * Перехватчики ставятся ВСЕГДА, а флаги решают, отправлять ли событие.
 * Так переключение слоя на докладе работает мгновенно, без перезагрузки.
 */
export function initObservability({ app, router }) {
  installBreadcrumbs(router)
  installNetworkCapture()
  installErrorCapture(app)
  installNativeContext()
  startTransport()

  watch(
    () => flags.replay,
    (on) => (on ? startReplay() : stopReplay()),
    { immediate: true },
  )

  capture('session', { kind: 'session.start' })
}
