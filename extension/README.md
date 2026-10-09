# HandsFree — Extension (MV3 fixes applied)

**Service worker lifecycle:** `background.ts` runs commands through a serial in-memory queue (one at a time, each with its own `AbortController`). The content script holds an open `chrome.runtime.Port` (`keepalive`) so Chrome keeps the worker alive mid-task. Voice input runs in the page itself (real click gesture + site mic permission) — no offscreen document. Known limit: a worker killed mid-task loses the in-memory queue.

**Fix #2 — Persistent orb:** `manifest.json` uses `host_permissions: ["<all_urls>"]` + `content_scripts: [{matches: ["<all_urls>"], js: ["src/content.js"]}]`, not `activeTab` alone. Orb is there on load, no toolbar click needed.

**Stage:** `dev` Node prototype stays frozen for demo; this `extension/` is the post-deadline track. Load unpacked in `chrome://extensions` to test in your normal tab — no `npm run dev`, no separate Playwright window.
