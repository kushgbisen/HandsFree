export async function injectHighlight(
  page: { evaluate: (fn: (s: string) => void, sel: string) => Promise<void> },
  selector: string,
) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return;
    el.classList.add('hf-highlight');
    el.style.outline = '3px solid #facc15';
    el.style.outlineOffset = '2px';
  }, selector);
}
