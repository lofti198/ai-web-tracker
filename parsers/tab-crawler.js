// Движок двухфазного обхода через реальные вкладки браузера. Один раз
// написан здесь — отдельные файлы парсеров дают только listUrls +
// extractLinks/extractDetail (см. parser-interface.js) и ничего не знают
// про chrome.tabs/chrome.scripting.

import { hasId, normalizeUrl } from '../storage/db.js';

const DEFAULT_MAX_ENTITIES = 10;
const DOM_READY_TIMEOUT_MS = 10000;
const SPA_SETTLE_DELAY_MS = 800;
const BETWEEN_TABS_DELAY_MS = 300;
const DETAIL_TAB_MIN_OPEN_MS = 6000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ждёт, пока страница станет "достаточно готовой" для extractLinks/
 * extractDetail — DOMContentLoaded (главный фрейм), а не полный `load`
 * (все картинки/трекеры/реклама). Многие сайты (например RemoteOK) висят
 * секундами на второстепенных ресурсах уже после того, как DOM полностью
 * построен — ждать `complete` было слишком медленно и часто приводило к
 * ложным таймаутам на быстрых по факту страницах.
 *
 * НИКОГДА не бросает исключение: если ни DOMContentLoaded, ни `complete`
 * не подоспели за DOM_READY_TIMEOUT_MS — просто прекращаем ждать и идём
 * извлекать данные из того, что уже отрендерилось (лучше частичный
 * результат, чем пропущенная целиком сущность).
 * @param {number} tabId
 */
function waitForDomReady(tabId) {
  return new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      chrome.webNavigation.onDOMContentLoaded.removeListener(domListener);
      chrome.tabs.onUpdated.removeListener(updateListener);
      resolve();
    };

    const timeout = setTimeout(finish, DOM_READY_TIMEOUT_MS);

    function domListener(details) {
      // frameId === 0 — главный документ вкладки, не iframe внутри неё.
      if (details.tabId === tabId && details.frameId === 0) finish();
    }
    chrome.webNavigation.onDOMContentLoaded.addListener(domListener);

    // Подстраховка: если DOMContentLoaded уже случился до того, как мы
    // успели подписаться (гонка на очень быстрых страницах), `complete`
    // тоже считается готовностью.
    function updateListener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') finish();
    }
    chrome.tabs.onUpdated.addListener(updateListener);
  });
}

/**
 * Открывает `url` в новой фоновой (неактивной) вкладке, ждёт загрузки,
 * запускает `extractor` и возвращает его результат. Вкладка закрывается
 * всегда, даже если инъекция упала.
 *
 * @param {string} url
 * @param {import('./parser-interface.js').ExtractLinksFn | import('./parser-interface.js').ExtractDetailFn} extractor
 */
async function extractFromTab(url, extractor, { closeTab = true, minOpenMs = 0 } = {}) {
  const openedAt = Date.now();
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForDomReady(tab.id);
    await sleep(SPA_SETTLE_DELAY_MS);

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractor,
      });
      return { result: results[0]?.result, tabId: tab.id };
    } catch (err) {
      if (!closeTab) err.tabId = tab.id;
      throw err;
    }
  } finally {
    if (closeTab) {
      const remainingOpenMs = Math.max(0, minOpenMs - (Date.now() - openedAt));
      if (remainingOpenMs > 0) await sleep(remainingOpenMs);
      chrome.tabs.remove(tab.id).catch(() => {});
    }
  }
}

/**
 * Двухфазный обход одного источника: списки → ссылки → (опционально) сущности.
 * @param {{
 *   name: string,
 *   listUrls: string[],
 *   extractLinks: import('./parser-interface.js').ExtractLinksFn,
 *   extractDetail?: import('./parser-interface.js').ExtractDetailFn,
 *   maxEntities?: number,
 *   useHistory?: boolean,
 * }} source
 * @param {(event: {source: string, phase: string, message: string, index?: number, total?: number}) => void} [onProgress]
 * @param {{ cancelled: boolean }} [cancelFlag] Stop-кнопка ставит cancelled=true —
 *   движок проверяет флаг между шагами и завершает обход досрочно, сохраняя
 *   уже собранные сущности (см. background/service-worker.js).
 * @returns {Promise<import('./parser-interface.js').RawItem[]>}
 */
export async function crawlSource(source, onProgress = () => {}, cancelFlag = null, onItem = null) {
  const { name, listUrls, extractLinks, extractDetail } = source;
  const maxEntities = normalizeMaxEntities(source.maxEntities);
  const useHistory = source.useHistory !== false;
  const isCancelled = () => Boolean(cancelFlag?.cancelled);

  const allLinks = [];
  const listTabIds = [];
  const closeListTabs = () => {
    for (const tabId of listTabIds) chrome.tabs.remove(tabId).catch(() => {});
  };

  for (const listUrl of listUrls) {
    if (isCancelled()) {
      onProgress({ source: name, phase: 'cancelled', message: 'Stopped before finishing list pages' });
      closeListTabs();
      return [];
    }

    onProgress({ source: name, phase: 'list', message: `Opening list page: ${listUrl}` });
    try {
      const { result: links, tabId } = await extractFromTab(listUrl, extractLinks, { closeTab: false });
      listTabIds.push(tabId);
      allLinks.push(...(links || []));
    } catch (err) {
      if (err.tabId) listTabIds.push(err.tabId);
      onProgress({ source: name, phase: 'error', message: `Failed to load list page ${listUrl}: ${err.message}` });
    }
  }

  const uniqueLinks = [];
  const seenUrls = new Set();
  for (const link of allLinks) {
    if (!link?.url || seenUrls.has(link.url)) continue;
    seenUrls.add(link.url);
    uniqueLinks.push(link);
  }

  onProgress({
    source: name,
    phase: 'list-done',
    message: `Found ${uniqueLinks.length} link(s) across ${listUrls.length} list page(s)`,
  });

  const newLinks = [];
  for (const link of uniqueLinks) {
    const known = useHistory ? await hasId(normalizeUrl(link.url)) : false;
    if (!known) newLinks.push(link);
  }

  const toVisit = newLinks;
  onProgress({
    source: name,
    phase: 'filtered',
    message: `${newLinks.length} new (of ${uniqueLinks.length}), visiting until ${formatFoundLimit(maxEntities)} found`,
  });

  if (!extractDetail) {
    // Однофазный парсер: extractLinks уже мог положить всё, что нужно
    // (например postedAt), в объект ссылки — пробрасываем как есть.
    const items = [];
    let foundCount = 0;
    for (const link of toVisit) {
      const item = {
        url: link.url,
        title: link.title,
        meta: link.meta || '',
        postedAt: link.postedAt || '',
        details: link.details || {},
      };
      items.push(item);
      if (onItem) foundCount += await onItem(item);
      if (foundCount >= maxEntities) break;
    }
    closeListTabs();
    return items;
  }

  const items = [];
  let foundCount = 0;
  for (let i = 0; i < toVisit.length; i++) {
    if (isCancelled()) {
      onProgress({
        source: name,
        phase: 'cancelled',
        message: `Stopped after ${items.length}/${toVisit.length} entities`,
      });
      break;
    }

    const link = toVisit[i];
    onProgress({
      source: name,
      phase: 'detail',
      index: i + 1,
      total: toVisit.length,
      message: `Fetching entity ${i + 1}/${toVisit.length}: ${link.title}`,
    });

    try {
      const { result: detail } = await extractFromTab(link.url, extractDetail, {
        minOpenMs: DETAIL_TAB_MIN_OPEN_MS,
      });
      const item = {
        url: link.url,
        title: link.title,
        meta: link.meta || '',
        description: detail?.description || '',
        postedAt: detail?.postedAt || '',
        details: detail?.details || {},
      };
      items.push(item);
      if (onItem) foundCount += await onItem(item);
      if (foundCount >= maxEntities) break;
    } catch (err) {
      onProgress({ source: name, phase: 'error', message: `Failed to load ${link.url}: ${err.message}` });
    }

    if (i < toVisit.length - 1) await sleep(BETWEEN_TABS_DELAY_MS);
  }

  onProgress({ source: name, phase: 'source-done', message: `Done: ${items.length} entities collected` });

  closeListTabs();
  return items;
}

function normalizeMaxEntities(value) {
  if (value === false || value === null || value === Infinity) return Infinity;
  const parsed = Number.parseInt(value ?? DEFAULT_MAX_ENTITIES, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_ENTITIES;
}

function formatFoundLimit(maxEntities) {
  return maxEntities === Infinity ? 'all matching items are' : `${maxEntities} matching item(s) are`;
}
