import { Action } from './Action.js';
import type { ActionContext, ActionKind } from './types.js';

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Press a keyboard key. fieldVariables: { key, ref? }.
 * - With `ref`: focuses that element and presses the key on it.
 * - Without `ref`: presses on the page's active focus via keyboard.
 */
export class PressKeyAction extends Action {
  readonly kind: ActionKind = 'press_key';

  constructor(
    private readonly key: string,
    private readonly ref?: string,
  ) {
    super();
  }

  protected async runInternal(
    ctx: ActionContext,
  ): Promise<Record<string, unknown>> {
    if (this.ref !== undefined) {
      const d = ctx.refs.resolve(this.ref);
      const locator = ctx.page.locator(d.selector).nth(d.domIndex);
      await locator.press(this.key, { timeout: DEFAULT_TIMEOUT_MS });
      return { key: this.key, ref: this.ref, role: d.role, name: d.name };
    }
    await ctx.page.keyboard.press(this.key);
    return { key: this.key };
  }
}
