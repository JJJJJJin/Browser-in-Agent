import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const CreateJobSchema = z.object({
  instruction: z.string().min(1),
  url: z.string().url().optional(),
  sessionId: z.string().min(1).optional(),
  webhook: z
    .object({
      url: z.string().url(),
      secret: z.string().min(1).optional(),
    })
    .optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

export async function registerJobRoutes(app: FastifyInstance) {
  app.post('/v1/jobs', async (req, reply) => {
    const parsed = CreateJobSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    }

    // MVP placeholder: a real job queue + webhook will be implemented later.
    const jobId = `job_${Date.now()}`;

    return reply.status(202).send({
      jobId,
      status: 'queued',
      received: parsed.data,
    });
  });

  app.get('/v1/jobs/:jobId', async (req, reply) => {
    const jobId = (req.params as { jobId?: string }).jobId;
    if (!jobId) return reply.status(400).send({ error: 'invalid_request' });

    return reply.send({
      jobId,
      status: 'unknown',
      note: 'MVP placeholder; job store not implemented yet.',
    });
  });

  app.post('/v1/jobs/:jobId/cancel', async (req, reply) => {
    const jobId = (req.params as { jobId?: string }).jobId;
    if (!jobId) return reply.status(400).send({ error: 'invalid_request' });
    return reply.send({ jobId, status: 'cancelled', note: 'MVP placeholder.' });
  });

  app.post('/v1/jobs/:jobId/webhook', async (req, reply) => {
    const jobId = (req.params as { jobId?: string }).jobId;
    if (!jobId) return reply.status(400).send({ error: 'invalid_request' });
    return reply.send({ jobId, ok: true, note: 'MVP placeholder.' });
  });
}

