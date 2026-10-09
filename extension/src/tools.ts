/**
 * Mechanical browser tools. Total functions: each succeeds or throws with a
 * clear error. No intent logic, no scoring, no guessing — the loop decides,
 * tools only execute.
 */

export type Candidate = {
  id: number;
  selector: string;
  description: string;
  method?: string;
  role?: string;
};

export async function getTabMeta(tabId: number): Promise<{ url: string; title: string }> {
  const tab = await chrome.tabs.get(tabId);
  return { url: tab.url ?? '', title: (tab.title ?? '').slice(0, 80) };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Observe with retries: right after a navigation the content script may not
 * be injected yet, and a transient miss must not kill the whole command.
 */
export async function observeTab(tabId: number, retries = 2): Promise<Candidate[]> {
  let lastErr: unknown = new Error('observe failed');
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: 'observe' });
      if (!res) throw new Error('page did not respond to observe');
      if (res.error) throw new Error(res.error);
      return (res.candidates ?? []) as Candidate[];
    } catch (e) {
      lastErr = e;
      if (i < retries) await sleep(350);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('observe failed');
}

export async function highlightTab(tabId: number, selector: string, id?: number): Promise<void> {
  await chrome.tabs.sendMessage(tabId, { type: 'highlight', selector, id });
}

export async function actOn(tabId: number, candidate: Candidate, value?: string): Promise<void> {
  const res = (await chrome.tabs.sendMessage(tabId, {
    type: 'act',
    candidate,
    value,
  })) as { ok?: boolean; error?: string } | undefined;
  // a failed act must throw with the page's reason, not silently "succeed"
  if (res && res.ok === false) {
    throw new Error(res.error || `could not act on ${candidate.description}`);
  }
}

export async function pressEnterKey(
  tabId: number,
  selector: string,
  id?: number,
): Promise<boolean> {
  const res = await chrome.tabs
    .sendMessage(tabId, { type: 'pressEnter', selector, id })
    .catch(() => null);
  return !!res?.ok;
}

/** Read back what a fill actually left in the field — the fill-stick check. */
export async function readLiveValue(tabId: number, id: number, selector: string): Promise<string> {
  const res = (await chrome.tabs
    .sendMessage(tabId, { type: 'readValue', id, selector })
    .catch(() => null)) as { ok?: boolean; value?: string } | null;
  return res?.value ?? '';
}

/** Deterministic quality via the page's own video player API (no menu maze). */
export async function setPlayerQuality(tabId: number, want: number | null): Promise<string> {
  const res = (await chrome.tabs
    .sendMessage(tabId, { type: 'playerQuality', want })
    .catch(() => null)) as { ok?: boolean; level?: string; error?: string } | null;
  if (!res?.ok) throw new Error(res?.error || 'quality change failed');
  return res.level || 'max';
}

export async function scrollOnce(tabId: number): Promise<void> {
  await chrome.tabs.sendMessage(tabId, { type: 'scroll' }).catch(() => {});
}

/** Navigate and wait until loaded (abort-aware). Returns the live URL. */
export async function navigateTab(
  tabId: number,
  url: string,
  signal: AbortSignal,
  timeoutMs = 12000,
): Promise<string> {
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

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
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
