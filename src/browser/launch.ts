import { chromium, type Browser, type Page } from 'playwright';

export async function launchBrowser(): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  return { browser, page };
}
