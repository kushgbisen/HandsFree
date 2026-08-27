/**
 * HandsFree — content script
 * Fix #2: persistent orb via content_scripts + host_permissions, not activeTab
 * This file runs on every page via manifest.content_scripts.matches = ["<all_urls>"]
 * So the orb is there on load, no toolbar click needed.
 * Also holds keepalive Port to background (fix #1).
 */

// keepalive: hold Port open so background service worker isn't killed mid-task
const port = chrome.runtime.connect({ name: 'keepalive' });
port.onDisconnect.addListener(() => {
  // reconnect if background restarted
  setTimeout(() => chrome.runtime.connect({ name: 'keepalive' }), 1000);
});

// HUD injection — same index-based grounding as Node prototype
const HUD_ID = 'hf-hud';
if (!document.getElementById(HUD_ID)) {
  const hud = document.createElement('div');
  hud.id = HUD_ID;
  hud.innerHTML = `<div style="position:fixed;right:16px;bottom:16px;width:320px;background:#111;color:#fff;z-index:2147483647;padding:12px;border-radius:12px;font:12px system-ui;">HandsFree — say "click sign in"</div>`;
  document.body?.appendChild(hud);
}

// observe() — fresh every turn, tags live nodes with data-hf-id, excludes HUD
export type Candidate = { id: number; selector: string; description: string; method?: string };
export async function observe(): Promise<Candidate[]> {
  document.querySelectorAll('[data-hf-id]').forEach((el) => el.removeAttribute('data-hf-id'));
  const els = Array.from(
    document.querySelectorAll(
      'button, a[href], input, select, textarea, [role="button"], [role="link"], [onclick]',
    ),
  ).filter((el) => {
    if ((el as HTMLElement).closest(`#${HUD_ID}`)) return false;
    const rect = (el as HTMLElement).getBoundingClientRect();
    const style = getComputedStyle(el as HTMLElement);
    return (
      rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
    );
  });
  return els.slice(0, 40).map((el, i) => {
    (el as HTMLElement).setAttribute('data-hf-id', String(i));
    const isInput = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
    const liveValue = isInput ? (el as HTMLInputElement).value?.trim() : '';
    const text = (
      liveValue ||
      el.textContent?.trim() ||
      el.getAttribute('aria-label') ||
      el.getAttribute('placeholder') ||
      el.tagName
    )
      .replace(/\s+/g, ' ')
      .slice(0, 80);
    const tag = el.tagName.toLowerCase();
    return {
      id: i,
      description: `${tag}: "${text}"`,
      selector: `[data-hf-id="${i}"]`,
      method: tag === 'input' || tag === 'textarea' || tag === 'select' ? 'fill' : 'click',
    };
  });
}

// act() — exact selector, zero fuzzy re-match
export async function act(candidate: Candidate, value?: string): Promise<void> {
  const el = document.querySelector(candidate.selector) as HTMLElement | null;
  if (!el) throw new Error(`candidate ${candidate.id} not found`);
  el.classList.add('hf-highlight');
  await new Promise((r) => setTimeout(r, 600));
  if (value !== undefined || candidate.method === 'fill') {
    (el as HTMLInputElement).value = value ?? '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    (el as HTMLElement).click();
  }
  setTimeout(() => el.classList.remove('hf-highlight'), 300);
}

// listen for background -> content messages (plan -> act)
chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.type === 'act' && msg.candidate) {
    await act(msg.candidate, msg.value);
  }
});
