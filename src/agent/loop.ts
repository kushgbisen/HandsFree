import PQueue from 'p-queue';

export const queue = new PQueue({ concurrency: 1 });

export async function runAgentLoop(_intent: string, _signal: AbortSignal): Promise<void> {
  // TODO: observe -> plan -> highlight -> act -> verify
}
