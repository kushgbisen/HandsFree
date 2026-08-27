export async function injectHud(page: { addInitScript: (fn: () => void) => Promise<void> }) {
  await page.addInitScript(() => {
    const id = 'hf-hud';
    if (document.getElementById(id)) return;
    const hud = document.createElement('div');
    hud.id = id;
    hud.style.cssText =
      'position:fixed;right:16px;bottom:16px;width:320px;min-height:80px;background:#111;color:#fff;z-index:2147483647;padding:12px;border-radius:12px;font:12px system-ui;';
    hud.textContent = 'HandsFree';
    document.body?.appendChild(hud);
  });
}
