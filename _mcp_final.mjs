// Clean single-load Indeed scrape via MCP tools only — no clicks / no reloads,
// so Cloudflare is not triggered. Extracts title, company, salary, location.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const SEARCH = 'https://au.indeed.com/jobs?q=ai+engineer&l=';
const N = 5;

const transport = new StreamableHTTPClientTransport(new URL('http://localhost:7799/mcp'));
const client = new Client({ name: 'scrape', version: '0.1.0' });
await client.connect(transport);
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  return (r.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
};

const browserId = JSON.parse(await call('create_browser', { engine: 'chromium' })).browserId;
const pageId = JSON.parse((await call('new_page', { browserId, url: SEARCH })).split('\n')[0]).pageId;

// Pull the full readable text (paginate via nextOffset).
let body = '', offset = 0;
for (let i = 0; i < 6; i++) {
  const out = await call('page_read', { pageId, mode: 'full', maxChars: 8000, offset });
  const nl = out.indexOf('\n');
  const head = JSON.parse(out.slice(0, nl));
  body += out.slice(nl + 1);
  if (!head.truncated || head.nextOffset === undefined) break;
  offset = head.nextOffset;
}

// Each job block starts with a "### <Title>" heading.
const blocks = body.split(/\n(?=### )/).filter((b) => b.startsWith('### '));
const jobs = blocks.slice(0, N).map((b) => {
  const lines = b.split('\n').map((l) => l.replace(/^[-#]\s*/, '').trim());
  const title = lines[0];
  const salary = (lines.find((l) => /\$[\d,]+/.test(l)) || '').trim();
  const viewAll = lines.find((l) => /^View all .+ jobs/.test(l)) || '';
  const m = viewAll.match(/^View all (.+?) jobs(?:\s*-\s*(.+?) jobs)?/);
  const company = m?.[1] || '';
  const location = m?.[2] || '';
  return { title, company, location, salary: salary || '—' };
});

console.log(JSON.stringify(jobs, null, 2));
await client.close();
process.exit(0);
