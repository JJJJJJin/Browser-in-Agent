// Scrape the first 5 Indeed "ai engineer" jobs using ONLY the project's MCP
// tools (create_browser / new_page / snapshot / click), over Streamable HTTP.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const SEARCH = 'https://au.indeed.com/jobs?q=ai+engineer&l=';
const N = 5;

const transport = new StreamableHTTPClientTransport(new URL('http://localhost:7799/mcp'));
const client = new Client({ name: 'scrape-harness', version: '0.1.0' });
await client.connect(transport);

const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  return { text, isError: r.isError };
};

// Parse the distilled tree: ordered jobs with title, full-details button ref, company.
function parseJobs(tree) {
  const lines = tree.split('\n');
  const jobs = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/button "full details of (.+?)" \[ref=(e\d+)\]/);
    if (!m) continue;
    const [, title, ref] = m;
    let company = '';
    for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
      const c = lines[j].match(/link "(.+?) jobs" \[ref=/);
      if (c) { company = c[1]; break; }
    }
    jobs.push({ title, ref, company });
  }
  return jobs;
}

// Find the snapshot header line (some tools prefix an {outcome} line first).
const header = (text) => {
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue;
    try {
      const o = JSON.parse(line);
      if (o.pageId) return o;
    } catch {
      /* not JSON */
    }
  }
  return {};
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Snapshot until the job list has hydrated (cards render via JS shortly after load).
async function waitJobs(pageId, tries = 6) {
  let last = [];
  for (let t = 0; t < tries; t++) {
    const s = await call('snapshot', { pageId });
    last = parseJobs(s.text);
    if (last.length >= 5) return last;
    await sleep(700);
  }
  return last;
}

const cb = await call('create_browser', { engine: 'chromium' });
const browserId = JSON.parse(cb.text).browserId;

const np = await call('new_page', { browserId, url: SEARCH });
const pageId = header(np.text).pageId;

// First pass: titles + companies (stable list order).
const jobs = (await waitJobs(pageId)).slice(0, N);

// Recover each job's URL: navigate fresh, wait for hydration, click its "full
// details" button → the page URL gains a vjk=<jobKey> → clean viewjob link.
for (let i = 0; i < jobs.length; i++) {
  await call('navigate', { pageId, url: SEARCH });
  const ordered = await waitJobs(pageId);
  const target = ordered[i];
  if (!target) {
    const s = await call('snapshot', { pageId });
    const pr = await call('page_read', { pageId, mode: 'full', maxChars: 300 });
    console.error(`iter ${i}: no target. url=${header(s.text).url}`);
    console.error(`  read: ${pr.text.replace(/\n/g, ' ').slice(0, 300)}`);
    continue;
  }
  const clicked = await call('click', { pageId, ref: target.ref, element: target.title });
  const url = header(clicked.text).url;
  const vjk = url ? new URL(url).searchParams.get('vjk') : null;
  console.error(`iter ${i}: "${target.title}" ok=${!clicked.isError} vjk=${vjk}`);
  jobs[i].url = vjk ? `https://au.indeed.com/viewjob?jk=${vjk}` : (url ?? '');
}

console.log(JSON.stringify(jobs, null, 2));
await client.close();
process.exit(0);
