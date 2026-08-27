import PQueue from 'p-queue';
import type { Action } from './planner.js';
import { getStagehand, getPage } from '../browser/launch.js';

export const queue: PQueue = new PQueue({ concurrency: 1 });

export async function execute(actions: Action[]): Promise<void> {
  let stagehand: any;
  try {
    stagehand = getStagehand();
  } catch {
    stagehand = null;
  }
  const page = getPage();

  for (const a of actions) {
    const instruction =
      a.type === 'click' ? `click the "${a.target}"` : `type "${a.value ?? ''}" into "${a.target}"`;

    console.log(
      `[loop] executing: ${instruction} page closed=${page.isClosed()} url=${page.url()}`,
    );
    await queue.add(async () => {
      console.log(`[loop] queue start: ${instruction} page closed=${page.isClosed()}`);
      // prefer stagehand self-healing act, fallback to playwright
      if (stagehand?.act) return stagehand.act(instruction);
      if (page?.act) return page.act(instruction);
      // last resort: playwright locator
      if (a.type === 'click')
        return page
          .getByText(a.target, { exact: false })
          .first()
          .click({ timeout: 5000, noWaitAfter: true });
      return page
        .getByPlaceholder(a.target)
        .or(page.getByLabel(a.target))
        .first()
        .fill(a.value ?? '');
    });
  }
}
