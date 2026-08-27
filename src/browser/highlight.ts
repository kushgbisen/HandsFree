import { getPage } from './launch.js';

const STYLE_ID = 'hf-highlight-style';
const HIGHLIGHT_CLASS = 'hf-highlight';

const CSS = `
.${HIGHLIGHT_CLASS} {
  outline: 3px solid #facc15 !important;
  outline-offset: 2px !important;
  background: rgba(250, 204, 21, 0.15) !important;
  transition: all 0.25s ease !important;
  animation: hf-pulse 1s ease-in-out infinite !important;
}
@keyframes hf-pulse {
  0%, 100% { outline-color: #facc15; }
  50% { outline-color: #fde68a; }
}
`;

/**
 * Ensures highlight style is injected once per page.
 */
async function ensureStyle(): Promise<void> {
  const page = getPage();
  await page.evaluate(
    ({ styleId, css }: { styleId: string; css: string }) => {
      if (document.getElementById(styleId)) return;
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = css;
      document.head.appendChild(style);
    },
    { styleId: STYLE_ID, css: CSS },
  );
}

/**
 * Highlights the exact observed element for 600ms (theater).
 * Must be called with the selector returned by observe() — never invented.
 */
export async function highlight(selector: string): Promise<void> {
  const page = getPage();
  await ensureStyle();

  // clear previous highlights
  await page.evaluate((cls: string) => {
    document.querySelectorAll(`.${cls}`).forEach((el) => el.classList.remove(cls));
  }, HIGHLIGHT_CLASS);

  await page.evaluate(
    ({ sel, cls }: { sel: string; cls: string }) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return;
      el.classList.add(cls);
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
    { sel: selector, cls: HIGHLIGHT_CLASS },
  );

  // theater pause — judges need to see the agent "think" before it acts
  await new Promise((r) => setTimeout(r, 600));
}

export async function clearHighlight(): Promise<void> {
  const page = getPage();
  await page
    .evaluate((cls: string) => {
      document.querySelectorAll(`.${cls}`).forEach((el) => el.classList.remove(cls));
    }, HIGHLIGHT_CLASS)
    .catch(() => {});
}
