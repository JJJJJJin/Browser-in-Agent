import { Action } from './Action.js';
import type { ActionContext, ActionKind } from './types.js';

const DEFAULT_TIMEOUT_MS = 15_000;

/** Click an element resolved from a snapshot ref. fieldVariables: { ref }. */
export class ClickAction extends Action {
  readonly kind: ActionKind = 'click';

  constructor(private readonly ref: string) {
    super();
  }

  protected async runInternal(
    ctx: ActionContext,
  ): Promise<Record<string, unknown>> {
    const d = ctx.refs.resolve(this.ref);
    const locator = ctx.page.locator(d.selector).nth(d.domIndex);
    await locator.click({ timeout: DEFAULT_TIMEOUT_MS });
    return { ref: this.ref, role: d.role, name: d.name };
  }
}
