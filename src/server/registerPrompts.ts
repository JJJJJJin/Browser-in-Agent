import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { GuidelineStore } from '../guidelines/GuidelineStore.js';

/**
 * Expose each guideline document as an MCP prompt (DESIGN.md §6): agents can
 * discover them via `prompts/list` and load the markdown via `prompts/get`.
 * Each prompt returns the file content as a single user message.
 */
export async function registerGuidelinePrompts(
  server: McpServer,
  store: GuidelineStore,
): Promise<void> {
  const guidelines = await store.list();
  for (const { name, description } of guidelines) {
    server.registerPrompt(
      name,
      { description: description || `Guideline: ${name}` },
      async () => ({
        messages: [
          {
            role: 'user',
            content: { type: 'text', text: await store.get(name) },
          },
        ],
      }),
    );
  }
}
