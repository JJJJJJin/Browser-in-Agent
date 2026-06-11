import { Action } from './Action.js';
import type { ActionContext, ActionKind } from './types.js';

const DEFAULT_TIMEOUT_MS = 15_000;

/** Type text into an element. fieldVariables: { ref, text, clearFirst? }. */
export class TypeAction extends Action {
  readonly kind: ActionKind = 'type';

  constructor(
    private readonly ref: string,
    private readonly text: string,
    private readonly clearFirst: boolean = false,
  ) {
    super();
  }

  protected async runInternal(
    ctx: ActionContext,
  ): Promise<Record<string, unknown>> {
    const d = ctx.refs.resolve(this.ref);
    const locator = ctx.page.locator(d.selector).nth(d.domIndex);
    if (this.clearFirst) {
      await locator.fill('', { timeout: DEFAULT_TIMEOUT_MS });
    }
    // Use pressSequentially so each keystroke fires real input events, which
    // many widgets (autocomplete, validation) rely on.
    await locator.pressSequentially(this.text, { timeout: DEFAULT_TIMEOUT_MS });
    return {
      ref: this.ref,
      role: d.role,
      name: d.name,
      length: this.text.length,
      clearFirst: this.clearFirst,
    };
  }
}
