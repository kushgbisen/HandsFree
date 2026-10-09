/** Pill updates. Fire-and-forget — a dead tab must never break the loop. */

export type HudUpdate = {
  transcript?: string;
  plan?: string;
  status?: string;
  verification?: string;
  showStop?: boolean;
  isFinal?: boolean;
  thought?: string;
  thinking?: boolean;
  working?: boolean;
};

export async function updateHud(tabId: number, update: HudUpdate): Promise<void> {
  chrome.tabs.sendMessage(tabId, { type: 'hud', update }).catch(() => {});
}
