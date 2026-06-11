# Browser-in-Agent MCP

A **locally-deployed [MCP](https://modelcontextprotocol.io) server** that gives any
MCP-capable agent (Claude, ChatGPT, DeepSeek, …) the ability to drive a real browser —
the "Chrome-in-Claude" experience, opened up to every agent.

The agent is the brain; this server is the hands. It exposes **atomic browser actions**
as MCP tools and returns a **token-efficient, ref-tagged snapshot** of the page after each
action, so the agent perceives and acts in a loop it fully controls.

> Architecture deep-dive: see [`docs/System_Architecture.md`](./docs/System_Architecture.md) (中文: [`docs/zh/System_Architecture.md`](./docs/zh/System_Architecture.md)). This README is for using and deploying it.

---

## How it works

```
agent  ──MCP tool call──▶  this server  ──Playwright──▶  Chrome / Firefox
       ◀──distilled snapshot──┘
```

1. **Perception, not screenshots.** `snapshot` returns a compact semantic tree where every
   interactive element carries a stable `ref` (e.g. `e7`), plus headings and body text:

   ```
   - heading "Login"
   - text "Sign in to continue"
   - textbox "Username" [ref=e7]
   - textbox "Password" [ref=e8]
   - button "Sign in" [ref=e23]
   ```

2. **Atomic actions by ref.** The agent reasons over that tree and calls e.g.
   `click(pageId, ref="e23", element="Sign in button")`. Every interactive action returns
   the refreshed snapshot, so the agent immediately sees the result and decides the next step.

3. **DOM + vision, agent's choice.** DOM-based perception is the default (cheap, robust).
   When that's not enough, an agent with its own vision model uses `screenshot`; an agent
   without vision (e.g. DeepSeek) calls `vision_query`, which screenshots the page and
   forwards it to a configured vision provider (Kimi).

4. **Precise multiplexing.** One server serves many agents; each agent may open many browsers
   (Chrome and/or Firefox), each with many pages. Every action is addressed by `pageId` and
   ownership is enforced per connection — agents can never touch each other's browsers.

---

## Tools

| Category | Tools |
|---|---|
| Session | `create_browser` · `new_page` · `list_browsers` · `list_pages` · `close_page` · `close_browser` |
| Navigation | `navigate` · `go_back` · `wait_for` |
| Perception | `snapshot` · `screenshot` |
| Interaction | `click` · `type` · `hover` · `clear` · `scroll` · `select_option` · `press_key` |
| Vision | `vision_query` |

`agentId` is **never** a tool argument — the server derives it from the MCP session, so
isolation can't be bypassed. Workflow **guidelines** are exposed separately as MCP *prompts*
(see below), not tools.

Users can also create additional scripts/tools to simplify the working progress (you don't want agent to interate 100 items in a list element and have reasoning for each one to merely get the item info, a simple tool/script can somehow achieve this).

---

## Quick start

Requires **Node.js ≥ 20** (tested on 26) and a POSIX shell (macOS / Linux).

```bash
# 1. one-click setup: installs deps, browsers, builds, creates .env
./scripts/setup.sh

# 2. start the server
npm start                 # production (built)   → http://localhost:7777/mcp
# or
npm run dev               # auto-reload dev mode
```

The full step-by-step deployment guide is in [`docs/INSTALL.md`](./docs/INSTALL.md).

---

## Configuration

Set via CLI flags (highest priority) or environment / `.env`. See [`.env.example`](./.env.example).

| CLI flag | Env var | Default | Purpose |
|---|---|---|---|
| `--port <n>` | `PORT` | `7777` | HTTP port |
| `--headless` | `HEADLESS` | `true` | Run browsers headless (`HEADLESS=false` to watch) |
| `--vision-provider <name>` | `VISION_PROVIDER` | — | Vision provider for `vision_query` (`kimi`) |
| `--vision-api-key <key>` | `VISION_API_KEY` | — | Vision provider API key |
| `--vision-model <id>` | `VISION_MODEL` | provider default | Override vision model |
| `--vision-base-url <url>` | `VISION_BASE_URL` | provider default | Override vision endpoint |
| `--guidelines <dir>` | `GUIDELINES_DIR` | `./guidelines` | Directory of `*.md` guideline playbooks |


```bash
# example: server with Kimi vision and custom guidelines
node dist/index.js --port 7777 --vision-provider kimi --vision-api-key sk-xxx --guidelines ./guidelines
```

> **Security:** keep API keys in `.env` or pass them at launch — never commit them. If a key
> ever appears in logs, chat, or a shared file, rotate it.

---

## Connecting an agent

The server speaks **Streamable HTTP MCP** at `POST/GET/DELETE /mcp`. Point any MCP client at it.

Minimal TypeScript client:

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const client = new Client({ name: 'my-agent', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost:7777/mcp')));

const { tools } = await client.listTools();
const browser = await client.callTool({ name: 'create_browser', arguments: { engine: 'chromium' } });
// → { browserId }, then new_page → snapshot → click/type by ref …
```

Each connection is one isolated agent session; its browsers are closed automatically when the
connection ends.

---

## Vision fallback (Kimi)

For agents whose LLM lacks vision (e.g. Deepseek). Configure a provider, then the agent calls `vision_query`:

```bash
node dist/index.js --vision-provider kimi --vision-api-key sk-your-kimi-key
```

```jsonc
// agent → vision_query
{ "pageId": "pg_…", "prompt": "What is the total shown and what color is the button?" }
// ← { "text": "The total is $4.2M and the button is green." }
```

If no provider is configured, `vision_query` returns a clear `VISION_NOT_CONFIGURED` error so the
agent can ask the user to set it up. Additional providers can be added under `src/vision/`.


---

## Workflow guidelines

Drop Markdown playbooks into the guidelines directory and they become MCP **prompts** the agent
can discover (`prompts/list`) and load (`prompts/get`) — e.g. a fixed "log in, open the dashboard,
read the figures, summarize" routine. See [`guidelines/example-login-summary.md`](./guidelines/example-login-summary.md).

---

## Project layout

```
src/
  index.ts          CLI entry → Express + Streamable HTTP MCP server
  config/           configuration loading
  browser/          Playwright launcher (chromium / firefox)
  router/           SessionRegistry + BrowserRouter (agent→browser→page, ownership)
  perception/       PageDistiller (ref-tagged tree + body text) + RefRegistry
  actions/          7 atomic actions + base class + registry
  executor/         per-page locked execution
  vision/           pluggable vision providers (Kimi)
  guidelines/       Markdown → MCP prompts
  server/           MCP server wiring + tool/prompt registration
scripts/setup.sh    one-click local install
docs/INSTALL.md             deployment guide
docs/System_Architecture.md architecture reference
```

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Run from source with reload (`tsx`) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the built server |
| `npm run typecheck` | Type-check without emitting |

## License

Private / unpublished.
