// Источник: EU Remote Jobs — https://euremotejobs.com/
// Двухфазный обход: страница списка (главная) даёт заголовок и ссылку,
// зарплата/тип/локация/дата и полное описание берутся со страницы вакансии.
//
// Селекторы проверены вживую через claude-in-chrome dev-инструменты на
// реальных страницах сайта (список + карточка вакансии). Если сайт
// поменяет вёрстку (тема Jobify/WP Job Manager) — перепроверить тем же
// способом (см. AGENTS.md).

export const originPattern = 'https://euremotejobs.com/*';
export const listUrls = ['https://euremotejobs.com/'];

// Выполняется ВНУТРИ вкладки со страницей списка (главная).
// Карточки — a.job-card-link, каждая оборачивает один .job-card.
export function extractLinks() {
  const links = document.querySelectorAll('a.job-card-link');
  const items = [];

  links.forEach((link) => {
    const titleEl = link.querySelector('.job-title');
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
// .job_listing-description и .job-listing-meta встречаются на странице
// ровно один раз (проверено через document.querySelectorAll(...).length),
// так что похожие/рекомендованные вакансии внизу страницы не подмешиваются.
export function extractDetail() {
  const descriptionEl = document.querySelector('.job_listing-description');
  const description = (descriptionEl?.innerText || '').replace(/\n{3,}/g, '\n\n').trim();

  const meta = document.querySelector('.job-listing-meta');
  const workType = meta?.querySelector('.job-type')?.textContent.trim() || '';
  const location = meta?.querySelector('.location')?.textContent.trim().replace(/\s+/g, ' ') || '';
  const postedAt = meta?.querySelector('.date-posted')?.textContent.trim() || '';
  // Поле зарплаты рендерится только когда она указана; текст вида "Salary: ...".
  const salaryText = meta?.querySelector('[class*="salary"]')?.textContent.trim() || '';
  const salary = salaryText.replace(/^Salary:\s*/i, '');

  const details = {};
  if (workType) details.workType = workType;
  if (location) details.location = location;
  if (salary) details.salary = salary;

  return { description, postedAt, details };
}
