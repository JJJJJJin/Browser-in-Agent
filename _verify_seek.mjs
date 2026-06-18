// Verification: drive the user's SYSTEM Chrome via the project's BrowserManager,
// open Seek, and keep the window open so the user can log in. Re-screenshots the
// live page every few seconds to /tmp/seek-latest.png so we can inspect state.
import { BrowserManager } from './dist/browser/BrowserManager.js';

const SHOT = '/tmp/seek-latest.png';

const manager = new BrowserManager({ source: 'system', systemBrowser: 'chrome' });
const { browser, context, engine } = await manager.launch('chromium', /* headless */ false);
const page = await context.newPage();

console.log('LAUNCHED system chrome, engine=', engine, 'version=', browser.version());

// Anti-fingerprint sanity: real Chrome UA + webdriver flag.
const probe = await page.evaluate(() => ({
  ua: navigator.userAgent,
  webdriver: navigator.webdriver,
  brands: navigator.userAgentData?.brands?.map((b) => b.brand).join(', '),
}));
console.log('PROBE', JSON.stringify(probe));

await page.goto('https://www.seek.com.au/oauth/login', { waitUntil: 'domcontentloaded' });
console.log('NAV', page.url());

let n = 0;
const tick = async () => {
  try {
    await page.screenshot({ path: SHOT });
    console.log('SHOT', ++n, page.url(), '-', await page.title());
  } catch (e) {
    console.log('shot.err', e.message);
  }
};
await tick();
const timer = setInterval(tick, 3000);

// Keep alive up to 15 min, then clean up.
setTimeout(async () => {
  clearInterval(timer);
  await browser.close().catch(() => {});
  console.log('CLOSED');
  process.exit(0);
}, 15 * 60 * 1000);

const bye = async () => { clearInterval(timer); await browser.close().catch(() => {}); process.exit(0); };
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
