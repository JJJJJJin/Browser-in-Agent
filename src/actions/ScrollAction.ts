import { z } from 'zod';

import { BaseAction, type ExecutionContext } from './BaseAction.js';
import type { ActionSpec } from './types.js';

const ScrollFieldVariablesSchema = z.object({
  deltaY: z.number().optional(),
  to: z.enum(['top', 'bottom']).optional(),
});

type ScrollFieldVariables = z.infer<typeof ScrollFieldVariablesSchema>;

export class ScrollAction extends BaseAction<ScrollFieldVariables> {
  static type = 'scroll' as const;

  constructor(spec: ActionSpec) {
    super(spec);
    this.fieldVariables = ScrollFieldVariablesSchema.parse(this.fieldVariables);
  }

  protected async runInternal(ctx: ExecutionContext) {
    const { deltaY, to } = this.fieldVariables;
    if (to === 'top') {
      await ctx.page.evaluate(() => window.scrollTo(0, 0));
      return { to };
    }
    if (to === 'bottom') {
      await ctx.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      return { to };
    }
    const dy = deltaY ?? 500;
    await ctx.page.mouse.wheel(0, dy);
    return { deltaY: dy };
  }
}

