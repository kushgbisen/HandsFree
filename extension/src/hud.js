/** Pill updates. Fire-and-forget — a dead tab must never break the loop. */
export async function updateHud(tabId, update) {
  chrome.tabs.sendMessage(tabId, { type: 'hud', update }).catch(() => {});
}
