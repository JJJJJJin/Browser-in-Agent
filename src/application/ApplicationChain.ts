import type { FastifyBaseLogger } from 'fastify';

import { createOpenAIClient } from '../llm/OpenAIClient.js';
import type { StructuredProfile } from '../profile/types.js';
import type { SeekJob } from '../seek/types.js';
import type { CompanyBrief, InterviewPack, JobApplication, JobSummary, MatchAnalysis } from './types.js';

const MODEL = process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';

type Logger = Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'> | undefined;

async function callJson<T>(systemPrompt: string, userPrompt: string): Promise<T> {
  const client = createOpenAIClient();
  const resp = await client.chat.completions.create({
    model: MODEL,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });
  const content = resp.choices[0]?.message?.content;
  if (!content) throw new Error('LLM returned empty response');
  return JSON.parse(content) as T;
}

async function summarizeJob(job: SeekJob): Promise<JobSummary> {
  const system = `You summarize job postings so a candidate can quickly assess fit. Be precise. Distinguish must-haves (explicit requirements) from nice-to-haves (preferred / bonus). Output strict JSON.`;
  const schema = `Return JSON: {
  "oneLineSummary": string,
  "responsibilities": string[],
  "mustHaveRequirements": string[],
  "niceToHaveRequirements": string[],
  "techStack": string[],
  "domain": string,
  "seniority": string
}`;
  const user = `${schema}

JOB TITLE: ${job.title}
COMPANY: ${job.company ?? 'Unknown'}
LOCATION: ${job.location ?? 'Unknown'}
WORK TYPE: ${job.workType ?? 'Unknown'}
CLASSIFICATION: ${job.classification ?? 'Unknown'}

DESCRIPTION:
${job.description}`;
  const out = await callJson<Partial<JobSummary>>(system, user);
  return {
    oneLineSummary: out.oneLineSummary ?? '',
    responsibilities: out.responsibilities ?? [],
    mustHaveRequirements: out.mustHaveRequirements ?? [],
    niceToHaveRequirements: out.niceToHaveRequirements ?? [],
    techStack: out.techStack ?? [],
    domain: out.domain ?? '',
    seniority: out.seniority ?? '',
  };
}

async function analyzeMatch(profile: StructuredProfile, jobSummary: JobSummary): Promise<MatchAnalysis> {
  const system = `You evaluate how well a candidate matches a job. Be honest — surface real gaps, not just praise. Cite SPECIFIC evidence from the candidate profile (a project, role, or skill). Never invent evidence. Output strict JSON.`;
  const schema = `Return JSON: {
  "fitScore": number (0-100),
  "oneLineFit": string,
  "strengths": [ { "requirement": string, "evidence": string } ],
  "gaps": [ { "requirement": string, "suggestion": string } ],
  "transferableSkills": string[],
  "keywordsToEmphasize": string[]
}`;
  const user = `${schema}

JOB SUMMARY:
${JSON.stringify(jobSummary, null, 2)}

CANDIDATE PROFILE:
${JSON.stringify(profile, null, 2)}`;
  const out = await callJson<Partial<MatchAnalysis>>(system, user);
  return {
    fitScore: typeof out.fitScore === 'number' ? out.fitScore : 0,
    oneLineFit: out.oneLineFit ?? '',
    strengths: out.strengths ?? [],
    gaps: out.gaps ?? [],
    transferableSkills: out.transferableSkills ?? [],
    keywordsToEmphasize: out.keywordsToEmphasize ?? [],
  };
}

async function generateResume(
  profile: StructuredProfile,
  jobSummary: JobSummary,
  match: MatchAnalysis,
  job: SeekJob,
): Promise<string> {
  const system = `You generate tailored resumes in MARKDOWN. Rules:
- Reorder/emphasize experiences and projects most relevant to the job
- Strengthen wording with strong action verbs; quantify outcomes ONLY when the candidate provided numbers
- Surface keywordsToEmphasize naturally; no keyword stuffing
- DO NOT invent experience, dates, technologies, or metrics not in the candidate profile
- Concise (~400-600 words, one page worth)
- Structure: # Name, contact line, > headline/summary, ## Experience, ## Projects, ## Skills, ## Education
Output strict JSON: { "resumeMarkdown": string }`;
  const user = `JOB: ${job.title} @ ${job.company ?? 'Unknown'}

JOB SUMMARY:
${JSON.stringify(jobSummary, null, 2)}

MATCH ANALYSIS:
${JSON.stringify(match, null, 2)}

CANDIDATE PROFILE:
${JSON.stringify(profile, null, 2)}`;
  const out = await callJson<{ resumeMarkdown?: string }>(system, user);
  return out.resumeMarkdown ?? '';
}

async function generateCompanyBrief(profile: StructuredProfile, jobSummary: JobSummary, job: SeekJob): Promise<CompanyBrief> {
  const system = `You write concise company + role briefings to help a candidate quickly catch up before applying or interviewing. Use what's in the job description first; supplement with general knowledge ONLY when you're confident. Be honest about uncertainty — never fabricate funding, headcount, founders, or recent news. Anything unverified goes into "thingsToVerify". Output strict JSON.`;
  const schema = `Return JSON: {
  "companyOneLiner": string,                  // one sentence: what they do, for whom
  "whatTheyDo": string,                       // 2-3 sentences
  "productsOrServices": string[],             // observable products/services
  "industryAndMarket": string,                // industry + competitive context
  "cultureAndValues": string,                 // signals from the JD or known sources
  "positionContext": string,                  // why this role exists, where it fits in the org
  "thingsToVerify": string[]                  // claims the candidate should double-check on the company site
}`;
  const user = `${schema}

JOB:
- Title: ${job.title}
- Company: ${job.company ?? 'Unknown'}
- Location: ${job.location ?? 'Unknown'}
- Classification: ${job.classification ?? 'Unknown'}

JOB DESCRIPTION (raw):
${job.description}

JOB SUMMARY (already extracted):
${JSON.stringify(jobSummary, null, 2)}

CANDIDATE LOCATION (for context only, do not personalize the brief): ${profile.contact.location ?? 'Unknown'}`;
  const out = await callJson<Partial<CompanyBrief>>(system, user);
  return {
    companyOneLiner: out.companyOneLiner ?? '',
    whatTheyDo: out.whatTheyDo ?? '',
    productsOrServices: out.productsOrServices ?? [],
    industryAndMarket: out.industryAndMarket ?? '',
    cultureAndValues: out.cultureAndValues ?? '',
    positionContext: out.positionContext ?? '',
    thingsToVerify: out.thingsToVerify ?? [],
  };
}

async function generateInterviewPack(
  profile: StructuredProfile,
  jobSummary: JobSummary,
  match: MatchAnalysis,
  job: SeekJob,
): Promise<InterviewPack> {
  const system = `You prepare interview answer drafts for a candidate. Generate 7-10 likely questions for THIS specific role and write tailored draft answers in the candidate's voice. Rules:
- Mix categories: motivation, experience, behavioral (STAR-shaped), technical (drawn from the job's tech stack), company-fit, closing
- Always include "Why do you want to join us?" (motivation) and "Tell me about yourself" (experience)
- Each suggestedAnswer: 3-5 sentences, concrete, citing real items from the candidate profile
- evidenceFromProfile: list the project / role / skill names the answer leans on (so the candidate can fact-check)
- For weakness/gap questions, draw honestly from matchAnalysis.gaps with a learning plan
- DO NOT invent experience or metrics
- Also produce 3-5 sharp "questionsToAskThem" — questions the candidate can ask the interviewer
Output strict JSON.`;
  const schema = `Return JSON: {
  "questions": [ {
    "question": string,
    "category": "motivation" | "experience" | "behavioral" | "technical" | "company-fit" | "closing",
    "suggestedAnswer": string,
    "evidenceFromProfile": string[],
    "notes": string | null
  } ],
  "questionsToAskThem": string[]
}`;
  const user = `${schema}

JOB: ${job.title} @ ${job.company ?? 'Unknown'}

JOB SUMMARY:
${JSON.stringify(jobSummary, null, 2)}

MATCH ANALYSIS:
${JSON.stringify(match, null, 2)}

CANDIDATE PROFILE:
${JSON.stringify(profile, null, 2)}`;
  const out = await callJson<Partial<InterviewPack>>(system, user);
  const questions = (out.questions ?? []).map((q) => ({
    question: q.question ?? '',
    category: q.category ?? 'experience',
    suggestedAnswer: q.suggestedAnswer ?? '',
    evidenceFromProfile: q.evidenceFromProfile ?? [],
    notes: q.notes ?? null,
  }));
  return {
    questions,
    questionsToAskThem: out.questionsToAskThem ?? [],
  };
}

async function generateCoverLetter(
  profile: StructuredProfile,
  jobSummary: JobSummary,
  match: MatchAnalysis,
  job: SeekJob,
): Promise<string> {
  const system = `You write SHORT cover letters (under 250 words, 3 paragraphs max). Tone: warm, confident, specific. Rules:
- Para 1: why this role — reference one concrete thing from the job description
- Para 2: top 1-2 strengths from the match analysis with cited evidence from profile
- Para 3: brief closing with availability/interest
- DO NOT invent facts not in the candidate profile
- No clichés ("passionate self-starter", "team player", etc.)
Output strict JSON: { "coverLetter": string }`;
  const user = `ROLE: ${job.title} at ${job.company ?? 'the company'}

JOB SUMMARY:
${JSON.stringify(jobSummary, null, 2)}

MATCH ANALYSIS:
${JSON.stringify(match, null, 2)}

CANDIDATE PROFILE:
${JSON.stringify(profile, null, 2)}`;
  const out = await callJson<{ coverLetter?: string }>(system, user);
  return out.coverLetter ?? '';
}

export type ChainOptions = {
  logger?: Logger;
};

export async function runApplicationChain(
  job: SeekJob,
  profile: StructuredProfile,
  opts: ChainOptions = {},
): Promise<JobApplication> {
  const log = opts.logger;

  log?.info({ jobId: job.jobId }, 'chain: stage 1 — summarizing job');
  const jobSummary = await summarizeJob(job);

  log?.info({ jobId: job.jobId }, 'chain: stage 2 — match analysis');
  const matchAnalysis = await analyzeMatch(profile, jobSummary);

  log?.info({ jobId: job.jobId }, 'chain: stages 3-6 in parallel — resume, cover letter, company brief, interview pack');
  const [resumeMarkdown, coverLetter, companyBrief, interviewPack] = await Promise.all([
    generateResume(profile, jobSummary, matchAnalysis, job),
    generateCoverLetter(profile, jobSummary, matchAnalysis, job),
    generateCompanyBrief(profile, jobSummary, job),
    generateInterviewPack(profile, jobSummary, matchAnalysis, job),
  ]);

  return {
    jobId: job.jobId,
    jobUrl: job.url,
    jobTitle: job.title,
    company: job.company,
    jobSummary,
    matchAnalysis,
    resumeMarkdown,
    coverLetter,
    companyBrief,
    interviewPack,
    model: MODEL,
    generatedAt: new Date().toISOString(),
    profileHash: profile.sourceMarkdownHash,
  };
}
