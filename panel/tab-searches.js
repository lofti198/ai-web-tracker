import {
  addSearch,
  getDisabledSearches,
  getSearches,
  getSearchOriginPatterns,
  parseListUrls,
  removeSearch,
  setSearchEnabled,
  updateSearch,
} from '../parsers/searches.js';
import { ensureHostPermission } from '../parsers/ensure-permission.js';

const searchesListEl = document.getElementById('searches-list');

const openAddSearchBtn = document.getElementById('open-add-search');
const addSearchDialog = document.getElementById('add-search-dialog');
const searchDialogTitle = document.getElementById('search-dialog-title');
const searchNameInput = document.getElementById('search-name');
const searchListUrlsInput = document.getElementById('search-list-urls');
const addSearchErrorEl = document.getElementById('add-search-error');
const saveSearchBtn = document.getElementById('save-search');
const cancelAddSearchBtn = document.getElementById('cancel-add-search');
const closeAddSearchBtn = document.getElementById('close-add-search');

let editingSearchName = null;

init();

async function init() {
  await renderSearches();

  openAddSearchBtn.addEventListener('click', openAddSearchDialog);
  cancelAddSearchBtn.addEventListener('click', () => addSearchDialog.close());
  closeAddSearchBtn.addEventListener('click', () => addSearchDialog.close());
  saveSearchBtn.addEventListener('click', onSaveSearch);
}

async function renderSearches() {
  const searches = await getSearches();
  const disabledSearches = new Set(await getDisabledSearches());

  searchesListEl.innerHTML = '';
  searches.forEach((search) => {
    const li = document.createElement('li');
    const enabled = !disabledSearches.has(search.name);
    li.className = enabled ? 'search-item' : 'search-item search-item-disabled';

    const headerRow = document.createElement('div');
    headerRow.className = 'search-header-row';

    const nameEl = document.createElement('span');
    nameEl.className = 'search-name';
    nameEl.textContent = search.name;
    headerRow.appendChild(nameEl);

    const actionsEl = document.createElement('div');
    actionsEl.className = 'search-actions';

    const enabledLabel = document.createElement('label');
    enabledLabel.className = 'search-enabled-toggle';
    enabledLabel.title = enabled ? 'Disable search' : 'Enable search';

    const enabledInput = document.createElement('input');
    enabledInput.type = 'checkbox';
    enabledInput.checked = enabled;
    enabledInput.addEventListener('change', () => onToggleSearch(search.name, enabledInput.checked));

    const enabledText = document.createElement('span');
    enabledText.textContent = enabledInput.checked ? 'On' : 'Off';

    enabledLabel.appendChild(enabledInput);
    enabledLabel.appendChild(enabledText);
    actionsEl.appendChild(enabledLabel);

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn btn-secondary btn-small';
    editBtn.textContent = 'Edit';
    editBtn.title = `Edit "${search.name}"`;
    editBtn.addEventListener('click', () => openEditSearchDialog(search));
    actionsEl.appendChild(editBtn);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'search-remove';
    removeBtn.textContent = 'x';
    removeBtn.title = `Remove "${search.name}"`;
    removeBtn.addEventListener('click', () => onRemoveSearch(search.name));
    actionsEl.appendChild(removeBtn);

    headerRow.appendChild(actionsEl);
    li.appendChild(headerRow);

    const urlsList = document.createElement('ul');
    urlsList.className = 'search-urls';
    (search.listUrls || []).forEach((url) => {
      const urlItem = document.createElement('li');
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = url;
      urlItem.appendChild(link);
      urlsList.appendChild(urlItem);
    });
    li.appendChild(urlsList);

    searchesListEl.appendChild(li);
  });
}

async function onRemoveSearch(name) {
  const confirmed = confirm(`Remove search "${name}"?`);
  if (!confirmed) return;
  await removeSearch(name);
  await renderSearches();
}

async function onToggleSearch(name, enabled) {
  await setSearchEnabled(name, enabled);
  await renderSearches();
}

function openAddSearchDialog() {
  editingSearchName = null;
  searchDialogTitle.textContent = 'Add search';
  saveSearchBtn.textContent = 'Add search';
  searchNameInput.value = '';
  searchListUrlsInput.value = '';
  addSearchErrorEl.hidden = true;
  addSearchDialog.showModal();
}

function openEditSearchDialog(search) {
  editingSearchName = search.name;
  searchDialogTitle.textContent = 'Edit search';
  saveSearchBtn.textContent = 'Save changes';
  searchNameInput.value = search.name;
  searchListUrlsInput.value = (search.listUrls || []).join('\n');
  addSearchErrorEl.hidden = true;
  addSearchDialog.showModal();
}

async function onSaveSearch() {
  addSearchErrorEl.hidden = true;
  saveSearchBtn.disabled = true;

  try {
    const input = {
      name: searchNameInput.value,
      listUrls: parseListUrls(searchListUrlsInput.value),
    };
    const search = editingSearchName ? await updateSearch(editingSearchName, input) : await addSearch(input);

    for (const originPattern of getSearchOriginPatterns(search)) {
      const granted = await ensureHostPermission(originPattern);
      if (!granted) {
        console.warn(`[tab-searches] permission denied for new search "${search.name}" at ${originPattern}`);
      }
    }

    addSearchDialog.close();
    editingSearchName = null;
    await renderSearches();
  } catch (err) {
    addSearchErrorEl.textContent = err.message;
    addSearchErrorEl.hidden = false;
  } finally {
    saveSearchBtn.disabled = false;
  }
}
