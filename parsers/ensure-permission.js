/**
 * Проверяет наличие host permission и, если его нет, запрашивает
 * его у пользователя. ВАЖНО: chrome.permissions.request() работает
 * только как прямая реакция на пользовательский жест (клик), поэтому
 * эту функцию можно вызывать только из обработчика клика в панели —
 * никогда из фонового alarm-хендлера.
 *
 * @param {string} originPattern например 'https://example.com/*'
 * @returns {Promise<boolean>}
 */
export async function ensureHostPermission(originPattern) {
  const already = await chrome.permissions.contains({ origins: [originPattern] });
  if (already) return true;

  return chrome.permissions.request({ origins: [originPattern] });
}

/**
 * Только проверяет наличие разрешения, ничего не запрашивает.
 * Безопасно для использования в фоновом контексте (alarms).
 * @param {string} originPattern
 * @returns {Promise<boolean>}
 */
export async function hasHostPermission(originPattern) {
  return chrome.permissions.contains({ origins: [originPattern] });
}
