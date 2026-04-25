import { z } from 'zod';

export const ActionTypeSchema = z.enum(['click', 'type', 'scroll', 'wait', 'assert']);
export type ActionType = z.infer<typeof ActionTypeSchema>;

export const ActionSpecSchema = z.object({
  id: z.string().min(1),
  type: ActionTypeSchema,
  fieldVariables: z.record(z.string(), z.unknown()).default({}),
});

export type ActionSpec = z.infer<typeof ActionSpecSchema>;

export type ActionResult =
  | {
      ok: true;
      actionId: string;
      type: ActionType;
      startedAt: string;
      finishedAt: string;
      durationMs: number;
      details?: Record<string, unknown>;
    }
  | {
      ok: false;
      actionId: string;
      type: ActionType;
      startedAt: string;
      finishedAt: string;
      durationMs: number;
      error: { message: string; name?: string };
      details?: Record<string, unknown>;
    };

