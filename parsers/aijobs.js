// Источник: aijobs.com — https://www.aijobs.com/jobs
// Двухфазный обход: страница списка даёт заголовок и ссылку, зарплата/тип/
// локация/дата и полное описание берутся со страницы вакансии.
//
// Селекторы проверены вживую через claude-in-chrome dev-инструменты на
// реальных страницах сайта (список + 2 карточки вакансии, с зарплатой и без).
// Если сайт поменяет вёрстку — перепроверить тем же способом (см. AGENTS.md).
//
// non-www (aijobs.com) редиректит на www.aijobs.com — origin/originPattern
// используют www-версию.

export const originPattern = 'https://www.aijobs.com/*';
export const listUrls = ['https://www.aijobs.com/jobs'];

// Выполняется ВНУТРИ вкладки со страницей списка.
// Карточки — a.job-details-link (30 шт. на странице, только реальные
// вакансии: фильтры/категории/пагинация в другой разметке и под этот
// селектор не подпадают), заголовок — вложенный h3.
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
export function extractDetail() {
  const descriptionEl = document.querySelector('#quill-container-with-job-details');
  const description = (descriptionEl?.innerText || '').replace(/\n{3,}/g, '\n\n').trim();

  // Строка вида "Компания • Тип занятости • Локация • [Зарплата] • N ago"
  // рендерится как список <a>/<span> с "•"-разделителями и без стабильных
  // классов на сами значения. Первый элемент — компания (не нужна), последний
  // — всегда дата публикации; зарплата/тип/локация между ними определяются
  // по паттерну текста, а не по фиксированной позиции, т.к. зарплата
  // показывается не всегда (проверено на 3 живых вакансиях).
  const box = document.querySelector('.job-inner-detail-box');
  const items = box?.children?.[0]
    ? Array.from(box.children[0].children)
        .map((el) => el.textContent.trim())
        .filter((t) => t && t !== '•')
    : [];

  const postedAt = items.length ? items[items.length - 1] : '';
  const middle = items.slice(1, Math.max(1, items.length - 1));

  const workTypeRe = /full-time|part-time|contract|freelance|internship|temporary|volunteer/i;
  const salaryRe = /[$€£]|\/\s*(year|hour|month|annum|week)/i;

  let workType = '';
  let salary = '';
  let location = '';
  middle.forEach((item) => {
    if (!workType && workTypeRe.test(item)) { workType = item; return; }
    if (!salary && salaryRe.test(item)) { salary = item; return; }
    if (!location) location = item;
  });

  const details = {};
  if (workType) details.workType = workType;
  if (location) details.location = location;
  if (salary) details.salary = salary;

  return { description, postedAt, details };
}
