# AutoBrowser

AutoBrowser is a TypeScript / Node.js toolkit that drives a real browser (Playwright) from human-language instructions and turns the results into structured data and AI-generated artefacts. Today it focuses on a single end-to-end workflow: **extract a SEEK job posting → distill a personal profile → generate a tailored resume, cover letter, company brief, and interview pack** for that role.

## What's in the box

Three CLIs — composable, each usable on its own:

| Command | Purpose |
| --- | --- |
| `npm run seek:extract -- <seek-url>` | Open a SEEK job page, extract title / company / description / classification, cache to SQLite |
| `npm run profile:distill` | Convert your free-form `profile/profile.md` into a structured JSON profile |
| `npm run apply -- <jobIdOrUrl>` | Full chain: load job + profile, run match analysis, write tailored resume / cover letter / company brief / interview pack to `output/` |

A Fastify HTTP API exposes the same building blocks for programmatic use (`npm run dev`).

## Setup

```bash
npm install
npx playwright install chromium      # one-time, needed for the SEEK extractor
cp .env.example .env                  # fill in OPENAI_API_KEY
```

Required env vars (see [.env.example](.env.example)):

| Variable | Default | Notes |
| --- | --- | --- |
| `OPENAI_API_KEY` | — | required for any LLM step (distill, match, resume, cover letter) |
| `OPENAI_MODEL` | `gpt-5.4` | any OpenAI chat-completions model |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | HTTP server only |
| `HEADLESS` | `true` | Playwright mode |
| `PROFILE_DIR` | `<cwd>/profile` | where `profile.md` and `profile.json` live |
| `APPLICATIONS_DIR` | `<cwd>/output` | where generated resumes etc. land |
| `SEEK_DB_PATH` | `<cwd>/data/seek_jobs.sqlite3` | SQLite cache for SEEK jobs and applications |

## Authoring your profile

Create `profile/profile.md` with your background in free-form markdown — name, contact, education, summary, skills, experience, projects. The distiller is faithful (it will not invent anything you didn't write), so include every detail you might want pulled into a resume.

### Multi-variant project descriptions

If a project can be framed differently depending on the role you're applying for (e.g. backend vs AI vs data engineer), write multiple `#### Variant — <role focus>` sub-sections under one `### <Project Name>` heading. The distiller preserves all variants, and the resume/cover-letter generators pick the variant whose framing best matches the target job's domain — they won't blend them.

```markdown
### NVR LLM Code Assistant
**Common tech:** ...

#### Variant — AI / ML engineer focus
[intro paragraph emphasizing model evaluation, fine-tuning, BLEU]
- highlight
- highlight

#### Variant — Backend / platform engineer focus
[intro paragraph emphasizing Celery+Redis pipeline, scalability]
- highlight
- highlight
```

A worked example lives in [doc/profile/profile.md](doc/profile/profile.md). Personal copies under `profile/` and `doc/profile/` are gitignored.

## CLI: `seek:extract`

Extracts a job posting from SEEK and caches it to the SQLite store at `data/seek_jobs.sqlite3`.

```bash
npm run seek:extract -- <seek-job-url> [options]

Options:
  --no-llm        Skip the LLM enrichment fallback (DOM-only extraction)
  --no-store      Don't write to the SQLite store
  --headed        Run the browser visibly (default headless)
  --out <file>    Also write the extracted job JSON to <file>
```

Example:

```bash
npm run seek:extract -- https://www.seek.com.au/job/12345678
npm run seek:extract -- https://www.seek.com.au/job/12345678 --headed --out job.json
```

## CLI: `profile:distill`

Reads `profile/profile.md`, calls the LLM to convert it into a structured JSON profile, writes `profile/profile.json`. The result is cached against a hash of the markdown — re-running with no changes is a no-op.

```bash
npm run profile:distill              # distill if profile.md changed (or first run)
npm run profile:distill -- --force   # re-distill even if hash matches
```

If `profile/profile.md` is missing, the CLI exits with a hint and exit code 2.

## CLI: `apply`

The full application-tailoring chain. In order:

1. Load the structured profile (distilling first if needed).
2. Load the cached SEEK job, or fetch it live if you passed a full URL.
3. Stage 1 — summarise the job (must-haves vs nice-to-haves, tech stack, seniority).
4. Stage 2 — match analysis (fit score, strengths/gaps with cited evidence, keywords to emphasise).
5. Stages 3–6 in parallel — tailored resume, cover letter, company brief, interview pack.

```bash
npm run apply -- <jobIdOrSeekUrl> [options]

Options:
  --reextract       Re-fetch the job from SEEK even if it's cached
  --force-profile   Re-distill profile.md before running
  --headed          Show the browser window during extraction (only if fetching live)
```

Examples:

```bash
npm run apply -- 12345678                                          # uses cached job
npm run apply -- https://www.seek.com.au/job/12345678              # fetch + cache + apply
npm run apply -- https://www.seek.com.au/job/12345678 --reextract  # force re-fetch
```

### Output layout

Generated artefacts go to `output/<YYYY-MM-DD>-<company>-<job-title>/`, where company and title are slugified (lowercase, non-alphanumerics → hyphens):

```
output/
└── 2026-05-06-canva-senior-backend-engineer/
    ├── resume.md           # tailored, variant-aware
    ├── cover_letter.md     # under 250 words, 3 paragraphs
    ├── company_brief.md    # company + role context, with "things to verify"
    ├── interview_pack.md   # likely Qs + draft answers + Qs to ask back
    ├── match.json          # fit score, strengths, gaps, keywords
    └── job_summary.json    # parsed job structure
```

The same data is also stored in the `job_applications` table of `data/seek_jobs.sqlite3` (so you can query history, build a dashboard, etc.).

## HTTP API

Start the server in watch mode:

```bash
npm run dev          # tsx watch on src/server.ts
# or
npm run build && npm start
```

Endpoints (all under `/v1`):

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/healthz` | liveness |
| POST | `/v1/execute` | run an instruction-driven browser action |
| POST | `/v1/verify` | verification helpers |
| POST | `/v1/jobs` | create an async browser job |
| GET | `/v1/jobs/:jobId` | fetch job status / result |
| POST | `/v1/jobs/:jobId/cancel` | cancel a running job |
| POST | `/v1/jobs/:jobId/webhook` | register a completion webhook |
| POST | `/v1/seek/extract` | extract a SEEK job (server-side equivalent of `seek:extract`) |
| GET | `/v1/seek/jobs` | list cached SEEK jobs |
| GET | `/v1/seek/jobs/:jobId` | fetch a cached SEEK job |
| GET | `/v1/profile` | read the structured profile |
| POST | `/v1/profile/distill` | re-distill `profile.md` |
| POST | `/v1/applications/generate` | run the application chain (HTTP equivalent of `apply`) |
| GET | `/v1/applications` | list generated applications |
| GET | `/v1/applications/:jobId` | fetch one generated application |

## Other scripts

```bash
npm run build       # tsc -p tsconfig.json
npm run start       # node dist/server.js
npm run typecheck   # tsc --noEmit
```

## Project layout

```
src/
├── server.ts                # Fastify entrypoint
├── routes/                  # HTTP handlers (execute, jobs, seek, profile, applications, verify)
├── browser/                 # Playwright session/browser management
├── executor/                # primitive browser actions
├── actions/                 # higher-level action library
├── planner/                 # LLM-backed instruction planner
├── llm/                     # OpenAI client wrapper
├── seek/                    # SEEK job extractor + SQLite cache + CLI
├── profile/                 # profile.md → profile.json distiller + CLI
├── application/             # job + profile → resume/cover-letter/brief/interview chain + CLI
└── singletons.ts
doc/profile/                 # personal profile drafts (gitignored)
profile/                     # canonical profile.md / profile.json (gitignored)
output/                      # generated applications (gitignored)
data/                        # SQLite caches (gitignored)
```

## End-to-end example

```bash
# 1. one-time setup
npm install
npx playwright install chromium
cp .env.example .env && $EDITOR .env             # set OPENAI_API_KEY

# 2. write your profile
mkdir -p profile && $EDITOR profile/profile.md

# 3. apply to a job
npm run apply -- https://www.seek.com.au/job/12345678

# resume + cover letter + brief + interview pack now live in
# output/<today>-<company>-<title>/
```
