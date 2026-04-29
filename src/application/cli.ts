import 'dotenv/config';

import { BrowserManager } from '../browser/BrowserManager.js';
import { ensureStructuredProfile, ProfileNotFoundError } from '../profile/ProfileStore.js';
import { extractSeekJob } from '../seek/SeekJobExtractor.js';
import { SeekJobStore } from '../seek/SeekJobStore.js';
import type { SeekJob } from '../seek/types.js';
import { ApplicationStore } from './ApplicationStore.js';
import { runApplicationChain } from './ApplicationChain.js';

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
      if (cached) return cached;
    }
    if (!isUrl(input)) {
      throw new Error(
        `No cached job for jobId "${input}". Run the seek extractor first, or pass the full SEEK URL with --reextract.`,
      );
    }
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

  let profile;
  try {
    profile = await ensureStructuredProfile({ force: args.forceProfile });
  } catch (err) {
    if (err instanceof ProfileNotFoundError) {
      console.error(err.message);
      process.exit(2);
    }
    throw err;
  }

  const job = await loadOrFetchJob(args.jobIdOrUrl, { reextract: args.reextract, headless: args.headless });
  console.error(`Job: ${job.title} @ ${job.company ?? 'Unknown'} (${job.jobId})`);

  const application = await runApplicationChain(job, profile);

  const store = new ApplicationStore();
  const files = store.upsert(application);
  store.close();

  console.error(`\nFit score: ${application.matchAnalysis.fitScore}/100 — ${application.matchAnalysis.oneLineFit}`);
  console.error(`Resume:         ${files.resumePath}`);
  console.error(`Cover letter:   ${files.coverLetterPath}`);
  console.error(`Company brief:  ${files.companyBriefPath}`);
  console.error(`Interview pack: ${files.interviewPackPath}`);
  console.error(`Match:          ${files.matchPath}`);
  console.error(`Job summary:    ${files.summaryPath}`);
  process.stdout.write(JSON.stringify(application, null, 2) + '\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
