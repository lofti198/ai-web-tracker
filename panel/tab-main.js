import { getSearchRunPlan } from '../parsers/searches.js';
import { ensureHostPermission } from '../parsers/ensure-permission.js';
import { getAll } from '../storage/db.js';
import { renderItemCard } from './item-card.js';

const scanBtn = document.getElementById('toggle-run');
const stopBtn = document.getElementById('stop-run');
const lastRunEl = document.getElementById('last-run');
const progressPanelEl = document.getElementById('progress-panel');
const progressCurrentTextEl = document.getElementById('progress-current-text');
const progressRecentEl = document.getElementById('progress-recent');
const justFoundSectionEl = document.getElementById('just-found-section');
const justFoundTitleEl = document.getElementById('just-found-title');
const justFoundListEl = document.getElementById('just-found-list');
const appLoadingEl = document.getElementById('app-loading');

const MAX_RECENT_EVENTS = 6;
let currentScanFoundCount = 0;
let isStopping = false;

init()
  .catch((err) => {
    console.error('[tab-main] failed to initialize panel:', err);
  })
  .finally(() => {
    hideAppLoading();
  });

async function init() {
  chrome.runtime.sendMessage({ type: 'PANEL_OPENED' });

  const stored = await chrome.storage.local.get('ui.lastRunAt');
  renderLastRun(stored['ui.lastRunAt']);

  // Сканирование только ручное — единственный источник правды "идёт ли
  // прогон прямо сейчас" — сам service worker (см. GET_STATUS). Это
  // важно проверять при каждом открытии панели: если предыдущая вкладка
  // с панелью была закрыта посреди прогона, кнопки должны отражать
  // реальное состояние, а не сбрасываться в "готово к запуску".
  const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
  const isRunning = Boolean(status?.isRunning);
  setScanning(isRunning);

  if (isRunning) {
    await restoreCurrentScanCount();
    await refreshJustFound();
  } else {
    hideJustFound();
  }

  const { 'ui.currentProgress': currentProgress } = await chrome.storage.session.get('ui.currentProgress');
  if (currentProgress) {
    showProgressEvent(currentProgress);
  }

  scanBtn.addEventListener('click', onScanNow);
  stopBtn.addEventListener('click', onStop);

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'SCAN_PROGRESS') {
      showProgressEvent(message.event);

      // "Верхнеуровневые" события всего прогона (source === null) отличаем
      // от построчного прогресса отдельных источников.
      if (message.event?.source === null && message.event?.phase === 'scan-start') {
        setScanning(true);
        resetScanStats();
        clearJustFound();
      }
      if (message.event?.phase === 'items-found' && message.event?.items?.length > 0) {
        // Дорисовываем карточки СРАЗУ по мере готовности источника, не
        // дожидаясь конца всего прогона.
        appendJustFound(message.event.items);
        incrementScanStats(message.event.items.length);
      }
      if (message.event?.source === null && message.event?.phase === 'scan-end') {
        setScanning(false);
      }
    }
  });
}

function setScanning(isScanning) {
  if (!isScanning) isStopping = false;
  scanBtn.disabled = isScanning;
  scanBtn.textContent = isScanning ? 'Scanning…' : 'Scan now';
  stopBtn.disabled = !isScanning || isStopping;
  stopBtn.textContent = isStopping ? 'Stopping…' : 'Stop';
}

async function onScanNow() {
  // Запрос разрешений на домены — только здесь, в обработчике клика.
  const { runnableEntries } = await getSearchRunPlan();
  for (const [name, parser] of runnableEntries) {
    for (const originPattern of getSourceOriginPatterns(parser)) {
      const granted = await ensureHostPermission(originPattern);
      if (!granted) {
        console.warn(`[tab-main] permission denied for search "${name}" at ${originPattern}`);
      }
    }
  }

  setScanning(true); // мгновенная обратная связь; финальное состояние выставит scan-end
  await chrome.runtime.sendMessage({ type: 'RUN_SCAN' });
}

async function onStop() {
  if (isStopping) return;

  isStopping = true;
  stopBtn.disabled = true;
  stopBtn.textContent = 'Stopping…';
  await chrome.runtime.sendMessage({ type: 'STOP' });
}

function hideAppLoading() {
  if (appLoadingEl) appLoadingEl.hidden = true;
}

function resetScanStats() {
  currentScanFoundCount = 0;
  renderJustFoundTitle();
}

function incrementScanStats(countToAdd) {
  currentScanFoundCount += countToAdd;
  renderJustFoundTitle();
}

async function restoreCurrentScanCount() {
  const { 'ui.lastRunItemIds': ids = [] } = await chrome.storage.local.get('ui.lastRunItemIds');
  currentScanFoundCount = ids.length;
  renderJustFoundTitle();
}

function renderJustFoundTitle() {
  justFoundTitleEl.textContent = currentScanFoundCount > 0 ? `Just found (${currentScanFoundCount})` : 'Just found';
}

/**
 * "Just found" — результаты последнего/текущего прогона (не вся история —
 * та живёт на вкладке History). Список id последнего прогона хранится в
 * chrome.storage.local (ui.lastRunItemIds, пишется в
 * background/service-worker.js), поэтому переживает закрытие/открытие
 * панели. Во время самого прогона список пополняется живьём по мере того,
 * как каждый источник досчитывает и сохраняет свои сущности
 * (см. appendJustFound), а по завершении всего прогона refreshJustFound()
 * делает финальную сверку с IndexedDB — на случай, если панель была
 * открыта уже посреди прогона и пропустила часть live-событий.
 */
function clearJustFound() {
  justFoundSectionEl.hidden = true;
  justFoundListEl.innerHTML = '';
}

function appendJustFound(items) {
  justFoundSectionEl.hidden = false;
  for (const item of items) {
    justFoundListEl.prepend(renderItemCard(item));
  }
}

function hideJustFound() {
  justFoundSectionEl.hidden = true;
  justFoundListEl.innerHTML = '';
  currentScanFoundCount = 0;
  renderJustFoundTitle();
}

async function refreshJustFound() {
  const { 'ui.lastRunItemIds': ids = [] } = await chrome.storage.local.get('ui.lastRunItemIds');

  justFoundListEl.innerHTML = '';

  if (ids.length === 0) {
    justFoundSectionEl.hidden = true;
    return;
  }

  const idSet = new Set(ids);
  const all = await getAll({ sortBy: 'foundAt', order: 'desc' });
  const justFound = all.filter((item) => idSet.has(item.id));

  justFoundSectionEl.hidden = justFound.length === 0;
  for (const item of justFound) {
    justFoundListEl.appendChild(renderItemCard(item));
  }
}

function renderLastRun(timestamp) {
  lastRunEl.textContent = timestamp ? `Last run: ${new Date(timestamp).toLocaleString()}` : 'Last run: —';
}

function getSourceOriginPatterns(source) {
  return source.originPatterns || (source.originPattern ? [source.originPattern] : []);
}

function showProgressEvent(event) {
  const isFinished = event.source === null && event.phase === 'scan-end';

  progressPanelEl.hidden = false;
  progressCurrentTextEl.textContent = event.source ? `[${event.source}] ${event.message}` : event.message;

  const li = document.createElement('li');
  li.className = event.phase === 'error' ? 'progress-entry progress-entry-error' : 'progress-entry';
  li.textContent = event.source ? `[${event.source}] ${event.message}` : event.message;
  progressRecentEl.prepend(li);
  while (progressRecentEl.children.length > MAX_RECENT_EVENTS) {
    progressRecentEl.removeChild(progressRecentEl.lastChild);
  }

  if (isFinished) {
    renderLastRun(Date.now());
    setTimeout(() => {
      progressPanelEl.hidden = true;
      progressRecentEl.innerHTML = '';
    }, 4000);
  }
}
