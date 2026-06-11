import 'dotenv/config';

import { BrowserManager } from '../browser/BrowserManager.js';
import { createLogger } from '../logger.js';
import { ensureStructuredProfile, ProfileNotFoundError, readProfileMarkdown } from '../profile/ProfileStore.js';
import { extractSeekJob } from '../seek/SeekJobExtractor.js';
import { SeekJobStore } from '../seek/SeekJobStore.js';
import type { SeekJob } from '../seek/types.js';
import { ApplicationStore } from './ApplicationStore.js';
import { runApplicationChain } from './ApplicationChain.js';

const log = createLogger('apply:cli');

type CliArgs = {
  jobIdOrUrl?: string;
  reextract: boolean;
  forceProfile: boolean;
  headless: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { reextract: false, forceProfile: false, headless: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;
    if (a === '--reextract') out.reextract = true;
    else if (a === '--force-profile') out.forceProfile = true;
    else if (a === '--headed') out.headless = false;
    else if (!out.jobIdOrUrl) out.jobIdOrUrl = a;
  }
  return out;
}

function printUsage() {
  console.error(
    [
      'Usage: tsx src/application/cli.ts <jobId | seek-job-url> [options]',
      '',
      'Options:',
      '  --reextract       Re-fetch the job from SEEK even if cached',
      '  --force-profile   Re-distill profile.md before running',
      '  --headed          Show the browser window during extraction',
      '',
      'Examples:',
      '  npm run apply -- 12345678',
      '  npm run apply -- https://www.seek.com.au/job/12345678 --reextract',
    ].join('\n'),
  );
}

function isUrl(s: string): boolean {
  return s.startsWith('http://') || s.startsWith('https://');
}

async function loadOrFetchJob(input: string, opts: { reextract: boolean; headless: boolean }): Promise<SeekJob> {
  const seekStore = new SeekJobStore();
  try {
    if (!opts.reextract) {
      const cached = isUrl(input) ? seekStore.getByUrl(input) : seekStore.get(input);
      if (cached) {
        log.info({ jobId: cached.jobId, source: 'cache' }, 'apply: loaded job from cache');
        return cached;
      }
    }
    if (!isUrl(input)) {
      throw new Error(
        `No cached job for jobId "${input}". Run the seek extractor first, or pass the full SEEK URL with --reextract.`,
      );
    }
    log.info({ url: input, headless: opts.headless }, 'apply: extracting job from SEEK');
    const manager = new BrowserManager();
    try {
      const session = await manager.getOrCreateSession({ headless: opts.headless });
      const job = await extractSeekJob(session.page, input);
      seekStore.upsert(job);
      return job;
    } finally {
      await manager.closeAll();
    }
  } finally {
    seekStore.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.jobIdOrUrl) {
    printUsage();
    process.exit(1);
  }

  log.info({ jobIdOrUrl: args.jobIdOrUrl, reextract: args.reextract, forceProfile: args.forceProfile }, 'apply: starting');

  let profile;
  let rawProfileMarkdown: string | undefined;
  try {
    profile = await ensureStructuredProfile({ force: args.forceProfile });
    rawProfileMarkdown = readProfileMarkdown();
  } catch (err) {
    if (err instanceof ProfileNotFoundError) {
      log.error({ err: err.message }, 'apply: profile not found');
      process.exit(2);
    }
    throw err;
  }

  const job = await loadOrFetchJob(args.jobIdOrUrl, { reextract: args.reextract, headless: args.headless });
  log.info({ jobId: job.jobId, title: job.title, company: job.company }, 'apply: job loaded');

  const application = await runApplicationChain(job, profile, { rawProfileMarkdown });

  const store = new ApplicationStore();
  const files = store.upsert(application);
  store.close();

  log.info(
    {
      fitScore: application.matchAnalysis.fitScore,
      oneLineFit: application.matchAnalysis.oneLineFit,
      resume: files.resumePath,
      coverLetter: files.coverLetterPath,
      companyBrief: files.companyBriefPath,
      interviewPack: files.interviewPackPath,
      match: files.matchPath,
      summary: files.summaryPath,
    },
    'apply: done',
  );
  process.stdout.write(JSON.stringify(application, null, 2) + '\n');
}

main().catch((err) => {
  log.error({ err: (err as Error).message, stack: (err as Error).stack }, 'apply: fatal');
  process.exit(1);
});
