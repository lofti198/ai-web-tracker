// Пример источника: We Work Remotely — https://weworkremotely.com/remote-jobs
// Двухфазный обход: страница списка даёт заголовок/компанию/локацию/теги,
// полное описание и структурированные поля (зарплата, тип занятости,
// категория, регион, навыки) берутся со страницы вакансии.
//
// Селекторы проверены вживую через chrome-in-chrome dev-инструменты на
// реальных страницах сайта. Если WWR поменяет вёрстку — перепроверить тем
// же способом (см. AGENTS.md).

export const originPattern = 'https://weworkremotely.com/*';
export const listUrls = ['https://weworkremotely.com/remote-jobs'];

// Выполняется ВНУТРИ вкладки со страницей списка.
// Промо/спонсорские блоки (li.new-listing-container без ссылки на
// /remote-jobs/... или без заголовка) пропускаются естественным образом.
export function extractLinks() {
  const rows = document.querySelectorAll('li.new-listing-container');
  const items = [];

  rows.forEach((row) => {
    const link = row.querySelector('a[href^="/remote-jobs/"]');
    const titleEl = row.querySelector('.new-listing__header__title__text');
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
export function extractDetail() {
  const descriptionEl = document.querySelector('.lis-container__job__content__description');
  const description = (descriptionEl?.innerText || '').replace(/\n{3,}/g, '\n\n').trim();

  // Каждый пункт "About the job" — это <li> с текстовым узлом-лейблом
  // (Posted on / Apply before / Job type / Salary / Category / Country /
  // Skills) и значением во вложенных span/a. Собираем как есть, без
  // жёсткого списка ключей — сайт не всегда показывает все поля.
  const aboutItems = document.querySelectorAll('.lis-container__job__sidebar__job-about__list__item');
  const details = {};
  let postedAt = '';

  aboutItems.forEach((item) => {
    const label = Array.from(item.childNodes)
      .find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim())
      ?.textContent.trim();
    if (!label) return;

    // Многозначные поля (Skills, Country) рендерятся как несколько .box
    // элементов подряд без пробела между ними — руками собираем через ", ".
    const boxes = [...new Set(Array.from(item.querySelectorAll('.box')).map((b) => b.textContent.trim()))].filter(Boolean);
    const value = boxes.length > 1 ? boxes.join(', ') : item.innerText.replace(label, '').trim().replace(/\s+/g, ' ');
    if (!value) return;

    if (label === 'Posted on') {
      postedAt = value;
    } else if (label === 'Job type') {
      details.workType = value;
    } else if (label === 'Salary') {
      details.salary = value;
    } else if (label === 'Country') {
      details.location = value;
    } else {
      return;
    }
  });

  return { description, postedAt, details };
}
