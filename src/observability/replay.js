/**
 * Слой 3 — запись сессии (rrweb).
 *
 * Пишется не видео, а мутации DOM. Поэтому это работает в WebView так же,
 * как в браузере, и весит на порядки меньше скринкаста.
 *
 * Режим буферный: держим в памяти последние N секунд и выгружаем ТОЛЬКО
 * если что-то упало. Трафика почти нет, а по каждому инциденту есть запись.
 *
 * Честные ограничения, которые надо назвать вслух:
 *  - canvas/WebGL пишутся плохо и дорого (recordCanvas по умолчанию выключен);
 *  - на слабом Android запись стоит процессорного времени — замерьте сами;
 *  - в записи видно всё, что видит пользователь → маскирование обязательно.
 */
import { config, flags } from './flags'
import { sendReplay } from './transport'
import { sessionId } from './session'

let stopFn = null
let buffer = []
let lastFlushReason = null

export const getReplayBuffer = () => buffer

export async function startReplay() {
  if (stopFn || !flags.replay) return
  // Динамический импорт: rrweb не должен попадать в основной бандл
  const rrweb = await import('rrweb')

  stopFn = rrweb.record({
    emit(event, isCheckout) {
      if (isCheckout) {
        // Полный снапшот: всё, что было до него, уже не нужно
        const keepFrom = Date.now() - config.replayBufferMs
        buffer = buffer.filter((e) => e.timestamp >= keepFrom)
      }
      buffer.push(event)
      // Страховка от разрастания памяти на длинных сессиях
      if (buffer.length > 4000) buffer.splice(0, buffer.length - 4000)
    },
    // Полный снапшот раз в 20 секунд — точка, с которой можно начать воспроизведение
    checkoutEveryNms: 20_000,
    maskAllInputs: true,
    maskTextClass: 'obs-mask',
    blockClass: 'obs-block',
    recordCanvas: false,
    // collectFonts у rrweb ловит только шрифты, зарегистрированные через JS
    // FontFace API — Material Icons подключён обычным CSS @font-face, так что
    // эта опция тут ничего не даёт. Проблема "иконки в плеере — это текст"
    // решена на стороне дашборда: см. play() в collector/public/index.html.
    collectFonts: false,
    sampling: {
      // Движения мыши/пальца прореживаем: их тысячи, ценности мало
      mousemove: 100,
      scroll: 200,
      input: 'last',
    },
  })
}

export function stopReplay() {
  stopFn?.()
  stopFn = null
  buffer = []
}

export async function flushReplay(reason = 'manual') {
  if (!flags.replay || !buffer.length) return
  lastFlushReason = reason
  const events = buffer.slice()
  await sendReplay(events, {
    sessionId,
    reason,
    release: config.release,
    startedAt: events[0]?.timestamp,
    endedAt: events[events.length - 1]?.timestamp,
  })
}

export const replayStatus = () => ({
  recording: Boolean(stopFn),
  events: buffer.length,
  approxKb: Math.round(JSON.stringify(buffer).length / 1024),
  lastFlushReason,
})
