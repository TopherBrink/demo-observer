/**
 * Слои наблюдаемости включаются флагами — это нужно для доклада:
 * на сцене вы включаете слой и заново воспроизводите баг.
 *
 * Флаги живут в localStorage, чтобы переживать перезагрузку страницы.
 * Слоёв 3 (replay) и 4 (native) в этой версии нет.
 */
import { reactive, watch } from 'vue'

const STORAGE_KEY = 'obs.flags'

const DEFAULTS = {
  // Слой 0 — глобальные обработчики ошибок
  errors: false,
  // Слой 1 — перехват сети (тела ответов + traceparent)
  network: false,
  // Слой 2 — валидация контракта API в рантайме
  contracts: false,
  // Слой 2.5 — не только сообщать о расхождении, но и чинить данные на лету
  contractsCoerce: false,
  // Отправлять события в Bugsink (выключено = копится только в IndexedDB локально)
  transport: true,
}

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }
  } catch {
    return { ...DEFAULTS }
  }
}

export const flags = reactive(load())

watch(
  flags,
  (value) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    } catch {
      /* приватный режим — переживём */
    }
  },
  { deep: true },
)

export function resetFlags() {
  Object.assign(flags, DEFAULTS)
}

const ENDPOINTS_KEY = 'obs.endpoints'

// То, что зашито в сборку (.env) на момент "quasar build" — дефолт для панели
// докладчика, а не единственный источник истины.
const ENDPOINT_DEFAULTS = {
  // DSN Bugsink/GlitchTip/Sentry вида https://<public_key>@<host>/<project_id>.
  // В отличие от коллектора это не просто URL — transport.js сам разбирает
  // DSN на составляющие, см. parseDsn() там же.
  sentryDsn: import.meta.env?.VITE_SENTRY_DSN || '',
  apiUrl: import.meta.env?.VITE_API_URL || 'http://192.168.0.10:8787',
}

function loadEndpoints() {
  try {
    const saved = JSON.parse(localStorage.getItem(ENDPOINTS_KEY) || '{}')
    return {
      sentryDsn: saved.sentryDsn || ENDPOINT_DEFAULTS.sentryDsn,
      apiUrl: saved.apiUrl || ENDPOINT_DEFAULTS.apiUrl,
    }
  } catch {
    return { ...ENDPOINT_DEFAULTS }
  }
}

export function resetEndpoints() {
  config.sentryDsn = ENDPOINT_DEFAULTS.sentryDsn
  config.apiUrl = ENDPOINT_DEFAULTS.apiUrl
}

export const config = reactive({
  ...loadEndpoints(),

  release: import.meta.env?.VITE_RELEASE || 'demo@1.0.0',

  // Куда можно подмешивать traceparent. Чужим доменам нельзя: кастомный
  // заголовок включит preflight и запрос упадёт по CORS. Это НЕ связано
  // с DSN Bugsink — это заголовок к мок-API, как и раньше.
  traceTargets: [
    /^http:\/\/192\.168\./,
    /^http:\/\/10\./,
    /^http:\/\/172\.(1[6-9]|2\d|3[01])\./,
    /^https:\/\/api\./,
  ],

  maxBodyChars: 4096, // обрезка тел запросов/ответов
  breadcrumbLimit: 50,

  redactKeys: [
    'password', 'pass', 'token', 'access_token', 'refresh_token', 'authorization',
    'phone', 'email', 'card', 'cvv', 'pan', 'secret', 'session_id', 'passport',
  ],
})

watch(
  () => [config.sentryDsn, config.apiUrl],
  ([sentryDsn, apiUrl]) => {
    try {
      localStorage.setItem(ENDPOINTS_KEY, JSON.stringify({ sentryDsn, apiUrl }))
    } catch {
      /* приватный режим — переживём */
    }
  },
)
