/**
 * Mechanical browser tools. Total functions: each succeeds or throws with a
 * clear error. No intent logic, no scoring, no guessing — the loop decides,
 * tools only execute.
 */
export async function getTabMeta(tabId) {
  const tab = await chrome.tabs.get(tabId);
  return { url: tab.url ?? '', title: (tab.title ?? '').slice(0, 80) };
}
export async function observeTab(tabId) {
  const res = await chrome.tabs.sendMessage(tabId, { type: 'observe' });
  return res?.candidates ?? [];
}
export async function highlightTab(tabId, selector) {
  await chrome.tabs.sendMessage(tabId, { type: 'highlight', selector });
}
export async function actOn(tabId, candidate, value) {
  await chrome.tabs.sendMessage(tabId, { type: 'act', candidate, value });
}
export async function pressEnterKey(tabId, selector) {
  const res = await chrome.tabs
    .sendMessage(tabId, { type: 'pressEnter', selector })
    .catch(() => null);
  return !!res?.ok;
}
export async function scrollOnce(tabId) {
  await chrome.tabs.sendMessage(tabId, { type: 'scroll' }).catch(() => {});
}
/** Navigate and wait until loaded (abort-aware). Returns the live URL. */
export async function navigateTab(tabId, url, signal, timeoutMs = 12000) {
  await chrome.tabs.update(tabId, { url });
  const start = Date.now();
  let lastUrl = '';
  for (;;) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new Error('tab went away');
    if (tab.url) lastUrl = tab.url;
    if (tab.status === 'complete' && tab.url) return tab.url;
    if (Date.now() - start > timeoutMs) {
      if (lastUrl) return lastUrl;
      throw new Error('page took too long to load');
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}
export function withTimeout(p, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timed out')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
