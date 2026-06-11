import { Action } from './Action.js';
import type { ActionContext, ActionKind } from './types.js';

const DEFAULT_TIMEOUT_MS = 15_000;

/** Clear the value of an input/textarea. fieldVariables: { ref }. */
export class ClearAction extends Action {
  readonly kind: ActionKind = 'clear';

  constructor(private readonly ref: string) {
    super();
  }

  protected async runInternal(
    ctx: ActionContext,
  ): Promise<Record<string, unknown>> {
    const d = ctx.refs.resolve(this.ref);
    const locator = ctx.page.locator(d.selector).nth(d.domIndex);
    await locator.fill('', { timeout: DEFAULT_TIMEOUT_MS });
    return { ref: this.ref, role: d.role, name: d.name };
  }
}
