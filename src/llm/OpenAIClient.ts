import OpenAI from 'openai';

export type OpenAIClientConfig = {
  apiKey?: string;
};

export function createOpenAIClient(cfg: OpenAIClientConfig = {}) {
  const apiKey = cfg.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY');
  }
  return new OpenAI({ apiKey });
}

