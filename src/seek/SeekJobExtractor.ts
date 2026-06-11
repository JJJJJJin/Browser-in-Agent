import type { Page } from 'playwright';

import { callOpenAIJson } from '../llm/callJson.js';
import { createLogger } from '../logger.js';
import type { SeekJob, SeekSalary } from './types.js';

const log = createLogger('seek:extractor');

type JsonLdJobPosting = {
  '@type'?: string | string[];
  title?: string;
  description?: string;
  datePosted?: string;
  validThrough?: string;
  employmentType?: string | string[];
  industry?: string;
  occupationalCategory?: string;
  hiringOrganization?: { name?: string } | string;
  jobLocation?:
    | {
        address?: {
          addressLocality?: string;
          addressRegion?: string;
          addressCountry?: string | { name?: string };
        };
      }
    | Array<{
        address?: {
          addressLocality?: string;
          addressRegion?: string;
          addressCountry?: string | { name?: string };
        };
      }>;
  baseSalary?: {
    currency?: string;
    value?: {
      minValue?: number;
      maxValue?: number;
      unitText?: string;
      value?: number;
    };
  };
};

const MODEL = process.env.OPENAI_MODEL ?? 'gpt-5.4';

function extractJobIdFromUrl(url: string): string {
  const m = url.match(/\/job\/(\d+)/);
  if (m && m[1]) return m[1];
  return url;
}

function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractBullets(html: string): string[] {
  const bullets: string[] = [];
  const re = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const raw = match[1];
    if (!raw) continue;
    const text = htmlToText(raw);
    if (text) bullets.push(text);
  }
  return bullets;
}

function locationFromJsonLd(jp: JsonLdJobPosting): string | null {
  const loc = Array.isArray(jp.jobLocation) ? jp.jobLocation[0] : jp.jobLocation;
  if (!loc?.address) return null;
  const a = loc.address;
  const country = typeof a.addressCountry === 'string' ? a.addressCountry : a.addressCountry?.name;
  return [a.addressLocality, a.addressRegion, country].filter(Boolean).join(', ') || null;
}

function companyFromJsonLd(jp: JsonLdJobPosting): string | null {
  const h = jp.hiringOrganization;
  if (!h) return null;
  if (typeof h === 'string') return h;
  return h.name ?? null;
}

function salaryFromJsonLd(jp: JsonLdJobPosting): SeekSalary | null {
  const bs = jp.baseSalary;
  if (!bs) return null;
  const v = bs.value ?? {};
  const out: SeekSalary = {
    currency: bs.currency ?? null,
    minValue: v.minValue ?? v.value ?? null,
    maxValue: v.maxValue ?? v.value ?? null,
    unitText: v.unitText ?? null,
  };
  if (out.minValue == null && out.maxValue == null && !out.currency) return null;
  return out;
}

function workTypeFromJsonLd(jp: JsonLdJobPosting): string | null {
  const et = jp.employmentType;
  if (!et) return null;
  if (Array.isArray(et)) return et.join(', ');
  return et;
}

type PageData = {
  jsonLdRaw: string[];
  nextData: string | null;
  visibleText: string;
  title: string;
};

async function readPageData(page: Page): Promise<PageData> {
  return page.evaluate(() => {
    const jsonLdNodes = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    const jsonLdRaw = jsonLdNodes.map((n) => n.textContent ?? '').filter(Boolean);

    const nextEl = document.getElementById('__NEXT_DATA__');
    const nextData = nextEl?.textContent ?? null;

    const titleEl = document.querySelector('h1');
    const title = titleEl?.textContent?.trim() ?? document.title ?? '';

    const main = document.querySelector('[data-automation="jobAdDetails"]') ?? document.querySelector('main') ?? document.body;
    const visibleText = (main as HTMLElement).innerText?.slice(0, 12000) ?? '';

    return { jsonLdRaw, nextData, visibleText, title };
  });
}

function findJobPosting(jsonLdRaw: string[]): JsonLdJobPosting | null {
  for (const raw of jsonLdRaw) {
    try {
      const parsed = JSON.parse(raw);
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const c of candidates) {
        const t = c?.['@type'];
        const isJob = t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'));
        if (isJob) return c as JsonLdJobPosting;
        if (Array.isArray(c?.['@graph'])) {
          for (const g of c['@graph']) {
            const gt = g?.['@type'];
            if (gt === 'JobPosting' || (Array.isArray(gt) && gt.includes('JobPosting'))) {
              return g as JsonLdJobPosting;
            }
          }
        }
      }
    } catch {
      // Skip malformed JSON-LD blocks; SEEK occasionally injects template strings.
    }
  }
  return null;
}

type NextJobFields = {
  classification: string | null;
  subClassification: string | null;
  workType: string | null;
  shortDescription: string | null;
  location: string | null;
  company: string | null;
};

function findNextJobFields(nextData: string | null): NextJobFields {
  const empty: NextJobFields = {
    classification: null,
    subClassification: null,
    workType: null,
    shortDescription: null,
    location: null,
    company: null,
  };
  if (!nextData) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(nextData);
  } catch {
    return empty;
  }

  let found: Record<string, unknown> | null = null;
  const visit = (node: unknown, depth: number) => {
    if (found || depth > 8 || !node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    const hasJobShape =
      ('classification' in obj || 'subClassification' in obj || 'workType' in obj) &&
      ('title' in obj || 'advertiser' in obj || 'companyName' in obj);
    if (hasJobShape) {
      found = obj;
      return;
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') visit(v, depth + 1);
    }
  };
  visit(parsed, 0);

  if (!found) return empty;

  const f = found as Record<string, unknown>;
  const cls = f.classification as Record<string, unknown> | string | undefined;
  const sub = f.subClassification as Record<string, unknown> | string | undefined;
  const adv = f.advertiser as Record<string, unknown> | undefined;
  const loc = f.location as Record<string, unknown> | string | undefined;

  const pickName = (v: unknown): string | null => {
    if (!v) return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>;
      const name = o.description ?? o.name ?? o.label;
      if (typeof name === 'string') return name;
    }
    return null;
  };

  return {
    classification: pickName(cls),
    subClassification: pickName(sub),
    workType: typeof f.workType === 'string' ? f.workType : pickName(f.workType),
    shortDescription: typeof f.teaser === 'string' ? f.teaser : (typeof f.shortDescription === 'string' ? f.shortDescription : null),
    location: pickName(loc),
    company: pickName(adv) ?? (typeof f.companyName === 'string' ? f.companyName : null),
  };
}

type LlmExtraction = {
  title: string | null;
  company: string | null;
  location: string | null;
  workType: string | null;
  classification: string | null;
  description: string | null;
  bulletPoints: string[];
};

async function llmExtract(visibleText: string, title: string): Promise<LlmExtraction | null> {
  if (!process.env.OPENAI_API_KEY) {
    log.warn('seek: LLM fallback skipped (no OPENAI_API_KEY)');
    return null;
  }
  try {
    const parsed = await callOpenAIJson<Partial<LlmExtraction>>({
      step: 'seek:extract-fallback',
      model: MODEL,
      systemPrompt: 'You extract structured data from job listings. Output only JSON.',
      userPrompt: `Extract the SEEK job posting details from the page text below. Return strict JSON with keys: title, company, location, workType, classification, description, bulletPoints (array of strings). Use null for unknown values. Keep description as plain text.\n\nPAGE TITLE: ${title}\n\nPAGE TEXT:\n${visibleText}`,
    });
    return {
      title: parsed.title ?? null,
      company: parsed.company ?? null,
      location: parsed.location ?? null,
      workType: parsed.workType ?? null,
      classification: parsed.classification ?? null,
      description: parsed.description ?? null,
      bulletPoints: Array.isArray(parsed.bulletPoints) ? parsed.bulletPoints.filter((b): b is string => typeof b === 'string') : [],
    };
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'seek: LLM fallback failed');
    return null;
  }
}

export type ExtractOptions = {
  /** Skip the LLM enrichment pass even when description is present. */
  noLlm?: boolean;
};

export async function extractSeekJob(page: Page, url: string, opts: ExtractOptions = {}): Promise<SeekJob> {
  const jobId = extractJobIdFromUrl(url);
  log.info({ jobId, url }, 'seek: navigating to job page');
  const navStart = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  log.info({ jobId, navMs: Date.now() - navStart }, 'seek: page DOM ready');

  const selectorFound = await page
    .waitForSelector('script[type="application/ld+json"], [data-automation="jobAdDetails"]', { timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  log.debug({ jobId, selectorFound }, 'seek: waited for job ad selector');

  const data = await readPageData(page);
  log.info(
    {
      jobId,
      jsonLdBlocks: data.jsonLdRaw.length,
      hasNextData: Boolean(data.nextData),
      visibleTextChars: data.visibleText.length,
      pageTitleChars: data.title.length,
    },
    'seek: page data captured',
  );

  const jsonLd = findJobPosting(data.jsonLdRaw);
  const nextFields = findNextJobFields(data.nextData);
  log.debug(
    {
      jobId,
      foundJsonLdJobPosting: Boolean(jsonLd),
      nextDataClassification: nextFields.classification,
      nextDataCompany: nextFields.company,
      nextDataLocation: nextFields.location,
    },
    'seek: structured-data parse complete',
  );

  let title = jsonLd?.title ?? data.title ?? '';
  let descriptionHtml: string | null = jsonLd?.description ?? null;
  let description = descriptionHtml ? htmlToText(descriptionHtml) : '';
  let bulletPoints = descriptionHtml ? extractBullets(descriptionHtml) : [];
  let company = companyFromJsonLd(jsonLd ?? {}) ?? nextFields.company;
  let location = locationFromJsonLd(jsonLd ?? {}) ?? nextFields.location;
  let workType = workTypeFromJsonLd(jsonLd ?? {}) ?? nextFields.workType;
  const salary = salaryFromJsonLd(jsonLd ?? {});

  let source: SeekJob['source'] = jsonLd ? (nextFields.classification ? 'mixed' : 'json-ld') : nextFields.classification ? 'next-data' : 'llm';

  if ((!description || description.length < 50) && !opts.noLlm) {
    log.info({ jobId, descChars: description.length }, 'seek: invoking LLM fallback (description thin)');
    const llm = await llmExtract(data.visibleText, title);
    if (llm) {
      const before = { title, company, location, workType, descChars: description.length, bullets: bulletPoints.length };
      title = title || llm.title || title;
      company = company ?? llm.company;
      location = location ?? llm.location;
      workType = workType ?? llm.workType;
      if (!description && llm.description) description = llm.description;
      if (bulletPoints.length === 0 && llm.bulletPoints.length) bulletPoints = llm.bulletPoints;
      source = source === 'json-ld' || source === 'next-data' ? 'mixed' : 'llm';
      log.info(
        {
          jobId,
          before,
          after: { title, company, location, workType, descChars: description.length, bullets: bulletPoints.length },
        },
        'seek: LLM fallback merged',
      );
    } else {
      log.warn({ jobId }, 'seek: LLM fallback returned no result');
    }
  }

  if (!description) {
    log.warn({ jobId, visibleTextChars: data.visibleText.length }, 'seek: falling back to raw visible text as description');
    description = data.visibleText;
  }

  log.info(
    {
      jobId,
      title: title.trim(),
      company,
      location,
      workType,
      classification: nextFields.classification,
      descChars: description.length,
      bullets: bulletPoints.length,
      source,
    },
    'seek: extraction complete',
  );

  return {
    jobId,
    url,
    title: title.trim(),
    company,
    location,
    workType,
    classification: nextFields.classification,
    subClassification: nextFields.subClassification,
    salary,
    postedAt: jsonLd?.datePosted ?? null,
    validThrough: jsonLd?.validThrough ?? null,
    shortDescription: nextFields.shortDescription,
    description,
    descriptionHtml,
    bulletPoints,
    source,
    rawJsonLd: jsonLd ?? null,
    fetchedAt: new Date().toISOString(),
  };
}
