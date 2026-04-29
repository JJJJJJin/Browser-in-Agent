import type { Page } from 'playwright';

import { createOpenAIClient } from '../llm/OpenAIClient.js';
import type { SeekJob, SeekSalary } from './types.js';

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

const MODEL = process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';

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
  if (!process.env.OPENAI_API_KEY) return null;
  const client = createOpenAIClient();
  const prompt = `Extract the SEEK job posting details from the page text below. Return strict JSON with keys: title, company, location, workType, classification, description, bulletPoints (array of strings). Use null for unknown values. Keep description as plain text.\n\nPAGE TITLE: ${title}\n\nPAGE TEXT:\n${visibleText}`;

  const resp = await client.chat.completions.create({
    model: MODEL,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You extract structured data from job listings. Output only JSON.' },
      { role: 'user', content: prompt },
    ],
  });
  const content = resp.choices[0]?.message?.content;
  if (!content) return null;
  try {
    const parsed = JSON.parse(content) as Partial<LlmExtraction>;
    return {
      title: parsed.title ?? null,
      company: parsed.company ?? null,
      location: parsed.location ?? null,
      workType: parsed.workType ?? null,
      classification: parsed.classification ?? null,
      description: parsed.description ?? null,
      bulletPoints: Array.isArray(parsed.bulletPoints) ? parsed.bulletPoints.filter((b): b is string => typeof b === 'string') : [],
    };
  } catch {
    return null;
  }
}

export type ExtractOptions = {
  /** Skip the LLM enrichment pass even when description is present. */
  noLlm?: boolean;
};

export async function extractSeekJob(page: Page, url: string, opts: ExtractOptions = {}): Promise<SeekJob> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForSelector('script[type="application/ld+json"], [data-automation="jobAdDetails"]', { timeout: 15_000 }).catch(() => undefined);

  const data = await readPageData(page);
  const jsonLd = findJobPosting(data.jsonLdRaw);
  const nextFields = findNextJobFields(data.nextData);

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
    const llm = await llmExtract(data.visibleText, title);
    if (llm) {
      title = title || llm.title || title;
      company = company ?? llm.company;
      location = location ?? llm.location;
      workType = workType ?? llm.workType;
      if (!description && llm.description) description = llm.description;
      if (bulletPoints.length === 0 && llm.bulletPoints.length) bulletPoints = llm.bulletPoints;
      source = source === 'json-ld' || source === 'next-data' ? 'mixed' : 'llm';
    }
  }

  if (!description) description = data.visibleText;

  return {
    jobId: extractJobIdFromUrl(url),
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
