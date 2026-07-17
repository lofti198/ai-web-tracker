// Технический лог прогонов сканирования. Отдельно от items (storage/db.js) —
// это диагностическая лента (что делалось), а не собранные данные.
// Хранится в chrome.storage.local как капнутый по длине массив — для
// объёма и частоты записи workshop-масштаба IndexedDB избыточна.

const STORAGE_KEY = 'logs.entries';
const MAX_ENTRIES = 300;

/**
 * @param {{ level?: 'info'|'warn'|'error', source?: string, message: string }} entry
 * @returns {Promise<void>}
 */
export async function appendLog({ level = 'info', source = '', message }) {
  const entry = { ts: Date.now(), level, source, message };
  const { [STORAGE_KEY]: existing = [] } = await chrome.storage.local.get(STORAGE_KEY);
  const next = [entry, ...existing].slice(0, MAX_ENTRIES);
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return entry;
}

/**
 * @returns {Promise<Array<{ts:number, level:string, source:string, message:string}>>}
 */
export async function getLogs() {
  const { [STORAGE_KEY]: entries = [] } = await chrome.storage.local.get(STORAGE_KEY);
  return entries;
}

/** @returns {Promise<void>} */
export async function clearLogs() {
  await chrome.storage.local.set({ [STORAGE_KEY]: [] });
}
