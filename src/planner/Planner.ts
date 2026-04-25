import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import type { Logger } from 'pino';

import type { PageSnapshot } from '../browser/PageSnapshot.js';
import { ActionPlanSchema, type ActionPlan } from '../actions/registry.js';
import { createOpenAIClient } from '../llm/OpenAIClient.js';

export type PlanRequest = {
  instruction: string;
  snapshot: PageSnapshot;
  skillsPromptAddendum?: string;
};

export class Planner {
  private systemPromptPromise: Promise<string> | null = null;

  private async getSystemPrompt(): Promise<string> {
    if (!this.systemPromptPromise) {
      const here = dirname(fileURLToPath(import.meta.url));
      const p = join(here, 'prompts', 'system.md');
      this.systemPromptPromise = readFile(p, 'utf8');
    }
    return this.systemPromptPromise;
  }

  async plan(req: PlanRequest, logger: Logger): Promise<ActionPlan> {
    const client = createOpenAIClient();
    const model = process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';
    const system = await this.getSystemPrompt();

    const user = {
      instruction: req.instruction,
      snapshot: req.snapshot,
      skills: req.skillsPromptAddendum ?? '',
    };

    logger.info({ model }, 'planner.request');

    // Use Chat Completions with JSON-only instruction; we validate via zod.
    const resp = await client.chat.completions.create({
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(user) },
      ],
    });

    const content = resp.choices[0]?.message?.content ?? '';
    logger.info({ contentLength: content.length }, 'planner.response');

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(content);
    } catch {
      // retry once with a "repair" prompt
      logger.warn({ contentPreview: content.slice(0, 400) }, 'planner.json_parse_failed_retrying');
      const repair = await client.chat.completions.create({
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: 'Fix the following into valid JSON only. Do not add explanations.' },
          { role: 'user', content },
        ],
      });
      const repaired = repair.choices[0]?.message?.content ?? '';
      parsedJson = JSON.parse(repaired);
    }

    const validated = ActionPlanSchema.safeParse(parsedJson);
    if (!validated.success) {
      logger.error({ issues: validated.error.issues }, 'planner.schema_validation_failed');
      throw new Error('Planner output failed schema validation');
    }

    return validated.data;
  }
}

