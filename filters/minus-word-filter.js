// Фильтр по минус-словам: элемент отбрасывается, если заголовок
// содержит хотя бы одно из минус-слов (регистронезависимо).

/**
 * @param {Array<object>} items
 * @param {{enabled: boolean, words: string[]}} config
 * @returns {Array<object>} items без отброшенных
 */
export function applyMinusWordFilter(items, { enabled, words } = {}) {
  if (!enabled || !words || words.length === 0) {
    return items;
  }

  const normalizedWords = words.map((w) => w.trim().toLowerCase()).filter(Boolean);

  return items.filter((item) => {
    const title = (item.title || '').toLowerCase();
    return !normalizedWords.some((w) => title.includes(w));
  });
}
