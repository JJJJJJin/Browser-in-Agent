import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { extractSeekJob } from '../seek/SeekJobExtractor.js';
import { SeekJobStore } from '../seek/SeekJobStore.js';
import { browserManager } from '../singletons.js';

const ExtractRequestSchema = z.object({
  url: z.string().url().refine((u) => /seek\.com/i.test(u), { message: 'URL must be a SEEK job URL' }),
  sessionId: z.string().min(1).optional(),
  noLlm: z.boolean().optional(),
  noStore: z.boolean().optional(),
});

let storeSingleton: SeekJobStore | null = null;
function getStore(): SeekJobStore {
  if (!storeSingleton) storeSingleton = new SeekJobStore();
  return storeSingleton;
}

export async function registerSeekRoutes(app: FastifyInstance) {
  app.addHook('onClose', async () => {
    storeSingleton?.close();
    storeSingleton = null;
  });

  app.post('/v1/seek/extract', async (req, reply) => {
    const parsed = ExtractRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    }

    const { url, sessionId, noLlm, noStore } = parsed.data;
    const session = await browserManager.getOrCreateSession({ sessionId });
    const job = await extractSeekJob(session.page, url, { noLlm: noLlm ?? false });

    if (!noStore) getStore().upsert(job);

    return reply.send({ ok: true, job });
  });

  app.get('/v1/seek/jobs', async (req, reply) => {
    const limitRaw = (req.query as { limit?: string }).limit;
    const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 50, 1), 500) : 50;
    return reply.send({ jobs: getStore().list(limit) });
  });

  app.get('/v1/seek/jobs/:jobId', async (req, reply) => {
    const jobId = (req.params as { jobId?: string }).jobId;
    if (!jobId) return reply.status(400).send({ error: 'invalid_request' });
    const job = getStore().get(jobId);
    if (!job) return reply.status(404).send({ error: 'not_found' });
    return reply.send({ job });
  });
}
