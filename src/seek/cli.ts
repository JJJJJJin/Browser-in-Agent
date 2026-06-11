import 'dotenv/config';

import { writeFileSync } from 'node:fs';

import { BrowserManager } from '../browser/BrowserManager.js';
import { createLogger } from '../logger.js';
import { extractSeekJob } from './SeekJobExtractor.js';
import { SeekJobStore } from './SeekJobStore.js';

const log = createLogger('seek:cli');

type CliArgs = {
  url?: string;
  jsonOut?: string;
  noLlm: boolean;
  noStore: boolean;
  headless: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { noLlm: false, noStore: false, headless: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;
    if (a === '--no-llm') out.noLlm = true;
    else if (a === '--no-store') out.noStore = true;
    else if (a === '--headed') out.headless = false;
    else if (a === '--out' || a === '-o') {
      const next = argv[i + 1];
      if (next) {
        out.jsonOut = next;
        i++;
      }
    } else if (!out.url && (a.startsWith('http://') || a.startsWith('https://'))) {
      out.url = a;
    }
  }
  return out;
}

function printUsage() {
  console.error(
    [
      'Usage: tsx src/seek/cli.ts <seek-job-url> [options]',
      '',
      'Options:',
      '  --no-llm       Skip the LLM enrichment fallback',
      '  --no-store     Do not write to the SQLite store',
      '  --headed       Run the browser with a head (default headless)',
      '  --out <file>   Also write the extracted job JSON to <file>',
      '',
      'Example:',
      '  npm run seek:extract -- https://www.seek.com.au/job/12345678',
    ].join('\n'),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url) {
    printUsage();
    process.exit(1);
  }

  log.info({ url: args.url, noLlm: args.noLlm, noStore: args.noStore, headless: args.headless }, 'seek: starting extraction');

  const manager = new BrowserManager();
  let session;
  try {
    session = await manager.getOrCreateSession({ headless: args.headless });
    const job = await extractSeekJob(session.page, args.url, { noLlm: args.noLlm });

    if (!args.noStore) {
      const store = new SeekJobStore();
      store.upsert(job);
      store.close();
    } else {
      log.debug('seek: skipping store (--no-store)');
    }

    const json = JSON.stringify(job, null, 2);
    if (args.jsonOut) {
      writeFileSync(args.jsonOut, json);
      log.info({ path: args.jsonOut }, 'seek: wrote job JSON to file');
    }
    process.stdout.write(json + '\n');
    log.info({ jobId: job.jobId, title: job.title, company: job.company }, 'seek: done');
  } finally {
    await manager.closeAll();
  }
}

main().catch((err) => {
  log.error({ err: (err as Error).message, stack: (err as Error).stack }, 'seek: fatal');
  process.exit(1);
});
