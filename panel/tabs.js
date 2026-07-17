// Универсальный переключатель вкладок, без зависимостей.
// Кнопки: [data-tab-target="name"], панели: [data-tab-panel="name"].
// При каждом открытии панель стартует с Main, как задано в HTML.

function activateTab(name) {
  document.querySelectorAll('[data-tab-target]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tabTarget === name);
  });
  document.querySelectorAll('[data-tab-panel]').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.tabPanel === name);
  });
}

document.querySelectorAll('[data-tab-target]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const name = btn.dataset.tabTarget;
    activateTab(name);
  });
});
