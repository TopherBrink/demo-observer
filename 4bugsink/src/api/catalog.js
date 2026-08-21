/**
 * Единственная точка, где данные с сервера превращаются в состояние приложения.
 * Именно поэтому валидация контракта живёт здесь, а не в компонентах.
 * Не изменилось ничего, кроме источника reportHandled() (теперь из sentry.js).
 */
import { config } from '../observability/flags'
import { validate, ProductsStrict, ProductsLenient } from '../observability/contracts'
import { reportHandled } from '../observability/sentry'

export async function fetchProducts() {
  const response = await fetch(`${config.apiUrl}/api/products`)
  if (!response.ok) {
    const error = new Error(`каталог недоступен: HTTP ${response.status}`)
    reportHandled(error, { where: 'fetchProducts', status: response.status })
    throw error
  }

  const raw = await response.json()
  const traceId = response.headers.get('x-trace-id')

  const { data, issues, repaired } = validate(ProductsStrict, ProductsLenient, raw, {
    endpoint: 'GET /api/products',
    traceId,
  })

  return { products: data, issues, repaired }
}

export async function submitOrder(items) {
  const response = await fetch(`${config.apiUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  })
  if (!response.ok) throw new Error(`заказ не отправлен: HTTP ${response.status}`)
  return response.json()
}
