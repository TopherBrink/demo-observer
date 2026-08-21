/**
 * Слои наблюдаемости включаются флагами — это нужно для доклада:
 * на сцене вы включаете слой и заново воспроизводите баг.
 *
 * Флаги живут в localStorage, чтобы переживать перезагрузку WebView.
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
  // Слой 3 — session replay (rrweb) в буферном режиме
  replay: false,
  // Слой 4 — нативный контекст и детект аварийного завершения
  native: false,
  // Отправлять события на коллектор (выключено = всё копится только локально)
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

// То, что зашито в сборку (.env / .env.cordova на момент "quasar build").
// Это именно ДЕФОЛТ для полей в панели докладчика — не единственный источник истины.
const ENDPOINT_DEFAULTS = {
  collectorUrl: import.meta.env?.VITE_COLLECTOR_URL || 'http://192.168.0.10:8787',
  apiUrl: import.meta.env?.VITE_API_URL || 'http://192.168.0.10:8787',
}

function loadEndpoints() {
  try {
    const saved = JSON.parse(localStorage.getItem(ENDPOINTS_KEY) || '{}')
    return {
      collectorUrl: saved.collectorUrl || ENDPOINT_DEFAULTS.collectorUrl,
      apiUrl: saved.apiUrl || ENDPOINT_DEFAULTS.apiUrl,
    }
  } catch {
    return { ...ENDPOINT_DEFAULTS }
  }
}

export function resetEndpoints() {
  config.collectorUrl = ENDPOINT_DEFAULTS.collectorUrl
  config.apiUrl = ENDPOINT_DEFAULTS.apiUrl
}

export const config = reactive({
  // Куда шлём события. В Cordova это ВСЕГДА абсолютный URL:
  // страница живёт на https://localhost (cordova-android 10+) или на
  // capacitor://localhost / file:// — относительные пути укажут не туда.
  //
  // По умолчанию — то, что зашили в сборку из .env.cordova. Но это редактируется
  // прямо в панели докладчика (без пересборки!) на случай, если в месте показа
  // сеть или IP окажутся другими, чем на момент сборки APK.
  ...loadEndpoints(),

  release: import.meta.env?.VITE_RELEASE || 'demo@1.0.0',

  // Куда можно подмешивать traceparent. Чужим доменам — нельзя:
  // кастомный заголовок включит preflight и запрос упадёт по CORS.
  // Все стандартные приватные диапазоны — чтобы работало в любой сети показа,
  // не только в той, что была на момент сборки.
  traceTargets: [
    /^http:\/\/192\.168\./,
    /^http:\/\/10\./,
    /^http:\/\/172\.(1[6-9]|2\d|3[01])\./,
    /^https:\/\/api\./,
  ],

  maxBodyChars: 4096, // обрезка тел запросов/ответов
  replayBufferMs: 60_000, // сколько секунд сессии держим в памяти
  breadcrumbLimit: 50,

  // Ключи, значения которых вырезаются из тел и заголовков перед отправкой
  redactKeys: [
    'password', 'pass', 'token', 'access_token', 'refresh_token', 'authorization',
    'phone', 'email', 'card', 'cvv', 'pan', 'secret', 'session_id', 'passport',
  ],
})

watch(
  () => [config.collectorUrl, config.apiUrl],
  ([collectorUrl, apiUrl]) => {
    try {
      localStorage.setItem(ENDPOINTS_KEY, JSON.stringify({ collectorUrl, apiUrl }))
    } catch {
      /* приватный режим — переживём */
    }
  },
)
