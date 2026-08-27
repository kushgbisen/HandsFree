import { getPage, getStagehand } from './launch.js';

export type Candidate = {
  id: number;
  selector: string;
  description: string;
  method?: string;
};

/**
 * Single source of truth: every plan must choose from what was
 * just observed. No persisted or invented targets.
 * Returns a numbered list of actionable candidates that were
 * confirmed to exist on the live page right now.
 */
export async function observe(): Promise<Candidate[]> {
  // try stagehand self-healing observe first
  let stagehand: any = null;
  try {
    stagehand = getStagehand();
  } catch {
    stagehand = null;
  }

  if (stagehand?.observe) {
    try {
      const result = await stagehand.observe(
        'list all buttons, links, and inputs that can be clicked or filled',
      );
      const raw = (result as any)?.data ?? (result as any)?.actions ?? result;
      const actions = Array.isArray(raw) ? raw : ((raw as any)?.actions ?? []);
      if (Array.isArray(actions) && actions.length > 0) {
        return actions.slice(0, 40).map((a: any, i: number) => ({
          id: i,
          selector: String(a.selector),
          description: String(a.description ?? `${a.method ?? 'act'} ${a.selector}`),
          method: a.method as string | undefined,
        }));
      }
    } catch (e) {
      console.warn('[observe] stagehand observe failed, falling back to DOM scan', e);
    }
  }

  // playwright fallback — fresh DOM scan, no assumptions
  const page = getPage();

  // clear stale ids from previous observe
  await page.evaluate(() => {
    document.querySelectorAll('[data-hf-id]').forEach((el) => el.removeAttribute('data-hf-id'));
  });

  const candidates: Candidate[] = await page.evaluate(() => {
    const els = Array.from(
      document.querySelectorAll(
        'button, a[href], input, select, textarea, [role="button"], [role="link"], [onclick]',
      ),
    ).filter((el) => {
      const rect = (el as HTMLElement).getBoundingClientRect();
      const style = window.getComputedStyle(el as HTMLElement);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none'
      );
    });

    return els.slice(0, 40).map((el, i) => {
      (el as HTMLElement).setAttribute('data-hf-id', String(i));
      const text = (
        el.textContent?.trim() ||
        el.getAttribute('aria-label') ||
        el.getAttribute('placeholder') ||
        el.getAttribute('value') ||
        el.getAttribute('alt') ||
        el.tagName
      )
        .replace(/\s+/g, ' ')
        .slice(0, 80);
      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute('type') ? `[${el.getAttribute('type')}]` : '';
      const role = el.getAttribute('role') ? `:${el.getAttribute('role')}` : '';
      return {
        id: i,
        description: `${tag}${type}${role}: "${text}"`,
        selector: `[data-hf-id="${i}"]`,
        method: tag === 'input' || tag === 'textarea' || tag === 'select' ? 'fill' : 'click',
      };
    });
  });

  return candidates;
}
