import { boot } from 'quasar/wrappers'
import { initObservability } from '../observability'

export default boot(({ app, router }) => {
  initObservability({ app, router })
})
