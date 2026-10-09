'use strict';
/**
 * HandsFree — content script. Runs on YOUR tabs (youtube.com included),
 * not a robot window. Clean card + observe/act/highlight.
 */
const HUD_ID = 'hf-hud';
const STYLE_ID = 'hf-hud-style';
const HIGHLIGHT_CLASS = 'hf-highlight';
const MIC_SVG = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1"/><line x1="12" y1="18" x2="12" y2="22"/></svg>`;
const STOP_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>`;
const MINUS_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
// Fire-and-forget messaging that stays silent when this build is orphaned
// (extension reloaded/updated — the new build arrives on tab refresh).
function safeSend(msg) {
  try {
    if (!chrome.runtime?.id) return;
    const p = chrome.runtime.sendMessage(msg);
    if (p && typeof p.catch === 'function') {
      p.catch(() => {});
    }
  } catch {
    // dead context — nothing to do until refresh
  }
}
function connectKeepalive() {
  try {
    if (!chrome.runtime?.id) return;
    const p = chrome.runtime.connect({ name: 'keepalive' });
    p.onDisconnect.addListener(() => setTimeout(connectKeepalive, 1000));
  } catch {
    // dead context — refresh brings the new build
  }
}
connectKeepalive();
function injectHud() {
  if (document.getElementById(HUD_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .${HIGHLIGHT_CLASS}{outline:3px solid #facc15 !important;outline-offset:2px !important;background:rgba(250,204,21,0.15) !important;animation:hf-pulse 1s ease-in-out infinite !important}
    @keyframes hf-pulse{0%,100%{outline-color:#facc15}50%{outline-color:#fde68a}}
    #${HUD_ID} button,#${HUD_ID} input{font:inherit;letter-spacing:inherit}
    #${HUD_ID}{position:fixed;right:20px;bottom:20px;width:300px;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;background:rgba(28,28,30,0.72);backdrop-filter:blur(24px) saturate(180%);-webkit-backdrop-filter:blur(24px) saturate(180%);color:#f5f5f7;z-index:2147483647;border-radius:22px;padding:16px;border:1px solid rgba(255,255,255,0.12);box-shadow:0 16px 48px rgba(0,0,0,0.42),inset 0 1px 0 rgba(255,255,255,0.08);font:13px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;letter-spacing:-0.008em;animation:hf-in 0.32s cubic-bezier(0.32,0.72,0,1)}
    @keyframes hf-in{from{opacity:0;transform:translateY(10px) scale(0.98)}}
    #${HUD_ID} #hf-top{display:flex;align-items:center;gap:8px;margin-bottom:12px}
    #${HUD_ID} #hf-dot{width:7px;height:7px;border-radius:50%;background:#30d158;flex:none;box-shadow:0 0 6px rgba(48,209,88,0.7)}
    #${HUD_ID} #hf-dot.busy{background:#ffd60a;box-shadow:0 0 6px rgba(255,214,10,0.7);animation:hf-blink 1s infinite}
    @keyframes hf-blink{50%{opacity:0.35}}
    #${HUD_ID} #hf-brand{font-size:10.5px;font-weight:600;letter-spacing:0.14em;color:#8e8e93}
    #${HUD_ID} #hf-min{margin-left:auto;width:24px;height:24px;border-radius:50%;border:0;background:transparent;color:#8e8e93;display:grid;place-items:center;cursor:pointer;transition:background 0.15s ease,color 0.15s ease,transform 0.15s ease}
    #${HUD_ID} #hf-min:hover{background:rgba(255,255,255,0.1);color:#fff}
    #${HUD_ID} #hf-min:active{transform:scale(0.92)}
    #${HUD_ID} #hf-status{color:#f5f5f7;font-weight:500;min-height:20px;margin-bottom:6px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
    #${HUD_ID} #hf-think{font-size:11.5px;line-height:1.45;color:#a1a1a6;min-height:0;margin:0 0 12px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
    #${HUD_ID} #hf-think:empty{display:none;margin:0}
    #${HUD_ID} #hf-think.live{background:linear-gradient(90deg,#a1a1a6 25%,#ffd60a 50%,#a1a1a6 75%);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:hf-shimmer 1.2s linear infinite}
    @keyframes hf-shimmer{to{background-position:-200% 0}}
    #${HUD_ID} #hf-row{display:flex;gap:10px;align-items:center}
    #${HUD_ID} #hf-mic{width:40px;height:40px;flex:none;border-radius:50%;border:0;background:#f5f5f7;color:#1d1d1f;display:grid;place-items:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.3);transition:transform 0.18s cubic-bezier(0.32,0.72,0,1),background 0.2s ease,box-shadow 0.2s ease}
    #${HUD_ID} #hf-mic:hover{transform:scale(1.06)}
    #${HUD_ID} #hf-mic:active{transform:scale(0.94)}
    #${HUD_ID} #hf-mic:focus-visible{outline:2px solid #ffd60a;outline-offset:2px}
    #${HUD_ID} #hf-mic.listening{background:#ff453a;color:#fff;animation:hf-ring 1s ease-out infinite}
    @keyframes hf-ring{0%{box-shadow:0 0 0 0 rgba(255,69,58,0.5)}100%{box-shadow:0 0 0 12px rgba(255,69,58,0)}}
    #${HUD_ID} #hf-mic.working{background:#ffd60a;color:#1d1d1f}
    #${HUD_ID} #hf-type{flex:1;min-width:0;height:40px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.1);border-radius:14px;color:#fff;font-size:13px;padding:0 14px;outline:none;transition:border-color 0.2s ease,box-shadow 0.2s ease,background 0.2s ease}
    #${HUD_ID} #hf-type::placeholder{color:#8e8e93}
    #${HUD_ID} #hf-type:focus{border-color:rgba(255,214,10,0.7);box-shadow:0 0 0 4px rgba(255,214,10,0.18);background:rgba(255,255,255,0.1)}
    #${HUD_ID}.collapsed #hf-body{display:none}
    #${HUD_ID}.collapsed{width:auto;padding:12px}
    #${HUD_ID}.collapsed #hf-top{margin-bottom:0}
    @media (prefers-color-scheme: light){
      #${HUD_ID}{background:rgba(255,255,255,0.78);color:#1d1d1f;border-color:rgba(0,0,0,0.08);box-shadow:0 16px 48px rgba(0,0,0,0.14),inset 0 1px 0 rgba(255,255,255,0.6)}
      #${HUD_ID} #hf-status{color:#1d1d1f}
      #${HUD_ID} #hf-think{color:#6e6e73}
      #${HUD_ID} #hf-think.live{background:linear-gradient(90deg,#6e6e73 25%,#b8860b 50%,#6e6e73 75%);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent}
      #${HUD_ID} #hf-min:hover{background:rgba(0,0,0,0.06);color:#000}
      #${HUD_ID} #hf-mic{background:#1d1d1f;color:#fff}
      #${HUD_ID} #hf-mic.listening{background:#ff453a;color:#fff}
      #${HUD_ID} #hf-mic.working{background:#ffd60a;color:#1d1d1f}
      #${HUD_ID} #hf-type{background:rgba(0,0,0,0.045);border-color:rgba(0,0,0,0.07);color:#1d1d1f}
      #${HUD_ID} #hf-type::placeholder{color:#8e8e93}
      #${HUD_ID} #hf-type:focus{background:rgba(0,0,0,0.03)}
    }
  `;
  document.head.appendChild(style);
  const hud = document.createElement('div');
  hud.id = HUD_ID;
  hud.innerHTML = `
    <div id="hf-top">
      <span id="hf-dot"></span>
      <span id="hf-brand">HANDSFREE</span>
      <button id="hf-min" title="Minimize">${MINUS_SVG}</button>
    </div>
    <div id="hf-body">
      <div id="hf-status">Tap mic or type below</div>
      <div id="hf-think"></div>
      <div id="hf-row">
        <button id="hf-mic" title="Tap to speak">${MIC_SVG}</button>
        <input id="hf-type" placeholder="Try “comment nice video”" aria-label="Type command" autocomplete="off" />
      </div>
    </div>
  `;
  (document.body || document.documentElement).appendChild(hud);
  const mic = document.getElementById('hf-mic');
  const mode = 'idle';
  window.__hfMode = mode;
  mic.addEventListener('click', () => {
    const m = window.__hfMode;
    if (m === 'working') {
      safeSend({ type: 'speech', text: 'stop', isFinal: true });
    } else {
      toggleMic();
    }
  });
  document.getElementById('hf-min')?.addEventListener('click', () => {
    hud.classList.toggle('collapsed');
  });
  const typeEl = document.getElementById('hf-type');
  typeEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const text = typeEl.value.trim();
      if (!text) return;
      typeEl.value = '';
      safeSend({ type: 'speech', text, isFinal: true });
    }
  });
  // first-run nudge: no key saved and pill still idle → point at the toolbar.
  // dead context (extension reloaded) → say so instead of failing silently.
  try {
    if (!chrome.runtime?.id) throw new Error('dead');
    chrome.runtime
      .sendMessage({ type: 'hello' })
      .then((res) => {
        if (res && !res.hasKey) {
          const st = document.getElementById('hf-status');
          if (st && st.textContent?.startsWith('Tap mic')) {
            setPillStatus('Set your key via the toolbar icon — basic mode until then');
          }
        }
      })
      .catch(() => {
        setPillStatus('Extension updated — refresh this tab');
      });
  } catch {
    setPillStatus('Extension updated — refresh this tab');
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectHud);
else injectHud();
new MutationObserver(() => {
  if (!document.getElementById(HUD_ID) && document.body) injectHud();
}).observe(document.documentElement, { childList: true, subtree: true });
function setPillStatus(t) {
  const st = document.getElementById('hf-status');
  if (st) st.textContent = t;
}
// --- voice input: runs HERE in the page, not in the offscreen document ---
// The tap is a real user gesture and the mic permission bubble appears
// on the actual site (youtube.com asks once, then remembers).
const PageSR = window.webkitSpeechRecognition || window.SpeechRecognition;
let pageRec = null;
let pageListening = false;
let pageStarting = false;
/** Pre-flight mic check: names the exact blocker instead of failing silent. */
async function diagnoseMic() {
  if (!PageSR) return 'Voice needs Chrome desktop — type instead';
  try {
    const devices = await navigator.mediaDevices?.enumerateDevices?.();
    if (devices && !devices.some((d) => d.kind === 'audioinput')) {
      return 'No microphone found on this device — plug one in or type instead';
    }
  } catch {
    // enumerate unavailable — continue to permission check
  }
  try {
    const st = await navigator.permissions.query({ name: 'microphone' });
    if (st.state === 'denied') {
      return 'Microphone is Blocked for this site — click the icon left of the address bar → Site settings → Microphone → Allow, then tap mic again';
    }
  } catch {
    // permissions API unavailable — continue to start attempt
  }
  return null;
}
function toggleMic() {
  if (!PageSR) {
    setPillStatus('Voice needs Chrome desktop — type instead');
    return;
  }
  if (!pageRec) {
    pageRec = new PageSR();
    pageRec.continuous = false;
    pageRec.interimResults = true;
    pageRec.lang = 'en-US';
    pageRec.onstart = () => {
      pageStarting = false;
      pageListening = true;
      setMic('listening');
      setPillStatus('Listening… speak clearly');
    };
    pageRec.onend = () => {
      pageStarting = false;
      pageListening = false;
      const m = window.__hfMode;
      if (m !== 'working') {
        setMic('idle');
        setPillStatus('Tap mic or type below');
      }
    };
    pageRec.onerror = (e) => {
      pageStarting = false;
      pageListening = false;
      setMic('idle');
      const err = e.error || 'unknown';
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        // re-diagnose for the precise fix (blocked vs no-device vs API)
        diagnoseMic().then((m) =>
          setPillStatus(
            m ?? 'Mic blocked — allow microphone access in the address bar, then tap again',
          ),
        );
      } else {
        setPillStatus(
          err === 'no-speech'
            ? 'Nothing heard — speak closer or type instead'
            : err === 'audio-capture'
              ? 'No microphone found — plug one in or type instead'
              : 'Mic issue (' + err + ') — try again or type instead',
        );
      }
    };
    pageRec.onresult = (e) => {
      const r = e.results[e.results.length - 1];
      const text = r[0].transcript;
      if (!r.isFinal) {
        setPillStatus(text || 'Listening…');
      } else if (text.trim()) {
        safeSend({ type: 'speech', text: text.trim(), isFinal: true });
      }
    };
  }
  if (pageListening || pageStarting) {
    try {
      pageRec.stop();
    } catch {
      pageStarting = false;
    }
    return;
  }
  // fresh start: diagnose first (fast, local), then start while the tap is fresh
  pageStarting = true;
  diagnoseMic().then((problem) => {
    if (problem) {
      pageStarting = false;
      setPillStatus(problem);
      return;
    }
    try {
      pageRec.start();
    } catch {
      pageStarting = false;
      setPillStatus('Mic busy — try again');
      return;
    }
    // permission bubble pending: Chrome waits for the user, we must not look dead
    setTimeout(() => {
      if (pageStarting && !pageListening) {
        setPillStatus(
          'Waiting for mic permission — allow it in the browser prompt, or type instead',
        );
      }
    }, 2500);
  });
}
function setMic(mode) {
  window.__hfMode = mode;
  const mic = document.getElementById('hf-mic');
  if (!mic) return;
  mic.classList.toggle('listening', mode === 'listening');
  mic.classList.toggle('working', mode === 'working');
  mic.innerHTML = mode === 'working' ? STOP_SVG : MIC_SVG;
  mic.title = mode === 'working' ? 'Stop' : 'Tap to speak';
}
// Broad net — the role filter below decides what is truly actionable.
const OBSERVE_SELECTOR =
  'button, a[href], input, select, textarea, [contenteditable="true"], [contenteditable=""], [role], [onclick], summary, [tabindex]:not([tabindex="-1"])';
// Roles a voice command can meaningfully act on. Everything else is noise.
const ACTIONABLE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'switch',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'option',
]);
function computedRole(el) {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit.split(' ')[0].toLowerCase();
  const tag = el.tagName.toLowerCase();
  if (tag === 'button') return 'button';
  if (tag === 'a' && el.hasAttribute('href')) return 'link';
  if (tag === 'summary') return 'button';
  if (tag === 'select') return 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'input') {
    const t = (el.getAttribute('type') || 'text').toLowerCase();
    if (t === 'hidden' || t === 'submit' || t === 'button') return t === 'hidden' ? '' : 'button';
    if (t === 'checkbox') return 'checkbox';
    if (t === 'radio') return 'radio';
    if (t === 'search') return 'searchbox';
    if (['text', 'email', 'password', 'tel', 'url', 'number'].includes(t)) return 'textbox';
    return '';
  }
  if (el.isContentEditable) return 'textbox';
  return '';
}
/** Accessible-name computation: labelledby > label > aria-label > text > placeholder. */
function accessibleName(el) {
  const labelledby = el.getAttribute('aria-labelledby');
  if (labelledby) {
    const parts = labelledby
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
      .filter(Boolean);
    if (parts.length) return parts.join(' ');
  }
  const id = el.id;
  if (id) {
    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent?.trim();
    if (label) return label;
    const wrapping = el.closest('label')?.textContent?.trim();
    if (wrapping) return wrapping;
  }
  return (
    el.getAttribute('aria-label')?.trim() ||
    (el.textContent?.trim() ?? '') ||
    el.getAttribute('placeholder')?.trim() ||
    el.getAttribute('alt')?.trim() ||
    el.getAttribute('title')?.trim() ||
    el.getAttribute('value')?.trim() ||
    ''
  );
}
function isVisible(el) {
  const html = el;
  const r = html.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const s = getComputedStyle(html);
  if (s.visibility === 'hidden' || s.display === 'none' || s.opacity === '0') return false;
  if (html.type === 'hidden') return false;
  return true;
}
/**
 * ARIA-first observation: every actionable control as role + accessible name —
 * the language LLMs natively understand. Scans deep (cap 200); the background
 * ranks by intent and sends only the top 15 to the model.
 */
async function observe() {
  document.querySelectorAll('[data-hf-id]').forEach((el) => el.removeAttribute('data-hf-id'));
  const els = Array.from(document.querySelectorAll(OBSERVE_SELECTOR)).filter((el) => {
    if (el.closest(`#${HUD_ID}`)) return false;
    if (!ACTIONABLE_ROLES.has(computedRole(el))) return false;
    if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return false;
    return isVisible(el);
  });
  return els.slice(0, 200).map((el, i) => {
    el.setAttribute('data-hf-id', String(i));
    const role = computedRole(el);
    const isFill = role === 'textbox' || role === 'searchbox' || role === 'combobox';
    const live =
      el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
        ? el.value?.trim()
        : el.isContentEditable
          ? (el.textContent?.trim() ?? '')
          : '';
    const name = (live || accessibleName(el)).replace(/\s+/g, ' ').slice(0, 80) || role;
    return {
      id: i,
      description: `${role} "${name}"`,
      selector: `[data-hf-id="${i}"]`,
      method: isFill ? 'fill' : 'click',
      role,
    };
  });
}
async function scrollPage() {
  window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'instant' });
}
async function highlight(selector) {
  document
    .querySelectorAll(`.${HIGHLIGHT_CLASS}`)
    .forEach((el) => el.classList.remove(HIGHLIGHT_CLASS));
  const el = document.querySelector(selector);
  if (el) {
    el.classList.add(HIGHLIGHT_CLASS);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await new Promise((r) => setTimeout(r, 400));
  }
}
async function act(candidate, value) {
  const el = document.querySelector(candidate.selector);
  if (!el) throw new Error('candidate not found');
  const needsFill = value !== undefined || candidate.method === 'fill';
  if (needsFill) {
    const text = value ?? '';
    const tgt = el;
    // click first (expands collapsed editors), then focus — like a human
    if (!(el instanceof HTMLSelectElement)) {
      try {
        tgt.click();
      } catch {
        /* collapsed or covered — focus below still works */
      }
    }
    tgt.focus?.();
    if (tgt.isContentEditable) {
      // rich editors (YouTube comments): execCommand registers as real typing,
      // textContent assignment is often ignored by the editor framework
      let done = false;
      try {
        const sel = window.getSelection();
        sel?.selectAllChildren(tgt);
        done = document.execCommand('insertText', false, text);
      } catch {
        done = false;
      }
      if (!done) tgt.textContent = text;
      tgt.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
      tgt.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (el instanceof HTMLSelectElement) {
      el.value = text;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      el.textContent = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
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
    } else if (msg.type === 'scroll') {
      await scrollPage();
      sendResponse({ ok: true, y: window.scrollY });
    } else if (msg.type === 'highlight') {
      await highlight(msg.selector);
      sendResponse({ ok: true });
    } else if (msg.type === 'act') {
      await act(msg.candidate, msg.value);
      sendResponse({ ok: true });
    } else if (msg.type === 'pressEnter') {
      const el = document.querySelector(msg.selector);
      if (el) {
        el.focus?.();
        for (const t of ['keydown', 'keypress', 'keyup']) {
          el.dispatchEvent(
            new KeyboardEvent(t, {
              bubbles: true,
              cancelable: true,
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              which: 13,
            }),
          );
        }
      }
      sendResponse({ ok: !!el });
    } else if (msg.type === 'hud') {
      const u = msg.update;
      const st = document.getElementById('hf-status');
      const dot = document.getElementById('hf-dot');
      const think = document.getElementById('hf-think');
      if (think && u.thought !== undefined) think.textContent = u.thought;
      if (think) think.classList.toggle('live', !!u.thinking);
      if (u.transcript !== undefined && st) {
        st.textContent = u.isFinal ? `Heard: "${u.transcript}"` : u.transcript || 'Listening…';
      }
      if (u.plan !== undefined && st && u.plan) st.textContent = u.plan;
      if (u.status !== undefined && st) st.textContent = u.status;
      if (u.verification !== undefined && st && u.verification) st.textContent = u.verification;
      const working =
        u.working ?? (u.showStop || (u.status && !/idle|need help|interrupt/i.test(u.status)));
      if (dot) dot.classList.toggle('busy', !!working || !!u.showMic);
      if (u.showMic) setMic('listening');
      else if (working) setMic('working');
      else setMic('idle');
      sendResponse({ ok: true });
    }
  })();
  return true;
});
