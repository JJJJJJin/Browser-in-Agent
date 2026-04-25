import type { Logger } from 'pino';
import type { Page } from 'playwright';

import type { BaseAction, ExecutionContext } from '../actions/BaseAction.js';
import type { ActionResult } from '../actions/types.js';

export type ExecutionResult = {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  results: ActionResult[];
};

export class Executor {
  async execute(actions: BaseAction[], deps: { page: Page; logger: Logger }): Promise<ExecutionResult> {
    const started = Date.now();
    const startedAt = new Date(started).toISOString();

    deps.logger.info({ actionCount: actions.length }, 'executor.start');

    const results: ActionResult[] = [];
    const ctx: ExecutionContext = { page: deps.page, logger: deps.logger, variables: {} };

    for (const action of actions) {
      const res = await action.run(ctx);
      results.push(res);
      if (!res.ok) break;
    }

    const finished = Date.now();
    const finishedAt = new Date(finished).toISOString();
    const durationMs = finished - started;
    const ok = results.every((r) => r.ok);

    deps.logger.info({ ok, durationMs }, 'executor.finish');

    return { ok, startedAt, finishedAt, durationMs, results };
  }
}

