import { randomUUID } from 'node:crypto';

import type { Browser, BrowserContext, Page } from 'playwright';

import { BrowserManager } from '../browser/BrowserManager.js';
import type { Engine } from '../browser/BrowserManager.js';
import { NotFoundError, OwnershipError } from '../errors.js';
import { createLogger } from '../logger.js';
import type { Logger } from '../logger.js';
import { RefRegistry } from '../perception/RefRegistry.js';

/** A single open tab, owned by exactly one agent + browser. Carries its own RefRegistry. */
export type PageRecord = {
  pageId: string;
  browserId: string;
  agentId: string;
  page: Page;
  refs: RefRegistry;
};

/** A launched browser instance + context, owned by exactly one agent. */
export type BrowserRecord = {
  browserId: string;
  agentId: string;
  engine: Engine;
  browser: Browser;
  context: BrowserContext;
};

/**
 * In-process handle table: agentId → browsers → pages. Enforces ownership on
 * every lookup so concurrent agents stay isolated. Designed behind a small
 * interface so a multi-process (e.g. Redis) backend can replace it later.
 */
export class SessionRegistry {
  private readonly browsers = new Map<string, BrowserRecord>();
  private readonly pages = new Map<string, PageRecord>();
  private browserCounter = 0;
  private pageCounter = 0;
  private readonly logger: Logger;

  constructor(
    private readonly manager: BrowserManager,
    private readonly headless: boolean,
    logger: Logger = createLogger('registry'),
  ) {
    this.logger = logger;
  }

  /** Launch a new browser for an agent and register it. */
  async createBrowser(agentId: string, engine: Engine): Promise<BrowserRecord> {
    const { browser, context } = await this.manager.launch(engine, this.headless);
    const browserId = `br_${++this.browserCounter}_${randomUUID().slice(0, 8)}`;
    const record: BrowserRecord = { browserId, agentId, engine, browser, context };
    this.browsers.set(browserId, record);
    this.logger.info({ agentId, browserId, engine }, 'browser.create');
    return record;
  }

  /** Open a new page (tab) inside one of the agent's browsers. */
  async createPage(agentId: string, browserId: string): Promise<PageRecord> {
    const browserRecord = this.getBrowser(agentId, browserId);
    const page = await browserRecord.context.newPage();
    const pageId = `pg_${++this.pageCounter}_${randomUUID().slice(0, 8)}`;
    const record: PageRecord = {
      pageId,
      browserId,
      agentId,
      page,
      refs: new RefRegistry(),
    };
    this.pages.set(pageId, record);
    this.logger.info({ agentId, browserId, pageId }, 'page.create');
    return record;
  }

  /** Resolve a page, enforcing existence + ownership. */
  getPage(agentId: string, pageId: string): PageRecord {
    const record = this.pages.get(pageId);
    if (!record) {
      throw new NotFoundError(`page not found: ${pageId}`);
    }
    if (record.agentId !== agentId) {
      throw new OwnershipError(`page ${pageId} does not belong to this agent`);
    }
    return record;
  }

  /** Resolve a browser, enforcing existence + ownership. */
  getBrowser(agentId: string, browserId: string): BrowserRecord {
    const record = this.browsers.get(browserId);
    if (!record) {
      throw new NotFoundError(`browser not found: ${browserId}`);
    }
    if (record.agentId !== agentId) {
      throw new OwnershipError(`browser ${browserId} does not belong to this agent`);
    }
    return record;
  }

  /** All browsers owned by an agent. */
  listBrowsers(agentId: string): BrowserRecord[] {
    const out: BrowserRecord[] = [];
    for (const record of this.browsers.values()) {
      if (record.agentId === agentId) out.push(record);
    }
    return out;
  }

  /** All pages of one of the agent's browsers (validates ownership of the browser). */
  listPages(agentId: string, browserId: string): PageRecord[] {
    this.getBrowser(agentId, browserId);
    const out: PageRecord[] = [];
    for (const record of this.pages.values()) {
      if (record.browserId === browserId && record.agentId === agentId) {
        out.push(record);
      }
    }
    return out;
  }

  /** Close and forget a single page. */
  async closePage(agentId: string, pageId: string): Promise<void> {
    const record = this.getPage(agentId, pageId);
    this.pages.delete(pageId);
    try {
      await record.page.close();
    } catch (err) {
      this.logger.warn(
        { pageId, err: (err as Error).message },
        'page.close.error',
      );
    }
    this.logger.info({ agentId, pageId }, 'page.close');
  }

  /** Close a browser and all of its pages. */
  async closeBrowser(agentId: string, browserId: string): Promise<void> {
    const record = this.getBrowser(agentId, browserId);
    this.browsers.delete(browserId);
    for (const [pageId, pageRecord] of this.pages) {
      if (pageRecord.browserId === browserId) {
        this.pages.delete(pageId);
      }
    }
    try {
      await record.context.close();
    } catch (err) {
      this.logger.warn(
        { browserId, err: (err as Error).message },
        'browser.context.close.error',
      );
    }
    try {
      await record.browser.close();
    } catch (err) {
      this.logger.warn(
        { browserId, err: (err as Error).message },
        'browser.close.error',
      );
    }
    this.logger.info({ agentId, browserId }, 'browser.close');
  }

  /** Tear down every resource owned by an agent (connection closed / shutdown). */
  async closeAgent(agentId: string): Promise<void> {
    const owned = this.listBrowsers(agentId);
    await Promise.all(
      owned.map((record) => this.closeBrowser(agentId, record.browserId)),
    );
    this.logger.info({ agentId, count: owned.length }, 'agent.close');
  }
}
