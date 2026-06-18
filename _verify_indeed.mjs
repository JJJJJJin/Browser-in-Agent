// Drive the user's SYSTEM Chrome via the project's BrowserManager to Indeed,
// search "ai engineer", and watch for a bot-block / Cloudflare challenge.
import { BrowserManager } from './dist/browser/BrowserManager.js';

const SHOT = '/tmp/indeed-latest.png';
const URL = 'https://au.indeed.com/jobs?q=ai+engineer&l=';

const manager = new BrowserManager({ source: 'system', systemBrowser: 'chrome' });
const { browser, context, engine } = await manager.launch('chromium', /* headless */ false);
const page = await context.newPage();
console.log('LAUNCHED system chrome, engine=', engine, 'version=', browser.version());

await page.goto(URL, { waitUntil: 'domcontentloaded' }).catch((e) => console.log('goto.err', e.message));
console.log('NAV', page.url());

// Heuristics for the usual Indeed/Cloudflare interstitials.
const BLOCK_RE = /just a moment|attention required|verify you are human|additional verification|cf-challenge|hcaptcha|px-captcha|blocked|unusual traffic/i;

let n = 0;
const tick = async () => {
  try {
    await page.screenshot({ path: SHOT });
    const title = await page.title().catch(() => '');
    const bodyText = await page
      .evaluate(() => document.body?.innerText?.slice(0, 400) ?? '')
      .catch(() => '');
    const jobCards = await page
      .locator('.job_seen_beacon, [data-testid="slider_item"], .jobsearch-ResultsList li')
      .count()
      .catch(() => 0);
    const blocked = BLOCK_RE.test(title) || BLOCK_RE.test(bodyText);
    console.log(
      `SHOT ${++n} blocked=${blocked} jobCards=${jobCards} title=${JSON.stringify(title)} url=${page.url()}`,
    );
  } catch (e) {
    console.log('shot.err', e.message);
  }
};
await tick();
const timer = setInterval(tick, 3000);

setTimeout(async () => {
  clearInterval(timer);
  await browser.close().catch(() => {});
  console.log('CLOSED');
  process.exit(0);
}, 15 * 60 * 1000);

const bye = async () => { clearInterval(timer); await browser.close().catch(() => {}); process.exit(0); };
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
