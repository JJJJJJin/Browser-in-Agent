import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import Database from 'better-sqlite3';

import { createLogger } from '../logger.js';
import type { SeekJob } from './types.js';

const log = createLogger('seek:store');
const DEFAULT_DB_PATH = process.env.SEEK_DB_PATH ?? resolve(process.cwd(), 'data', 'seek_jobs.sqlite3');

export class SeekJobStore {
  private db: Database.Database;

  constructor(dbPath: string = DEFAULT_DB_PATH) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    log.debug({ dbPath }, 'seek-store: opened sqlite db');
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS seek_jobs (
        job_id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        company TEXT,
        location TEXT,
        work_type TEXT,
        classification TEXT,
        sub_classification TEXT,
        salary_json TEXT,
        posted_at TEXT,
        valid_through TEXT,
        short_description TEXT,
        description TEXT NOT NULL,
        description_html TEXT,
        bullet_points_json TEXT NOT NULL,
        source TEXT NOT NULL,
        raw_json_ld TEXT,
        fetched_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_seek_jobs_company ON seek_jobs(company);
      CREATE INDEX IF NOT EXISTS idx_seek_jobs_classification ON seek_jobs(classification);
      CREATE INDEX IF NOT EXISTS idx_seek_jobs_fetched_at ON seek_jobs(fetched_at);
    `);
  }

  upsert(job: SeekJob): void {
    const stmt = this.db.prepare(`
      INSERT INTO seek_jobs (
        job_id, url, title, company, location, work_type,
        classification, sub_classification, salary_json,
        posted_at, valid_through, short_description,
        description, description_html, bullet_points_json,
        source, raw_json_ld, fetched_at, payload_json
      ) VALUES (
        @jobId, @url, @title, @company, @location, @workType,
        @classification, @subClassification, @salaryJson,
        @postedAt, @validThrough, @shortDescription,
        @description, @descriptionHtml, @bulletPointsJson,
        @source, @rawJsonLd, @fetchedAt, @payloadJson
      )
      ON CONFLICT(job_id) DO UPDATE SET
        url = excluded.url,
        title = excluded.title,
        company = excluded.company,
        location = excluded.location,
        work_type = excluded.work_type,
        classification = excluded.classification,
        sub_classification = excluded.sub_classification,
        salary_json = excluded.salary_json,
        posted_at = excluded.posted_at,
        valid_through = excluded.valid_through,
        short_description = excluded.short_description,
        description = excluded.description,
        description_html = excluded.description_html,
        bullet_points_json = excluded.bullet_points_json,
        source = excluded.source,
        raw_json_ld = excluded.raw_json_ld,
        fetched_at = excluded.fetched_at,
        payload_json = excluded.payload_json
    `);

    stmt.run({
      jobId: job.jobId,
      url: job.url,
      title: job.title,
      company: job.company,
      location: job.location,
      workType: job.workType,
      classification: job.classification,
      subClassification: job.subClassification,
      salaryJson: job.salary ? JSON.stringify(job.salary) : null,
      postedAt: job.postedAt,
      validThrough: job.validThrough,
      shortDescription: job.shortDescription,
      description: job.description,
      descriptionHtml: job.descriptionHtml,
      bulletPointsJson: JSON.stringify(job.bulletPoints),
      source: job.source,
      rawJsonLd: job.rawJsonLd ? JSON.stringify(job.rawJsonLd) : null,
      fetchedAt: job.fetchedAt,
      payloadJson: JSON.stringify(job),
    });
    log.info({ jobId: job.jobId, company: job.company, source: job.source }, 'seek-store: upserted job');
  }

  get(jobId: string): SeekJob | null {
    const row = this.db.prepare('SELECT payload_json FROM seek_jobs WHERE job_id = ?').get(jobId) as
      | { payload_json: string }
      | undefined;
    log.debug({ jobId, hit: Boolean(row) }, 'seek-store: get by id');
    if (!row) return null;
    return JSON.parse(row.payload_json) as SeekJob;
  }

  getByUrl(url: string): SeekJob | null {
    const row = this.db.prepare('SELECT payload_json FROM seek_jobs WHERE url = ?').get(url) as
      | { payload_json: string }
      | undefined;
    log.debug({ url, hit: Boolean(row) }, 'seek-store: get by url');
    if (!row) return null;
    return JSON.parse(row.payload_json) as SeekJob;
  }

  list(limit = 50): Array<Pick<SeekJob, 'jobId' | 'url' | 'title' | 'company' | 'location' | 'fetchedAt'>> {
    const rows = this.db
      .prepare(
        'SELECT job_id, url, title, company, location, fetched_at FROM seek_jobs ORDER BY fetched_at DESC LIMIT ?',
      )
      .all(limit) as Array<{
      job_id: string;
      url: string;
      title: string;
      company: string | null;
      location: string | null;
      fetched_at: string;
    }>;
    return rows.map((r) => ({
      jobId: r.job_id,
      url: r.url,
      title: r.title,
      company: r.company,
      location: r.location,
      fetchedAt: r.fetched_at,
    }));
  }

  close(): void {
    this.db.close();
  }
}
