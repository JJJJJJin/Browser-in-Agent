import { Action } from './Action.js';
import type { ActionContext, ActionKind } from './types.js';

const DEFAULT_DELTA_Y = 600;

/**
 * Scroll the page. fieldVariables: { deltaY?, to? }.
 * - `to: 'top' | 'bottom'` jumps to the page extremes.
 * - otherwise scrolls by `deltaY` (defaults to a viewport-ish step).
 * No ref required — scroll targets the page, not an element.
 */
export class ScrollAction extends Action {
  readonly kind: ActionKind = 'scroll';

  constructor(
    private readonly deltaY?: number,
    private readonly to?: 'top' | 'bottom',
  ) {
    super();
  }

  protected async runInternal(
    ctx: ActionContext,
  ): Promise<Record<string, unknown>> {
    if (this.to === 'top') {
      await ctx.page.evaluate(() => window.scrollTo(0, 0));
      return { to: 'top' };
    }
    if (this.to === 'bottom') {
      await ctx.page.evaluate(() =>
        window.scrollTo(0, document.documentElement.scrollHeight),
      );
      return { to: 'bottom' };
    }
    const delta = this.deltaY ?? DEFAULT_DELTA_Y;
    await ctx.page.mouse.wheel(0, delta);
    return { deltaY: delta };
  }
}
