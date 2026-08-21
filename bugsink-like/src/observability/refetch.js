/**
 * Общий сигнал «перезапросить данные текущей страницы».
 *
 * Дёргается из двух мест: кнопки режима бэкенда в панели докладчика и
 * pull-to-refresh в layout. Страницы, которым есть что перезапрашивать
 * (сейчас — только каталог), подписываются через onRefetch() и сами решают,
 * что значит «обновиться». requestRefetch() ждёт реального завершения —
 * это важно для pull-to-refresh: спиннер должен висеть, пока не придут
 * данные, а не произвольные полсекунды.
 */
const handlers = new Set()

export function onRefetch(fn) {
  handlers.add(fn)
  return () => handlers.delete(fn)
}

export async function requestRefetch() {
  await Promise.allSettled([...handlers].map((fn) => fn()))
}
