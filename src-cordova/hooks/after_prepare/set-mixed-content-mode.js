#!/usr/bin/env node
/**
 * cordova-android (проверено на 15.1.0) нигде не вызывает
 * WebSettings.setMixedContentMode() — а платформенный дефолт Android для
 * WebView это MIXED_CONTENT_NEVER_ALLOW. Наша страница отдаётся с
 * https://localhost (WebViewAssetLoader, cordova-android 10+), а коллектор —
 * обычный http на LAN-адрес. Итог — тот самый “This request has been
 * blocked; the content must be served over HTTPS.”, и он не лечится ни
 * usesCleartextTraffic, ни CSP: это отдельный, более ранний барьер.
 *
 * Преференс <preference name="MixedContentMode"> в config.xml на этот движок
 * не действует (ничего его не читает) — поэтому патчим сгенерированный файл
 * хуком. cordova prepare перезаписывает platforms/android при каждой сборке,
 * так что правка руками не пережила бы следующий build.
 */
const fs = require('fs')
const path = require('path')

module.exports = function (context) {
  const projectRoot = context.opts.projectRoot
  const target = path.join(
    projectRoot,
    'platforms/android/CordovaLib/src/org/apache/cordova/engine/SystemWebViewEngine.java',
  )

  if (!fs.existsSync(target)) return

  let src = fs.readFileSync(target, 'utf8')
  if (src.includes('setMixedContentMode')) return // уже пропатчено этим же хуком

  const anchor = 'final WebSettings settings = webView.getSettings();'
  if (!src.includes(anchor)) {
    console.warn('[set-mixed-content-mode] якорь не найден в SystemWebViewEngine.java — пропускаю, проверьте вручную')
    return
  }

  src = src.replace(
    anchor,
    `${anchor}\n        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);`,
  )
  fs.writeFileSync(target, src)
  console.log('[set-mixed-content-mode] WebView: разрешён http-контент со страницы https://localhost')
}
