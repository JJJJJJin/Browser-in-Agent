import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { snapshotPage } from '../browser/PageSnapshot.js';
import { actionsFromPlan } from '../actions/registry.js';
import { browserManager, executor, planner } from '../singletons.js';

const ExecuteRequestSchema = z.object({
  instruction: z.string().min(1),
  url: z.string().url().optional(),
  sessionId: z.string().min(1).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

export async function registerExecuteRoutes(app: FastifyInstance) {
  app.addHook('onClose', async () => {
    await browserManager.closeAll();
  });

  app.post('/v1/execute', async (req, reply) => {
    const parsed = ExecuteRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'invalid_request',
        issues: parsed.error.issues,
      });
    }

    const { url, sessionId, instruction } = parsed.data;
    const session = await browserManager.getOrCreateSession({ sessionId });
    if (url) await session.page.goto(url, { waitUntil: 'domcontentloaded' });

    const snapshot = await snapshotPage(session.page);
    const plan = await planner.plan({ instruction, snapshot }, app.log);
    const actions = actionsFromPlan(plan);
    const executionResult = await executor.execute(actions, { page: session.page, logger: app.log });
    return reply.send({
      ok: true,
      sessionId: session.sessionId,
      url: session.page.url(),
      snapshot,
      plan,
      executionResult,
    });
  });
}

