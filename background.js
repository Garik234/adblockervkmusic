// background.js - service worker (MV3) для VK Music Ad Blocker.
// Управляет состоянием вкл/выкл, считает заблокированные элементы,
// обрабатывает сообщения от content-script и переключает правила
// declarativeNetRequest при изменении настроек.

// Кросс-браузерный namespace: Firefox экспортирует `browser`,
// Chrome - `chrome`. Используем то, что есть.
const api = (typeof browser !== "undefined" ? browser : chrome);

const RULESET_ID = "vk_ad_rules";
const STORAGE_KEYS = {
  enabled: "enabled",
  blockedTotal: "blockedTotal",
  blockedSession: "blockedSession",
};

// Состояние сессии в памяти SW. SW может быть выгружен,
// поэтому критичные данные дублируются в storage.
let sessionBlocked = 0;

// Инициализация значений по умолчанию при первой установке.
api.runtime.onInstalled.addListener(async () => {
  const stored = await api.storage.local.get([
    STORAGE_KEYS.enabled,
    STORAGE_KEYS.blockedTotal,
  ]);
  if (typeof stored.enabled !== "boolean") {
    await api.storage.local.set({ [STORAGE_KEYS.enabled]: true });
  }
  if (typeof stored.blockedTotal !== "number") {
    await api.storage.local.set({ [STORAGE_KEYS.blockedTotal]: 0 });
  }
  await applyRulesetState();
});

api.runtime.onStartup.addListener(async () => {
  await applyRulesetState();
});

// Включаем/отключаем набор правил DNR в зависимости от настройки.
async function applyRulesetState() {
  try {
    const { enabled } = await api.storage.local.get(STORAGE_KEYS.enabled);
    const isOn = enabled !== false;
    if (api.declarativeNetRequest && api.declarativeNetRequest.updateEnabledRulesets) {
      await api.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: isOn ? [RULESET_ID] : [],
        disableRulesetIds: isOn ? [] : [RULESET_ID],
      });
    }
  } catch (e) {
    // Firefox может ещё не поддерживать updateEnabledRulesets для всех версий -
    // тогда блокировка DOM-элементов в content.js остаётся основной защитой.
    console.warn("[VKMAB] applyRulesetState:", e);
  }
}

// Сообщения от content-script и popup.
api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (!msg || typeof msg !== "object") return;

    switch (msg.type) {
      case "AD_BLOCKED": {
        const count = Math.max(1, Number(msg.count) || 1);
        sessionBlocked += count;
        const { blockedTotal = 0 } = await api.storage.local.get(STORAGE_KEYS.blockedTotal);
        await api.storage.local.set({
          [STORAGE_KEYS.blockedTotal]: blockedTotal + count,
          [STORAGE_KEYS.blockedSession]: sessionBlocked,
        });
        sendResponse({ ok: true });
        break;
      }

      case "GET_STATE": {
        const stored = await api.storage.local.get([
          STORAGE_KEYS.enabled,
          STORAGE_KEYS.blockedTotal,
        ]);
        sendResponse({
          enabled: stored.enabled !== false,
          blockedTotal: stored.blockedTotal || 0,
          blockedSession: sessionBlocked,
          version: api.runtime.getManifest().version,
        });
        break;
      }

      case "SET_ENABLED": {
        await api.storage.local.set({ [STORAGE_KEYS.enabled]: !!msg.value });
        await applyRulesetState();
        // Уведомляем все вкладки VK о смене состояния.
        const tabs = await api.tabs.query({ url: ["*://*.vk.com/*", "*://*.vk.ru/*"] });
        for (const tab of tabs) {
          api.tabs.sendMessage(tab.id, { type: "STATE_CHANGED", enabled: !!msg.value })
            .catch(() => { /* вкладка могла быть закрыта */ });
        }
        sendResponse({ ok: true });
        break;
      }

      case "RESET_STATS": {
        sessionBlocked = 0;
        await api.storage.local.set({
          [STORAGE_KEYS.blockedTotal]: 0,
          [STORAGE_KEYS.blockedSession]: 0,
        });
        sendResponse({ ok: true });
        break;
      }
    }
  })();
  // Возвращаем true, чтобы sendResponse работал асинхронно.
  return true;
});
