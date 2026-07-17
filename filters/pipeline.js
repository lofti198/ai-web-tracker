import { applyKeywordFilter } from './keyword-filter.js';
import { applyMinusWordFilter } from './minus-word-filter.js';
import { applyAiFilter } from './ai-filter.js';

/**
 * Прогоняет элементы через все включённые фильтры по очереди:
 * сначала дешёвые локальные (keyword, minus-word), затем — только
 * на том, что осталось — платный и медленный AI-фильтр.
 *
 * @param {Array<object>} items
 * @param {object} config filters.config из chrome.storage.local
 * @returns {Promise<Array<object>>}
 */
export async function applyFilters(items, config) {
  let result = applyKeywordFilter(items, config.keywordFilter);
  result = applyMinusWordFilter(result, config.minusWordFilter);
  result = await applyAiFilter(result, config.aiFilter);
  return result;
}
