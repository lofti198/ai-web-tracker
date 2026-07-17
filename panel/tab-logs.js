import { getLogs, clearLogs } from '../storage/logs.js';

const clearBtn = document.getElementById('clear-logs');
const logsListEl = document.getElementById('logs-list');
const logsEmptyEl = document.getElementById('logs-empty');
const dialog = document.getElementById('logs-dialog');
const openBtn = document.getElementById('open-logs');
const closeBtn = document.getElementById('close-logs');

init();

async function init() {
  await refreshLogs();
  clearBtn.addEventListener('click', onClearLogs);
  openBtn.addEventListener('click', async () => {
    await refreshLogs();
    dialog.showModal();
  });
  closeBtn.addEventListener('click', () => dialog.close());

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'SCAN_PROGRESS') {
      refreshLogs();
    }
  });
}

async function onClearLogs() {
  await clearLogs();
  await refreshLogs();
}

async function refreshLogs() {
  const entries = await getLogs();
  logsListEl.innerHTML = '';
  logsEmptyEl.hidden = entries.length > 0;

  for (const entry of entries) {
    logsListEl.appendChild(renderEntry(entry));
  }
}

function renderEntry(entry) {
  const li = document.createElement('li');
  li.className = `log-entry log-entry-${entry.level}`;

  const time = document.createElement('span');
  time.className = 'log-time';
  time.textContent = new Date(entry.ts).toLocaleTimeString();

  const level = document.createElement('span');
  level.className = 'log-level';
  level.textContent = entry.level.toUpperCase();

  const message = document.createElement('span');
  message.className = 'log-message';
  message.textContent = entry.source ? `[${entry.source}] ${entry.message}` : entry.message;

  li.append(time, level, message);
  return li;
}
