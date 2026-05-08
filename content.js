// content.js - выполняется на всех страницах vk.com / vk.ru.
// Удаляет рекламные DOM-элементы, перехватывает аудио-рекламу
// через хук на vk.audioAdsConfig и сообщает фоновому скрипту
// статистику заблокированных элементов.

(function () {
  "use strict";

  const api = (typeof browser !== "undefined" ? browser : chrome);

  // ---------- Конфигурация селекторов ----------
  // Селекторы собраны из открытых источников (vtosters/adblock и аналогичных
  // userscript'ов). При изменении вёрстки VK достаточно обновить этот объект.
  const CONFIG = {
    // Прямые CSS-селекторы рекламных и промо-элементов.
    selectors: [
      // Музыка / аудио-промо подписки VK Музыка / VK Combo.
      ".CatalogBlock__subscription",
      ".audio_promo",
      ".audio_subscribe_promo",
      ".audio_subscribe_promo__content",
      ".audio_ads",
      ".audio_row_ads",
      ".audio_page_block_promo",
      ".CatalogBlock--subscription",
      "[data-testid='audio_promo']",
      "[data-block-type='audio_subscribe_promo']",

      // Боковые баннеры и блоки рекламы.
      "#ads_left",
      ".ads300-thumb",
      ".ads600x200",
      ".ads_600x200",
      ".trg-b-banner-block",
      ".ads_ads_box",
      ".ads_ads_news_wrap",
      "._ads_block_data_w",

      // Промо VK Pay / настройки.
      ".settings_vkpay_promo_banner_link_a",
      "#settings_ps_promo_big_banner_container",

      // Рекомендации, которые часто маскируются под рекламу.
      ".GroupsRecommendationsBlock",
      ".FriendsSuggestionsBlock",
      "#feed_recommends",
      ".RecommendedNarrativesBlock",
      "#friends_right_blocks_root",
      ".FeedVideosForYou",
      ".ShortVideoFeedBlock",

      // Посты-реклама в ленте.
      "div[id^='post-'][data-ad-block-uid]",
      ".post[data-ad]",
      ".post[data-ad-view]",
      ".wall_marked_as_ads",
      ".post_marked_as_ads",

      // Медиа-источники из рекламной CDN.
      "div[data-mt-video-hls*='mradx.net']",
      "img[src^='https://r0.mradx.net']",
      "img[src*='ad.mail.ru']",
    ],

    // Текстовые маркеры - если у элемента нет стабильного класса,
    // ищем по содержимому (последний резерв).
    textMarkers: [
      "Реклама", "Рекламная запись", "Промо",
      "VK Музыка Premium", "Подписка VK Музыка", "VK Combo",
    ],

    // Паттерны URL внутри атрибутов (src/href) - для иконок рекламы.
    urlPatterns: [
      "ads.vk.com",
      "ad.mail.ru",
      "mradx.net",
      "top-fwz1.mail.ru",
      "trg.mail.ru",
      "target.my.com",
    ],
  };

  // ---------- Состояние ----------
  let enabled = true;
  let observer = null;
  let removalTimer = null;
  let blockedBuffer = 0;
  let flushTimer = null;

  // ---------- Утилиты ----------
  function reportBlocked(count) {
    if (!count) return;
    blockedBuffer += count;
    if (flushTimer) return;
    // Батчим отправку, чтобы не дёргать SW по каждому элементу.
    flushTimer = setTimeout(() => {
      const toSend = blockedBuffer;
      blockedBuffer = 0;
      flushTimer = null;
      try {
        api.runtime.sendMessage({ type: "AD_BLOCKED", count: toSend })
          .catch(() => { /* SW мог быть выгружен - это нормально */ });
      } catch (_) { /* noop */ }
    }, 500);
  }

  function safeRemove(el) {
    if (!el || !el.isConnected) return false;
    try {
      // Помечаем, чтобы не считать дважды.
      if (el.dataset && el.dataset.vkmabRemoved === "1") return false;
      if (el.dataset) el.dataset.vkmabRemoved = "1";
      el.style.setProperty("display", "none", "important");
      // Удалять полностью можно, но скрытие безопаснее (VK иногда читает атрибуты).
      return true;
    } catch (_) {
      return false;
    }
  }

  function sweepBySelectors(root) {
    if (!enabled) return 0;
    let removed = 0;
    const scope = root && root.querySelectorAll ? root : document;
    for (const sel of CONFIG.selectors) {
      let nodes;
      try {
        nodes = scope.querySelectorAll(sel);
      } catch (_) {
        continue;
      }
      for (const node of nodes) {
        if (safeRemove(node)) removed++;
      }
    }
    return removed;
  }

  function sweepByTextMarkers(root) {
    if (!enabled) return 0;
    // Дорогая операция - выполняем редко, только в верхнеуровневых вставках.
    let removed = 0;
    const scope = root && root.querySelectorAll ? root : document;
    const candidates = scope.querySelectorAll(
      "[class*='promo'],[class*='Promo'],[class*='banner'],[class*='Banner']"
    );
    for (const node of candidates) {
      if (!node.isConnected) continue;
      const text = (node.textContent || "").trim();
      if (!text || text.length > 200) continue;
      for (const marker of CONFIG.textMarkers) {
        if (text.includes(marker)) {
          if (safeRemove(node)) removed++;
          break;
        }
      }
    }
    return removed;
  }

  // ---------- Перехват аудио-рекламы на уровне JS ----------
  // VK хранит конфигурацию аудио-рекламы в window.audioAdsConfig
  // (а также в vk.audioAdsConfig). Перезаписываем свойства, чтобы
  // плеер считал, что реклама отключена/исчерпана.
  function patchAudioAdsConfig() {
    const patcher = (target) => {
      if (!target || typeof target !== "object") return;
      try {
        target.enabled = false;
        target.day_limit_reached = true;
        target.sections = [];
        target.sections_settings = {};
      } catch (_) { /* readonly - пропускаем */ }
    };

    const trapObject = (host, prop) => {
      let value = host[prop];
      patcher(value);
      try {
        Object.defineProperty(host, prop, {
          configurable: true,
          get() { return value; },
          set(v) { patcher(v); value = v; },
        });
      } catch (_) { /* property уже non-configurable */ }
    };

    // Применяем сразу и при появлении глобала vk.
    trapObject(window, "audioAdsConfig");
    if (window.vk) trapObject(window.vk, "audioAdsConfig");

    // vk появляется не сразу - отлавливаем установку.
    let _vk = window.vk;
    try {
      Object.defineProperty(window, "vk", {
        configurable: true,
        get() { return _vk; },
        set(v) {
          _vk = v;
          if (v && typeof v === "object") trapObject(v, "audioAdsConfig");
        },
      });
    } catch (_) { /* noop */ }
  }

  // Инжектим патч в основной мир страницы (content-script изолирован
  // от window страницы, поэтому нужен <script>).
  function injectPagePatch() {
    try {
      const code = "(" + patchAudioAdsConfig.toString() + ")();";
      const s = document.createElement("script");
      s.textContent = code;
      (document.head || document.documentElement).appendChild(s);
      s.remove();
    } catch (e) {
      console.warn("[VKMAB] inject failed:", e);
    }
  }

  // ---------- MutationObserver ----------
  function startObserver() {
    if (observer) return;
    observer = new MutationObserver((mutations) => {
      if (!enabled) return;
      let removed = 0;
      // Дешёвый проход: проверяем только новые узлы.
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          // Проверяем сам узел.
          for (const sel of CONFIG.selectors) {
            try {
              if (node.matches && node.matches(sel)) {
                if (safeRemove(node)) removed++;
                break;
              }
            } catch (_) { /* invalid selector for this node */ }
          }
          // И его потомков.
          if (node.querySelectorAll) {
            removed += sweepBySelectors(node);
          }
        }
      }
      if (removed) reportBlocked(removed);
    });

    observer.observe(document.documentElement || document, {
      childList: true,
      subtree: true,
    });
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (removalTimer) {
      clearInterval(removalTimer);
      removalTimer = null;
    }
  }

  // ---------- Старт ----------
  function start() {
    injectPagePatch();
    startObserver();

    // Первичный проход после готовности DOM.
    const initialSweep = () => {
      const removed = sweepBySelectors(document) + sweepByTextMarkers(document);
      if (removed) reportBlocked(removed);
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initialSweep, { once: true });
    } else {
      initialSweep();
    }

    // Периодическая зачистка (VK перерисовывает SPA - иногда наблюдатель
    // не успевает за изменением атрибутов уже существующих узлов).
    removalTimer = setInterval(() => {
      if (!enabled) return;
      const removed = sweepBySelectors(document);
      if (removed) reportBlocked(removed);
    }, 5000);
  }

  // Перехватываем смену состояния из popup.
  api.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== "STATE_CHANGED") return;
    enabled = !!msg.enabled;
    if (enabled) {
      start();
    } else {
      stopObserver();
      // Возвращать удалённые элементы не пытаемся: пользователь
      // может перезагрузить страницу.
    }
  });

  // Запрашиваем актуальное состояние и стартуем.
  api.runtime.sendMessage({ type: "GET_STATE" })
    .then((state) => {
      enabled = !state || state.enabled !== false;
      if (enabled) start();
    })
    .catch(() => {
      // SW недоступен - работаем по умолчанию (включено).
      start();
    });

  // Очистка при выгрузке страницы.
  window.addEventListener("pagehide", stopObserver, { once: true });
})();
