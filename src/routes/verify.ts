import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const VerifyRequestSchema = z.object({
  sessionId: z.string().min(1).optional(),
  url: z.string().url().optional(),
  assertions: z
    .array(
      z.object({
        type: z.enum(['url_contains', 'title_contains', 'text_contains', 'selector_visible']),
        value: z.string().min(1),
      }),
    )
    .min(1),
});

export async function registerVerifyRoutes(app: FastifyInstance) {
  app.post('/v1/verify', async (req, reply) => {
    const parsed = VerifyRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    }

    // MVP placeholder: real verify runs AssertActions against a live page.
    return reply.send({
      ok: true,
      mode: 'placeholder',
      received: parsed.data,
    });
  });
}

