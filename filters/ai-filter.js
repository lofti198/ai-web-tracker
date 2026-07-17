// AI-фильтр через OpenAI Chat Completions API. Чистый fetch, без SDK.
// Задел на будущее: учёт стоимости запросов (токены/$) — вне рамок v1.

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';
// Меньше, чем без description: в промпт теперь идёт ещё и сниппет текста,
// не только заголовок — держим размер батча разумным по токенам.
const BATCH_SIZE = 10;
const DESCRIPTION_SNIPPET_LENGTH = 400;
const CV_SNIPPET_LENGTH = 3000; // ~ несколько абзацев резюме, не весь документ на каждый батч

/**
 * @param {Array<object>} items
 * @param {{enabled: boolean, apiKey: string, prompt: string, cvText?: string}} config
 *   cvText — текст резюме с вкладки Profile (опционально); если задан,
 *   учитывается моделью наравне с текстовым критерием prompt.
 * @returns {Promise<Array<object>>} items, прошедшие критерий, с полем aiVerdict
 */
export async function applyAiFilter(items, { enabled, apiKey, prompt, cvText } = {}) {
  if (!enabled || !apiKey) {
    return items;
  }
  if (items.length === 0) {
    return items;
  }

  const batches = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    batches.push(items.slice(i, i + BATCH_SIZE));
  }

  const results = [];
  for (const batch of batches) {
    try {
      const verdicts = await classifyBatch(batch, apiKey, prompt, cvText);
      batch.forEach((item, i) => {
        const verdict = verdicts[i];
        if (verdict && verdict.match) {
          results.push({ ...item, aiVerdict: verdict.reason || '' });
        }
      });
    } catch (err) {
      console.warn('[ai-filter] batch failed, dropping batch items:', err);
      // Элементы, которые не удалось прогнать через AI, не сохраняются —
      // чтобы не показывать неотфильтрованный шум.
    }
  }

  return results;
}

async function classifyBatch(batch, apiKey, prompt, cvText) {
  const list = batch
    .map((item, i) => {
      const details = item.details || {};
      const structured = [
        details.salary ? `salary: ${details.salary}` : '',
        details.workType ? `work type: ${details.workType}` : '',
        details.location ? `location: ${details.location}` : '',
        item.postedAt ? `posted: ${item.postedAt}` : '',
      ].filter(Boolean);
      const header = `${i}. ${item.title}${structured.length > 0 ? ` (${structured.join('; ')})` : ''}`;
      const snippet = item.description ? item.description.slice(0, DESCRIPTION_SNIPPET_LENGTH) : '';
      return snippet ? `${header}\n   ${snippet}` : header;
    })
    .join('\n');

  const cvSection = cvText
    ? `\n\nРезюме пользователя (учитывай наравне с критерием ниже):\n${cvText.slice(0, CV_SNIPPET_LENGTH)}`
    : '';

  const systemMessage =
    'Ты фильтруешь список элементов по критерию пользователя. ' +
    'Для каждого элемента верни решение match (true/false) и краткое пояснение (reason, до 15 слов). ' +
    'Ответ строго в формате JSON: {"results": [{"index": number, "match": boolean, "reason": string}, ...]}. ' +
    'Верни ровно один объект результата на каждый элемент списка, сохраняя порядок index.' +
    cvSection;

  const userMessage = `Критерий отбора: ${prompt}\n\nСписок элементов:\n${list}`;

  const response = await fetch(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API HTTP ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI API returned empty content');
  }

  const parsed = JSON.parse(content);
  const resultsByIndex = new Map();
  (parsed.results || []).forEach((r) => resultsByIndex.set(r.index, r));

  return batch.map((_, i) => resultsByIndex.get(i) || { match: false, reason: '' });
}
