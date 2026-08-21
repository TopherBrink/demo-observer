<template>
  <q-page padding>
    <div class="row items-center justify-between q-mb-md">
      <div class="text-h6">Каталог</div>
      <q-btn flat icon="shopping_cart" :label="count" to="/cart" data-obs-label="открыть корзину" />
    </div>

    <q-banner v-if="issues.length" class="bg-orange-2 q-mb-md">
      <template #avatar><q-icon name="warning" /></template>
      Ответ сервера не совпал с ожиданиями фронтенда: {{ issues.length }}
      {{ issues.length === 1 ? 'расхождение' : 'расхождений' }}.
      <div class="text-caption q-mt-xs">
        <div v-for="(issue, i) in issues.slice(0, 4)" :key="i">
          {{ issue.path }}: ждали {{ issue.expected }}, пришло {{ issue.received }} ({{ issue.actual }})
        </div>
      </div>
      <div v-if="repaired" class="text-caption text-weight-medium q-mt-xs">
        Данные приведены к ожидаемым типам на лету — интерфейс работает, но контракт всё равно сломан.
      </div>
    </q-banner>

    <q-inner-loading :showing="loading" />

    <div class="row q-col-gutter-md">
      <div v-for="product in products" :key="product.id" class="col-12 col-sm-6 col-md-4">
        <q-card flat bordered>
          <q-card-section>
            <div class="text-subtitle1">{{ product.title }}</div>
            <div class="text-caption text-grey-7">Осталось: {{ product.stock }}</div>
            <div class="text-h6 q-mt-sm">
              {{ formatPrice(product.price - product.discount) }}
              <q-badge v-if="product.sale" color="red" class="q-ml-sm">Акция</q-badge>
            </div>
          </q-card-section>
          <q-card-actions>
            <q-btn
              flat
              color="primary"
              label="В корзину"
              :data-obs-label="`добавить ${product.id}`"
              @click="addToCart(product)"
            />
          </q-card-actions>
        </q-card>
      </div>
    </div>
  </q-page>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { fetchProducts } from '../api/catalog'
import { addToCart, count } from '../stores/cart'

const products = ref([])
const issues = ref([])
const repaired = ref(false)
const loading = ref(true)

const formatPrice = (value) => `${value} ₽`

onMounted(async () => {
  try {
    const result = await fetchProducts()
    products.value = result.products
    issues.value = result.issues
    repaired.value = result.repaired
  } finally {
    loading.value = false
  }
})
</script>
