import { z } from 'zod';

import { BaseAction, type ExecutionContext } from './BaseAction.js';
import type { ActionSpec } from './types.js';

const WaitFieldVariablesSchema = z.object({
  timeoutMs: z.number().int().positive().optional(),
  selector: z.string().min(1).optional(),
  state: z.enum(['attached', 'detached', 'visible', 'hidden']).optional(),
});

type WaitFieldVariables = z.infer<typeof WaitFieldVariablesSchema>;

export class WaitAction extends BaseAction<WaitFieldVariables> {
  static type = 'wait' as const;

  constructor(spec: ActionSpec) {
    super(spec);
    this.fieldVariables = WaitFieldVariablesSchema.parse(this.fieldVariables);
  }

  protected async runInternal(ctx: ExecutionContext) {
    const { timeoutMs, selector, state } = this.fieldVariables;
    const timeout = timeoutMs ?? 3000;

    if (selector) {
      await ctx.page.locator(selector).first().waitFor({ timeout, state: state ?? 'visible' });
      return { selector, state: state ?? 'visible', timeoutMs: timeout };
    }

    await ctx.page.waitForTimeout(timeout);
    return { timeoutMs: timeout };
  }
}

