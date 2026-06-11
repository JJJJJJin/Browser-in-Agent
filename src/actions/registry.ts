import { z } from 'zod';

import { Action } from './Action.js';
import { ClearAction } from './ClearAction.js';
import { ClickAction } from './ClickAction.js';
import { HoverAction } from './HoverAction.js';
import { PressKeyAction } from './PressKeyAction.js';
import { ScrollAction } from './ScrollAction.js';
import { SelectAction } from './SelectAction.js';
import { TypeAction } from './TypeAction.js';
import type { ActionKind } from './types.js';

const refSchema = z.object({ ref: z.string().min(1) });

const typeSchema = z.object({
  ref: z.string().min(1),
  text: z.string(),
  clearFirst: z.boolean().optional(),
});

const scrollSchema = z
  .object({
    deltaY: z.number().optional(),
    to: z.enum(['top', 'bottom']).optional(),
  })
  .strict();

const selectSchema = z
  .object({
    ref: z.string().min(1),
    value: z.string().optional(),
    label: z.string().optional(),
  })
  .refine((v) => v.value !== undefined || v.label !== undefined, {
    message: 'select_option requires either `value` or `label`',
  });

const pressKeySchema = z.object({
  key: z.string().min(1),
  ref: z.string().min(1).optional(),
});

const KNOWN_KINDS: readonly ActionKind[] = [
  'click',
  'type',
  'hover',
  'clear',
  'scroll',
  'select_option',
  'press_key',
];

function isActionKind(kind: string): kind is ActionKind {
  return (KNOWN_KINDS as readonly string[]).includes(kind);
}

/**
 * Build an Action from a kind + raw params. Params are validated with a
 * per-kind zod schema; throws on unknown kind or invalid params.
 */
export function actionFromSpec(
  kind: ActionKind,
  params: Record<string, unknown>,
): Action {
  if (!isActionKind(kind)) {
    throw new Error(`Unknown action kind: ${String(kind)}`);
  }

  switch (kind) {
    case 'click': {
      const { ref } = refSchema.parse(params);
      return new ClickAction(ref);
    }
    case 'type': {
      const { ref, text, clearFirst } = typeSchema.parse(params);
      return new TypeAction(ref, text, clearFirst ?? false);
    }
    case 'hover': {
      const { ref } = refSchema.parse(params);
      return new HoverAction(ref);
    }
    case 'clear': {
      const { ref } = refSchema.parse(params);
      return new ClearAction(ref);
    }
    case 'scroll': {
      const { deltaY, to } = scrollSchema.parse(params);
      return new ScrollAction(deltaY, to);
    }
    case 'select_option': {
      const { ref, value, label } = selectSchema.parse(params);
      return new SelectAction(ref, value, label);
    }
    case 'press_key': {
      const { key, ref } = pressKeySchema.parse(params);
      return new PressKeyAction(key, ref);
    }
    default: {
      // Exhaustiveness guard.
      const _never: never = kind;
      throw new Error(`Unhandled action kind: ${String(_never)}`);
    }
  }
}
