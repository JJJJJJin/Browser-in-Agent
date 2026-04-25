import { z } from 'zod';

import { AssertAction } from './AssertAction.js';
import { BaseAction } from './BaseAction.js';
import { ClickAction } from './ClickAction.js';
import { ScrollAction } from './ScrollAction.js';
import { TypeAction } from './TypeAction.js';
import { WaitAction } from './WaitAction.js';
import { ActionSpecSchema, type ActionSpec, type ActionType } from './types.js';

type ActionCtor = new (spec: ActionSpec) => BaseAction;

const registry: Record<ActionType, ActionCtor> = {
  click: ClickAction,
  type: TypeAction,
  scroll: ScrollAction,
  wait: WaitAction,
  assert: AssertAction,
};

export const ActionPlanSchema = z.object({
  goal: z.string().min(1).optional(),
  actions: z.array(ActionSpecSchema),
  assumptions: z.array(z.string()).optional(),
  needsMoreInfo: z.array(z.object({ question: z.string().min(1) })).optional(),
});

export type ActionPlan = z.infer<typeof ActionPlanSchema>;

export function actionFromSpec(spec: ActionSpec): BaseAction {
  const ctor = registry[spec.type];
  return new ctor(spec);
}

export function actionsFromPlan(plan: ActionPlan): BaseAction[] {
  return plan.actions.map(actionFromSpec);
}

