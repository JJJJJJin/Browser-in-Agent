import { z } from 'zod';

import { BaseAction, type ExecutionContext } from './BaseAction.js';
import type { ActionSpec } from './types.js';

const TypeFieldVariablesSchema = z.object({
  selector: z.string().min(1),
  text: z.string(),
  clearFirst: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

type TypeFieldVariables = z.infer<typeof TypeFieldVariablesSchema>;

export class TypeAction extends BaseAction<TypeFieldVariables> {
  static type = 'type' as const;

  constructor(spec: ActionSpec) {
    super(spec);
    this.fieldVariables = TypeFieldVariablesSchema.parse(this.fieldVariables);
  }

  protected async runInternal(ctx: ExecutionContext) {
    const { selector, text, clearFirst, timeoutMs } = this.fieldVariables;
    const timeout = timeoutMs ?? 15_000;

    const loc = ctx.page.locator(selector);
    await loc.first().waitFor({ state: 'visible', timeout });
    await loc.first().click({ timeout });
    if (clearFirst) await loc.first().fill('', { timeout });
    await loc.first().type(text, { timeout });
    return { selector, chars: text.length, clearFirst: !!clearFirst };
  }
}

