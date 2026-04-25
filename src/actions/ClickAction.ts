import { z } from 'zod';

import { BaseAction, type ExecutionContext } from './BaseAction.js';
import type { ActionSpec } from './types.js';

const ClickFieldVariablesSchema = z.object({
  selector: z.string().min(1).optional(),
  text: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().optional(),
});

type ClickFieldVariables = z.infer<typeof ClickFieldVariablesSchema>;

export class ClickAction extends BaseAction<ClickFieldVariables> {
  static type = 'click' as const;

  constructor(spec: ActionSpec) {
    super(spec);
    this.fieldVariables = ClickFieldVariablesSchema.parse(this.fieldVariables);
  }

  protected async runInternal(ctx: ExecutionContext) {
    const { selector, text, timeoutMs } = this.fieldVariables;
    const timeout = timeoutMs ?? 15_000;

    if (selector) {
      await ctx.page.click(selector, { timeout });
      return { via: 'selector', selector };
    }

    if (text) {
      const locator = ctx.page.getByText(text, { exact: false });
      await locator.first().click({ timeout });
      return { via: 'text', text };
    }

    throw new Error('ClickAction requires fieldVariables.selector or fieldVariables.text');
  }
}

