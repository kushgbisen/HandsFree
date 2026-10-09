/**
 * Deterministic site opener. Pure "open X" goals skip the model entirely:
 * known map → live probe of <name>.com → Google assist (loop clicks result).
 * Anything ambiguous (results, links, tabs, settings) falls through to ReAct.
 */
const SITES = {
  youtube: 'https://www.youtube.com',
  google: 'https://www.google.com',
  gmail: 'https://mail.google.com',
  maps: 'https://maps.google.com',
  drive: 'https://drive.google.com',
  bookmyshow: 'https://www.bookmyshow.com',
  amazon: 'https://www.amazon.in',
  flipkart: 'https://www.flipkart.com',
  myntra: 'https://www.myntra.com',
  zomato: 'https://www.zomato.com',
  swiggy: 'https://www.swiggy.com',
  irctc: 'https://www.irctc.co.in',
  upes: 'https://www.upes.ac.in',
  myupes: 'https://myupes.upes.ac.in/',
  github: 'https://github.com',
  stackoverflow: 'https://stackoverflow.com',
  wikipedia: 'https://www.wikipedia.org',
  reddit: 'https://www.reddit.com',
  x: 'https://x.com',
  twitter: 'https://x.com',
  instagram: 'https://www.instagram.com',
  facebook: 'https://www.facebook.com',
  linkedin: 'https://www.linkedin.com',
  netflix: 'https://www.netflix.com',
  spotify: 'https://open.spotify.com',
  hotstar: 'https://www.hotstar.com',
  paytm: 'https://paytm.com',
  phonepe: 'https://www.phonepe.com',
  hdfc: 'https://www.hdfcbank.com',
  icici: 'https://www.icicibank.com',
  sbi: 'https://www.onlinesbi.sbi',
  whatsapp: 'https://web.whatsapp.com',
  telegram: 'https://web.telegram.org',
  notion: 'https://www.notion.so',
  figma: 'https://www.figma.com',
  chatgpt: 'https://chatgpt.com',
  gemini: 'https://gemini.google.com',
};
const OPEN_RE = /^\s*(open|go to|goto|visit|take me to|launch)\b\s+(.+?)\s*$/i;
// in-page nouns, never site names — "open the first result" stays with the loop
const OPEN_GUARD =
  /\b(results?|links?|tabs?|settings|menu|options?|files?|images?|photos?|videos?|downloads|history|bookmarks|extensions?|it|this|that|these|those|them)\b/i;
const OPEN_STRIP = /\s+(official\s+)?(website|web ?site|web ?page|page|app|application)\s*$/i;
/** "open bookmyshow website" → "bookmyshow"; anything ambiguous → null. */
export function matchOpenGoal(goal) {
  const m = goal.match(OPEN_RE);
  if (!m) return null;
  const name = m[2].trim().replace(OPEN_STRIP, '').trim();
  if (!name || OPEN_GUARD.test(name)) return null;
  return name.toLowerCase();
}
/**
 * Any HTTP response (even 403/405) means the host is alive — only network
 * failure / timeout counts as dead. 5 s cap, never fatal.
 */
async function probeSite(slug) {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) return null;
  const url = `https://${slug.toLowerCase()}.com`;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    await fetch(url, { method: 'HEAD', signal: ctl.signal });
    clearTimeout(t);
    return url;
  } catch {
    return null;
  }
}
export async function resolveSite(name) {
  const hit = SITES[name];
  if (hit) return { url: hit, direct: true };
  const probed = await probeSite(name.replace(/\s+/g, ''));
  if (probed) return { url: probed, direct: true };
  return {
    url: `https://www.google.com/search?q=${encodeURIComponent(name + ' official website')}`,
    direct: false,
  };
}
