import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import Database from 'better-sqlite3';

import type { CompanyBrief, InterviewPack, JobApplication } from './types.js';

const DEFAULT_DB_PATH = process.env.SEEK_DB_PATH ?? resolve(process.cwd(), 'data', 'seek_jobs.sqlite3');
const DEFAULT_FILE_DIR = process.env.APPLICATIONS_DIR ?? resolve(process.cwd(), 'output');

function slugify(s: string | null | undefined, fallback: string): string {
  if (!s) return fallback;
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || fallback;
}

function applicationFolderName(app: { generatedAt: string; company: string | null; jobTitle: string }): string {
  const date = app.generatedAt.slice(0, 10);
  const companySlug = slugify(app.company, 'unknown-company');
  const titleSlug = slugify(app.jobTitle, 'job');
  return `${date}-${companySlug}-${titleSlug}`;
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
    mkdirSync(dir, { recursive: true });

    const resumePath = resolve(dir, 'resume.md');
    const coverLetterPath = resolve(dir, 'cover_letter.md');
    const matchPath = resolve(dir, 'match.json');
    const summaryPath = resolve(dir, 'job_summary.json');
    const companyBriefPath = resolve(dir, 'company_brief.md');
    const interviewPackPath = resolve(dir, 'interview_pack.md');

    writeFileSync(resumePath, app.resumeMarkdown);
    writeFileSync(coverLetterPath, app.coverLetter);
    writeFileSync(matchPath, JSON.stringify(app.matchAnalysis, null, 2));
    writeFileSync(summaryPath, JSON.stringify(app.jobSummary, null, 2));
    writeFileSync(companyBriefPath, renderCompanyBrief(app, app.companyBrief));
    writeFileSync(interviewPackPath, renderInterviewPack(app, app.interviewPack));

    return { resumePath, coverLetterPath, matchPath, summaryPath, companyBriefPath, interviewPackPath };
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
