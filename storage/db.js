// Тонкая промис-обёртка над IndexedDB. Без внешних библиотек.

const DB_NAME = 'ai-web-tracker';
const DB_VERSION = 1;
const STORE_NAME = 'items';

let dbPromise = null;

/**
 * Открывает (или создаёт при первом запуске) базу данных.
 * Идемпотентна — повторные вызовы возвращают тот же промис/соединение.
 * @returns {Promise<IDBDatabase>}
 */
export function initDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('foundAt', 'foundAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

/**
 * Сохраняет элемент, только если записи с таким id ещё нет.
 * @param {object} item
 * @returns {Promise<boolean>} true если запись была новой и сохранена
 */
export async function saveIfNew(item) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(item.id);

    getReq.onsuccess = () => {
      if (getReq.result) {
        resolve(false);
        return;
      }
      const addReq = store.add(item);
      addReq.onsuccess = () => resolve(true);
      addReq.onerror = () => reject(addReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/**
 * Возвращает все сохранённые элементы, отсортированные по полю.
 * @param {{sortBy?: string, order?: 'asc'|'desc'}} options
 * @returns {Promise<object[]>}
 */
export async function getAll({ sortBy = 'foundAt', order = 'desc' } = {}) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const items = request.result || [];
      items.sort((a, b) => {
        const av = a[sortBy];
        const bv = b[sortBy];
        if (av === bv) return 0;
        const cmp = av > bv ? 1 : -1;
        return order === 'desc' ? -cmp : cmp;
      });
      resolve(items);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Полностью очищает историю найденных элементов.
 * @returns {Promise<void>}
 */
export async function clearAll() {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Проверяет, есть ли уже запись с таким id — без чтения всего объекта.
 * Используется движком обхода (parsers/tab-crawler.js), чтобы не открывать
 * вкладку сущности повторно ради уже известной записи.
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function hasId(id) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getKey(id);
    request.onsuccess = () => resolve(request.result !== undefined);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Возвращает количество сохранённых элементов (для бейджа иконки).
 * @returns {Promise<number>}
 */
export async function count() {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Нормализует URL для использования как ключа дедупликации:
 * обрезает трекинговые query-параметры (utm_*, ref, source и т.п.).
 * @param {string} url
 * @returns {string}
 */
export function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    const trackingParams = [...parsed.searchParams.keys()].filter(
      (key) => key.toLowerCase().startsWith('utm_') || ['ref', 'source'].includes(key.toLowerCase())
    );
    trackingParams.forEach((key) => parsed.searchParams.delete(key));
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
}
