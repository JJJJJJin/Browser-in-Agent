# Deployment Guide (Local, macOS / Linux)

How to install and run the Browser-in-Agent MCP server on your own machine. Windows is not
supported yet.

## 1. Prerequisites

- **Node.js ≥ 20** (tested on 26) and **npm**. Check with `node -v`.
  Install from <https://nodejs.org> or via a version manager (`nvm`, `fnm`, `volta`).
- **git** to clone the repo.
- A POSIX shell (the bundled script is `bash`).
- Disk space for browsers (~500 MB for Chromium + Firefox).

## 2. Get the code

```bash
git clone <your-repo-url> browser-in-agent
cd browser-in-agent
```

## 3. One-click setup

```bash
./scripts/setup.sh
```

This script (idempotent — safe to re-run) will:

1. Verify Node ≥ 20.
2. Install npm dependencies (`npm ci` when a lockfile exists, else `npm install`).
3. Install the Playwright browsers (`chromium` + `firefox`).
4. Compile TypeScript to `dist/`.
5. Create `.env` from `.env.example` if you don't have one.
6. Ensure a `guidelines/` directory exists.

If you prefer to do it by hand:

```bash
npm install
npx playwright install chromium firefox
npm run build
cp .env.example .env
```

## 4. Configure

Edit `.env` (or pass CLI flags at launch — flags win over env). Common settings:

```ini
PORT=7777
HEADLESS=true
# Vision fallback (only for agents without their own vision model):
# VISION_PROVIDER=kimi
# VISION_API_KEY=sk-your-kimi-key
```

See the full table in the [README](../README.md#configuration). **Never commit your real `.env`.**

## 5. Run

```bash
npm start          # runs the built server (dist/)
# or
npm run dev        # source + auto-reload (tsx)
```

You should see:

```
INFO  [server] server.listening port=7777 headless=true vision="none"
```

The MCP endpoint is now at **`http://localhost:7777/mcp`** (Streamable HTTP).

### Watch the browser

Set `HEADLESS=false` (or `--headless` omitted with `HEADLESS=false`) to see the browser window
while the agent drives it — useful for debugging.

## 6. Verify it works

Quick handshake check (returns a `mcp-session-id` header):

```bash
curl -s -D - -X POST http://localhost:7777/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.0"}}}' \
  | grep -i "mcp-session-id"
```

For a full tool-driven check, use any MCP client (see the README's *Connecting an agent* snippet).

## 7. Connect your agent

Point your MCP client at `http://localhost:7777/mcp`. Each connection becomes an isolated agent
session; the browsers it opens are cleaned up automatically when it disconnects.

## 8. Run as a background service (optional)

Simplest:

```bash
nohup npm start > server.log 2>&1 &
```

For auto-restart on boot, wrap `node dist/index.js` in a `launchd` plist (macOS) or a `systemd`
unit (Linux) with `PORT` / vision env vars set there.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Node.js >= 20 required` | Upgrade Node. |
| Playwright "browser not found" | Re-run `npx playwright install chromium firefox`. |
| `vision_query` returns `VISION_NOT_CONFIGURED` | Set `VISION_PROVIDER` + `VISION_API_KEY`. |
| Port already in use | Change `PORT` in `.env` or pass `--port`. |
| `__name is not defined` in dev | Only affects unbuilt `page.evaluate` code; use `npm start`, or ensure the in-page `__name` shim is present (see `src/perception/PageDistiller.ts`). |
