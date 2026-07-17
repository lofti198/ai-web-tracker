// Источник: AI Jobs — https://www.aijobs.com/jobs
// Двухфазный обход: страница списка даёт заголовок и ссылку, зарплата/тип
// занятости/локация/дата публикации и полное описание берутся со страницы
// вакансии.
//
// Селекторы проверены вживую через claude-in-chrome dev-инструменты на
// реальных страницах сайта (страница списка + 2 карточки вакансии). Если
// aijobs.com поменяет вёрстку — перепроверить тем же способом (см. AGENTS.md).

export const originPattern = 'https://www.aijobs.com/*';
export const listUrls = ['https://www.aijobs.com/jobs'];

// Выполняется ВНУТРИ вкладки со страницей списка.
// Карточки — a.job-details-link (ровно одна на .job-listings-item),
// поэтому промо-блоки и служебные ссылки (город/тип занятости/apply) в
// списке ссылок сами по себе не попадают.
export function extractLinks() {
  const links = document.querySelectorAll('a.job-details-link');
  const items = [];

  links.forEach((link) => {
    const titleEl = link.querySelector('h3');
    if (!link.href || !titleEl) return;

    items.push({
      url: link.href,
      title: titleEl.textContent.trim(),
      meta: '',
    });
  });

  return items;
}

// Выполняется ВНУТРИ вкладки со страницей отдельной вакансии.
// .job-inner-detail-box встречается на странице ровно один раз, так что
// похожие вакансии внизу страницы не подмешиваются.
export function extractDetail() {
  const descriptionEl = document.querySelector('aside.job-inner-left .html-content');
  const description = (descriptionEl?.innerText || '').replace(/\n{3,}/g, '\n\n').trim();

  const metaRow = document.querySelector('.job-inner-detail-box .d-flex.align-items-center.flex-wrap.jb-gap-lg');
  const infoItems = metaRow
    ? Array.from(metaRow.children).filter((el) => !el.classList.contains('info-items-divider'))
    : [];

  // Порядок пунктов в metaRow фиксированный: компания, тип занятости,
  // локация, необязательная зарплата, дата публикации (например "3w ago") —
  // последней всегда идёт дата, зарплата (если есть) стоит перед ней.
  const workType = infoItems[1]?.textContent.trim() || '';
  const location = infoItems[2]?.textContent.trim() || '';
  const postedAt = infoItems[infoItems.length - 1]?.textContent.trim() || '';
  const salary = infoItems.length > 4 ? infoItems[3]?.textContent.trim() || '' : '';

  const details = {};
  if (workType) details.workType = workType;
  if (location) details.location = location;
  if (salary) details.salary = salary;

  return { description, postedAt, details };
}
