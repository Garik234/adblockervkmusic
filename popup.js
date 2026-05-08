const api = (typeof browser !== "undefined" ? browser : chrome);

const $toggle = document.getElementById("enabled-toggle");
const $session = document.getElementById("stat-session");
const $total = document.getElementById("stat-total");
const $version = document.getElementById("version");
const $reset = document.getElementById("reset-btn");
const $status = document.getElementById("status");

function flash(text) {
  $status.textContent = text;
  setTimeout(() => { $status.textContent = "Готово"; }, 1500);
}

async function refresh() {
  try {
    const state = await api.runtime.sendMessage({ type: "GET_STATE" });
    if (!state) return;
    $toggle.checked = state.enabled;
    $session.textContent = String(state.blockedSession || 0);
    $total.textContent = String(state.blockedTotal || 0);
    $version.textContent = "v" + (state.version || "-");
  } catch (e) {
    $status.textContent = "Ошибка связи";
  }
}

$toggle.addEventListener("change", async () => {
  await api.runtime.sendMessage({ type: "SET_ENABLED", value: $toggle.checked });
  flash($toggle.checked ? "Блокировка включена" : "Блокировка отключена");
});

$reset.addEventListener("click", async () => {
  await api.runtime.sendMessage({ type: "RESET_STATS" });
  await refresh();
  flash("Статистика сброшена");
});

refresh();
// Обновляем счётчик, пока popup открыт.
setInterval(refresh, 1500);
