import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import type { Request, Response } from 'express';

import { BrowserManager } from './browser/BrowserManager.js';
import { loadConfig } from './config/Config.js';
import { Executor } from './executor/Executor.js';
import { GuidelineStore } from './guidelines/GuidelineStore.js';
import { createLogger } from './logger.js';
import { PageDistiller } from './perception/PageDistiller.js';
import { PageReader } from './perception/PageReader.js';
import { BrowserRouter } from './router/BrowserRouter.js';
import { SessionRegistry } from './router/SessionRegistry.js';
import { createMcpServerForAgent } from './server/McpServer.js';
import type { McpServerDeps } from './server/McpServer.js';
import { createVisionProvider } from './vision/providerRegistry.js';

async function main(): Promise<void> {
  const config = loadConfig(process.argv.slice(2), process.env);
  const logger = createLogger('server');

  // ---- Singletons -------------------------------------------------------
  const manager = new BrowserManager(logger.child({ scope: 'browser' }));
  const registry = new SessionRegistry(manager, config.headless, logger.child({ scope: 'registry' }));
  const router = new BrowserRouter(registry);
  const distiller = new PageDistiller();
  const reader = new PageReader();
  const executor = new Executor(router, distiller, logger.child({ scope: 'executor' }));
  const vision = createVisionProvider(config.vision);
  const guidelines = new GuidelineStore(config.guidelinesDir);

  const deps: McpServerDeps = {
    router,
    executor,
    distiller,
    reader,
    vision,
    guidelines,
    logger,
    headless: config.headless,
  };

  // ---- Per-session transport table (multi-session Streamable HTTP) ------
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const app = express();
  app.use(express.json({ limit: '8mb' }));

  // POST /mcp — initialize a new session or dispatch to an existing one.
  app.post('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'];
    const sid = typeof sessionId === 'string' ? sessionId : undefined;

    let transport: StreamableHTTPServerTransport | undefined = sid
      ? transports.get(sid)
      : undefined;

    if (!transport && sid === undefined && isInitializeRequest(req.body)) {
      // New session: we generate the id ourselves so we can bind it into the
      // per-agent MCP server BEFORE connecting. The sessionId IS the agentId.
      const agentId = randomUUID();
      const newTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => agentId,
        onsessioninitialized: (newSessionId: string) => {
          transports.set(newSessionId, newTransport);
          logger.info({ agentId: newSessionId }, 'session.initialized');
        },
      });

      newTransport.onclose = () => {
        transports.delete(agentId);
        void registry
          .closeAgent(agentId)
          .catch((err) => logger.error({ err: (err as Error).message }, 'session.close.error'));
        logger.info({ agentId }, 'session.closed');
      };

      const agentServer = createMcpServerForAgent(agentId, deps);
      await agentServer.connect(newTransport);
      await newTransport.handleRequest(req, res, req.body);
      return;
    }

    if (!transport) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'No valid session. Send an initialize request first.' },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  });

  // GET /mcp — server-to-client SSE stream for an existing session.
  app.get('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'];
    const sid = typeof sessionId === 'string' ? sessionId : undefined;
    const transport = sid ? transports.get(sid) : undefined;
    if (!transport) {
      res.status(400).send('Invalid or missing session id');
      return;
    }
    await transport.handleRequest(req, res);
  });

  // DELETE /mcp — explicit session termination.
  app.delete('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'];
    const sid = typeof sessionId === 'string' ? sessionId : undefined;
    const transport = sid ? transports.get(sid) : undefined;
    if (!transport) {
      res.status(400).send('Invalid or missing session id');
      return;
    }
    await transport.handleRequest(req, res);
    if (sid) {
      transports.delete(sid);
      await registry.closeAgent(sid).catch((err) => {
        logger.error({ err: (err as Error).message }, 'session.delete.close.error');
      });
    }
  });

  const httpServer = app.listen(config.port, () => {
    logger.info(
      { port: config.port, headless: config.headless, vision: vision?.name ?? 'none' },
      'server.listening',
    );
  });

  // Surface bind failures clearly. Without this, an EADDRINUSE error is emitted
  // a tick after the (misleading) 'server.listening' log, and the process dies
  // silently — making a port collision look like a clean start that vanished.
  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(
        { port: config.port },
        'server.port_in_use',
      );
    } else {
      logger.error({ err: err.message }, 'server.error');
    }
    process.exit(1);
  });

  // ---- Graceful shutdown ------------------------------------------------
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'server.shutdown');
    httpServer.close();
    await Promise.all(
      [...transports.values()].map((t) => t.close().catch(() => undefined)),
    );
    await Promise.all(
      [...transports.keys()].map((agentId) =>
        registry.closeAgent(agentId).catch(() => undefined),
      ),
    );
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('fatal:', err);
  process.exit(1);
});
