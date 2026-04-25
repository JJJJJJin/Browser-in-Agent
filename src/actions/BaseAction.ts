import type { Page } from 'playwright';
import type { Logger } from 'pino';

import type { ActionResult, ActionSpec, ActionType } from './types.js';

export type ExecutionContext = {
  page: Page;
  logger: Logger;
  variables: Record<string, unknown>;
};

export abstract class BaseAction<TFieldVariables extends Record<string, unknown> = Record<string, unknown>> {
  readonly id: string;
  readonly type: ActionType;
  fieldVariables: TFieldVariables;

  protected constructor(spec: ActionSpec) {
    this.id = spec.id;
    this.type = spec.type;
    this.fieldVariables = (spec.fieldVariables ?? {}) as TFieldVariables;
  }

  protected abstract runInternal(ctx: ExecutionContext): Promise<Record<string, unknown> | void>;

  async run(ctx: ExecutionContext): Promise<ActionResult> {
    const started = Date.now();
    const startedAt = new Date(started).toISOString();

    ctx.logger.info(
      {
        actionId: this.id,
        actionType: this.type,
        fieldVariables: this.fieldVariables,
      },
      'action.start',
    );

    try {
      const details = (await this.runInternal(ctx)) ?? {};
      const finished = Date.now();
      const finishedAt = new Date(finished).toISOString();
      const durationMs = finished - started;

      ctx.logger.info(
        { actionId: this.id, actionType: this.type, durationMs, details },
        'action.success',
      );

      return {
        ok: true,
        actionId: this.id,
        type: this.type,
        startedAt,
        finishedAt,
        durationMs,
        details,
      };
    } catch (err) {
      const finished = Date.now();
      const finishedAt = new Date(finished).toISOString();
      const durationMs = finished - started;
      const e = err as Error;

      ctx.logger.error(
        {
          actionId: this.id,
          actionType: this.type,
          durationMs,
          err: { name: e.name, message: e.message, stack: e.stack },
        },
        'action.failed',
      );

      return {
        ok: false,
        actionId: this.id,
        type: this.type,
        startedAt,
        finishedAt,
        durationMs,
        error: { name: e.name, message: e.message },
      };
    }
  }
}

