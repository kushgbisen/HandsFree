import { getPage } from './launch.js';

const HUD_ID = 'hf-hud';
const STYLE_ID = 'hf-hud-style';

// Tiny status pill — the main page already has the full UI, so the
// injected overlay is only a working indicator + stop button.
// Skipped entirely on the HUD page itself (it has #bar) to avoid double UI.
const HUD_HTML = `
<div id="${HUD_ID}">
  <span id="hf-dot"></span>
  <span id="hf-status">Idle</span>
  <button id="hf-stop" title="Stop agent">■</button>
</div>
`;

const HUD_CSS = `
#${HUD_ID}{position:fixed;right:16px;bottom:16px;display:flex;align-items:center;gap:8px;background:rgba(17,17,17,0.92);color:#fff;z-index:2147483647;border-radius:24px;padding:8px 8px 8px 12px;border:1px solid #2a2a2a;font:12px system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.4)}
#hf-dot{width:8px;height:8px;background:#22c55e;border-radius:50%;flex:none}
#hf-dot.busy{background:#facc15;animation:hf-blink 1s infinite}
@keyframes hf-blink{50%{opacity:.35}}
#hf-status{color:#d4d4d4;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#hf-stop{display:none;width:28px;height:28px;border-radius:50%;border:0;background:#ef4444;color:#fff;font-size:12px;font-weight:700;cursor:pointer;flex:none}
#hf-stop:hover{background:#dc2626}
`;

const SKIP_IF_PRESENT = 'bar'; // main HUD page marker — don't double up

type InjectArgs = {
  hudId: string;
  hudHtml: string;
  styleId: string;
  hudCss: string;
  skip: string;
  serverUrl: string;
};

export async function injectHud(serverUrl = 'http://localhost:3000'): Promise<void> {
  const page = getPage();
  await page.addInitScript(
    ({ hudId, hudHtml, styleId, hudCss, skip, serverUrl }: InjectArgs) => {
      const inject = () => {
        if (document.getElementById(skip)) return; // this IS the HUD page
        if (document.getElementById(hudId)) return;
        if (!document.body) {
          setTimeout(inject, 100);
          return;
        }
        if (!document.getElementById(styleId)) {
          const style = document.createElement('style');
          style.id = styleId;
          style.textContent = hudCss;
          document.head.appendChild(style);
        }
        const wrapper = document.createElement('div');
        wrapper.innerHTML = hudHtml;
        document.body.appendChild(wrapper.firstElementChild as HTMLElement);
        document.getElementById('hf-stop')?.addEventListener('click', () => {
          fetch(serverUrl + '/command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: 'stop' }),
          }).catch(() => {});
        });
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
      else inject();
      new MutationObserver(() => {
        if (!document.getElementById(skip) && !document.getElementById(hudId) && document.body)
          inject();
      }).observe(document.documentElement, { childList: true, subtree: true });
    },
    {
      hudId: HUD_ID,
      hudHtml: HUD_HTML,
      styleId: STYLE_ID,
      hudCss: HUD_CSS,
      skip: SKIP_IF_PRESENT,
      serverUrl,
    },
  );

  await page
    .evaluate(
      ({ hudId, hudHtml, styleId, hudCss, skip, serverUrl }: InjectArgs) => {
        if (document.getElementById(skip)) return;
        if (document.getElementById(hudId)) return;
        if (!document.getElementById(styleId)) {
          const style = document.createElement('style');
          style.id = styleId;
          style.textContent = hudCss;
          document.head.appendChild(style);
        }
        const wrapper = document.createElement('div');
        wrapper.innerHTML = hudHtml;
        if (document.body) {
          document.body.appendChild(wrapper.firstElementChild as HTMLElement);
          document.getElementById('hf-stop')?.addEventListener('click', () => {
            fetch(serverUrl + '/command', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: 'stop' }),
            }).catch(() => {});
          });
        }
      },
      {
        hudId: HUD_ID,
        hudHtml: HUD_HTML,
        styleId: STYLE_ID,
        hudCss: HUD_CSS,
        skip: SKIP_IF_PRESENT,
        serverUrl,
      },
    )
    .catch(() => {});
}

export type HudUpdate = {
  transcript?: string;
  plan?: string;
  status?: string;
  verification?: string;
  showStop?: boolean;
  isFinal?: boolean;
};

export async function updateHud(update: HudUpdate): Promise<void> {
  const page = getPage();
  await page
    .evaluate((u: HudUpdate) => {
      if (document.getElementById('bar')) return; // main page shows its own UI
      const st = document.getElementById('hf-status');
      const dot = document.getElementById('hf-dot');
      const stop = document.getElementById('hf-stop') as HTMLButtonElement | null;
      const label =
        u.status ??
        (u.verification?.includes('✓')
          ? 'Done'
          : (u.verification ?? u.plan ?? u.transcript?.replace(/^"|"$/g, '')));
      if (label && st) st.textContent = label.slice(0, 60);
      if (dot)
        dot.classList.toggle('busy', !!u.status && !/idle|done|verif|need help/i.test(u.status));
      if (stop) {
        const working = !!u.status && !/idle|verified|need help|done/i.test(u.status);
        stop.style.display = working || u.showStop ? 'block' : 'none';
      }
    }, update)
    .catch(() => {});
}
