const STORAGE_KEY = 'filters.config';

const DEFAULT_CONFIG = {
  keywordFilter: { enabled: false, words: [] },
  minusWordFilter: { enabled: false, words: [] },
  aiFilter: { enabled: false, prompt: '' },
};

const keywordEnabled = document.getElementById('keyword-enabled');
const keywordWords = document.getElementById('keyword-words');
const minusEnabled = document.getElementById('minus-enabled');
const minusWords = document.getElementById('minus-words');
const aiEnabled = document.getElementById('ai-enabled');
const aiPrompt = document.getElementById('ai-prompt');
const aiWarning = document.getElementById('ai-warning');
const toast = document.getElementById('toast');

let toastTimer = null;
let saveTimer = null;

init();

async function init() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const config = { ...DEFAULT_CONFIG, ...(stored[STORAGE_KEY] || {}) };

  keywordEnabled.checked = config.keywordFilter.enabled;
  keywordWords.value = wordsToText(config.keywordFilter.words);

  minusEnabled.checked = config.minusWordFilter.enabled;
  minusWords.value = wordsToText(config.minusWordFilter.words);

  aiEnabled.checked = config.aiFilter.enabled;
  aiPrompt.value = config.aiFilter.prompt || '';

  keywordEnabled.addEventListener('change', onSave);
  minusEnabled.addEventListener('change', onSave);
  aiEnabled.addEventListener('change', onSave);
  keywordWords.addEventListener('input', scheduleSave);
  minusWords.addEventListener('input', scheduleSave);
  aiPrompt.addEventListener('input', scheduleSave);
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(onSave, 500);
}

async function onSave() {
  aiWarning.hidden = true;
  let shouldShowMissingKeyToast = false;

  if (aiEnabled.checked) {
    // The key lives on the Setting tab, so read it from storage.
    const { 'profile.openaiApiKey': apiKey } = await chrome.storage.local.get('profile.openaiApiKey');
    if (!apiKey) {
      shouldShowMissingKeyToast = true;
    }
  }

  const config = {
    keywordFilter: {
      enabled: keywordEnabled.checked,
      words: textToWords(keywordWords.value),
    },
    minusWordFilter: {
      enabled: minusEnabled.checked,
      words: textToWords(minusWords.value),
    },
    aiFilter: {
      enabled: aiEnabled.checked,
      prompt: aiPrompt.value.trim(),
    },
  };

  await chrome.storage.local.set({ [STORAGE_KEY]: config });

  if (shouldShowMissingKeyToast) {
    showToast('AI filter is enabled, but OpenAI API key is not set. Add it on the Setting tab.', 'error');
  }
}

function showToast(message, level = 'info') {
  if (!toast) return;

  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast toast-${level}`;
  toast.hidden = false;

  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 4500);
}

function wordsToText(words) {
  return Array.isArray(words) ? words.join(', ') : '';
}

function textToWords(text) {
  return text
    .split(/[\n,]+/)
    .map((w) => w.trim())
    .filter(Boolean);
}
