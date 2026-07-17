const DESCRIPTION_PREVIEW_LENGTH = 220;

const STRUCTURED_FIELDS = [
  { key: 'salary', label: 'Salary', className: 'item-entity-salary' },
  { key: 'workType', label: 'Work type', className: 'item-entity-work-type' },
  { key: 'location', label: 'Location', className: 'item-entity-location' },
  { key: 'postedAt', label: 'Posted', className: 'item-entity-posted-at' },
];

/**
 * Renders one saved item. Used by Main ("Just found") and History.
 *
 * @param {object} item
 * @returns {HTMLLIElement}
 */
export function renderItemCard(item) {
  const li = document.createElement('li');
  li.className = 'item-card';

  const link = document.createElement('a');
  link.href = item.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = item.title;
  li.appendChild(link);

  const structured = getStructuredFields(item);
  if (structured.length > 0) {
    const entityRow = document.createElement('div');
    entityRow.className = 'item-entities';
    for (const field of structured) {
      const entity = document.createElement('span');
      entity.className = `item-entity ${field.className}`;
      entity.textContent = `${field.label}: ${field.value}`;
      entityRow.appendChild(entity);
    }
    li.appendChild(entityRow);
  }

  if (item.description) {
    const description = document.createElement('p');
    description.className = 'item-description';

    const isLong = item.description.length > DESCRIPTION_PREVIEW_LENGTH;
    const previewText = isLong ? `${item.description.slice(0, DESCRIPTION_PREVIEW_LENGTH)}...` : item.description;
    description.textContent = previewText;
    li.appendChild(description);

    if (isLong) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'item-description-toggle';
      toggle.textContent = 'Show more';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.addEventListener('click', () => {
        const expanded = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', String(!expanded));
        description.textContent = expanded ? previewText : item.description;
        toggle.textContent = expanded ? 'Show more' : 'Show less';
      });
      li.appendChild(toggle);
    }
  }

  if (item.matchedKeywords && item.matchedKeywords.length > 0) {
    const badge = document.createElement('div');
    badge.className = 'item-filter-badge';
    badge.textContent = `Keyword filter: ${item.matchedKeywords.join(', ')}`;
    li.appendChild(badge);
  }

  if (item.aiVerdict) {
    const badge = document.createElement('div');
    badge.className = 'item-filter-badge item-filter-badge-ai';
    badge.textContent = `AI filter: ${item.aiVerdict}`;
    li.appendChild(badge);
  }

  return li;
}

function getStructuredFields(item) {
  const details = item.details || {};
  const normalized = {
    salary: details.salary,
    workType: details.workType || details.work_type || details.job_type || details.type,
    location: details.location || details.region || details.country,
    postedAt: item.postedAt || details.postedAt || details.posted_at,
  };

  return STRUCTURED_FIELDS.map((field) => ({
    ...field,
    value: normalizeValue(normalized[field.key], field.key),
  })).filter((field) => field.value);
}

function normalizeValue(value, key) {
  if (Array.isArray(value)) value = value.filter(Boolean).join(', ');
  if (!value) return '';
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (key !== 'postedAt') return text;

  const timestamp = Date.parse(text);
  if (Number.isNaN(timestamp)) return text;
  return new Date(timestamp).toLocaleDateString();
}
