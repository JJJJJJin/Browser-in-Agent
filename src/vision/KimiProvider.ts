import OpenAI from 'openai';
import type { VisionConfig } from '../config/Config.js';
import type { VisionProvider } from './VisionProvider.js';

const DEFAULT_BASE_URL = 'https://api.moonshot.cn/v1';
const DEFAULT_MODEL = 'moonshot-v1-8k-vision-preview';

/**
 * Vision provider backed by Moonshot/Kimi's OpenAI-compatible chat completions
 * endpoint (docs/System_Architecture.md §5.8). The image is sent inline as a base64 data URL.
 */
export class KimiProvider implements VisionProvider {
  readonly name = 'kimi';

  private readonly client: OpenAI;
  private readonly model: string;

  constructor(cfg: VisionConfig) {
    this.client = new OpenAI({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseUrl ?? DEFAULT_BASE_URL,
    });
    this.model = cfg.model ?? DEFAULT_MODEL;
  }

  async query(input: { imageBase64: string; mimeType: string; prompt: string }): Promise<{ text: string }> {
    const dataUrl = `data:${input.mimeType};base64,${input.imageBase64}`;

    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            { type: 'text', text: input.prompt },
          ],
        },
      ],
    });

    const first = completion.choices[0];
    const text = first?.message?.content ?? '';
    return { text: typeof text === 'string' ? text : '' };
  }
}
