import { Stagehand, localBrowser } from '@browserbasehq/stagehand';

export let stagehand: any;
export let page: any;
export let browser: any;
export let context: any;

// visible browser (not headless), navigates to test site
export async function initBrowser(targetUrl = 'https://example.com') {
  const wantHeadless = process.env.HEADLESS === 'true';
  const hasRealKey = !!(process.env.OPENAI_API_KEY ?? process.env.DEEPSEEK_API_KEY);

  // container/CI: use playwright directly (no Chrome dependency, headless)
  // local dev: try localBrowser for visible window, fallback to playwright
  if (wantHeadless) {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true });
  } else {
    try {
      browser = await localBrowser.launch({ headless: false });
    } catch {
      const { chromium } = await import('playwright');
      browser = await chromium.launch({ headless: false });
    }
  }

  // stagehand needs a real LLM key — skip if none (use playwright directly)
  if (hasRealKey) {
    try {
      stagehand = await Stagehand.create({
        browser,
        model: {
          modelName: 'openai/gpt-4o-mini',
          apiKey: process.env.OPENAI_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? 'dummy',
        },
      } as never);
    } catch (e) {
      console.warn('[browser] stagehand init failed, falling back to playwright:', e);
      stagehand = null;
    }
  } else {
    stagehand = null;
  }

  context = await browser.newContext();
  page = await context.newPage();
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  console.log(
    `[browser] ready: ${page.url()} closed=${page.isClosed()} contexts=${browser.contexts().length}`,
  );
  return { stagehand, page, browser, context };
}

export function getPage() {
  if (!page) throw new Error('browser not initialized — call initBrowser() first');
  return page;
}

export function getStagehand() {
  if (!stagehand) throw new Error('stagehand not initialized — call initBrowser() first');
  return stagehand;
}

export function getBrowser() {
  if (!browser) throw new Error('browser not initialized — call initBrowser() first');
  return browser;
}
