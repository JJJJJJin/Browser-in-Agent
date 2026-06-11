import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { actionFromSpec } from '../actions/registry.js';
import type { Engine } from '../browser/BrowserManager.js';
import { DomainError } from '../errors.js';
import type { Executor } from '../executor/Executor.js';
import type { GuidelineStore } from '../guidelines/GuidelineStore.js';
import type { Logger } from '../logger.js';
import type { PageDistiller } from '../perception/PageDistiller.js';
import type { DistilledSnapshot, ElementDescriptor } from '../perception/snapshotTypes.js';
import type { PageRecord } from '../router/SessionRegistry.js';
import type { BrowserRouter } from '../router/BrowserRouter.js';
import { requireVisionProvider } from '../vision/providerRegistry.js';
import type { VisionProvider } from '../vision/VisionProvider.js';

import { registerGuidelinePrompts } from './registerPrompts.js';

/** Dependencies wired in by the CLI entrypoint and shared across every agent's server. */
export type McpServerDeps = {
  router: BrowserRouter;
  executor: Executor;
  distiller: PageDistiller;
  vision: VisionProvider | undefined;
  guidelines: GuidelineStore;
  logger: Logger;
  headless: boolean;
};

type TextContent = { type: 'text'; text: string };
type ImageContent = { type: 'image'; data: string; mimeType: string };
type ToolResult = {
  content: (TextContent | ImageContent)[];
  isError?: boolean;
};

function textContent(text: string): TextContent {
  return { type: 'text', text };
}

/** Render a distilled snapshot for the agent: a JSON header line + the text tree. */
function snapshotContent(snapshot: DistilledSnapshot): TextContent {
  const header = JSON.stringify({
    pageId: snapshot.pageId,
    url: snapshot.url,
    title: snapshot.title,
    scroll: snapshot.scroll,
    elementCount: snapshot.elementCount,
  });
  return textContent(`${header}\n${snapshot.tree}`);
}

/** Map a thrown error into an isError tool result so the agent can react. */
function errorResult(err: unknown): ToolResult {
  if (err instanceof DomainError) {
    return {
      isError: true,
      content: [textContent(`${err.code}: ${err.message}`)],
    };
  }
  const e = err as Error;
  return {
    isError: true,
    content: [textContent(`ERROR: ${e?.message ?? String(err)}`)],
  };
}

/**
 * Build a fully-configured MCP server bound to a single agent. `agentId` is
 * closed over by every tool handler and is never exposed as a tool parameter
 * (docs/System_Architecture.md §3 / §6) — it comes from the transport's Mcp-Session-Id.
 */
export function createMcpServerForAgent(agentId: string, deps: McpServerDeps): McpServer {
  const { router, executor, distiller, vision, guidelines, logger } = deps;
  const log = logger.child({ scope: 'mcp', agentId });

  const server = new McpServer({
    name: 'browser-in-agent',
    version: '0.1.0',
  });

  /** Distill a page and refresh its RefRegistry so the returned refs are valid. */
  async function distillAndRefresh(record: PageRecord): Promise<DistilledSnapshot> {
    const { snapshot, descriptors }: { snapshot: DistilledSnapshot; descriptors: ElementDescriptor[] } =
      await distiller.distill(record.page, record.pageId);
    record.refs.set(descriptors);
    return snapshot;
  }

  // ---- Session / lifecycle tools ---------------------------------------

  server.registerTool(
    'create_browser',
    {
      description: 'Launch a new browser instance (chromium or firefox) for this agent.',
      inputSchema: { engine: z.enum(['chromium', 'firefox']) },
    },
    async ({ engine }): Promise<ToolResult> => {
      try {
        const record = await router.createBrowser(agentId, engine as Engine);
        return { content: [textContent(JSON.stringify({ browserId: record.browserId }))] };
      } catch (err) {
        log.error({ err: (err as Error).message }, 'create_browser.error');
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'new_page',
    {
      description: 'Open a new page (tab) in a browser, optionally navigating to a URL. Returns a snapshot.',
      inputSchema: { browserId: z.string().min(1), url: z.string().url().optional() },
    },
    async ({ browserId, url }): Promise<ToolResult> => {
      try {
        const record = await router.createPage(agentId, browserId);
        if (url) {
          await record.page.goto(url, { waitUntil: 'domcontentloaded' });
        }
        const snapshot = await distillAndRefresh(record);
        return {
          content: [
            textContent(JSON.stringify({ pageId: record.pageId })),
            snapshotContent(snapshot),
          ],
        };
      } catch (err) {
        log.error({ err: (err as Error).message }, 'new_page.error');
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'list_browsers',
    {
      description: 'List all browsers owned by this agent.',
      inputSchema: {},
    },
    async (): Promise<ToolResult> => {
      try {
        const browsers = router.listBrowsers(agentId).map((b) => ({
          browserId: b.browserId,
          engine: b.engine,
        }));
        return { content: [textContent(JSON.stringify({ browsers }))] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'list_pages',
    {
      description: 'List all open pages in one of this agent\'s browsers.',
      inputSchema: { browserId: z.string().min(1) },
    },
    async ({ browserId }): Promise<ToolResult> => {
      try {
        const pages = router.listPages(agentId, browserId).map((p) => ({
          pageId: p.pageId,
          url: p.page.url(),
          title: '',
        }));
        // Resolve titles asynchronously (best-effort).
        await Promise.all(
          router.listPages(agentId, browserId).map(async (p, i) => {
            const entry = pages[i];
            if (!entry) return;
            try {
              entry.title = await p.page.title();
            } catch {
              entry.title = '';
            }
          }),
        );
        return { content: [textContent(JSON.stringify({ pages }))] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'close_page',
    {
      description: 'Close a single page (tab).',
      inputSchema: { pageId: z.string().min(1) },
    },
    async ({ pageId }): Promise<ToolResult> => {
      try {
        await router.closePage(agentId, pageId);
        return { content: [textContent(JSON.stringify({ ok: true }))] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'close_browser',
    {
      description: 'Close a browser and all of its pages.',
      inputSchema: { browserId: z.string().min(1) },
    },
    async ({ browserId }): Promise<ToolResult> => {
      try {
        await router.closeBrowser(agentId, browserId);
        return { content: [textContent(JSON.stringify({ ok: true }))] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ---- Navigation / perception tools -----------------------------------

  server.registerTool(
    'navigate',
    {
      description: 'Navigate a page to a URL. Returns the updated snapshot.',
      inputSchema: { pageId: z.string().min(1), url: z.string().url() },
    },
    async ({ pageId, url }): Promise<ToolResult> => {
      try {
        const record = router.resolvePage(agentId, pageId);
        await record.page.goto(url, { waitUntil: 'domcontentloaded' });
        const snapshot = await distillAndRefresh(record);
        return { content: [snapshotContent(snapshot)] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'go_back',
    {
      description: 'Navigate back in the page history. Returns the updated snapshot.',
      inputSchema: { pageId: z.string().min(1) },
    },
    async ({ pageId }): Promise<ToolResult> => {
      try {
        const record = router.resolvePage(agentId, pageId);
        await record.page.goBack({ waitUntil: 'domcontentloaded' });
        const snapshot = await distillAndRefresh(record);
        return { content: [snapshotContent(snapshot)] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'wait_for',
    {
      description:
        'Wait for a text to appear, or a selector to reach a state, then return the snapshot.',
      inputSchema: {
        pageId: z.string().min(1),
        text: z.string().optional(),
        selector: z.string().optional(),
        state: z.enum(['attached', 'detached', 'visible', 'hidden']).optional(),
        timeoutMs: z.number().int().positive().optional(),
      },
    },
    async ({ pageId, text, selector, state, timeoutMs }): Promise<ToolResult> => {
      try {
        const record = router.resolvePage(agentId, pageId);
        const timeout = timeoutMs ?? 15_000;
        if (text !== undefined) {
          await record.page.getByText(text).first().waitFor({ state: state ?? 'visible', timeout });
        } else if (selector !== undefined) {
          await record.page.locator(selector).first().waitFor({ state: state ?? 'visible', timeout });
        } else {
          await record.page.waitForLoadState('networkidle', { timeout });
        }
        const snapshot = await distillAndRefresh(record);
        return { content: [snapshotContent(snapshot)] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'snapshot',
    {
      description: 'Capture a fresh distilled semantic snapshot of the page (refs for actions).',
      inputSchema: { pageId: z.string().min(1) },
    },
    async ({ pageId }): Promise<ToolResult> => {
      try {
        const record = router.resolvePage(agentId, pageId);
        const snapshot = await distillAndRefresh(record);
        return { content: [snapshotContent(snapshot)] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'screenshot',
    {
      description: 'Capture a PNG screenshot of the page as image content.',
      inputSchema: { pageId: z.string().min(1), fullPage: z.boolean().optional() },
    },
    async ({ pageId, fullPage }): Promise<ToolResult> => {
      try {
        const record = router.resolvePage(agentId, pageId);
        const buffer = await record.page.screenshot({ fullPage: fullPage ?? false, type: 'png' });
        return {
          content: [
            { type: 'image', data: buffer.toString('base64'), mimeType: 'image/png' },
          ],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ---- Atomic action tools ---------------------------------------------

  const elementField = z.string().min(1);

  server.registerTool(
    'click',
    {
      description: 'Click an element resolved from a snapshot ref. Returns the updated snapshot.',
      inputSchema: { pageId: z.string().min(1), ref: z.string().min(1), element: elementField },
    },
    async ({ pageId, ref }): Promise<ToolResult> => {
      try {
        const action = actionFromSpec('click', { ref });
        const { outcome, snapshot } = await executor.run(agentId, pageId, action);
        return {
          content: [textContent(JSON.stringify({ outcome })), snapshotContent(snapshot)],
          isError: !outcome.ok,
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'type',
    {
      description: 'Type text into an element. Optionally clear it first. Returns the updated snapshot.',
      inputSchema: {
        pageId: z.string().min(1),
        ref: z.string().min(1),
        element: elementField,
        text: z.string(),
        clearFirst: z.boolean().optional(),
      },
    },
    async ({ pageId, ref, text, clearFirst }): Promise<ToolResult> => {
      try {
        const action = actionFromSpec('type', { ref, text, clearFirst });
        const { outcome, snapshot } = await executor.run(agentId, pageId, action);
        return {
          content: [textContent(JSON.stringify({ outcome })), snapshotContent(snapshot)],
          isError: !outcome.ok,
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'hover',
    {
      description: 'Hover over an element. Returns the updated snapshot.',
      inputSchema: { pageId: z.string().min(1), ref: z.string().min(1), element: elementField },
    },
    async ({ pageId, ref }): Promise<ToolResult> => {
      try {
        const action = actionFromSpec('hover', { ref });
        const { outcome, snapshot } = await executor.run(agentId, pageId, action);
        return {
          content: [textContent(JSON.stringify({ outcome })), snapshotContent(snapshot)],
          isError: !outcome.ok,
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'clear',
    {
      description: 'Clear the value of an input/textarea element. Returns the updated snapshot.',
      inputSchema: { pageId: z.string().min(1), ref: z.string().min(1), element: elementField },
    },
    async ({ pageId, ref }): Promise<ToolResult> => {
      try {
        const action = actionFromSpec('clear', { ref });
        const { outcome, snapshot } = await executor.run(agentId, pageId, action);
        return {
          content: [textContent(JSON.stringify({ outcome })), snapshotContent(snapshot)],
          isError: !outcome.ok,
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'scroll',
    {
      description: 'Scroll the page by deltaY or to top/bottom. Returns the updated snapshot.',
      inputSchema: {
        pageId: z.string().min(1),
        deltaY: z.number().optional(),
        to: z.enum(['top', 'bottom']).optional(),
      },
    },
    async ({ pageId, deltaY, to }): Promise<ToolResult> => {
      try {
        const params: Record<string, unknown> = {};
        if (deltaY !== undefined) params.deltaY = deltaY;
        if (to !== undefined) params.to = to;
        const action = actionFromSpec('scroll', params);
        const { outcome, snapshot } = await executor.run(agentId, pageId, action);
        return {
          content: [textContent(JSON.stringify({ outcome })), snapshotContent(snapshot)],
          isError: !outcome.ok,
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'select_option',
    {
      description: 'Select an option in a <select> by value or label. Returns the updated snapshot.',
      inputSchema: {
        pageId: z.string().min(1),
        ref: z.string().min(1),
        element: elementField,
        value: z.string().optional(),
        label: z.string().optional(),
      },
    },
    async ({ pageId, ref, value, label }): Promise<ToolResult> => {
      try {
        const params: Record<string, unknown> = { ref };
        if (value !== undefined) params.value = value;
        if (label !== undefined) params.label = label;
        const action = actionFromSpec('select_option', params);
        const { outcome, snapshot } = await executor.run(agentId, pageId, action);
        return {
          content: [textContent(JSON.stringify({ outcome })), snapshotContent(snapshot)],
          isError: !outcome.ok,
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'press_key',
    {
      description:
        'Press a keyboard key, optionally focused on an element ref. Returns the updated snapshot.',
      inputSchema: {
        pageId: z.string().min(1),
        key: z.string().min(1),
        ref: z.string().min(1).optional(),
        element: elementField.optional(),
      },
    },
    async ({ pageId, key, ref }): Promise<ToolResult> => {
      try {
        const params: Record<string, unknown> = { key };
        if (ref !== undefined) params.ref = ref;
        const action = actionFromSpec('press_key', params);
        const { outcome, snapshot } = await executor.run(agentId, pageId, action);
        return {
          content: [textContent(JSON.stringify({ outcome })), snapshotContent(snapshot)],
          isError: !outcome.ok,
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ---- Vision tool ------------------------------------------------------

  server.registerTool(
    'vision_query',
    {
      description:
        'Screenshot the page and ask a configured vision provider a question about it. Returns text.',
      inputSchema: {
        pageId: z.string().min(1),
        prompt: z.string().min(1),
        fullPage: z.boolean().optional(),
      },
    },
    async ({ pageId, prompt, fullPage }): Promise<ToolResult> => {
      try {
        const provider = requireVisionProvider(vision);
        const record = router.resolvePage(agentId, pageId);
        const buffer = await record.page.screenshot({ fullPage: fullPage ?? false, type: 'png' });
        const { text } = await provider.query({
          imageBase64: buffer.toString('base64'),
          mimeType: 'image/png',
          prompt,
        });
        return { content: [textContent(text)] };
      } catch (err) {
        log.error({ err: (err as Error).message }, 'vision_query.error');
        return errorResult(err);
      }
    },
  );

  // ---- Guideline prompts ------------------------------------------------

  void registerGuidelinePrompts(server, guidelines).catch((err) => {
    log.error({ err: (err as Error).message }, 'prompts.register.error');
  });

  return server;
}
