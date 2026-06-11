import type { Page } from 'playwright';

import type { Logger } from '../logger.js';
import type { RefRegistry } from '../perception/RefRegistry.js';

export type ActionKind =
  | 'click'
  | 'type'
  | 'hover'
  | 'clear'
  | 'scroll'
  | 'select_option'
  | 'press_key';

/** Everything an Action needs to operate on a single page. */
export type ActionContext = {
  page: Page;
  refs: RefRegistry;
  logger: Logger;
};

/** Result of running a single action (the Executor pairs this with a fresh snapshot). */
export type ActionOutcome = {
  ok: boolean;
  kind: ActionKind;
  durationMs: number;
  details?: Record<string, unknown>;
  error?: { name: string; message: string };
};
