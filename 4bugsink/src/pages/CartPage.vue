<template>
  <q-page padding>
    <div class="text-h6 q-mb-md">Корзина</div>

    <q-list v-if="cart.items.length" bordered separator>
      <q-item v-for="item in cart.items" :key="item.id">
        <q-item-section>
          <q-item-label>{{ item.title }}</q-item-label>
          <q-item-label caption>{{ item.qty }} шт.</q-item-label>
        </q-item-section>
        <q-item-section side>
          {{ (item.price - item.discount) * item.qty }} ₽
        </q-item-section>
        <q-item-section side>
          <q-btn flat dense icon="close" @click="removeFromCart(item.id)" />
        </q-item-section>
      </q-item>
    </q-list>

    <div v-else class="text-grey-7">Пока пусто. Добавьте товар из каталога.</div>

    <div v-if="cart.items.length" class="q-mt-lg">
      <div class="text-h5">Итого: {{ total }} ₽</div>
      <q-btn
        color="primary"
        class="q-mt-md"
        label="Оформить заказ"
        data-obs-label="оформить заказ"
        :loading="sending"
        @click="checkout"
      />
      <div v-if="error" class="text-negative q-mt-sm">{{ error }}</div>
    </div>
  </q-page>
</template>

<script setup>
import { ref } from 'vue'
import { cart, total, removeFromCart, clearCart } from '../stores/cart'
import { submitOrder } from '../api/catalog'
import { reportHandled } from '../observability/sentry'

const sending = ref(false)
const error = ref('')

async function checkout() {
  sending.value = true
  error.value = ''
  try {
    // Сервер отвергает NaN — и пользователь видит ровно это сообщение.
    // Ни оно, ни очередь действий не объясняют, откуда взялся NaN.
    await submitOrder(cart.items.map((i) => ({ id: i.id, qty: i.qty, sum: (i.price - i.discount) * i.qty })))
    clearCart()
  } catch (e) {
    error.value = 'Не удалось оформить заказ. Попробуйте позже.'
    reportHandled(e, { where: 'checkout', total: total.value })
  } finally {
    sending.value = false
  }
}
</script>
