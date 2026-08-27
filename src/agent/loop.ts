import PQueue from 'p-queue';

export const queue: PQueue = new PQueue({ concurrency: 1 });

export async function runAgentLoop(_intent: string, _signal: AbortSignal): Promise<void> {
  // TODO: observe -> plan -> highlight -> act -> verify
}
