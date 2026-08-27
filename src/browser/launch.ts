import { Stagehand } from '@browserbasehq/stagehand';

export let stagehand: any;
export let page: any;
export let browser: any;
export let context: any;

// visible browser (not headless), navigates to test site
export async function initBrowser(targetUrl = 'https://example.com') {
  const wantHeadless = process.env.HEADLESS === 'true';
  const aistudioKey =
    process.env.AISTUDIO_API_KEY ?? process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  // stagehand only supports openai/google models directly — deepseek/openrouter use playwright fallback for act
  const hasRealKey = !!(openaiKey ?? aistudioKey);

  // always use playwright chromium — visible via Chrome channel when not headless
  // (localBrowser returns a StagehandBrowser without newContext, so we use playwright directly)
  const { chromium } = await import('playwright');
  if (wantHeadless) {
    browser = await chromium.launch({ headless: true });
  } else {
    try {
      browser = await chromium.launch({ headless: false, channel: 'chrome' });
    } catch {
      browser = await chromium.launch({ headless: false });
    }
  }

  // stagehand needs a real LLM key — skip if none (use playwright directly)
  if (hasRealKey) {
    try {
      const model = openaiKey
        ? { modelName: 'openai/gpt-4o-mini' as const, apiKey: openaiKey }
        : { modelName: 'google/gemini-3.1-flash-lite-preview' as const, apiKey: aistudioKey! };
      stagehand = await Stagehand.create({ browser, model } as never);
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
