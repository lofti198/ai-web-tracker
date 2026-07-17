import { getSearchRunPlan } from '../parsers/searches.js';
import { hasHostPermission } from '../parsers/ensure-permission.js';
import { crawlSource } from '../parsers/tab-crawler.js';
import { saveIfNew, normalizeUrl } from '../storage/db.js';
import { applyFilters } from '../filters/pipeline.js';
import { appendLog } from '../storage/logs.js';

const PANEL_TAB_KEY = 'ui.panelTabId';

const DEFAULT_FILTERS_CONFIG = {
  keywordFilter: { enabled: false, words: [] },
  minusWordFilter: { enabled: false, words: [] },
  aiFilter: { enabled: false, prompt: '' },
};

// Флаг отмены ТЕКУЩЕГО прогона. Не null, пока runScan() выполняется —
// это же и источник правды для GET_STATUS (см. ниже): сканирование только
// ручное, никакого расписания/автозапуска нет, поэтому "идёт ли прогон
// прямо сейчас" полностью описывается этим флагом.
let activeScanCancelFlag = null;

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get('filters.config');

  if (!stored['filters.config']) {
    await chrome.storage.local.set({ 'filters.config': DEFAULT_FILTERS_CONFIG });
  }
});

// Клик по иконке открывает панель как обычную вкладку Chrome (не всплывающее
// окно и не встроенную боковую панель) — и переиспользует уже открытую
// вкладку вместо того, чтобы плодить новые.
//
// Обёрнуто в try/catch с гарантированным фолбэком: что бы ни пошло не так
// при переиспользовании старой вкладки, клик должен ВСЕГДА в итоге открыть
// панель, а не тихо ничего не сделать.
chrome.action.onClicked.addListener(async () => {
  const panelUrl = chrome.runtime.getURL('panel/panel.html');

  try {
    const { [PANEL_TAB_KEY]: existingId } = await chrome.storage.session.get(PANEL_TAB_KEY);

    if (existingId != null) {
      try {
        const tab = await chrome.tabs.get(existingId);
        // chrome.tabs id могут переиспользоваться Chrome для СОВСЕМ другой
        // вкладки после закрытия исходной — сверяем URL, чтобы случайно не
        // "открыть" панель фокусировкой чужой вкладки.
        if (tab.url === panelUrl || tab.pendingUrl === panelUrl) {
          await chrome.tabs.update(tab.id, { active: true });
          await chrome.windows.update(tab.windowId, { focused: true });
          return;
        }
      } catch {
        // Вкладка уже закрыта пользователем — создадим новую ниже.
      }
    }

    const created = await chrome.tabs.create({ url: panelUrl });
    await chrome.storage.session.set({ [PANEL_TAB_KEY]: created.id });
  } catch (err) {
    console.error('[service-worker] failed to reuse/focus panel tab, forcing a fresh one:', err);
    try {
      const created = await chrome.tabs.create({ url: panelUrl });
      await chrome.storage.session.set({ [PANEL_TAB_KEY]: created.id });
    } catch (err2) {
      console.error('[service-worker] could not open panel tab at all:', err2);
    }
  }
});

chrome.tabs.onRemoved.addListener(async (closedTabId) => {
  const { [PANEL_TAB_KEY]: existingId } = await chrome.storage.session.get(PANEL_TAB_KEY);
  if (closedTabId === existingId) {
    await chrome.storage.session.remove(PANEL_TAB_KEY);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'RUN_SCAN') {
    // Единственный способ запустить сканирование — эта кнопка. Никакого
    // расписания/автозапуска нет.
    runScan().then((summary) => sendResponse(summary));
    return true; // async response
  }

  if (message?.type === 'STOP') {
    // Прерывает прогон, который выполняется прямо сейчас (если есть) —
    // crawlSource прекращает открывать новые вкладки и возвращает уже
    // собранное. Если ничего не запущено — no-op.
    if (activeScanCancelFlag) activeScanCancelFlag.cancelled = true;
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === 'PANEL_OPENED') {
    chrome.storage.local.set({ 'ui.unseenCount': 0 });
    chrome.action.setBadgeText({ text: '' });
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === 'GET_STATUS') {
    // Идёт ли прогон прямо сейчас — целиком описывается этим флагом,
    // никакого отдельного "isRunning"-состояния в storage не существует.
    sendResponse({ isRunning: activeScanCancelFlag !== null });
    return false;
  }

  return false;
});

/**
 * Пишет запись в технический лог (вкладка "Logs") и одновременно рассылает
 * live-событие панели (если она сейчас открыта — иначе сообщение просто
 * никто не слушает, это не ошибка). Снапшот последнего события сохраняется
 * в session storage, чтобы только что открытая панель увидела текущий
 * статус. Событие фазы 'items-found' дополнительно несёт `items` —
 * реально сохранённые записи этого источника, чтобы панель могла сразу
 * дорисовать карточки в "Just found", не дожидаясь конца всего прогона.
 */
function reportProgress(event) {
  const level = event.phase === 'error' ? 'error' : 'info';
  appendLog({ level, source: event.source || '', message: event.message }).catch(() => {});

  chrome.storage.session.set({ 'ui.currentProgress': event }).catch(() => {});
  chrome.runtime.sendMessage({ type: 'SCAN_PROGRESS', event }).catch(() => {});
}

const REJECTED_TITLES_PREVIEW = 5;

/**
 * Сообщает, сколько сущностей источника прошло/не прошло content-фильтры
 * (keyword/minus-word/AI) — отдельно от dedup-фильтрации по уже известным
 * ссылкам (та происходит раньше, внутри tab-crawler.js, и сюда уже не
 * попадает). Молчит, если ни один фильтр не включён — тогда "прошли все"
 * не несёт информации и просто шумит в логе.
 * @param {string} sourceName
 * @param {Array<object>} beforeFilters
 * @param {Array<object>} afterFilters
 * @param {object} filtersConfig
 */
function reportFilterResult(sourceName, beforeFilters, afterFilters, filtersConfig) {
  if (beforeFilters.length === 0) return;

  const anyFilterEnabled =
    filtersConfig.keywordFilter?.enabled || filtersConfig.minusWordFilter?.enabled || filtersConfig.aiFilter?.enabled;
  if (!anyFilterEnabled) return;

  const passedUrls = new Set(afterFilters.map((item) => item.url));
  const rejected = beforeFilters.filter((item) => !passedUrls.has(item.url));

  if (rejected.length === 0) {
    reportProgress({
      source: sourceName,
      phase: 'filter-result',
      message: `Filters: all ${beforeFilters.length} item(s) matched`,
    });
    return;
  }

  reportProgress({
    source: sourceName,
    phase: 'filter-result',
    message: `Filters: ${afterFilters.length} of ${beforeFilters.length} item(s) matched, ${rejected.length} filtered out`,
  });

  const titles = rejected
    .slice(0, REJECTED_TITLES_PREVIEW)
    .map((item) => `"${item.title}"`)
    .join(', ');
  const more = rejected.length > REJECTED_TITLES_PREVIEW ? ` and ${rejected.length - REJECTED_TITLES_PREVIEW} more` : '';
  reportProgress({
    source: sourceName,
    phase: 'filter-result',
    message: `Filtered out: ${titles}${more}`,
  });
}

/**
 * Прогоняет все зарегистрированные парсеры через двухфазный обход
 * (parsers/tab-crawler.js), фильтрует и сохраняет новые находки.
 * @returns {Promise<{ newItemsCount: number, ranAt: number }>}
 */
async function runScan() {
  if (activeScanCancelFlag) {
    // Если сканирование уже идёт, второй параллельный прогон не запускаем.
    reportProgress({ source: null, phase: 'skipped', message: 'A scan is already in progress — not starting another' });
    return { newItemsCount: 0, ranAt: Date.now() };
  }

  reportProgress({ source: null, phase: 'scan-start', message: 'Scan started' });

  const cancelFlag = { cancelled: false };
  activeScanCancelFlag = cancelFlag;

  const { runnableEntries, disabledSearches, invalidSearches } = await getSearchRunPlan();
  for (const searchName of disabledSearches) {
    reportProgress({ source: searchName, phase: 'skipped', message: 'Skipped: search disabled' });
  }
  for (const invalidSearch of invalidSearches) {
    reportProgress({
      source: invalidSearch.name,
      phase: 'error',
      message: `Skipped: ${invalidSearch.message}`,
    });
  }

  const permittedEntries = [];
  for (const [name, parser] of runnableEntries) {
    const originPatterns = getSourceOriginPatterns(parser);
    const permissionChecks = await Promise.all(originPatterns.map((originPattern) => hasHostPermission(originPattern)));
    const allowed = permissionChecks.every(Boolean);
    if (!allowed) {
      reportProgress({ source: name, phase: 'skipped', message: 'Skipped: host permission not granted yet' });
      continue;
    }
    permittedEntries.push([name, parser]);
  }

  const {
    'filters.config': storedFiltersConfig = DEFAULT_FILTERS_CONFIG,
    'profile.openaiApiKey': apiKey = '',
    'profile.cvText': cvText = '',
    'scan.limitEntities': limitEntities = true,
    'scan.maxEntities': storedMaxEntities = 10,
    'history.enabled': historyEnabled = true,
  } = await chrome.storage.local.get([
    'filters.config',
    'profile.openaiApiKey',
    'profile.cvText',
    'scan.limitEntities',
    'scan.maxEntities',
    'history.enabled',
  ]);

  // API-ключ и текст резюме живут в профиле (вкладка Profile), а не в
  // filters.config — но AI-фильтру (filters/ai-filter.js) они нужны как
  // часть его конфига, поэтому подмешиваем их сюда на каждый прогон.
  const filtersConfig = {
    ...storedFiltersConfig,
    aiFilter: { ...storedFiltersConfig.aiFilter, apiKey, cvText },
  };
  const maxEntities = limitEntities === false ? Infinity : normalizeMaxEntities(storedMaxEntities);
  const useHistory = historyEnabled !== false;

  let newItemsCount = 0;
  const newlySavedItems = [];

  async function saveRawItemsLive(sourceName, rawItems) {
    const withSource = rawItems.map((raw) => ({ ...raw, source: sourceName }));
    const filtered = await applyFilters(withSource, filtersConfig);
    reportFilterResult(sourceName, withSource, filtered, filtersConfig);

    const savedItems = [];
    for (const item of filtered) {
      const id = normalizeUrl(item.url);
      const record = {
        id,
        url: item.url,
        title: item.title,
        meta: item.meta || '',
        description: item.description || '',
        postedAt: item.postedAt || '',
        details: normalizeStructuredDetails(item.details || {}),
        source: item.source,
        foundAt: Date.now(),
        matchedKeywords: item.matchedKeywords || [],
        aiVerdict: item.aiVerdict ?? null,
      };
      if (useHistory) {
        const saved = await saveIfNew(record);
        if (saved) savedItems.push(record);
      } else {
        savedItems.push(record);
      }
    }

    if (savedItems.length === 0) return 0;

    newItemsCount += savedItems.length;
    newlySavedItems.push(...savedItems);
    await chrome.storage.local.set({
      'ui.lastRunItemIds': newlySavedItems.map((item) => item.id),
    });
    reportProgress({
      source: sourceName,
      phase: 'items-found',
      message: `${savedItems.length} new item(s) saved`,
      items: savedItems,
    });
    return savedItems.length;
  }

  await chrome.storage.local.set({ 'ui.lastRunItemIds': [] });

  // Каждый источник фильтруется и сохраняется СРАЗУ по завершении своего
  // обхода, а не после того, как отработают вообще все источники — иначе
  // один медленный источник держал бы результаты быстрых невидимыми до
  // самого конца прогона. Источники всё ещё идут параллельно
  // (Promise.allSettled), просто каждый доводит свой результат до
  // сохранения независимо от остальных.
  const settled = await Promise.allSettled(
    permittedEntries.map(async ([name, parser]) => {
      await crawlSource({ name, ...parser, maxEntities, useHistory }, reportProgress, cancelFlag, (rawItem) =>
        saveRawItemsLive(name, [rawItem])
      );
        // Живое обновление: панель дорисовывает эти карточки в "Just
        // found" не дожидаясь конца всего прогона.
    })
  );

  if (activeScanCancelFlag === cancelFlag) activeScanCancelFlag = null;

  settled.forEach((result, i) => {
    const [name] = permittedEntries[i];
    if (result.status === 'rejected') {
      reportProgress({ source: name, phase: 'error', message: `Parser crashed: ${result.reason?.message || result.reason}` });
    }
  });

  const ranAt = Date.now();
  await chrome.storage.local.set({
    'ui.lastRunAt': ranAt,
    'ui.lastRunItemIds': newlySavedItems.map((item) => item.id),
  });
  await chrome.storage.session.remove('ui.currentProgress');

  if (newItemsCount > 0) {
    const { 'ui.unseenCount': unseenCount = 0 } = await chrome.storage.local.get('ui.unseenCount');
    const total = unseenCount + newItemsCount;
    await chrome.storage.local.set({ 'ui.unseenCount': total });
    chrome.action.setBadgeText({ text: String(total) });
    chrome.action.setBadgeBackgroundColor({ color: '#d9480f' });
  }

  const endMessage = cancelFlag.cancelled
    ? `Scan stopped early: ${newItemsCount} new item(s) saved before stopping`
    : `Scan complete: ${newItemsCount} new item(s)`;
  reportProgress({ source: null, phase: 'scan-end', message: endMessage });

  return { newItemsCount, ranAt, newItemIds: newlySavedItems.map((item) => item.id) };
}

function getSourceOriginPatterns(source) {
  return source.originPatterns || (source.originPattern ? [source.originPattern] : []);
}

function normalizeStructuredDetails(details) {
  const normalized = {
    salary: details.salary,
    workType: details.workType || details.work_type || details.job_type || details.type,
    location: details.location || details.region || details.country,
  };

  return Object.fromEntries(Object.entries(normalized).filter(([, value]) => value));
}

function normalizeMaxEntities(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
}
