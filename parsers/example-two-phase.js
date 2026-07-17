// Пример парсера №2 (продвинутый уровень): двухфазный обход — страница
// списка даёт только заголовок/компанию, а полное описание нужно доставать
// с отдельной страницы каждой вакансии (extractDetail).
// Источник для демо: RemoteOK — https://remoteok.com/remote-jobs
//
// Все селекторы ниже проверены вживую через браузерные dev-инструменты
// (см. AGENTS.md — «сначала смотри на реальный сайт»), а не угаданы.
// Если RemoteOK поменяет вёрстку — их придётся перепроверить тем же способом.

export const originPattern = 'https://remoteok.com/*';
export const listUrls = ['https://remoteok.com/remote-jobs'];

// Выполняется ВНУТРИ вкладки со страницей списка.
export function extractLinks() {
  const rows = document.querySelectorAll('tr.job');
  const items = [];

  rows.forEach((row) => {
    const link = row.querySelector('a[href^="/remote-jobs/"]');
    const titleEl = row.querySelector('h2');
    if (!link || !titleEl) return;

    items.push({
      url: link.href,
      title: titleEl.textContent.trim(),
      meta: '',
    });
  });

  return items;
}

// Выполняется ВНУТРИ вкладки со страницей отдельной вакансии.
// На детальной странице RemoteOK встроена ещё и лента похожих вакансий с
// такой же вёрсткой — .active обозначает именно текущую (основную) запись.
export function extractDetail() {
  const activeRow = document.querySelector('tr.job.active');
  const expandRow = document.querySelector('tr.expand.active');
  if (!activeRow || !expandRow) {
    return { description: '', postedAt: '', details: {} };
  }

  const descriptionEl = expandRow.querySelector('[itemprop="description"] .html');
  const description = (descriptionEl?.innerText || '').replace(/\n{3,}/g, '\n\n').trim();

  const postedAt = activeRow.querySelector('time')?.getAttribute('datetime') || '';
  const location = activeRow.querySelector('.location')?.textContent?.trim() || '';

  return {
    description,
    postedAt,
    details: {
      location,
    },
  };
}
