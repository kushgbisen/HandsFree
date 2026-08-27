import PQueue from 'p-queue';
import type { Plan } from './planner.js';
import type { Candidate } from '../browser/observe.js';
import { getStagehand, getPage } from '../browser/launch.js';
import { clearHighlight, highlight } from '../browser/highlight.js';

export const queue: PQueue = new PQueue({ concurrency: 1 });

/**
 * Executes the chosen candidate directly — zero re-interpretation.
 * The only allowed target is the exact element that was observed.
 */
export async function execute(plan: Plan, candidates: Candidate[]): Promise<void> {
  const candidate = candidates[plan.index];
  if (!candidate) throw new Error(`execute: candidate index ${plan.index} not found`);

  let stagehand: any = null;
  try {
    stagehand = getStagehand();
  } catch {
    stagehand = null;
  }
  const page = getPage();

  console.log(
    `[loop] executing id=${candidate.id} -> ${candidate.description} reasoning="${plan.reasoning}" closed=${page.isClosed()} url=${page.url()}`,
  );

  // theater: highlight exact observed element for 600ms before act
  try {
    await highlight(candidate.selector);
  } catch (e) {
    console.warn('[loop] highlight failed', e);
  }

  await queue.add(async () => {
    console.log(`[loop] queue start id=${candidate.id} selector=${candidate.selector}`);

    // strongest grounding: stagehand with exact observed selector
    if (stagehand?.act) {
      return stagehand.act({
        selector: candidate.selector,
        description: candidate.description,
        method: candidate.method === 'fill' ? 'fill' : 'click',
        arguments: plan.value ? [plan.value] : [],
      });
    }

    if ((page as any)?.act) {
      return (page as any).act({
        selector: candidate.selector,
        description: candidate.description,
        method: candidate.method,
        arguments: plan.value ? [plan.value] : [],
      });
    }

    // exact selector — never fuzzy text match
    const locator = page.locator(candidate.selector);
    if (plan.value !== undefined || candidate.method === 'fill') {
      return locator.fill(plan.value ?? '', { timeout: 5000 });
    }
    return locator.click({ timeout: 5000, noWaitAfter: true });
  });

  // keep highlight briefly then clear (visible from back of room)
  await new Promise((r) => setTimeout(r, 300));
  await clearHighlight().catch(() => {});
}
