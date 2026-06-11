# Browser-in-Agent MCP — System Architecture

> English document. 中文版本: [`zh/System_Architecture.md`](./zh/System_Architecture.md).

This project is a **locally-deployed MCP server** that exposes browser-control capabilities to
any MCP-capable agent (Claude / ChatGPT / DeepSeek …). The agent perceives pages and performs
atomic actions through MCP tools, so it can drive a browser autonomously — the "Chrome-in-Claude"
experience. This document describes the overall architecture, module responsibilities, and key
interfaces, as a reference for development and maintenance.

---

## 1. Design principles

- **The agent is the brain; MCP is the hands.** MCP embeds no LLM planning. The agent calls tools;
  the server executes them and returns the results.
- **Snapshot + ref-based addressing.** No pixel coordinates. `snapshot` returns a compact semantic
  tree where elements carry a `ref` (e.g. `e23`), and actions target elements by `ref`. Low token
  cost, robust, and usable by any agent that can read text.
- **Purely atomic actions.** click / type / hover / clear / scroll / select_option / press_key —
  the agent composes them freely.
- **Auto-return a distilled snapshot after each action.** Every interactive action returns the
  refreshed snapshot, so the agent sees the result immediately, leaving natural room to reason.
- **DOM + vision, the agent decides.** When DOM is insufficient, a vision-capable agent fetches
  the image itself via `screenshot`; a non-vision agent falls back to `vision_query` (the server
  forwards to a pluggable vision provider).
- **Precise targeting.** With many agents, browsers, and pages running concurrently, every action
  must land exactly on its target page, and agents must be isolated from each other.

---

## 2. Technology stack

| Item | Choice |
|---|---|
| Language | TypeScript (ESM, `"type": "module"`, NodeNext/Bundler resolution) |
| MCP | `@modelcontextprotocol/sdk` (official) |
| Transport | Streamable HTTP, one server with multiple sessions |
| HTTP layer | `express` (hosts StreamableHTTPServerTransport) |
| Browser | `playwright` (chromium + firefox) |
| Validation | `zod` (tool-input schemas) |
| Logging | `pino` |
| Vision | `openai` SDK (pointed at Moonshot/Kimi's OpenAI-compatible endpoint) |
| Configuration | CLI flags + env (`dotenv`) |

**Removed:** fastify, better-sqlite3, and the legacy `planner/`, `llm/`, `routes/`, `seek/`, `application/`, `profile/`.

---

## 3. Identity & addressing model

```
agentId            ← injected by the MCP connection (Mcp-Session-Id); the agent cannot forge it or pass it as a tool argument
  └─ browserId      { engine: 'chromium' | 'firefox', Browser, BrowserContext }
       └─ pageId     → Playwright Page (a single tab)
```

- **agentId** source: the session id of the Streamable HTTP transport. The server maintains a
  `Mcp-Session-Id → agentId` mapping.
- **Actions carry only `pageId`:** a page belongs to exactly one browser, and the registry can
  look up its browser/engine.
- **Ownership check:** every time a `pageId` is resolved, the server verifies it belongs to the
  current `agentId`, otherwise it throws `OwnershipError`. This is the root of cross-talk
  prevention and isolation.
- **No Redis:** an in-process `Map` is enough. The registry interface is designed to be swappable,
  so a Redis backend can be added later for multi-process deployments.

---

## 4. Directory structure

```
src/
  index.ts                    # CLI entry: parse config → start HTTP MCP server → graceful shutdown
  config/
    Config.ts                 # config definition + parsing from CLI/env (port, headless, vision provider/key, guidelines dir)
  errors.ts                   # domain errors: OwnershipError, NotFoundError, VisionNotConfiguredError, RefNotFoundError
  logger.ts                   # pino logger factory (kept as-is)
  browser/
    BrowserManager.ts         # start/stop chromium|firefox instances, manage Browser/Context/Page
  router/
    SessionRegistry.ts        # agentId→browserId→pageId handle table; create/query/close; ownership checks
    BrowserRouter.ts          # high-level facade: resolvePage(agentId,pageId)→Page; wraps registry + checks
  perception/
    PageDistiller.ts          # Page → { tree: string, refs } distilled semantic tree (with refs)
    RefRegistry.ts            # per-page: ref(e1,e2…) → ElementDescriptor (selector/index); refreshed per snapshot
    snapshotTypes.ts          # DistilledSnapshot and related types
  actions/
    Action.ts                 # abstract base: start(ctx) → ActionResult; run() wraps logging/timing (cf. legacy BaseAction)
    ClickAction.ts TypeAction.ts HoverAction.ts ClearAction.ts
    ScrollAction.ts SelectAction.ts PressKeyAction.ts
    registry.ts               # actionFromSpec(kind, params) → Action instance
    types.ts                  # ActionKind, ActionResult, ActionContext
  executor/
    Executor.ts               # run(agentId,pageId,action) → take PageLock → action.start → return distilled snapshot
    PageLock.ts               # one async mutex per pageId (serial within a page, parallel across pages)
  vision/
    VisionProvider.ts         # interface VisionProvider { query(image, prompt) }
    KimiProvider.ts           # Moonshot/Kimi implementation (OpenAI-compatible)
    providerRegistry.ts       # look up provider by config name; not configured → VisionNotConfiguredError
  guidelines/
    GuidelineStore.ts         # load *.md from config dir; list()/get(name)
  server/
    McpServer.ts              # create MCP Server, register tools + prompts, mount Streamable HTTP transport
    registerTools.ts          # register all tools (see §6); parse inputs and delegate to router/executor/vision
    registerPrompts.ts        # expose guidelines as MCP prompts
```

---

## 5. Core interfaces (cross-module contracts)

### 5.1 Errors (`src/errors.ts`)
```ts
export class DomainError extends Error { constructor(public code: string, message: string) { super(message); } }
export class OwnershipError extends DomainError {}        // pageId/browserId does not belong to this agent
export class NotFoundError extends DomainError {}         // browserId/pageId does not exist
export class RefNotFoundError extends DomainError {}      // ref not in the current snapshot (page changed, re-snapshot needed)
export class VisionNotConfiguredError extends DomainError {} // vision_query called but no vision provider configured
```

### 5.2 Distilled snapshot (`src/perception/snapshotTypes.ts`)
```ts
export type ElementDescriptor = {
  ref: string;            // 'e1','e2'… stable within a single snapshot
  role: string;           // button | link | textbox | checkbox | heading | text …
  name: string;           // readable name (innerText / aria-label / label / placeholder)
  selector: string;       // CSS selector for resolution (cf. legacy PageSnapshot.selectorFor)
  domIndex: number;       // fallback index when the selector matches multiple nodes
};
export type DistilledSnapshot = {
  pageId: string;
  url: string;
  title: string;
  scroll: { x: number; y: number };
  tree: string;           // text tree shown to the agent (see example below)
  elementCount: number;
};
```
Example `tree` text format (what the agent sees): interactive elements carry a `ref`; headings and
body text do not (they are for reading/summarizing).
```
- heading "Report"
- text "Revenue grew 12% this quarter"
- textbox "Username" [ref=e7]
- textbox "Password" [ref=e8]
- button "Sign in" [ref=e23]
- link "Forgot password" [ref=e31]
```
Body-text collection: the **direct text** of `p/li/td/th/dt/dd/blockquote/figcaption/caption/summary/pre`
(own text nodes only, to avoid nested duplication), skipping text inside interactive controls and
headings; normalized, de-duplicated, capped (MAX_TEXTS), and interleaved with interactive
elements/headings in document order.

### 5.3 RefRegistry (`src/perception/RefRegistry.ts`)
```ts
export class RefRegistry {
  // replaced with fresh descriptors after each distill (a ref is valid only within the latest snapshot)
  set(descriptors: ElementDescriptor[]): void;
  resolve(ref: string): ElementDescriptor;   // not found → throws RefNotFoundError
}
```
- **Each pageId holds one RefRegistry** (attached to the page record in SessionRegistry).
- After `distill()` runs, call `set()` to refresh; before an action runs, use `resolve(ref)` to get
  the selector/domIndex.

### 5.4 PageDistiller (`src/perception/PageDistiller.ts`)
```ts
export class PageDistiller {
  // capture interactive elements + structure, generate refs, text tree, descriptors. Reuses the legacy PageSnapshot selectorFor / isVisible logic.
  async distill(page: Page): Promise<{ snapshot: DistilledSnapshot; descriptors: ElementDescriptor[] }>;
}
```

### 5.5 Action (`src/actions/`)
```ts
// types.ts
export type ActionKind = 'click'|'type'|'hover'|'clear'|'scroll'|'select_option'|'press_key';
export type ActionContext = {
  page: Page;
  refs: RefRegistry;
  logger: Logger;
};
export type ActionOutcome = { ok: boolean; details?: Record<string, unknown>; error?: { name: string; message: string } };

// Action.ts (abstract base; cf. the legacy BaseAction run/runInternal wrapping)
export abstract class Action {
  abstract readonly kind: ActionKind;
  protected abstract runInternal(ctx: ActionContext): Promise<Record<string, unknown> | void>;
  async start(ctx: ActionContext): Promise<ActionOutcome>;   // wraps timing/logging/error capture
}
```
- Resolving an element: `const d = ctx.refs.resolve(ref);` then operate via
  `page.locator(d.selector).nth(d.domIndex)`.
- Each action's `fieldVariables` (constructor params):
  - Click: `{ ref }`
  - Type: `{ ref, text, clearFirst?: boolean }`
  - Hover: `{ ref }`
  - Clear: `{ ref }`
  - Scroll: `{ deltaY?: number, to?: 'top'|'bottom' }` (no ref needed)
  - SelectOption: `{ ref, value? , label? }`
  - PressKey: `{ key, ref? }` (omit ref to press on the page)

### 5.6 Executor (`src/executor/Executor.ts`)
```ts
export class Executor {
  constructor(private router: BrowserRouter, private distiller: PageDistiller, private logger: Logger) {}
  // take the pageId's PageLock (serial within a page, parallel across pages) → action.start → re-distill → refresh refs → return snapshot
  async run(agentId: string, pageId: string, action: Action):
    Promise<{ outcome: ActionOutcome; snapshot: DistilledSnapshot }>;
}
```

### 5.7 BrowserRouter / SessionRegistry (`src/router/`)
```ts
type PageRecord = { pageId: string; browserId: string; agentId: string; page: Page; refs: RefRegistry };
type BrowserRecord = { browserId: string; agentId: string; engine: Engine; browser: Browser; context: BrowserContext };

export class SessionRegistry {
  createBrowser(agentId: string, engine: Engine): Promise<BrowserRecord>;
  createPage(agentId: string, browserId: string): Promise<PageRecord>;
  getPage(agentId: string, pageId: string): PageRecord;     // verify ownership → OwnershipError/NotFoundError
  listBrowsers(agentId: string): BrowserRecord[];
  listPages(agentId: string, browserId: string): PageRecord[];
  closePage(agentId: string, pageId: string): Promise<void>;
  closeBrowser(agentId: string, browserId: string): Promise<void>;
  closeAgent(agentId: string): Promise<void>;               // on disconnect, clean up all of the agent's resources
}

export class BrowserRouter {
  resolvePage(agentId: string, pageId: string): PageRecord;  // delegates to SessionRegistry.getPage
}
```

### 5.8 VisionProvider (`src/vision/`)
```ts
export interface VisionProvider {
  readonly name: string;
  query(input: { imageBase64: string; mimeType: string; prompt: string }): Promise<{ text: string }>;
}
// KimiProvider: uses the openai SDK, baseURL='https://api.moonshot.cn/v1', model defaults to 'moonshot-v1-8k-vision-preview' (configurable)
// providerRegistry.get(name): no key configured → throws VisionNotConfiguredError (message tells the user to configure the vision API key via CLI/env)
```

---

## 6. MCP tools (external interface)

All tool inputs are validated with zod. **`pageId` is required** (except session create/list tools).
`agentId` is **never** an input — the server injects it from the connection. Interactive tools
**automatically return the distilled snapshot text** after running.

| Tool | Input | Returns |
|---|---|---|
| `create_browser` | `{ engine: 'chromium'\|'firefox' }` | `{ browserId }` |
| `new_page` | `{ browserId, url? }` | `{ pageId, snapshot }` |
| `list_browsers` | `{}` | `{ browsers: [{browserId, engine}] }` |
| `list_pages` | `{ browserId }` | `{ pages: [{pageId, url, title}] }` |
| `close_page` | `{ pageId }` | `{ ok }` |
| `close_browser` | `{ browserId }` | `{ ok }` |
| `navigate` | `{ pageId, url }` | `{ snapshot }` |
| `go_back` | `{ pageId }` | `{ snapshot }` |
| `wait_for` | `{ pageId, text?, selector?, state?, timeoutMs? }` | `{ snapshot }` |
| `snapshot` | `{ pageId }` | `{ snapshot }` |
| `screenshot` | `{ pageId, fullPage? }` | MCP image content (base64) |
| `click` | `{ pageId, ref, element }` | `{ outcome, snapshot }` |
| `type` | `{ pageId, ref, element, text, clearFirst? }` | `{ outcome, snapshot }` |
| `hover` | `{ pageId, ref, element }` | `{ outcome, snapshot }` |
| `clear` | `{ pageId, ref, element }` | `{ outcome, snapshot }` |
| `scroll` | `{ pageId, deltaY?, to? }` | `{ snapshot }` |
| `select_option` | `{ pageId, ref, element, value?, label? }` | `{ outcome, snapshot }` |
| `press_key` | `{ pageId, key, ref?, element? }` | `{ outcome, snapshot }` |
| `vision_query` | `{ pageId, prompt, fullPage? }` | `{ text }` (server screenshots + forwards to the vision provider; not configured → error) |

> The `element` field: a human-readable description of the target (e.g. "Sign-in button"), used for
> logging/auditability — not the primary basis for targeting (targeting relies on `ref`).

**Guidelines go through MCP prompts** (not tools): the server lists `guidelines/*.md` as prompts, which
the agent can discover via `prompts/list` and load via `prompts/get`. Each prompt returns the
contents of its md file as user/assistant message text.

---

## 7. Connection lifecycle

- New connection (new `Mcp-Session-Id`) → allocate an `agentId`.
- Connection closed (transport `onclose`) → `SessionRegistry.closeAgent(agentId)`, closing all of
  its browsers.
- Server process exit (SIGINT/SIGTERM) → close all agent resources, then exit.

---

## 8. Configuration (`src/config/Config.ts`)

Either CLI or env; CLI takes priority:
```
browser-mcp \
  --port 7777                 # PORT, default 7777
  --headless                  # HEADLESS, default true
  --vision-provider kimi      # VISION_PROVIDER, optional
  --vision-api-key sk-xxx     # VISION_API_KEY
  --vision-model ...          # VISION_MODEL, defaults per provider
  --vision-base-url ...       # VISION_BASE_URL, defaults per provider
  --guidelines ./guidelines   # GUIDELINES_DIR, default ./guidelines
```
```ts
export type Config = {
  port: number; headless: boolean;
  vision?: { provider: string; apiKey: string; model?: string; baseUrl?: string };
  guidelinesDir: string;
};
export function loadConfig(argv: string[], env: NodeJS.ProcessEnv): Config;
```

---

## 9. Implementation conventions

- ESM: relative imports **carry the `.js` extension** (`tsconfig` moduleResolution=Bundler, but keep
  the `.js` suffix for runtime compatibility).
- `strict` + `noUncheckedIndexedAccess` enabled: array index access must guard against undefined.
- Confirm a new dependency is necessary before adding it; existing dependencies are in §2.
- Each module is self-contained: it only imports the types defined in §4/§5 and does not depend back
  on the server layer.
- Single responsibility: the tools layer only "parses input → calls router/executor/vision → formats
  the response"; it contains no business logic.
