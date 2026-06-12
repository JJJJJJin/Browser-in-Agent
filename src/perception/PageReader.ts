import type { Page } from 'playwright';

/** Default character budget returned in one read (pages can be huge). */
const DEFAULT_MAX_CHARS = 20_000;
/** Hard ceiling on a single read, to protect the agent's token budget. */
const MAX_MAX_CHARS = 100_000;

export type ReadMode = 'main' | 'full';

export type PageReadOptions = {
  /** CSS selector to scope the read to one element/region. Overrides `mode`'s root choice. */
  selector?: string;
  /** 'main' (default) extracts the primary content; 'full' reads the whole <body>. */
  mode?: ReadMode;
  /** Max characters to return in this call (default 20000, capped at 100000). */
  maxChars?: number;
  /** Character offset into the extracted text, for paging through long pages. */
  offset?: number;
};

export type PageReadResult = {
  url: string;
  title: string;
  mode: ReadMode;
  selector?: string;
  /** The (possibly sliced) extracted text. */
  text: string;
  /** Full extracted length before slicing. */
  totalChars: number;
  offset: number;
  returnedChars: number;
  /** True when more text remains beyond `offset + returnedChars`. */
  truncated: boolean;
  /** Offset to pass next to continue reading; present only when truncated. */
  nextOffset?: number;
};

/** Shape returned from the in-page evaluation. */
type RawRead = {
  url: string;
  title: string;
  /** Full extracted text; empty string when the selector matched nothing. */
  text: string;
  /** True when a selector was supplied but resolved to no element. */
  notFound: boolean;
};

/**
 * Page → readable text content.
 *
 * Where `PageDistiller` produces a token-efficient *interactive* tree for acting
 * (body text deliberately capped/truncated), `PageReader` extracts the page's
 * readable prose for the agent to read, summarize, or extract facts from.
 *
 * Strategy (all inside one `page.evaluate`):
 *  - pick a root: an explicit `selector`, else the main-content container
 *    (`main`/`article`/`[role=main]`, scored by text length) for `mode:'main'`,
 *    else `<body>` for `mode:'full'`;
 *  - collect the *leaf-most* block elements (p, li, headings, td, …) and emit
 *    each one's `innerText` once, prefixing headings with `#` and list items
 *    with `-`. Emitting only leaf-most blocks avoids the nested-container
 *    duplication problem while keeping inline link/emphasis text in the prose;
 *  - in `mode:'main'` with no explicit selector, skip page chrome
 *    (nav/header/footer/aside and their ARIA roles);
 *  - fall back to the root's `innerText` for div-soup / SPA pages where the
 *    block-leaf pass finds little.
 *
 * The Node side then pages the result via `offset`/`maxChars`.
 */
export class PageReader {
  async read(page: Page, options: PageReadOptions = {}): Promise<PageReadResult> {
    const mode: ReadMode = options.selector ? (options.mode ?? 'main') : (options.mode ?? 'main');
    const offset = Math.max(0, Math.floor(options.offset ?? 0));
    const maxChars = Math.min(
      MAX_MAX_CHARS,
      Math.max(1, Math.floor(options.maxChars ?? DEFAULT_MAX_CHARS)),
    );

    const raw: RawRead = await page.evaluate(
      ({ selector, mode: evMode }) => {
        // Dev mode (tsx/esbuild keepNames) wraps named functions in `__name(...)`,
        // which is undefined in the page context this body is serialized into.
        // Shim it before any wrapped inner function runs; no-op in built output.
        (globalThis as unknown as { __name?: unknown }).__name ??= (fn: unknown) => fn;

        const applyChromeFilter = !selector && evMode === 'main';

        const isVisible = (el: Element): boolean => {
          const rect = (el as HTMLElement).getBoundingClientRect?.();
          if (!rect) return false;
          if (rect.width <= 1 || rect.height <= 1) return false;
          const style = window.getComputedStyle(el);
          if (style.visibility === 'hidden' || style.display === 'none') return false;
          if (style.opacity === '0') return false;
          return true;
        };

        const CHROME_TAGS = new Set(['NAV', 'HEADER', 'FOOTER', 'ASIDE']);
        const CHROME_ROLES = new Set([
          'navigation',
          'banner',
          'contentinfo',
          'complementary',
          'search',
        ]);
        const isChrome = (el: Element): boolean => {
          if (CHROME_TAGS.has(el.tagName)) return true;
          const role = el.getAttribute('role');
          if (role && CHROME_ROLES.has(role)) return true;
          if (el.getAttribute('aria-hidden') === 'true') return true;
          return false;
        };
        const inChrome = (el: Element, root: Element): boolean => {
          let cur: Element | null = el;
          while (cur && cur !== root) {
            if (isChrome(cur)) return true;
            cur = cur.parentElement;
          }
          return false;
        };

        const innerTextOf = (el: Element): string =>
          ((el as HTMLElement).innerText ?? el.textContent ?? '');

        // Choose the content root.
        let root: Element | null;
        if (selector) {
          root = document.querySelector(selector);
          if (!root) {
            return { url: window.location.href, title: document.title, text: '', notFound: true };
          }
        } else if (evMode === 'full') {
          root = document.body;
        } else {
          const candidates = Array.from(
            document.querySelectorAll<HTMLElement>('main, article, [role="main"]'),
          ).filter(isVisible);
          let best: Element | null = null;
          let bestLen = 0;
          for (const c of candidates) {
            const len = innerTextOf(c).trim().length;
            if (len > bestLen) {
              best = c;
              bestLen = len;
            }
          }
          root = best ?? document.body;
        }
        if (!root) {
          return { url: window.location.href, title: document.title, text: '', notFound: false };
        }

        const BLOCK_LEAF = 'p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,figcaption,caption,dt,dd,td,th';
        const normalize = (s: string): string => s.replace(/[ \t]*\n[ \t]*/g, '\n').replace(/[ \t]+/g, ' ').trim();
        const collapseInline = (s: string): string => s.replace(/\s+/g, ' ').trim();

        const lines: string[] = [];
        const seen = new Set<string>();
        const pushLine = (line: string): void => {
          if (!line) return;
          // Drop an immediately repeated line (common with duplicated headers).
          const last = lines.length ? lines[lines.length - 1] : undefined;
          if (last === line) return;
          lines.push(line);
        };

        const leaves = Array.from(root.querySelectorAll<HTMLElement>(BLOCK_LEAF)).filter((el) => {
          if (!isVisible(el)) return false;
          if (applyChromeFilter && inChrome(el, root as Element)) return false;
          // Keep only leaf-most blocks so nested containers don't double-count.
          if (el.querySelector(BLOCK_LEAF)) return false;
          return true;
        });

        for (const el of leaves) {
          const tag = el.tagName.toLowerCase();
          if (tag === 'pre') {
            const code = innerTextOf(el).replace(/\s+$/g, '');
            if (code.trim()) pushLine(code);
            continue;
          }
          const text = collapseInline(innerTextOf(el));
          if (text.length < 1) continue;
          let line: string;
          if (/^h[1-6]$/.test(tag)) {
            line = `${'#'.repeat(Number(tag.slice(1)))} ${text}`;
          } else if (tag === 'li') {
            line = `- ${text}`;
          } else {
            line = text;
          }
          // Cross-block dedupe only for short repeated bits (nav-like noise);
          // keep long paragraphs even if a substring repeats elsewhere.
          if (text.length <= 60) {
            if (seen.has(line)) continue;
            seen.add(line);
          }
          pushLine(line);
        }

        let text = lines.join('\n');

        // Div-soup / SPA fallback: block-leaf pass found little but the root
        // clearly renders text — use its innerText, paragraph-split.
        const rootText = normalize(innerTextOf(root));
        if (text.trim().length < 200 && rootText.length > text.trim().length) {
          text = rootText
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l.length > 0)
            .join('\n');
        }

        // Collapse runs of blank lines.
        text = text.replace(/\n{3,}/g, '\n\n').trim();

        return { url: window.location.href, title: document.title, text, notFound: false };
      },
      { selector: options.selector ?? null, mode },
    );

    if (raw.notFound) {
      return {
        url: raw.url,
        title: raw.title,
        mode,
        ...(options.selector !== undefined ? { selector: options.selector } : {}),
        text: '',
        totalChars: 0,
        offset,
        returnedChars: 0,
        truncated: false,
      };
    }

    const total = raw.text.length;
    const start = Math.min(offset, total);
    const slice = raw.text.slice(start, start + maxChars);
    const end = start + slice.length;
    const truncated = end < total;

    return {
      url: raw.url,
      title: raw.title,
      mode,
      ...(options.selector !== undefined ? { selector: options.selector } : {}),
      text: slice,
      totalChars: total,
      offset: start,
      returnedChars: slice.length,
      truncated,
      ...(truncated ? { nextOffset: end } : {}),
    };
  }
}
