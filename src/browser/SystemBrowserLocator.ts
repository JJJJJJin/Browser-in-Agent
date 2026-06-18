import { accessSync, constants } from 'node:fs';

import { createLogger } from '../logger.js';
import type { Logger } from '../logger.js';

/** System browser families the user can opt into. Maps to a Playwright engine. */
export type SystemBrowserName = 'chrome' | 'firefox';

/**
 * Normalised platform identifiers. `process.platform` values are collapsed into
 * these three buckets; Raspberry Pi OS (and other ARM/desktop Linux distros)
 * fall under `linux`.
 */
export type PlatformId = 'mac' | 'win' | 'linux';

/** Map the configured system browser to the Playwright engine that drives it. */
export const SYSTEM_BROWSER_ENGINE: Record<SystemBrowserName, 'chromium' | 'firefox'> = {
  chrome: 'chromium',
  firefox: 'firefox',
};

/** Collapse `process.platform` into a {@link PlatformId}. */
export function currentPlatform(platform: NodeJS.Platform = process.platform): PlatformId {
  switch (platform) {
    case 'darwin':
      return 'mac';
    case 'win32':
      return 'win';
    default:
      // linux, freebsd, openbsd, android … all use the Linux candidate list.
      return 'linux';
  }
}

/**
 * Per-platform, per-browser executable candidates, tried in order. The first
 * path that exists and is executable wins. Adding support for a new browser or
 * OS is just a matter of extending this table — nothing else needs to change.
 *
 * Windows entries interpolate the usual install-root env vars at lookup time so
 * we honour non-default drive letters / localized "Program Files" folders.
 */
type CandidateTable = Record<PlatformId, Record<SystemBrowserName, string[]>>;

function windowsCandidates(env: NodeJS.ProcessEnv): Record<SystemBrowserName, string[]> {
  const programFiles = env.PROGRAMFILES ?? 'C:\\Program Files';
  const programFilesX86 = env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)';
  const localAppData = env.LOCALAPPDATA ?? '';
  return {
    chrome: [
      `${programFiles}\\Google\\Chrome\\Application\\chrome.exe`,
      `${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`,
      localAppData ? `${localAppData}\\Google\\Chrome\\Application\\chrome.exe` : '',
      // Fall back to Edge (Chromium) if Chrome is absent.
      `${programFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${programFilesX86}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ].filter(Boolean),
    firefox: [
      `${programFiles}\\Mozilla Firefox\\firefox.exe`,
      `${programFilesX86}\\Mozilla Firefox\\firefox.exe`,
    ],
  };
}

function buildCandidates(env: NodeJS.ProcessEnv): CandidateTable {
  return {
    mac: {
      chrome: [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      ],
      firefox: ['/Applications/Firefox.app/Contents/MacOS/firefox'],
    },
    win: windowsCandidates(env),
    linux: {
      // Raspberry Pi OS ships Chromium as `chromium-browser`; Debian/Ubuntu use
      // `chromium` or `google-chrome-stable`.
      chrome: [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/snap/bin/chromium',
      ],
      // Raspberry Pi OS / Debian ship Firefox ESR.
      firefox: ['/usr/bin/firefox', '/usr/bin/firefox-esr', '/snap/bin/firefox'],
    },
  };
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves the filesystem path of a system-installed browser, given the user's
 * OS and chosen browser family. Pure lookup logic, no Playwright dependency, so
 * it is trivial to unit-test and to extend with new platforms/browsers.
 */
export class SystemBrowserLocator {
  private readonly logger: Logger;
  private readonly env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv = process.env, logger: Logger = createLogger('locator')) {
    this.env = env;
    this.logger = logger;
  }

  /**
   * Find the executable for `browser` on `platform`.
   *
   * @param explicitPath  If provided, it is validated and returned verbatim —
   *                      a user override always wins over auto-detection.
   * @throws Error with an actionable message when nothing is found.
   */
  locate(
    browser: SystemBrowserName,
    explicitPath?: string,
    platform: PlatformId = currentPlatform(),
  ): string {
    if (explicitPath) {
      if (!isExecutable(explicitPath)) {
        throw new Error(
          `Configured system browser path is not an executable file: ${explicitPath}`,
        );
      }
      this.logger.info({ browser, platform, path: explicitPath }, 'locator.explicit');
      return explicitPath;
    }

    const candidates = buildCandidates(this.env)[platform][browser];
    for (const candidate of candidates) {
      if (isExecutable(candidate)) {
        this.logger.info({ browser, platform, path: candidate }, 'locator.resolved');
        return candidate;
      }
    }

    throw new Error(
      `Could not find a system ${browser} on ${platform}. Looked in: ${candidates.join(
        ', ',
      )}. Install it, or pass --system-browser-path / SYSTEM_BROWSER_PATH to point at the executable.`,
    );
  }
}
