import { getAll, clearAll, count } from '../storage/db.js';
import { renderItemCard } from './item-card.js';

const HISTORY_ENABLED_KEY = 'history.enabled';

const totalCountEl = document.getElementById('history-total-count');
const clearBtn = document.getElementById('clear-history');
const itemsListEl = document.getElementById('items-list');
const itemsEmptyEl = document.getElementById('items-empty');
const historyEnabledInput = document.getElementById('history-enabled');

init();

async function init() {
  const stored = await chrome.storage.local.get(HISTORY_ENABLED_KEY);
  historyEnabledInput.checked = stored[HISTORY_ENABLED_KEY] !== false;

  await refreshList();
  clearBtn.addEventListener('click', onClearHistory);
  historyEnabledInput.addEventListener('change', async () => {
    await chrome.storage.local.set({ [HISTORY_ENABLED_KEY]: historyEnabledInput.checked });
  });

  chrome.runtime.onMessage.addListener((message) => {
    // items-found — источник только что сохранил часть находок, ещё до
    // конца всего прогона; scan-end — финальная сверка. Оба ведут к
    // одному и тому же полному перезапросу из IndexedDB — источников
    // за прогон немного, лишний refreshList() не создаёт проблем.
    if (message?.type === 'SCAN_PROGRESS' && (message.event?.phase === 'items-found' || message.event?.phase === 'scan-end')) {
      refreshList();
    }
  });
}

async function onClearHistory() {
  const confirmed = confirm('Clear the entire history of found items?');
  if (!confirmed) return;
  await clearAll();
  await refreshList();
}

async function refreshList() {
  const items = await getAll({ sortBy: 'foundAt', order: 'desc' });
  const total = await count();

  totalCountEl.textContent = String(total);
  itemsListEl.innerHTML = '';
  itemsEmptyEl.hidden = items.length > 0;

  for (const item of items) {
    itemsListEl.appendChild(renderItemCard(item));
  }
}
