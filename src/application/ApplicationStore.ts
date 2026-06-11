import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import Database from 'better-sqlite3';

import { createLogger } from '../logger.js';
import type { CompanyBrief, InterviewPack, JobApplication } from './types.js';

const log = createLogger('apply:store');

const DEFAULT_DB_PATH = process.env.SEEK_DB_PATH ?? resolve(process.cwd(), 'data', 'seek_jobs.sqlite3');
const DEFAULT_FILE_DIR = process.env.APPLICATIONS_DIR ?? resolve(process.cwd(), 'output');

const TIMESTAMP_PREFIX = 'last-updated-';
const TIMESTAMP_SUFFIX = '.txt';

function slugify(s: string | null | undefined, fallback: string): string {
  if (!s) return fallback;
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || fallback;
}

function applicationFolderName(app: { company: string | null; jobTitle: string }): string {
  const companySlug = slugify(app.company, 'unknown-company');
  const titleSlug = slugify(app.jobTitle, 'job');
  return `${companySlug}-${titleSlug}`;
}

/**
 * Encode an ISO timestamp into a filename-safe form. Colons are not safe on
 * Windows / older filesystems, so swap them for hyphens, and drop the millisecond
 * suffix for readability. Example: `last-updated-2026-05-06T08-12-04Z.txt`.
 */
function timestampFileName(generatedAt: string): string {
  const safe = generatedAt.replace(/\.\d+/, '').replace(/:/g, '-');
  return `${TIMESTAMP_PREFIX}${safe}${TIMESTAMP_SUFFIX}`;
}

export type SavedFiles = {
  resumePath: string;
  coverLetterPath: string;
  matchPath: string;
  summaryPath: string;
  companyBriefPath: string;
  interviewPackPath: string;
};

function bullets(items: string[]): string {
  if (!items.length) return '_(none)_';
  return items.map((i) => `- ${i}`).join('\n');
}

function renderCompanyBrief(app: JobApplication, brief: CompanyBrief): string {
  return `# Company & Role Brief — ${app.company ?? 'Unknown'} · ${app.jobTitle}

> ${brief.companyOneLiner}

## What they do
${brief.whatTheyDo}

## Products / services
${bullets(brief.productsOrServices)}

## Industry & market
${brief.industryAndMarket}

## Culture & values (signals)
${brief.cultureAndValues}

## Why this role exists
${brief.positionContext}

## Verify before interview
${bullets(brief.thingsToVerify)}
`;
}

function renderInterviewPack(app: JobApplication, pack: InterviewPack): string {
  const qa = pack.questions
    .map((q, idx) => {
      const evidence = q.evidenceFromProfile.length ? `\n_Evidence: ${q.evidenceFromProfile.join('; ')}_` : '';
      const notes = q.notes ? `\n_Notes: ${q.notes}_` : '';
      return `### ${idx + 1}. [${q.category}] ${q.question}\n\n${q.suggestedAnswer}${evidence}${notes}`;
    })
    .join('\n\n');

  return `# Interview Prep — ${app.company ?? 'Unknown'} · ${app.jobTitle}

## Likely questions & draft answers
${qa || '_(no questions generated)_'}

## Questions to ask them
${bullets(pack.questionsToAskThem)}
`;
}

export class ApplicationStore {
  private db: Database.Database;
  private fileDir: string;

  constructor(dbPath: string = DEFAULT_DB_PATH, fileDir: string = DEFAULT_FILE_DIR) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.fileDir = fileDir;
    log.debug({ dbPath, fileDir }, 'apply-store: opened sqlite db');
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS job_applications (
        job_id TEXT PRIMARY KEY,
        job_url TEXT NOT NULL,
        job_title TEXT NOT NULL,
        company TEXT,
        fit_score INTEGER,
        one_line_fit TEXT,
        model TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        profile_hash TEXT NOT NULL,
        resume_md TEXT NOT NULL,
        cover_letter TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_job_applications_company ON job_applications(company);
      CREATE INDEX IF NOT EXISTS idx_job_applications_generated_at ON job_applications(generated_at);
      CREATE INDEX IF NOT EXISTS idx_job_applications_fit_score ON job_applications(fit_score);
    `);
  }

  upsert(app: JobApplication): SavedFiles {
    log.info({ jobId: app.jobId, fitScore: app.matchAnalysis.fitScore }, 'apply-store: upserting application row');
    this.db
      .prepare(
        `
      INSERT INTO job_applications (
        job_id, job_url, job_title, company, fit_score, one_line_fit,
        model, generated_at, profile_hash, resume_md, cover_letter, payload_json
      ) VALUES (
        @jobId, @jobUrl, @jobTitle, @company, @fitScore, @oneLineFit,
        @model, @generatedAt, @profileHash, @resumeMd, @coverLetter, @payloadJson
      )
      ON CONFLICT(job_id) DO UPDATE SET
        job_url = excluded.job_url,
        job_title = excluded.job_title,
        company = excluded.company,
        fit_score = excluded.fit_score,
        one_line_fit = excluded.one_line_fit,
        model = excluded.model,
        generated_at = excluded.generated_at,
        profile_hash = excluded.profile_hash,
        resume_md = excluded.resume_md,
        cover_letter = excluded.cover_letter,
        payload_json = excluded.payload_json
    `,
      )
      .run({
        jobId: app.jobId,
        jobUrl: app.jobUrl,
        jobTitle: app.jobTitle,
        company: app.company,
        fitScore: app.matchAnalysis.fitScore,
        oneLineFit: app.matchAnalysis.oneLineFit,
        model: app.model,
        generatedAt: app.generatedAt,
        profileHash: app.profileHash,
        resumeMd: app.resumeMarkdown,
        coverLetter: app.coverLetter,
        payloadJson: JSON.stringify(app),
      });

    return this.writeFiles(app);
  }

  private writeFiles(app: JobApplication): SavedFiles {
    const dir = resolve(this.fileDir, applicationFolderName(app));
    const folderExisted = existsSync(dir);
    mkdirSync(dir, { recursive: true });
    log.info({ dir, folderExisted }, 'apply-store: writing application artefacts');

    const resumePath = resolve(dir, 'resume.md');
    const coverLetterPath = resolve(dir, 'cover_letter.md');
    const matchPath = resolve(dir, 'match.json');
    const summaryPath = resolve(dir, 'job_summary.json');
    const companyBriefPath = resolve(dir, 'company_brief.md');
    const interviewPackPath = resolve(dir, 'interview_pack.md');

    writeFileSync(resumePath, app.resumeMarkdown);
    log.debug({ path: resumePath, chars: app.resumeMarkdown.length }, 'apply-store: wrote resume.md');
    writeFileSync(coverLetterPath, app.coverLetter);
    log.debug({ path: coverLetterPath, chars: app.coverLetter.length }, 'apply-store: wrote cover_letter.md');
    writeFileSync(matchPath, JSON.stringify(app.matchAnalysis, null, 2));
    log.debug({ path: matchPath }, 'apply-store: wrote match.json');
    writeFileSync(summaryPath, JSON.stringify(app.jobSummary, null, 2));
    log.debug({ path: summaryPath }, 'apply-store: wrote job_summary.json');
    writeFileSync(companyBriefPath, renderCompanyBrief(app, app.companyBrief));
    log.debug({ path: companyBriefPath }, 'apply-store: wrote company_brief.md');
    writeFileSync(interviewPackPath, renderInterviewPack(app, app.interviewPack));
    log.debug({ path: interviewPackPath }, 'apply-store: wrote interview_pack.md');

    this.writeTimestampMarker(dir, app.generatedAt);

    log.info({ dir, files: 6 }, 'apply-store: all artefacts written');

    return { resumePath, coverLetterPath, matchPath, summaryPath, companyBriefPath, interviewPackPath };
  }

  /**
   * Write a timestamp marker file inside `dir` whose NAME encodes the latest
   * application time. Removes any older `last-updated-*.txt` files so only the
   * most recent marker remains, making the folder a quick visual log of when
   * the candidate last applied to this role.
   */
  private writeTimestampMarker(dir: string, generatedAt: string): void {
    let removed = 0;
    try {
      for (const entry of readdirSync(dir)) {
        if (entry.startsWith(TIMESTAMP_PREFIX) && entry.endsWith(TIMESTAMP_SUFFIX)) {
          try {
            unlinkSync(resolve(dir, entry));
            removed++;
          } catch (err) {
            log.warn({ entry, err: (err as Error).message }, 'apply-store: failed to remove old timestamp marker');
          }
        }
      }
    } catch (err) {
      log.warn({ dir, err: (err as Error).message }, 'apply-store: could not enumerate timestamp markers');
    }

    const fileName = timestampFileName(generatedAt);
    const path = resolve(dir, fileName);
    writeFileSync(path, `${generatedAt}\n`);
    log.info({ path, removedOldMarkers: removed }, 'apply-store: refreshed last-updated marker');
  }

  get(jobId: string): JobApplication | null {
    const row = this.db.prepare('SELECT payload_json FROM job_applications WHERE job_id = ?').get(jobId) as
      | { payload_json: string }
      | undefined;
    if (!row) return null;
    return JSON.parse(row.payload_json) as JobApplication;
  }

  list(limit = 50): Array<{
    jobId: string;
    jobTitle: string;
    company: string | null;
    fitScore: number | null;
    oneLineFit: string | null;
    generatedAt: string;
  }> {
    const rows = this.db
      .prepare(
        `SELECT job_id, job_title, company, fit_score, one_line_fit, generated_at
         FROM job_applications ORDER BY generated_at DESC LIMIT ?`,
      )
      .all(limit) as Array<{
      job_id: string;
      job_title: string;
      company: string | null;
      fit_score: number | null;
      one_line_fit: string | null;
      generated_at: string;
    }>;
    return rows.map((r) => ({
      jobId: r.job_id,
      jobTitle: r.job_title,
      company: r.company,
      fitScore: r.fit_score,
      oneLineFit: r.one_line_fit,
      generatedAt: r.generated_at,
    }));
  }

  close(): void {
    this.db.close();
  }
}
