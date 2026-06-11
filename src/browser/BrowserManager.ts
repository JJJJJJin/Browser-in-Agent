import { chromium, firefox } from 'playwright';
import type { Browser, BrowserContext } from 'playwright';

import { createLogger } from '../logger.js';
import type { Logger } from '../logger.js';

/** Supported Playwright browser engines. */
export type Engine = 'chromium' | 'firefox';

/**
 * Thin wrapper over Playwright engine launchers. It only knows how to launch a
 * browser + a fresh context for a given engine; all session/ownership
 * bookkeeping lives in SessionRegistry.
 */
export class BrowserManager {
  private readonly logger: Logger;

  constructor(logger: Logger = createLogger('browser')) {
    this.logger = logger;
  }

  /** Launch a browser of the requested engine and open a fresh context. */
  async launch(
    engine: Engine,
    headless: boolean,
  ): Promise<{ browser: Browser; context: BrowserContext }> {
    const launcher = engine === 'firefox' ? firefox : chromium;
    this.logger.info({ engine, headless }, 'browser.launch');
    const browser = await launcher.launch({ headless });
    const context = await browser.newContext();
    this.logger.info({ engine }, 'browser.launched');
    return { browser, context };
  }
}
