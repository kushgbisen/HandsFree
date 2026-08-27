import PQueue from 'p-queue';
import type { Action } from './planner.js';
import { getPage } from '../browser/launch.js';

export const queue: PQueue = new PQueue({ concurrency: 1 });

export async function execute(actions: Action[]): Promise<void> {
  const page = getPage();

  for (const a of actions) {
    const instruction =
      a.type === 'click' ? `click the "${a.target}"` : `type "${a.value ?? ''}" into "${a.target}"`;

    await queue.add(() => page.act(instruction));
  }
}
