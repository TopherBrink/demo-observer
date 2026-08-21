<template>
  <!-- obs-block: содержимое панели не попадает в запись сессии -->
  <div class="obs-block">
    <q-btn
      fab
      color="dark"
      icon="bug_report"
      class="fixed-bottom-right q-ma-md"
      style="z-index: 3000"
      @click="open = true"
    />

    <q-dialog v-model="open" position="right" full-height>
      <q-card style="width: 420px; max-width: 100vw">
        <q-card-section class="row items-center">
          <div class="text-h6">Слои наблюдаемости</div>
          <q-space />
          <q-btn flat dense icon="close" v-close-popup />
        </q-card-section>

        <q-separator />

        <q-card-section>
          <q-toggle v-model="flags.errors" label="0 — Ошибки (window/promise/vue)" />
          <q-toggle v-model="flags.network" label="1 — Сеть: тела ответов + traceparent" />
          <q-toggle v-model="flags.contracts" label="2 — Контракт API" />
          <q-toggle
            v-model="flags.contractsCoerce"
            :disable="!flags.contracts"
            label="2.5 — Чинить данные на лету"
            class="q-ml-lg"
          />
          <q-toggle v-model="flags.replay" label="3 — Запись сессии (rrweb)" />
          <q-toggle v-model="flags.native" label="4 — Нативный контекст" />
          <q-separator class="q-my-sm" />
          <q-toggle v-model="flags.transport" label="Отправлять на коллектор" />
        </q-card-section>

        <q-separator />

        <q-card-section>
          <div class="text-subtitle2 q-mb-sm">Адрес коллектора / API</div>
          <q-input
            v-model="config.collectorUrl"
            dense
            outlined
            label="URL коллектора"
            placeholder="http://192.168.1.114:8787"
            class="q-mb-sm"
          />
          <q-input
            v-model="config.apiUrl"
            dense
            outlined
            label="URL API"
            placeholder="http://192.168.1.114:8787"
          />
          <div class="row items-center justify-between q-mt-xs">
            <div class="text-caption text-grey-7">
              Меняется на лету, без пересборки — на случай, если IP машины на месте
              показа окажется другим. Сохраняется в этом устройстве.
            </div>
          </div>
          <q-btn
            flat
            dense
            size="sm"
            no-caps
            label="сбросить к значению из сборки"
            class="q-mt-xs"
            @click="resetEndpoints"
          />
        </q-card-section>

        <q-separator />

        <q-card-section>
          <div class="text-subtitle2 q-mb-sm">Сломать бэкенд</div>
          <q-btn-toggle
            v-model="brokenMode"
            no-caps
            spread
            :options="[
              { label: 'Норма', value: 'off' },
              { label: 'Типы', value: 'types' },
              { label: 'Хаос', value: 'chaos' },
            ]"
            @update:model-value="setBroken"
          />
          <div class="text-caption text-grey-7 q-mt-xs">
            «Типы» — акционные товары приходят со строковой ценой и discount: null.
            «Хаос» — плюс случайные 502 и задержки.
          </div>
        </q-card-section>

        <q-separator />

        <q-card-section>
          <div class="text-subtitle2 q-mb-sm">Сломать фронтенд</div>
          <div class="row q-gutter-sm">
            <q-btn size="sm" outline label="throw" @click="boom" />
            <q-btn size="sm" outline label="promise" @click="boomAsync" />
            <q-btn size="sm" outline label="битая картинка" @click="boomResource" />
            <q-btn size="sm" outline label="выгрузить запись" @click="flushReplay('manual')" />
          </div>
          <img v-if="showBadImage" src="/definitely-missing.png" style="display: none" alt="" />
        </q-card-section>

        <q-separator />

        <q-card-section>
          <div class="row justify-between text-caption">
            <span>в очереди: {{ stats.queued }}</span>
            <span>отправлено: {{ stats.sent }}</span>
            <span>схлопнуто: {{ stats.dropped }}</span>
          </div>
          <div v-if="replay.recording" class="text-caption q-mt-xs">
            запись: {{ replay.events }} событий ≈ {{ replay.approxKb }} КБ в памяти
          </div>
          <div v-if="stats.lastError" class="text-caption text-negative">{{ stats.lastError }}</div>
        </q-card-section>

        <q-separator />

        <q-card-section class="col-grow scroll" style="max-height: 40vh">
          <div class="text-subtitle2 q-mb-sm">Поток событий</div>
          <div v-for="event in recent" :key="event.id" class="q-mb-xs text-caption">
            <q-badge :color="levelColor(event.level)" :label="event.type" />
            <span class="q-ml-xs">{{ summarize(event) }}</span>
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { flags, config, resetEndpoints } from '../observability/flags'
import { stats, onEvent } from '../observability/transport'
import { flushReplay, replayStatus } from '../observability/replay'
import { requestRefetch } from '../observability/refetch'

const open = ref(false)
const recent = ref([])
const brokenMode = ref('off')
const showBadImage = ref(false)
const replay = ref(replayStatus())

let unsubscribe
let timer

onMounted(() => {
  unsubscribe = onEvent((event) => {
    recent.value.unshift(event)
    if (recent.value.length > 40) recent.value.pop()
  })
  timer = setInterval(() => (replay.value = replayStatus()), 1000)
})

onUnmounted(() => {
  unsubscribe?.()
  clearInterval(timer)
})

async function setBroken(mode) {
  await fetch(`${config.apiUrl}/api/admin/mode?value=${mode}`, { method: 'POST' })
  // Иначе смена режима не видна, пока кто-нибудь не дёрнет каталог руками —
  // а на сцене руки заняты микрофоном.
  await requestRefetch()
}

const boom = () => {
  throw new Error('Кнопка «throw» из панели докладчика')
}
const boomAsync = () => Promise.reject(new Error('Промис, который никто не поймал'))
const boomResource = () => (showBadImage.value = true)

const levelColor = (level) =>
  ({ error: 'negative', warning: 'orange', info: 'grey-7' })[level] || 'grey-7'

function summarize(event) {
  const p = event.payload || {}
  if (event.type === 'network') return `${p.method} ${short(p.url)} → ${p.status} (${p.durationMs} мс)`
  if (event.type === 'contract') return `${p.endpoint}: ${p.issues?.length} расхождений`
  if (event.type === 'error') return p.message
  if (event.type === 'native') return p.kind
  return JSON.stringify(p).slice(0, 80)
}

const short = (url) => String(url).replace(config.apiUrl, '')
</script>
