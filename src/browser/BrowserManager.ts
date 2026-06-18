import { chromium, firefox } from 'playwright';
import type { Browser, BrowserContext } from 'playwright';

import { createLogger } from '../logger.js';
import type { Logger } from '../logger.js';
import {
  SYSTEM_BROWSER_ENGINE,
  SystemBrowserLocator,
} from './SystemBrowserLocator.js';
import type { SystemBrowserName } from './SystemBrowserLocator.js';

/** Supported Playwright browser engines. */
export type Engine = 'chromium' | 'firefox';

/** Where the browser binary comes from. */
export type BrowserSource = 'playwright' | 'system';

/**
 * How browsers should be launched. Resolved once from config and held by the
 * BrowserManager. In `system` mode we drive the user's installed browser, which
 * sidesteps a class of Playwright-bundled-Chromium fingerprinting signals.
 */
export type BrowserLaunchConfig = {
  source: BrowserSource;
  /** Which system browser to use when `source === 'system'`. */
  systemBrowser: SystemBrowserName;
  /** Explicit executable path override (skips auto-detection). */
  systemBrowserPath?: string;
};

export const DEFAULT_LAUNCH_CONFIG: BrowserLaunchConfig = {
  source: 'playwright',
  systemBrowser: 'chrome',
};

/** Result of a launch: the live handles plus the engine actually used. */
export type LaunchResult = {
  browser: Browser;
  context: BrowserContext;
  /** Effective engine — may differ from the requested one in `system` mode. */
  engine: Engine;
};

/**
 * Thin wrapper over Playwright engine launchers. It knows how to launch a
 * browser + a fresh context, either from Playwright's bundled binaries or from
 * a system-installed browser. All session/ownership bookkeeping lives in
 * SessionRegistry.
 */
export class BrowserManager {
  private readonly logger: Logger;
  private readonly launchConfig: BrowserLaunchConfig;
  private readonly locator: SystemBrowserLocator;

  constructor(
    launchConfig: BrowserLaunchConfig = DEFAULT_LAUNCH_CONFIG,
    locator: SystemBrowserLocator = new SystemBrowserLocator(),
    logger: Logger = createLogger('browser'),
  ) {
    this.launchConfig = launchConfig;
    this.locator = locator;
    this.logger = logger;
  }

  /**
   * Launch a browser + fresh context.
   *
   * @param engine    Engine requested by the agent (Playwright mode only). In
   *                  `system` mode the configured system browser dictates the
   *                  engine, and this hint is ignored (a mismatch is logged).
   * @param headless  Whether to run headless.
   */
  async launch(engine: Engine, headless: boolean): Promise<LaunchResult> {
    if (this.launchConfig.source === 'system') {
      return this.launchSystem(engine, headless);
    }
    return this.launchPlaywright(engine, headless);
  }

  /** Launch a Playwright-bundled browser (the original behaviour). */
  private async launchPlaywright(engine: Engine, headless: boolean): Promise<LaunchResult> {
    const launcher = engine === 'firefox' ? firefox : chromium;
    this.logger.info({ source: 'playwright', engine, headless }, 'browser.launch');
    const browser = await launcher.launch({ headless });
    const context = await browser.newContext();
    this.logger.info({ source: 'playwright', engine }, 'browser.launched');
    return { browser, context, engine };
  }

  /** Launch the user's system-installed browser via `executablePath`. */
  private async launchSystem(requested: Engine, headless: boolean): Promise<LaunchResult> {
    const { systemBrowser, systemBrowserPath } = this.launchConfig;
    const engine = SYSTEM_BROWSER_ENGINE[systemBrowser];
    if (engine !== requested) {
      this.logger.warn(
        { requested, systemBrowser, engine },
        'browser.engine_overridden_by_system',
      );
    }

    const executablePath = this.locator.locate(systemBrowser, systemBrowserPath);
    const launcher = engine === 'firefox' ? firefox : chromium;
    this.logger.info(
      { source: 'system', systemBrowser, engine, executablePath, headless },
      'browser.launch',
    );
    const browser = await launcher.launch({ headless, executablePath });
    const context = await browser.newContext();
    this.logger.info({ source: 'system', systemBrowser, engine }, 'browser.launched');
    return { browser, context, engine };
  }
}
