/**
 * Mechanical browser tools. Total functions: each succeeds or throws with a
 * clear error. No intent logic, no scoring, no guessing — the loop decides,
 * tools only execute.
 */
export async function getTabMeta(tabId) {
  const tab = await chrome.tabs.get(tabId);
  return { url: tab.url ?? '', title: (tab.title ?? '').slice(0, 80) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * Observe with retries: right after a navigation the content script may not
 * be injected yet, and a transient miss must not kill the whole command.
 */
export async function observeTab(tabId, retries = 2) {
  let lastErr = new Error('observe failed');
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: 'observe' });
      if (!res) throw new Error('page did not respond to observe');
      if (res.error) throw new Error(res.error);
      return res.candidates ?? [];
    } catch (e) {
      lastErr = e;
      if (i < retries) await sleep(350);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('observe failed');
}
export async function highlightTab(tabId, selector, id) {
  await chrome.tabs.sendMessage(tabId, { type: 'highlight', selector, id });
}
export async function actOn(tabId, candidate, value) {
  const res = await chrome.tabs.sendMessage(tabId, {
    type: 'act',
    candidate,
    value,
  });
  // a failed act must throw with the page's reason, not silently "succeed"
  if (res && res.ok === false) {
    throw new Error(res.error || `could not act on ${candidate.description}`);
  }
}
export async function pressEnterKey(tabId, selector, id) {
  const res = await chrome.tabs
    .sendMessage(tabId, { type: 'pressEnter', selector, id })
    .catch(() => null);
  return !!res?.ok;
}
/** Read back what a fill actually left in the field — the fill-stick check. */
export async function readLiveValue(tabId, id, selector) {
  const res = await chrome.tabs
    .sendMessage(tabId, { type: 'readValue', id, selector })
    .catch(() => null);
  return res?.value ?? '';
}
/** Deterministic quality via the page's own video player API (no menu maze). */
export async function setPlayerQuality(tabId, want) {
  const res = await chrome.tabs
    .sendMessage(tabId, { type: 'playerQuality', want })
    .catch(() => null);
  if (!res?.ok) throw new Error(res?.error || 'quality change failed');
  return res.level || 'max';
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
