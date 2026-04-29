import type { FastifyInstance } from 'fastify';

import {
  ensureStructuredProfile,
  getProfilePaths,
  ProfileNotFoundError,
  readStructuredProfile,
} from '../profile/ProfileStore.js';

export async function registerProfileRoutes(app: FastifyInstance) {
  app.get('/v1/profile', async (_req, reply) => {
    const profile = readStructuredProfile();
    if (!profile) {
      return reply
        .status(404)
        .send({ error: 'profile_not_distilled', paths: getProfilePaths(), hint: 'POST /v1/profile/distill first' });
    }
    return reply.send({ profile });
  });

  app.post('/v1/profile/distill', async (req, reply) => {
    const force = (req.body as { force?: boolean } | undefined)?.force ?? false;
    try {
      const profile = await ensureStructuredProfile({ force });
      return reply.send({ ok: true, profile });
    } catch (err) {
      if (err instanceof ProfileNotFoundError) {
        return reply.status(404).send({ error: 'profile_markdown_missing', message: err.message, paths: getProfilePaths() });
      }
      throw err;
    }
  });
}
