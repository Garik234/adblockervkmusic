# VK Music Ad Blocker

Браузерное расширение для **Chrome** и **Firefox**, блокирующее рекламу
на сайтах VK (`vk.com`, `vk.ru`) - в первую очередь в разделе VK Музыка.

## Что блокируется

- **Аудио-реклама** между треками - патч `audioAdsConfig` отключает
  серверную выдачу рекламных вставок плееру VK.
- **Промо-блоки подписки** - VK Музыка Premium, VK Combo, баннеры
  `audio_subscribe_promo`, `CatalogBlock__subscription` и т. п.
- **Баннерная реклама** на странице - `#ads_left`, `.ads300-thumb`,
  `.ads_ads_box` и аналогичные.
- **Рекламные посты в ленте** - `[data-ad]`, `.wall_marked_as_ads`.
- **Сетевые запросы** к рекламным эндпоинтам:
  `ads.vk.com`, `ad.mail.ru`, `mradx.net`, `top-fwz1.mail.ru`,
  `target.my.com`, `trg.mail.ru`, `vk.com/ads_rotate`,
  `act=need_show_promo`, `act=audio_ads`, `act=ad_event` и др.

Список селекторов и URL-паттернов основан на актуальных открытых
правилах сообщества (см. `vtosters/adblock`, `VK Ads Fixes`) и легко
обновляется через `CONFIG.selectors` в `content.js` и `rules.json`.

## Архитектура

| Файл | Назначение |
|------|------------|
| `manifest.json` | Manifest V3, общий для Chrome и Firefox |
| `background.js` | Service worker: состояние, статистика, переключение DNR |
| `content.js` | MutationObserver + патч `audioAdsConfig` через `<script>`-инъекцию |
| `rules.json` | Правила `declarativeNetRequest` (блокировка сетевых запросов) |
| `styles.css` | CSS-инжект - мгновенно скрывает рекламные элементы до запуска JS |
| `popup.html` / `popup.css` / `popup.js` | UI: переключатель и счётчик |
| `icons/` | Иконки 16/48/128 |

## Установка

### Chrome / Edge / Opera (на базе Chromium)

1. Откройте `chrome://extensions`.
2. Включите **Developer mode** (правый верхний угол).
3. Нажмите **Load unpacked** и выберите папку `vkmusicadblocker/`.

### Firefox

1. Откройте `about:debugging#/runtime/this-firefox`.
2. Нажмите **Load Temporary Add-on…**.
3. Выберите файл `manifest.json` внутри папки расширения.

> Для постоянной установки в Firefox требуется подпись на
> [addons.mozilla.org](https://addons.mozilla.org).

## Сборка ZIP-архива для публикации

```bash
# из корня репозитория
zip -r vk-music-adblocker.zip . \
    -x ".git/*" "*.md" "*.zip" "icons/icon.svg"
```

Получившийся `vk-music-adblocker.zip` можно загружать в Chrome Web
Store или AMO.

## Обновление селекторов

Если VK изменит вёрстку, обновите массив `CONFIG.selectors` в
`content.js`, такой же список в `styles.css`, и при необходимости -
`rules.json`. После этого увеличьте `version` в `manifest.json`.

## Совместимость

- **Manifest V3**
- **`declarativeNetRequest`** - поддерживается Chrome 84+ и Firefox 113+.
- **`browser` namespace с фоллбеком на `chrome`** - обеспечивает работу
  одинакового кода в обоих браузерах.

## Политики магазинов

Расширение блокирует только **рекламные** запросы и DOM-элементы;
не модифицирует контент пользователя, не отправляет данные на
сторонние серверы, не использует remote code. Это соответствует
требованиям Chrome Web Store (Single Purpose, Limited Use) и
Mozilla Add-on Policies.
