/**
 * Runtime configuration, resolved from CLI flags (priority) then env vars.
 *
 *   browser-mcp --port 7777 --headless \
 *     --vision-provider kimi --vision-api-key sk-xxx \
 *     --vision-model moonshot-v1-8k-vision-preview \
 *     --guidelines ./guidelines
 */
import type { BrowserLaunchConfig } from '../browser/BrowserManager.js';

export type VisionConfig = {
  provider: string;
  apiKey: string;
  model?: string;
  baseUrl?: string;
};

export type Config = {
  port: number;
  headless: boolean;
  /** How browsers are launched: Playwright-bundled or a system-installed browser. */
  browser: BrowserLaunchConfig;
  /** Present only when a vision provider + api key were supplied. */
  vision?: VisionConfig;
  guidelinesDir: string;
};

export const DEFAULTS = {
  port: 7777,
  headless: true,
  guidelinesDir: './guidelines',
  browserSource: 'playwright',
  systemBrowser: 'chrome',
} as const;

/**
 * Parse argv (process.argv.slice(2)) and env into a Config.
 * Implemented by the foundation; see docs/System_Architecture.md §8.
 */
export function loadConfig(argv: string[], env: NodeJS.ProcessEnv): Config {
  const flags = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg || !arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags.set(key, true); // boolean flag, e.g. --headless
    } else {
      flags.set(key, next);
      i++;
    }
  }

  const str = (flag: string, envKey: string): string | undefined => {
    const v = flags.get(flag);
    if (typeof v === 'string') return v;
    return env[envKey];
  };

  const port = Number(str('port', 'PORT') ?? DEFAULTS.port) || DEFAULTS.port;

  const headlessFlag = flags.get('headless');
  const headlessEnv = env.HEADLESS;
  const headless =
    headlessFlag === true
      ? true
      : headlessFlag === 'false'
        ? false
        : headlessEnv !== undefined
          ? headlessEnv !== 'false'
          : DEFAULTS.headless;

  const guidelinesDir = str('guidelines', 'GUIDELINES_DIR') ?? DEFAULTS.guidelinesDir;

  // ---- Browser source ---------------------------------------------------
  const sourceRaw = (str('browser-source', 'BROWSER_SOURCE') ?? DEFAULTS.browserSource).toLowerCase();
  const source = sourceRaw === 'system' ? 'system' : 'playwright';

  const sysRaw = (str('system-browser', 'SYSTEM_BROWSER') ?? DEFAULTS.systemBrowser).toLowerCase();
  const systemBrowser = sysRaw === 'firefox' ? 'firefox' : 'chrome';

  const systemBrowserPath = str('system-browser-path', 'SYSTEM_BROWSER_PATH');

  const browser: BrowserLaunchConfig = {
    source,
    systemBrowser,
    ...(systemBrowserPath ? { systemBrowserPath } : {}),
  };

  const provider = str('vision-provider', 'VISION_PROVIDER');
  const apiKey = str('vision-api-key', 'VISION_API_KEY');
  const vision: VisionConfig | undefined =
    provider && apiKey
      ? {
          provider,
          apiKey,
          model: str('vision-model', 'VISION_MODEL'),
          baseUrl: str('vision-base-url', 'VISION_BASE_URL'),
        }
      : undefined;

  return { port, headless, browser, vision, guidelinesDir };
}
