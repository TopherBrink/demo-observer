import { reactive, computed } from 'vue'
import * as Sentry from '@sentry/vue'

export const cart = reactive({ items: [] })

export function addToCart(product) {
  const existing = cart.items.find((i) => i.id === product.id)
  if (existing) existing.qty += 1
  else cart.items.push({ ...product, qty: 1 })
  // Раньше — addBreadcrumb() в наш ring-buffer. Ring-buffer теперь у Sentry
  // свой, встроенный: любая доменная крошка добавляется прямо в него.
  Sentry.addBreadcrumb({ category: 'cart', message: 'cart.add', data: { productId: product.id } })
}

export function removeFromCart(id) {
  cart.items = cart.items.filter((i) => i.id !== id)
  Sentry.addBreadcrumb({ category: 'cart', message: 'cart.remove', data: { productId: id } })
}

export function clearCart() {
  cart.items = []
}

/**
 * Здесь и рождается NaN.
 *
 * Код честный и обычный: цена минус скидка, умножить на количество.
 * Он ломается ровно тогда, когда price приходит строкой "12900.00",
 * а поле discount не приходит вовсе:
 *
 *   "12900.00" - null      === 12900   ← пронесло
 *   "12900.00" - undefined === NaN     ← приехали
 *
 * Исключения не возникает. Просто NaN, который дальше едет по всему
 * интерфейсу и всплывает уже при попытке оформить заказ.
 */
export const total = computed(() =>
  cart.items.reduce((sum, item) => sum + (item.price - item.discount) * item.qty, 0),
)

export const count = computed(() => cart.items.reduce((sum, item) => sum + item.qty, 0))
