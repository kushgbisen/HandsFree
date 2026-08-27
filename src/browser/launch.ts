import { Stagehand } from '@browserbasehq/stagehand';

export let stagehand: any;
export let page: any;

// visible browser, navigates to test target
export async function initBrowser(targetUrl = 'https://example.com') {
  stagehand = await Stagehand.create({
    headless: false,
  } as never);

  page = stagehand.page;
  await page.goto(targetUrl);
  return { stagehand, page };
}

export function getPage() {
  if (!page) throw new Error('browser not initialized — call initBrowser() first');
  return page;
}

export function getStagehand() {
  if (!stagehand) throw new Error('stagehand not initialized — call initBrowser() first');
  return stagehand;
}
