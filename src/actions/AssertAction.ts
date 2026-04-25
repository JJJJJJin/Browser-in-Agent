import { z } from 'zod';

import { BaseAction, type ExecutionContext } from './BaseAction.js';
import type { ActionSpec } from './types.js';

const AssertFieldVariablesSchema = z.object({
  kind: z.enum(['url_contains', 'title_contains', 'text_contains', 'selector_visible']),
  value: z.string().min(1),
  timeoutMs: z.number().int().positive().optional(),
});

type AssertFieldVariables = z.infer<typeof AssertFieldVariablesSchema>;

export class AssertAction extends BaseAction<AssertFieldVariables> {
  static type = 'assert' as const;

  constructor(spec: ActionSpec) {
    super(spec);
    this.fieldVariables = AssertFieldVariablesSchema.parse(this.fieldVariables);
  }

  protected async runInternal(ctx: ExecutionContext) {
    const { kind, value, timeoutMs } = this.fieldVariables;
    const timeout = timeoutMs ?? 10_000;

    if (kind === 'url_contains') {
      const url = ctx.page.url();
      if (!url.includes(value)) throw new Error(`Assert failed: url does not include "${value}"`);
      return { kind, value, actual: url };
    }

    if (kind === 'title_contains') {
      const title = await ctx.page.title();
      if (!title.includes(value)) throw new Error(`Assert failed: title does not include "${value}"`);
      return { kind, value, actual: title };
    }

    if (kind === 'text_contains') {
      await ctx.page.getByText(value, { exact: false }).first().waitFor({ state: 'visible', timeout });
      return { kind, value };
    }

    if (kind === 'selector_visible') {
      await ctx.page.locator(value).first().waitFor({ state: 'visible', timeout });
      return { kind, selector: value };
    }

    return { kind, value };
  }
}

