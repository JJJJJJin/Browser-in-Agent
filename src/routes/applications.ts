import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ApplicationStore } from '../application/ApplicationStore.js';
import { runApplicationChain } from '../application/ApplicationChain.js';
import { ensureStructuredProfile, ProfileNotFoundError } from '../profile/ProfileStore.js';
import { extractSeekJob } from '../seek/SeekJobExtractor.js';
import { SeekJobStore } from '../seek/SeekJobStore.js';
import type { SeekJob } from '../seek/types.js';
import { browserManager } from '../singletons.js';

const GenerateRequestSchema = z
  .object({
    jobId: z.string().min(1).optional(),
    url: z.string().url().optional(),
    reextract: z.boolean().optional(),
    forceProfile: z.boolean().optional(),
    sessionId: z.string().min(1).optional(),
  })
  .refine((d) => d.jobId || d.url, { message: 'Provide jobId or url' });

let appStore: ApplicationStore | null = null;
function getAppStore(): ApplicationStore {
  if (!appStore) appStore = new ApplicationStore();
  return appStore;
}

let seekStore: SeekJobStore | null = null;
function getSeekStore(): SeekJobStore {
  if (!seekStore) seekStore = new SeekJobStore();
  return seekStore;
}

async function loadOrFetchJob(input: { jobId?: string; url?: string; reextract?: boolean; sessionId?: string }): Promise<SeekJob> {
  const store = getSeekStore();
  if (!input.reextract) {
    const cached = input.jobId ? store.get(input.jobId) : input.url ? store.getByUrl(input.url) : null;
    if (cached) return cached;
  }
  if (!input.url) {
    throw new Error(`No cached job for jobId "${input.jobId}". Provide url or call /v1/seek/extract first.`);
  }
  const session = await browserManager.getOrCreateSession({ sessionId: input.sessionId });
  const job = await extractSeekJob(session.page, input.url);
  store.upsert(job);
  return job;
}

export async function registerApplicationRoutes(app: FastifyInstance) {
  app.addHook('onClose', async () => {
    appStore?.close();
    seekStore?.close();
    appStore = null;
    seekStore = null;
  });

  app.post('/v1/applications/generate', async (req, reply) => {
    const parsed = GenerateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    }

    let profile;
    try {
      profile = await ensureStructuredProfile({ force: parsed.data.forceProfile ?? false });
    } catch (err) {
      if (err instanceof ProfileNotFoundError) {
        return reply.status(412).send({ error: 'profile_missing', message: err.message });
      }
      throw err;
    }

    const job = await loadOrFetchJob(parsed.data);
    const application = await runApplicationChain(job, profile, { logger: app.log });
    const files = getAppStore().upsert(application);
    return reply.send({ ok: true, application, files });
  });

  app.get('/v1/applications', async (req, reply) => {
    const limitRaw = (req.query as { limit?: string }).limit;
    const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 50, 1), 500) : 50;
    return reply.send({ applications: getAppStore().list(limit) });
  });

  app.get('/v1/applications/:jobId', async (req, reply) => {
    const jobId = (req.params as { jobId?: string }).jobId;
    if (!jobId) return reply.status(400).send({ error: 'invalid_request' });
    const application = getAppStore().get(jobId);
    if (!application) return reply.status(404).send({ error: 'not_found' });
    return reply.send({ application });
  });
}
