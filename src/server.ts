import 'dotenv/config';
import Fastify from 'fastify';

import { registerApplicationRoutes } from './routes/applications.js';
import { registerExecuteRoutes } from './routes/execute.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerProfileRoutes } from './routes/profile.js';
import { registerSeekRoutes } from './routes/seek.js';
import { registerVerifyRoutes } from './routes/verify.js';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
  },
});

app.get('/healthz', async () => ({ ok: true }));

await registerExecuteRoutes(app);
await registerJobRoutes(app);
await registerSeekRoutes(app);
await registerProfileRoutes(app);
await registerApplicationRoutes(app);
await registerVerifyRoutes(app);

const port = Number(process.env.PORT ?? '3000');
const host = process.env.HOST ?? '127.0.0.1';

try {
  await app.listen({ port, host });
  app.log.info({ host, port }, 'AutoBrowser server listening');
} catch (err) {
  app.log.error({ err }, 'Failed to start server');
  process.exit(1);
}

