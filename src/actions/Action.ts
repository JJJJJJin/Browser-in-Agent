import type { ActionContext, ActionKind, ActionOutcome } from './types.js';

/**
 * Abstract atomic action. Subclasses implement `runInternal`; `start` wraps it
 * with timing, logging and error capture so the Executor always gets a uniform
 * ActionOutcome (it never throws for an action-level failure).
 *
 * Element targeting: subclasses resolve `ref` via `ctx.refs.resolve(ref)` to get
 * an ElementDescriptor, then operate with `ctx.page.locator(d.selector).nth(d.domIndex)`.
 */
export abstract class Action {
  abstract readonly kind: ActionKind;

  protected abstract runInternal(
    ctx: ActionContext,
  ): Promise<Record<string, unknown> | void>;

  async start(ctx: ActionContext): Promise<ActionOutcome> {
    const started = Date.now();
    ctx.logger.info({ kind: this.kind }, 'action.start');
    try {
      const details = (await this.runInternal(ctx)) ?? {};
      const durationMs = Date.now() - started;
      ctx.logger.info({ kind: this.kind, durationMs }, 'action.success');
      return { ok: true, kind: this.kind, durationMs, details };
    } catch (err) {
      const durationMs = Date.now() - started;
      const e = err as Error;
      ctx.logger.error(
        { kind: this.kind, durationMs, err: { name: e.name, message: e.message } },
        'action.failed',
      );
      return {
        ok: false,
        kind: this.kind,
        durationMs,
        error: { name: e.name, message: e.message },
      };
    }
  }
}
