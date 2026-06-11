/**
 * Pluggable vision provider contract (docs/System_Architecture.md §5.8).
 *
 * The server forwards a page screenshot + a natural-language prompt to a vision
 * provider on behalf of agents that cannot see images themselves. Concrete
 * implementations (e.g. KimiProvider) wrap a specific backend.
 */
export interface VisionProvider {
  /** Stable, human-readable provider name (e.g. 'kimi'). */
  readonly name: string;
  /**
   * Answer `prompt` about the supplied image.
   * @param input.imageBase64 Base64-encoded image bytes (no data: prefix).
   * @param input.mimeType    Image MIME type (e.g. 'image/png').
   * @param input.prompt      Natural-language question/instruction.
   */
  query(input: { imageBase64: string; mimeType: string; prompt: string }): Promise<{ text: string }>;
}
