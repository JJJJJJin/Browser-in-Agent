import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

import { createLogger } from '../logger.js';

const log = createLogger('browser');

export type BrowserSession = {
  sessionId: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
};

type CreateOrGetOptions = {
  sessionId?: string;
  headless?: boolean;
};

export class BrowserManager {
  private sessions = new Map<string, BrowserSession>();

  async getOrCreateSession(opts: CreateOrGetOptions = {}): Promise<BrowserSession> {
    const sessionId = opts.sessionId ?? `sess_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const existing = this.sessions.get(sessionId);
    if (existing) {
      log.debug({ sessionId }, 'browser: reusing session');
      return existing;
    }

    const headless = opts.headless ?? (process.env.HEADLESS ?? 'true') !== 'false';
    log.info({ sessionId, headless }, 'browser: launching chromium');
    const start = Date.now();
    const browser = await chromium.launch({ headless });
    const context = await browser.newContext();
    const page = await context.newPage();
    log.info({ sessionId, launchMs: Date.now() - start }, 'browser: session ready');

    const session: BrowserSession = { sessionId, browser, context, page };
    this.sessions.set(sessionId, session);
    return session;
  }

  async closeSession(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    log.info({ sessionId }, 'browser: closing session');
    this.sessions.delete(sessionId);
    await s.context.close().catch(() => undefined);
    await s.browser.close().catch(() => undefined);
  }

  async closeAll(): Promise<void> {
    const ids = [...this.sessions.keys()];
    if (ids.length === 0) return;
    log.debug({ count: ids.length }, 'browser: closing all sessions');
    await Promise.all(ids.map((id) => this.closeSession(id)));
  }
}

