// Фильтр по словам: элемент проходит, если заголовок содержит
// хотя бы одно из слов списка (регистронезависимое OR-совпадение).

/**
 * @param {Array<object>} items
 * @param {{enabled: boolean, words: string[]}} config
 * @returns {Array<object>} items с добавленным полем matchedKeywords
 */
export function applyKeywordFilter(items, { enabled, words } = {}) {
  if (!enabled || !words || words.length === 0) {
    return items.map((item) => ({ ...item, matchedKeywords: item.matchedKeywords || [] }));
  }

  const normalizedWords = words.map((w) => w.trim().toLowerCase()).filter(Boolean);

  return items
    .map((item) => {
      const title = (item.title || '').toLowerCase();
      const matchedKeywords = normalizedWords.filter((w) => title.includes(w));
      return { ...item, matchedKeywords };
    })
    .filter((item) => item.matchedKeywords.length > 0);
}
