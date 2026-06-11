# Browser-in-Agent MCP — 系统架构

> 中文文档。English version: [`../System_Architecture.md`](../System_Architecture.md)。

本项目是一个**本地部署的 MCP server**,把浏览器操作能力暴露给任意支持 MCP 的 agent
(Claude / ChatGPT / DeepSeek …)。agent 通过 MCP 工具感知页面、执行原子动作,从而像
"Chrome in Claude" 那样自主使用浏览器。本文档说明系统的整体架构、模块职责与关键接口,供开发与维护参考。

---

## 1. 设计理念

- **agent 是大脑,MCP 是手脚。** MCP 不内置任何 LLM 规划。agent 调用工具,server 执行并返回结果。
- **快照 + ref 引用定位。** 不用像素坐标。`snapshot` 返回带 `ref`(如 `e23`)的精简语义树,
  动作用 `ref` 定位元素。Token 低、鲁棒、任何能读文本的 agent 都能用。
- **纯原子动作。** click/type/hover/clear/scroll/select_option/press_key,agent 自由组合。
- **执行后自动回精简快照。** 每个交互动作返回更新后的快照,agent 立即看到结果,天然留出思考空间。
- **DOM + 视觉双管齐下,由 agent 决定。** DOM 不足时,有视觉的 agent 用 `screenshot` 自取图片;
  无视觉的 agent 用 `vision_query` 兜底(server 转发可插拔视觉供应商)。
- **精准落点。** 多 agent、多浏览器、多页面并发时,每个动作必须精确落在目标 page 上,且 agent 之间隔离。

---

## 2. 技术栈

| 项 | 选择 |
|---|---|
| 语言 | TypeScript (ESM, `"type": "module"`, NodeNext/Bundler 解析) |
| MCP | `@modelcontextprotocol/sdk` (官方) |
| 传输 | Streamable HTTP,单 server 多会话 |
| HTTP 层 | `express`(承载 StreamableHTTPServerTransport) |
| 浏览器 | `playwright`(chromium + firefox) |
| 校验 | `zod`(工具入参 schema) |
| 日志 | `pino` |
| 视觉 | `openai` SDK(指向 Moonshot/Kimi 的 OpenAI 兼容端点) |
| 配置 | CLI flags + env(`dotenv`) |

**移除**:fastify、better-sqlite3,以及旧的 `planner/`、`llm/`、`routes/`、`seek/`、`application/`、`profile/`。

---

## 3. 身份与寻址模型

```
agentId            ← 由 MCP 连接注入(Mcp-Session-Id),agent 不可伪造、不可作为工具入参传入
  └─ browserId      { engine: 'chromium' | 'firefox', Browser, BrowserContext }
       └─ pageId     → Playwright Page(一个 tab)
```

- **agentId** 来源:Streamable HTTP transport 的 session id。server 维护 `Mcp-Session-Id → agentId`。
- **动作只带 `pageId`**:一个 page 唯一属于一个 browser,registry 能反查 browser/engine。
- **归属校验**:每次解析 `pageId` 时校验它属于当前 `agentId`,否则抛 `OwnershipError`。这是防串台与隔离的根。
- **无 Redis**:进程内 `Map` 即可。registry 接口设计为可替换实现,未来多进程再换 Redis 后端。

---

## 4. 目录结构

```
src/
  index.ts                    # CLI 入口:解析配置 → 启动 HTTP MCP server → 优雅关闭
  config/
    Config.ts                 # 配置定义 + 从 CLI/env 解析(端口、headless、视觉 provider/key、guidelines 目录)
  errors.ts                   # 领域错误:OwnershipError, NotFoundError, VisionNotConfiguredError, RefNotFoundError
  logger.ts                   # pino logger 工厂(保留现有)
  browser/
    BrowserManager.ts         # 启动/关闭 chromium|firefox 实例,管理 Browser/Context/Page
  router/
    SessionRegistry.ts        # agentId→browserId→pageId 句柄表;创建/查询/关闭;归属校验
    BrowserRouter.ts          # 高层门面:resolvePage(agentId,pageId)→Page;封装 registry + 校验
  perception/
    PageDistiller.ts          # Page → { tree: string, refs } 精简语义树(带 ref)
    RefRegistry.ts            # per-page:ref(e1,e2…) → ElementDescriptor(selector/索引);随快照刷新
    snapshotTypes.ts          # DistilledSnapshot 等类型
  actions/
    Action.ts                 # 抽象基类:start(ctx) → ActionResult;run() 包装日志/计时(参考旧 BaseAction)
    ClickAction.ts TypeAction.ts HoverAction.ts ClearAction.ts
    ScrollAction.ts SelectAction.ts PressKeyAction.ts
    registry.ts               # actionFromSpec(kind, params) → Action 实例
    types.ts                  # ActionKind, ActionResult, ActionContext
  executor/
    Executor.ts               # run(agentId,pageId,action) → 取 PageLock → action.start → 回精简快照
    PageLock.ts               # 每个 pageId 一把异步互斥锁(同页串行、跨页并行)
  vision/
    VisionProvider.ts         # interface VisionProvider { query(image, prompt) }
    KimiProvider.ts           # Moonshot/Kimi 实现(OpenAI 兼容)
    providerRegistry.ts       # 按配置名查 provider;未配置 → VisionNotConfiguredError
  guidelines/
    GuidelineStore.ts         # 从配置目录加载 *.md;list()/get(name)
  server/
    McpServer.ts              # 创建 MCP Server,注册 tools + prompts,挂载 Streamable HTTP transport
    registerTools.ts          # 注册所有工具(见 §6),把入参解析后委托给 router/executor/vision
    registerPrompts.ts        # 把 guidelines 暴露为 MCP prompts
```

---

## 5. 核心接口(模块间约定)

### 5.1 错误 (`src/errors.ts`)
```ts
export class DomainError extends Error { constructor(public code: string, message: string) { super(message); } }
export class OwnershipError extends DomainError {}        // pageId/browserId 不属于该 agent
export class NotFoundError extends DomainError {}         // browserId/pageId 不存在
export class RefNotFoundError extends DomainError {}      // ref 在当前快照中不存在(页面已变,需重新 snapshot)
export class VisionNotConfiguredError extends DomainError {} // 调 vision_query 但未配置视觉 provider
```

### 5.2 精简快照 (`src/perception/snapshotTypes.ts`)
```ts
export type ElementDescriptor = {
  ref: string;            // 'e1','e2'… 当次快照内稳定
  role: string;           // button | link | textbox | checkbox | heading | text …
  name: string;           // 可读名(innerText / aria-label / label / placeholder)
  selector: string;       // 解析用 CSS 选择器(参考旧 PageSnapshot.selectorFor)
  domIndex: number;       // 同选择器命中多个时的兜底索引
};
export type DistilledSnapshot = {
  pageId: string;
  url: string;
  title: string;
  scroll: { x: number; y: number };
  tree: string;           // 给 agent 看的文本树(见下例)
  elementCount: number;
};
```
`tree` 文本格式示例(agent 看到的内容):交互元素带 `ref`,标题与正文文本不带 `ref`(供阅读/汇总)。
```
- heading "报表"
- text "本季度营收增长 12%"
- textbox "用户名" [ref=e7]
- textbox "密码" [ref=e8]
- button "登录" [ref=e23]
- link "忘记密码" [ref=e31]
```
正文采集:`p/li/td/th/dt/dd/blockquote/figcaption/caption/summary/pre` 的**直接文本**(只取自身文本节点,
避免嵌套重复),跳过交互控件内部文本与标题,归一化、去重、有上限(MAX_TEXTS),按文档顺序与交互元素/标题交织。

### 5.3 RefRegistry (`src/perception/RefRegistry.ts`)
```ts
export class RefRegistry {
  // 每次 distill 后用新的 descriptors 替换(ref 仅在最近一次快照内有效)
  set(descriptors: ElementDescriptor[]): void;
  resolve(ref: string): ElementDescriptor;   // 不存在 → 抛 RefNotFoundError
}
```
- **每个 pageId 持有一个 RefRegistry**(挂在 SessionRegistry 的 page 记录上)。
- `distill()` 执行后调用 `set()` 刷新;动作执行前用 `resolve(ref)` 拿到 selector/domIndex。

### 5.4 PageDistiller (`src/perception/PageDistiller.ts`)
```ts
export class PageDistiller {
  // 抓取交互元素 + 结构,生成 ref、文本树、descriptors。复用旧 PageSnapshot 的 selectorFor / isVisible 逻辑。
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

// Action.ts (抽象基类,参考旧 BaseAction 的 run/runInternal 包装)
export abstract class Action {
  abstract readonly kind: ActionKind;
  protected abstract runInternal(ctx: ActionContext): Promise<Record<string, unknown> | void>;
  async start(ctx: ActionContext): Promise<ActionOutcome>;   // 包装计时/日志/错误捕获
}
```
- 定位元素:`const d = ctx.refs.resolve(ref);` 然后用 `page.locator(d.selector).nth(d.domIndex)` 操作。
- 各动作 `fieldVariables`(构造参数):
  - Click: `{ ref }`
  - Type: `{ ref, text, clearFirst?: boolean }`
  - Hover: `{ ref }`
  - Clear: `{ ref }`
  - Scroll: `{ deltaY?: number, to?: 'top'|'bottom' }`(不需要 ref)
  - SelectOption: `{ ref, value? , label? }`
  - PressKey: `{ key, ref? }`(ref 省略则对 page 按键)

### 5.6 Executor (`src/executor/Executor.ts`)
```ts
export class Executor {
  constructor(private router: BrowserRouter, private distiller: PageDistiller, private logger: Logger) {}
  // 取该 pageId 的 PageLock(同页串行,跨页并行)→ 执行 action.start → 重新 distill → 刷新 refs → 返回快照
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
  getPage(agentId: string, pageId: string): PageRecord;     // 校验归属 → OwnershipError/NotFoundError
  listBrowsers(agentId: string): BrowserRecord[];
  listPages(agentId: string, browserId: string): PageRecord[];
  closePage(agentId: string, pageId: string): Promise<void>;
  closeBrowser(agentId: string, browserId: string): Promise<void>;
  closeAgent(agentId: string): Promise<void>;               // 连接断开时清理该 agent 全部资源
}

export class BrowserRouter {
  resolvePage(agentId: string, pageId: string): PageRecord;  // 委托 SessionRegistry.getPage
}
```

### 5.8 VisionProvider (`src/vision/`)
```ts
export interface VisionProvider {
  readonly name: string;
  query(input: { imageBase64: string; mimeType: string; prompt: string }): Promise<{ text: string }>;
}
// KimiProvider: 用 openai SDK,baseURL='https://api.moonshot.cn/v1',model 默认 'moonshot-v1-8k-vision-preview'(可配)
// providerRegistry.get(name): 未配置 key → 抛 VisionNotConfiguredError(消息含"请通过 CLI/env 配置视觉 API key")
```

---

## 6. MCP 工具清单(对外接口)

所有工具入参用 zod 校验。**`pageId` 是必填**(除会话创建/列举类)。`agentId` **绝不**作为入参——由 server 从连接注入。
交互类工具执行后**自动返回精简快照文本**。

| 工具 | 入参 | 返回 |
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
| `screenshot` | `{ pageId, fullPage? }` | MCP image content(base64) |
| `click` | `{ pageId, ref, element }` | `{ outcome, snapshot }` |
| `type` | `{ pageId, ref, element, text, clearFirst? }` | `{ outcome, snapshot }` |
| `hover` | `{ pageId, ref, element }` | `{ outcome, snapshot }` |
| `clear` | `{ pageId, ref, element }` | `{ outcome, snapshot }` |
| `scroll` | `{ pageId, deltaY?, to? }` | `{ snapshot }` |
| `select_option` | `{ pageId, ref, element, value?, label? }` | `{ outcome, snapshot }` |
| `press_key` | `{ pageId, key, ref?, element? }` | `{ outcome, snapshot }` |
| `vision_query` | `{ pageId, prompt, fullPage? }` | `{ text }`(server 截图 + 转发视觉 provider;未配置 → 报错) |

> `element` 字段:人类可读的目标描述(如 "登录按钮"),用于日志/可审计,并非定位主依据(定位靠 `ref`)。

**Guidelines 走 MCP prompts**(非工具):server 把 `guidelines/*.md` 列为 prompts,agent 可 `prompts/list` 发现、
`prompts/get` 加载。每个 prompt 返回该 md 文件内容作为 user/assistant 消息文本。

---

## 7. 连接生命周期

- 新连接(新 `Mcp-Session-Id`)→ 分配 `agentId`。
- 连接关闭(transport `onclose`)→ `SessionRegistry.closeAgent(agentId)`,关闭其所有 browser。
- server 进程退出(SIGINT/SIGTERM)→ 关闭所有 agent 资源后退出。

---

## 8. 配置 (`src/config/Config.ts`)

CLI/env 均可,CLI 优先:
```
browser-mcp \
  --port 7777                 # PORT,默认 7777
  --headless                  # HEADLESS,默认 true
  --vision-provider kimi      # VISION_PROVIDER,可选
  --vision-api-key sk-xxx     # VISION_API_KEY
  --vision-model ...          # VISION_MODEL,默认按 provider
  --vision-base-url ...       # VISION_BASE_URL,默认按 provider
  --guidelines ./guidelines   # GUIDELINES_DIR,默认 ./guidelines
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

## 9. 实现约定

- ESM:相对 import **带 `.js` 扩展名**(`tsconfig` moduleResolution=Bundler,但保持 .js 后缀以兼容运行时)。
- `strict` + `noUncheckedIndexedAccess` 开启:数组下标访问需判空。
- 新增依赖前先确认是否必要;现有依赖见 §2。
- 每个模块自洽:只 import §4/§5 定义的类型,不反向依赖 server 层。
- 单一职责:tools 层只做"解析入参 → 调 router/executor/vision → 格式化返回",不写业务逻辑。
