/**
 * Runtime configuration, resolved from CLI flags (priority) then env vars.
 *
 *   browser-mcp --port 7777 --headless \
 *     --vision-provider kimi --vision-api-key sk-xxx \
 *     --vision-model moonshot-v1-8k-vision-preview \
 *     --guidelines ./guidelines
 */
export type VisionConfig = {
  provider: string;
  apiKey: string;
  model?: string;
  baseUrl?: string;
};

export type Config = {
  port: number;
  headless: boolean;
  /** Present only when a vision provider + api key were supplied. */
  vision?: VisionConfig;
  guidelinesDir: string;
};

export const DEFAULTS = {
  port: 7777,
  headless: true,
  guidelinesDir: './guidelines',
} as const;

/**
 * Parse argv (process.argv.slice(2)) and env into a Config.
 * Implemented by the foundation; see DESIGN.md §8.
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

  return { port, headless, vision, guidelinesDir };
}
