import { createLogger, type Logger } from '../logger.js';
import { createOpenAIClient } from './OpenAIClient.js';

const log = createLogger('llm');

export type CallJsonOptions = {
  step: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  logger?: Logger;
};

/**
 * Call the OpenAI chat-completions API with JSON response_format and log
 * request size, latency, response size, and token usage at info level.
 */
export async function callOpenAIJson<T>(opts: CallJsonOptions): Promise<T> {
  const stepLog = opts.logger ?? log;
  stepLog.info(
    {
      step: opts.step,
      model: opts.model,
      sysChars: opts.systemPrompt.length,
      userChars: opts.userPrompt.length,
    },
    'llm: request',
  );

  const client = createOpenAIClient();
  const start = Date.now();
  let resp;
  try {
    resp = await client.chat.completions.create({
      model: opts.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: opts.systemPrompt },
        { role: 'user', content: opts.userPrompt },
      ],
    });
  } catch (err) {
    stepLog.error({ step: opts.step, model: opts.model, latencyMs: Date.now() - start, err: (err as Error).message }, 'llm: error');
    throw err;
  }
  const latencyMs = Date.now() - start;
  const content = resp.choices[0]?.message?.content;
  const usage = resp.usage;
  stepLog.info(
    {
      step: opts.step,
      model: opts.model,
      latencyMs,
      respChars: content?.length ?? 0,
      promptTokens: usage?.prompt_tokens,
      completionTokens: usage?.completion_tokens,
      totalTokens: usage?.total_tokens,
      finishReason: resp.choices[0]?.finish_reason ?? null,
    },
    'llm: response',
  );

  if (!content) throw new Error(`LLM (${opts.step}) returned empty response`);
  try {
    return JSON.parse(content) as T;
  } catch (err) {
    stepLog.error({ step: opts.step, snippet: content.slice(0, 200) }, 'llm: invalid JSON');
    throw err;
  }
}
