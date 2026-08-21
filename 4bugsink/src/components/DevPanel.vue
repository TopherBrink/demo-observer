<template>
  <div>
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
          <div class="text-h6">Слои наблюдаемости (Sentry-версия)</div>
          <q-space />
          <q-btn flat dense icon="close" v-close-popup />
        </q-card-section>

        <q-separator />

        <q-card-section>
          <q-toggle v-model="flags.errors" label="0 — Ошибки (через @sentry/vue)" />
          <q-toggle v-model="flags.network" label="1 — Сеть: тела ответов (доп. поверх Sentry)" />
          <q-toggle v-model="flags.contracts" label="2 — Контракт API (шлём как Sentry-сообщение)" />
          <q-toggle
            v-model="flags.contractsCoerce"
            :disable="!flags.contracts"
            label="2.5 — Чинить данные на лету"
            class="q-ml-lg"
          />
          <q-separator class="q-my-sm" />
          <q-toggle v-model="flags.transport" label="Отправлять в Sentry/Bugsink" />
          <div class="text-caption text-grey-7 q-mt-xs">
            Слоёв 3 (replay) и 4 (native) здесь нет — см. README про сравнение.
          </div>
        </q-card-section>

        <q-separator />

        <q-card-section>
          <div class="text-subtitle2 q-mb-sm">DSN / API</div>
          <q-input
            v-model="config.sentryDsn"
            dense
            outlined
            label="Sentry / Bugsink DSN"
            placeholder="https://<key>@host/1"
            class="q-mb-sm"
          />
          <q-input
            v-model="config.apiUrl"
            dense
            outlined
            label="URL мок-API"
            placeholder="http://192.168.1.114:8787"
          />
          <div class="text-caption text-grey-7 q-mt-xs">
            apiUrl меняется на лету. DSN — нет: Sentry.init() фиксирует его при
            старте страницы, см. комментарий в flags.js.
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
          </div>
          <img v-if="showBadImage" src="/definitely-missing.png" style="display: none" alt="" />
        </q-card-section>

        <q-separator />

        <q-card-section class="col-grow scroll" style="max-height: 40vh">
          <div class="text-subtitle2 q-mb-sm">Поток событий (beforeSend Sentry)</div>
          <div v-for="event in recent" :key="event.event_id" class="q-mb-xs text-caption">
            <q-badge :color="levelColor(event.level)" :label="event.tags?.kind || 'error'" />
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
import { onEvent } from '../observability/sentry'
import { requestRefetch } from '../observability/refetch'

const open = ref(false)
const recent = ref([])
const brokenMode = ref('off')
const showBadImage = ref(false)

let unsubscribe

onMounted(() => {
  unsubscribe = onEvent((event) => {
    recent.value.unshift(event)
    if (recent.value.length > 40) recent.value.pop()
  })
})

onUnmounted(() => unsubscribe?.())

async function setBroken(mode) {
  await fetch(`${config.apiUrl}/api/admin/mode?value=${mode}`, { method: 'POST' })
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
  if (event.tags?.kind === 'contract') {
    const extra = event.extra || {}
    return `${extra.endpoint}: ${extra.issues?.length} расхождений`
  }
  return event.exception?.values?.[0]?.value || event.message || 'событие'
}
</script>
