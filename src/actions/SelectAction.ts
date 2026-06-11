import { Action } from './Action.js';
import type { ActionContext, ActionKind } from './types.js';

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Select an <option> in a <select>. fieldVariables: { ref, value?, label? }.
 * At least one of value/label must be provided.
 */
export class SelectAction extends Action {
  readonly kind: ActionKind = 'select_option';

  constructor(
    private readonly ref: string,
    private readonly value?: string,
    private readonly label?: string,
  ) {
    super();
  }

  protected async runInternal(
    ctx: ActionContext,
  ): Promise<Record<string, unknown>> {
    if (this.value === undefined && this.label === undefined) {
      throw new Error('select_option requires either `value` or `label`');
    }
    const d = ctx.refs.resolve(this.ref);
    const locator = ctx.page.locator(d.selector).nth(d.domIndex);
    const selected =
      this.value !== undefined
        ? await locator.selectOption(
            { value: this.value },
            { timeout: DEFAULT_TIMEOUT_MS },
          )
        : await locator.selectOption(
            { label: this.label as string },
            { timeout: DEFAULT_TIMEOUT_MS },
          );
    return {
      ref: this.ref,
      role: d.role,
      name: d.name,
      value: this.value,
      label: this.label,
      selected,
    };
  }
}
