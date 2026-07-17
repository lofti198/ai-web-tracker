/**
 * Контракт парсера v2. Этот файл не исполняется — только описание типов
 * для подсказок и как пример для участников воркшопа.
 *
 * Каждый парсер описывает двухфазный обход одного источника:
 *   1. Каждая страница списка из listUrls (их может быть несколько — с
 *      разными фильтрами/регионами одного и того же сайта) по очереди
 *      открывается в отдельной фоновой вкладке.
 *   2. extractLinks выполняется ВНУТРИ этой вкладки (через
 *      chrome.scripting.executeScript) и достаёт ссылки на сущности.
 *      Результаты со всех listUrls объединяются и дедуплицируются по url.
 *   3. Если extractDetail задан — для каждой НОВОЙ (ранее не встречавшейся)
 *      ссылки открывается своя вкладка, и extractDetail достаёт из неё
 *      полные данные (описание и т.п.). Если extractDetail не задан —
 *      парсер однофазный: данных из extractLinks достаточно.
 *
 * @typedef {Object} EntityLink
 * @property {string} url
 * @property {string} title
 * @property {string} [meta]
 * @property {string} [postedAt]  для однофазных парсеров (без extractDetail):
 *   если на странице списка уже есть дата публикации, положите её сюда —
 *   она пробрасывается в RawItem как есть.
 * @property {Object<string,string>} [details]  аналогично — доп. поля для
 *   однофазных парсеров, если их можно взять прямо со страницы списка.
 *
 * @typedef {Object} EntityDetail
 * @property {string} [description]  полный текст (например, описание вакансии)
 * @property {string} [postedAt]     дата публикации на сайте-источнике (не путать с foundAt — когда МЫ её нашли)
 * @property {Object<string,string>} [details]  произвольные доп. поля: company/location/salary/tags — что уместно теме
 *
 * @typedef {Object} RawItem
 * @property {string} url
 * @property {string} title
 * @property {string} [meta]
 * @property {string} [description]
 * @property {string} [postedAt]
 * @property {Object<string,string>} [details]
 */

/**
 * ВАЖНО: extractLinks и extractDetail выполняются в контексте ЦЕЛЕВОЙ
 * страницы через chrome.scripting.executeScript — это обычные функции без
 * замыканий на внешние переменные модуля (видят только `document`/`window`
 * той вкладки). Пишите их так, будто вставляете `<script>` прямо в чужую
 * страницу.
 *
 * @callback ExtractLinksFn
 * @returns {EntityLink[]}
 *
 * @callback ExtractDetailFn
 * @returns {EntityDetail}
 */

/**
 * export const originPattern = 'https://example-source.com/*';
 * export const listUrls = ['https://example-source.com/listing?region=eu'];
 * export function extractLinks() { ... }        // обязательно
 * export function extractDetail() { ... }        // опционально (двухфазный обход)
 */

export {};
