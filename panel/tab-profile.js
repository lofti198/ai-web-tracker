// Профиль пользователя: резюме (несколько файлов-вложений + текст) и
// OpenAI API-ключ. Отдельно от Filters — это конфигурация уровня
// аккаунта, а не критерий конкретного прогона. AI-фильтр
// (filters/ai-filter.js) читает ключ и текст резюме из
// chrome.storage.local (ключи profile.*), не отсюда — см.
// background/service-worker.js (runScan).

const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8MB — с запасом от лимита chrome.storage.local

const cvFileInput = document.getElementById('cv-file-input');
const cvAttachedListEl = document.getElementById('cv-attached-list');
const cvTextInput = document.getElementById('cv-text');
const apiKeyInput = document.getElementById('ai-api-key');
const apiKeyToggleBtn = document.getElementById('ai-key-toggle');
const scanLimitEnabledInput = document.getElementById('scan-limit-enabled');
const scanMaxEntitiesInput = document.getElementById('scan-max-entities');

// Список вложений держим целиком в памяти (как и остальные поля вкладки)
// и пишем в storage только по клику Save — можно приложить несколько
// файлов (например разные резюме под разные типы вакансий) и убрать
// лишние до сохранения.
let attachedFiles = []; // { id, name, type, size, dataUrl }[]
let saveTimer = null;

init();

async function init() {
  const stored = await chrome.storage.local.get([
    'profile.openaiApiKey',
    'profile.cvText',
    'profile.cvFiles',
    'scan.limitEntities',
    'scan.maxEntities',
  ]);

  apiKeyInput.value = stored['profile.openaiApiKey'] || '';
  if (cvTextInput) cvTextInput.value = stored['profile.cvText'] || '';
  attachedFiles = stored['profile.cvFiles'] || [];
  scanLimitEnabledInput.checked = stored['scan.limitEntities'] !== false;
  scanMaxEntitiesInput.value = String(normalizeMaxEntities(stored['scan.maxEntities']));
  updateScanLimitInputState();
  renderAttachedFiles();

  cvFileInput?.addEventListener('change', onFilesSelected);
  apiKeyToggleBtn.addEventListener('click', onToggleKeyVisibility);
  apiKeyInput.addEventListener('input', scheduleSave);
  cvTextInput?.addEventListener('input', scheduleSave);
  scanMaxEntitiesInput.addEventListener('input', scheduleSave);
  scanLimitEnabledInput.addEventListener('change', () => {
    updateScanLimitInputState();
    onSave();
  });
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(onSave, 500);
}

function renderAttachedFiles() {
  if (!cvAttachedListEl) return;

  cvAttachedListEl.innerHTML = '';
  for (const file of attachedFiles) {
    const li = document.createElement('li');
    li.className = 'cv-file-item';

    const link = document.createElement('a');
    link.href = file.dataUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = `${file.name} (${formatSize(file.size)})`;
    li.appendChild(link);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'cv-remove';
    removeBtn.textContent = '✕';
    removeBtn.title = `Remove "${file.name}"`;
    removeBtn.addEventListener('click', () => onRemoveFile(file.id));
    li.appendChild(removeBtn);

    cvAttachedListEl.appendChild(li);
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function onFilesSelected() {
  const files = Array.from(cvFileInput.files || []);
  cvFileInput.value = ''; // сброс сразу — иначе повторный выбор того же файла не даст change

  for (const file of files) {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      alert(`"${file.name}" is too large (${formatSize(file.size)}) — max ${formatSize(MAX_FILE_SIZE_BYTES)}. Skipped.`);
      continue;
    }

    const dataUrl = await readFileAsDataUrl(file);
    attachedFiles.push({
      id: crypto.randomUUID(),
      name: file.name,
      type: file.type,
      size: file.size,
      dataUrl,
    });

    // .txt читаем сразу и ДОБАВЛЯЕМ в текстовое поле (не заменяем) —
    // с несколькими файлами перезапись стёрла бы ранее добавленный текст.
    if (file.type === 'text/plain' || /\.txt$/i.test(file.name)) {
      const text = await readFileAsText(file);
      cvTextInput.value = cvTextInput.value ? `${cvTextInput.value}\n\n${text}` : text;
    }
  }

  renderAttachedFiles();
  await onSave();
}

async function onRemoveFile(id) {
  attachedFiles = attachedFiles.filter((file) => file.id !== id);
  renderAttachedFiles();
  await onSave();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function onToggleKeyVisibility() {
  const isPassword = apiKeyInput.type === 'password';
  apiKeyInput.type = isPassword ? 'text' : 'password';
  apiKeyToggleBtn.textContent = isPassword ? 'Hide' : 'Show';
}

async function onSave() {
  await chrome.storage.local.set({
    'profile.openaiApiKey': apiKeyInput.value.trim(),
    'profile.cvText': cvTextInput?.value.trim() || '',
    'profile.cvFiles': attachedFiles,
    'scan.limitEntities': scanLimitEnabledInput.checked,
    'scan.maxEntities': normalizeMaxEntities(scanMaxEntitiesInput.value),
  });
}

function updateScanLimitInputState() {
  scanMaxEntitiesInput.disabled = !scanLimitEnabledInput.checked;
}

function normalizeMaxEntities(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
}
