import { VisionNotConfiguredError } from '../errors.js';
import type { VisionConfig } from '../config/Config.js';
import type { VisionProvider } from './VisionProvider.js';
import { KimiProvider } from './KimiProvider.js';

/** Provider names this server can construct. */
const SUPPORTED_PROVIDERS = ['kimi'] as const;

/**
 * Build a VisionProvider from config (DESIGN.md §5.8).
 * Returns undefined when no vision config was supplied (vision is optional).
 * Throws for an unknown/unsupported provider name.
 */
export function createVisionProvider(cfg?: VisionConfig): VisionProvider | undefined {
  if (!cfg) return undefined;

  switch (cfg.provider) {
    case 'kimi':
      return new KimiProvider(cfg);
    default:
      throw new Error(
        `Unknown vision provider '${cfg.provider}'. Supported providers: ${SUPPORTED_PROVIDERS.join(', ')}.`,
      );
  }
}

/**
 * Assert a vision provider is configured before using it.
 * Throws VisionNotConfiguredError (mapped to a tool error) when undefined.
 */
export function requireVisionProvider(provider: VisionProvider | undefined): VisionProvider {
  if (!provider) {
    throw new VisionNotConfiguredError(
      'No vision provider is configured. Configure a vision API key via CLI (--vision-provider kimi --vision-api-key <key>) or env (VISION_PROVIDER, VISION_API_KEY) before using vision_query.',
    );
  }
  return provider;
}
