// Пример парсера №1 (базовый уровень): однофазный обход — вся нужная
// информация уже есть на странице списка, отдельные страницы сущностей
// открывать не нужно (extractDetail не задан).
// Источник для демо: Hacker News Jobs — https://news.ycombinator.com/jobs

export const originPattern = 'https://news.ycombinator.com/*';
export const listUrls = ['https://news.ycombinator.com/jobs'];

// Выполняется ВНУТРИ вкладки со страницей списка (chrome.scripting.executeScript).
// Обычная функция без замыканий на внешние переменные — видит только DOM
// этой конкретной вкладки. Селекторы проверены вживую на реальной странице.
export function extractLinks() {
  const rows = document.querySelectorAll('tr.athing');
  const items = [];

  rows.forEach((row) => {
    const link = row.querySelector('.titleline a');
    if (!link) return;

    const ageEl = row.nextElementSibling?.querySelector('.subtext .age');
    const isoDate = ageEl?.title?.split(' ')[0] || '';

    items.push({
      url: link.href,
      title: link.textContent.trim(),
      meta: ageEl?.textContent?.trim() || '',
      postedAt: isoDate,
    });
  });

  return items;
}
