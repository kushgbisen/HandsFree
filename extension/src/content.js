/**
 * HandsFree — content script (runs on every page via manifest host_permissions, not activeTab)
 * Holds keepalive Port, injects HUD, provides observe/act/highlight
 */
const HUD_ID = 'hf-hud';
const STYLE_ID = 'hf-hud-style';
const HIGHLIGHT_CLASS = 'hf-highlight';
const port = chrome.runtime.connect({ name: 'keepalive' });
port.onDisconnect.addListener(() =>
  setTimeout(() => chrome.runtime.connect({ name: 'keepalive' }), 1000),
);
// HUD
function injectHud() {
  if (document.getElementById(HUD_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `.${HIGHLIGHT_CLASS}{outline:3px solid #facc15 !important;outline-offset:2px !important;background:rgba(250,204,21,0.15) !important;animation:hf-pulse 1s infinite !important}@keyframes hf-pulse{0%,100%{outline-color:#facc15}50%{outline-color:#fde68a}} #${HUD_ID}{position:fixed;right:16px;bottom:16px;width:320px;background:#111;color:#fff;z-index:2147483647;padding:12px;border-radius:12px;font:12px system-ui;box-shadow:0 4px 24px rgba(0,0,0,0.4);border:1px solid #262626}`;
  document.head.appendChild(style);
  const hud = document.createElement('div');
  hud.id = HUD_ID;
  hud.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
      <span id="hf-dot" style="width:8px;height:8px;background:#22c55e;border-radius:50%;display:inline-block;"></span>
      <span style="font-weight:700;">HandsFree</span>
      <span id="hf-status" style="margin-left:auto;font-size:11px;color:#a3a3a3;">Idle</span>
      <button id="hf-mic" style="margin-left:8px;padding:6px 10px;border-radius:8px;border:0;background:#fff;color:#000;font-weight:700;cursor:pointer;">🎤</button>
    </div>
    <div id="hf-transcript" style="min-height:18px;color:#e5e5e5;word-break:break-word;"></div>
    <div id="hf-plan" style="font-size:11px;color:#facc15;min-height:14px;"></div>
    <div id="hf-verification" style="font-size:11px;color:#a3a3a3;min-height:14px;"></div>
  `;
  (document.body || document.documentElement).appendChild(hud);
  document
    .getElementById('hf-mic')
    ?.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'startMic' }));
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectHud);
else injectHud();
new MutationObserver(() => {
  if (!document.getElementById(HUD_ID) && document.body) injectHud();
}).observe(document.documentElement, { childList: true, subtree: true });
async function observe() {
  document.querySelectorAll('[data-hf-id]').forEach((el) => el.removeAttribute('data-hf-id'));
  const els = Array.from(
    document.querySelectorAll(
      'button, a[href], input, select, textarea, [role="button"], [role="link"], [onclick]',
    ),
  ).filter((el) => {
    if (el.closest(`#${HUD_ID}`)) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  });
  return els.slice(0, 40).map((el, i) => {
    el.setAttribute('data-hf-id', String(i));
    const isInput = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
    const live = isInput ? el.value?.trim() : '';
    const text = (
      live ||
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
async function highlight(selector) {
  document
    .querySelectorAll(`.${HIGHLIGHT_CLASS}`)
    .forEach((el) => el.classList.remove(HIGHLIGHT_CLASS));
  const el = document.querySelector(selector);
  if (el) {
    el.classList.add(HIGHLIGHT_CLASS);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await new Promise((r) => setTimeout(r, 600));
  }
}
async function act(candidate, value) {
  const el = document.querySelector(candidate.selector);
  if (!el) throw new Error('candidate not found');
  if (value !== undefined || candidate.method === 'fill') {
    el.value = value ?? '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    el.click();
  }
  setTimeout(() => el.classList.remove(HIGHLIGHT_CLASS), 300);
}
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === 'observe') {
      const candidates = await observe();
      sendResponse({ candidates });
    } else if (msg.type === 'highlight') {
      await highlight(msg.selector);
      sendResponse({ ok: true });
    } else if (msg.type === 'act') {
      await act(msg.candidate, msg.value);
      sendResponse({ ok: true });
    } else if (msg.type === 'hud') {
      const u = msg.update;
      const tr = document.getElementById('hf-transcript');
      const pl = document.getElementById('hf-plan');
      const st = document.getElementById('hf-status');
      const ve = document.getElementById('hf-verification');
      if (u.transcript !== undefined && tr) tr.textContent = u.transcript;
      if (u.plan !== undefined && pl) pl.textContent = u.plan;
      if (u.status !== undefined && st) st.textContent = u.status;
      if (u.verification !== undefined && ve) ve.textContent = u.verification;
      if (u.showMic !== undefined) {
        const dot = document.getElementById('hf-dot');
        if (dot) dot.style.background = u.showMic ? '#ef4444' : '#22c55e';
      }
      sendResponse({ ok: true });
    }
  })();
  return true;
});
export {};
