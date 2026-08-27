# HandsFree — Extension (MV3 fixes applied)

**Fix #1 — Service worker ephemerality:** `background.ts` never keeps `PQueue` only in memory. It holds an open `chrome.runtime.Port` (`keepalive`) from both `content.ts` and `offscreen.ts`, and checkpoints `queue.size` to `chrome.storage.session` on `active`/`idle`. If Chrome kills the worker mid-task, the Port disconnects and we reconnect, or we restore from storage. No silent queue loss.

**Fix #2 — Persistent orb:** `manifest.json` uses `host_permissions: ["<all_urls>"]` + `content_scripts: [{matches: ["<all_urls>"], js: ["src/content.js"]}]`, not `activeTab` alone. Orb is there on load, no toolbar click needed.

**Stage:** `dev` Node prototype stays frozen for demo; this `extension/` is the post-deadline track. Load unpacked in `chrome://extensions` to test in your normal tab — no `npm run dev`, no separate Playwright window.
