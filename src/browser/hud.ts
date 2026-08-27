import { getPage } from './launch.js';

const HUD_ID = 'hf-hud';
const STYLE_ID = 'hf-hud-style';

const HUD_HTML = `
<div id="${HUD_ID}" style="position:fixed;right:16px;bottom:16px;width:320px;min-height:100px;background:#111;color:#fff;z-index:2147483647;padding:12px;border-radius:12px;font:12px system-ui;box-shadow:0 4px 24px rgba(0,0,0,0.4);border:1px solid #262626;">
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
    <span style="width:8px;height:8px;background:#22c55e;border-radius:50%;display:inline-block;"></span>
    <span style="font-weight:600;">HandsFree</span>
    <span id="hf-status" style="margin-left:auto;font-size:11px;color:#a3a3a3;">Idle</span>
  </div>
  <div id="hf-transcript" style="min-height:18px;color:#e5e5e5;margin-bottom:6px;word-break:break-word;"></div>
  <div id="hf-plan" style="font-size:11px;color:#facc15;min-height:14px;margin-bottom:6px;word-break:break-word;"></div>
  <div id="hf-verification" style="font-size:11px;color:#a3a3a3;min-height:14px;"></div>
  <button id="hf-stop" style="margin-top:8px;width:100%;padding:6px;background:#ef4444;color:#fff;border:0;border-radius:8px;font-weight:600;cursor:pointer;display:none;">STOP</button>
</div>
`;

const HUD_CSS = `
#${HUD_ID} { font-family: system-ui, -apple-system, sans-serif; }
`;

/**
 * Injects HUD overlay into the Playwright page. Persists across navigations via addInitScript.
 */
export async function injectHud(): Promise<void> {
  const page = getPage();

  // addInitScript ensures HUD re-injects on every navigation
  await page.addInitScript(
    ({
      hudId,
      hudHtml,
      styleId,
      hudCss,
    }: {
      hudId: string;
      hudHtml: string;
      styleId: string;
      hudCss: string;
    }) => {
      const inject = () => {
        if (document.getElementById(hudId)) return;
        if (!document.body) {
          // body not yet available, retry
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
        const hud = wrapper.firstElementChild as HTMLElement;
        document.body.appendChild(hud);
        const stopBtn = document.getElementById('hf-stop') as HTMLButtonElement | null;
        stopBtn?.addEventListener('click', () => {
          fetch('/command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: 'stop' }),
          }).catch(() => {});
        });
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inject);
      } else {
        inject();
      }
      // also observe DOM for SPA navigations that replace body
      const observer = new MutationObserver(() => {
        if (!document.getElementById(hudId) && document.body) inject();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    },
    { hudId: HUD_ID, hudHtml: HUD_HTML, styleId: STYLE_ID, hudCss: HUD_CSS },
  );

  // also inject immediately for current page
  await page
    .evaluate(
      ({
        hudId,
        hudHtml,
        styleId,
        hudCss,
      }: {
        hudId: string;
        hudHtml: string;
        styleId: string;
        hudCss: string;
      }) => {
        if (document.getElementById(hudId)) return;
        if (!document.getElementById(styleId)) {
          const style = document.createElement('style');
          style.id = styleId;
          style.textContent = hudCss;
          document.head.appendChild(style);
        }
        const wrapper = document.createElement('div');
        wrapper.innerHTML = hudHtml;
        const hud = wrapper.firstElementChild as HTMLElement;
        if (document.body) document.body.appendChild(hud);
      },
      { hudId: HUD_ID, hudHtml: HUD_HTML, styleId: STYLE_ID, hudCss: HUD_CSS },
    )
    .catch(() => {});
}

export type HudUpdate = {
  transcript?: string;
  plan?: string;
  status?: string;
  verification?: string;
  showStop?: boolean;
};

export async function updateHud(update: HudUpdate): Promise<void> {
  const page = getPage();
  await page
    .evaluate((u: HudUpdate) => {
      const tr = document.getElementById('hf-transcript');
      const pl = document.getElementById('hf-plan');
      const st = document.getElementById('hf-status');
      const ve = document.getElementById('hf-verification');
      const stop = document.getElementById('hf-stop') as HTMLButtonElement | null;
      if (u.transcript !== undefined && tr) tr.textContent = u.transcript;
      if (u.plan !== undefined && pl) pl.textContent = u.plan;
      if (u.status !== undefined && st) st.textContent = u.status;
      if (u.verification !== undefined && ve) ve.textContent = u.verification;
      if (u.showStop !== undefined && stop) stop.style.display = u.showStop ? 'block' : 'none';
    }, update)
    .catch(() => {});
}
