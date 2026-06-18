// Extract the first 5 Indeed "ai engineer" job cards (title, company, url).
import { BrowserManager } from './dist/browser/BrowserManager.js';

const URL = 'https://au.indeed.com/jobs?q=ai+engineer&l=';
const manager = new BrowserManager({ source: 'system', systemBrowser: 'chrome' });
const { browser, context } = await manager.launch('chromium', /* headless */ false);
const page = await context.newPage();

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.job_seen_beacon, [data-jk]', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1500);

const jobs = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('#mosaic-provider-jobcards li .job_seen_beacon, .job_seen_beacon'));
  const out = cards.map((card) => {
    const titleEl = card.querySelector('h2.jobTitle a, a.jcs-JobTitle, h2 a');
    const companyEl = card.querySelector('[data-testid="company-name"], .companyName, span.css-1h7lukg');
    const jk =
      card.querySelector('[data-jk]')?.getAttribute('data-jk') ||
      titleEl?.getAttribute('data-jk') ||
      (titleEl?.id?.startsWith('job_') ? titleEl.id.slice(4) : '');
    const href = titleEl?.getAttribute('href') || '';
    const url = jk
      ? `https://au.indeed.com/viewjob?jk=${jk}`
      : href
        ? new URL(href, 'https://au.indeed.com').href
        : '';
    return {
      title: titleEl?.textContent?.trim() || '',
      company: companyEl?.textContent?.trim() || '',
      url,
    };
  });
  const seen = new Set();
  const unique = [];
  for (const j of out) {
    if (!j.url || seen.has(j.url)) continue;
    seen.add(j.url);
    unique.push(j);
    if (unique.length === 5) break;
  }
  return unique;
});

console.log(JSON.stringify(jobs, null, 2));
await browser.close();
process.exit(0);
