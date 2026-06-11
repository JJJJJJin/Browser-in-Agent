import type { Page } from 'playwright';

import type { DistilledSnapshot, ElementDescriptor } from './snapshotTypes.js';

/** Max characters for the text tree handed to the agent. */
const MAX_TREE_CHARS = 6000;
/** Upper bound on interactive elements captured per snapshot. */
const MAX_INTERACTIVE = 200;
/** Upper bound on structural (heading) context lines. */
const MAX_HEADINGS = 30;
/** Upper bound on body-text lines (paragraphs / list items / table cells …). */
const MAX_TEXTS = 120;

/** Raw row returned from the in-page evaluation, before refs/tree assembly. */
type RawInteractive = {
  role: string;
  name: string;
  selector: string;
  domIndex: number;
  /** Document order, used to interleave with headings. */
  order: number;
  /** True when this element lives inside an active (blocking) modal dialog. */
  inModal: boolean;
};

type RawHeading = {
  level: number;
  name: string;
  order: number;
};

type RawText = {
  text: string;
  order: number;
};

type RawCollect = {
  url: string;
  title: string;
  scroll: { x: number; y: number };
  interactive: RawInteractive[];
  headings: RawHeading[];
  texts: RawText[];
  /** The topmost active modal dialog, if one is blocking the page. */
  modal: { present: boolean; name: string };
};

/**
 * Page → distilled semantic snapshot.
 *
 * All DOM work happens inside a single `page.evaluate`, reusing the old
 * PageSnapshot selector strategy (id > data-testid > name > class > tag) with
 * CSS.escape handling, generalized to emit a per-element selector + nth-match
 * domIndex so `locator(selector).nth(domIndex)` is unambiguous. The Node side
 * assigns refs in document order and renders the bounded text tree.
 */
export class PageDistiller {
  async distill(
    page: Page,
    pageId: string,
  ): Promise<{ snapshot: DistilledSnapshot; descriptors: ElementDescriptor[] }> {
    const raw: RawCollect = await page.evaluate(
      ({ maxInteractive, maxHeadings, maxTexts }) => {
        // Dev mode runs under tsx/esbuild with keepNames, which wraps named
        // functions in `__name(...)`. That helper is defined in Node, not in the
        // page context this function is serialized into, so shim it before any
        // wrapped inner function executes. No-op under the tsc-built output.
        (globalThis as unknown as { __name?: unknown }).__name ??= (fn: unknown) => fn;

        const cssEscape: (s: string) => string =
          (window as unknown as { CSS?: { escape?: (s: string) => string } }).CSS?.escape ??
          ((s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (m) => `\\${m}`));

        const isVisible = (el: Element): boolean => {
          const rect = (el as HTMLElement).getBoundingClientRect?.();
          if (!rect) return false;
          if (rect.width <= 1 || rect.height <= 1) return false;
          const style = window.getComputedStyle(el);
          if (style.visibility === 'hidden' || style.display === 'none') return false;
          if (style.opacity === '0') return false;
          return true;
        };

        const selectorFor = (el: Element): string => {
          const id = el.getAttribute('id');
          if (id) return `#${cssEscape(id)}`;
          const testId = el.getAttribute('data-testid');
          if (testId) return `[data-testid="${testId}"]`;
          const testAttr = el.getAttribute('data-test');
          if (testAttr) return `[data-test="${testAttr}"]`;
          const nameAttr = el.getAttribute('name');
          if (
            nameAttr &&
            (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')
          ) {
            return `${el.tagName.toLowerCase()}[name="${nameAttr}"]`;
          }
          const cls = (el.getAttribute('class') ?? '')
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2);
          if (cls.length) return `${el.tagName.toLowerCase()}.${cls.map(cssEscape).join('.')}`;
          return el.tagName.toLowerCase();
        };

        const roleFor = (el: Element): string => {
          const explicit = el.getAttribute('role');
          const tag = el.tagName.toLowerCase();
          const type = (el.getAttribute('type') ?? '').toLowerCase();
          if (explicit) {
            if (explicit === 'textbox') return 'textbox';
            return explicit;
          }
          if (tag === 'a') return 'link';
          if (tag === 'button') return 'button';
          if (tag === 'select') return 'combobox';
          if (tag === 'textarea') return 'textbox';
          if (tag === 'input') {
            if (type === 'checkbox') return 'checkbox';
            if (type === 'radio') return 'radio';
            if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
            return 'textbox';
          }
          return 'text';
        };

        const nameFor = (el: Element): string => {
          const aria = el.getAttribute('aria-label');
          if (aria && aria.trim()) return aria.trim();

          const id = el.getAttribute('id');
          if (id) {
            const label = document.querySelector(`label[for="${cssEscape(id)}"]`);
            const labelText = label?.textContent?.trim();
            if (labelText) return labelText;
          }

          // <label><input> … </label> wrapping
          const parentLabel = el.closest('label');
          if (parentLabel) {
            const t = parentLabel.textContent?.trim();
            if (t) return t;
          }

          const text = (el as HTMLElement).innerText?.trim();
          if (text) return text;

          const placeholder = el.getAttribute('placeholder');
          if (placeholder && placeholder.trim()) return placeholder.trim();

          const value = el.getAttribute('value');
          if (value && value.trim()) return value.trim();

          const title = el.getAttribute('title');
          if (title && title.trim()) return title.trim();

          return '';
        };

        const normalize = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, 140);

        // Assign each element a document-order index so interactive + heading
        // rows can be interleaved on the Node side.
        const allEls = Array.from(document.querySelectorAll<HTMLElement>('*'));
        const orderOf = new Map<Element, number>();
        allEls.forEach((el, i) => orderOf.set(el, i));

        const interactiveSelector =
          'a, button, [role="button"], input, textarea, select, [role="link"], [role="checkbox"], [role="textbox"]';

        const interactiveEls = Array.from(
          document.querySelectorAll<HTMLElement>(interactiveSelector),
        ).filter(isVisible);

        // ---- Modal detection -------------------------------------------------
        // A modal dialog drawn over a scrim blocks all interaction with the page
        // behind it, yet (a) the scrim is a non-interactive <div> we never emit
        // and (b) the dialog is injected late in the DOM, so its controls sort
        // last and get truncated out of the bounded tree. We detect the dialog
        // here so the Node side can surface it first.
        const modalSelector =
          '[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]';
        const modalEls = Array.from(
          document.querySelectorAll<HTMLElement>(modalSelector),
        ).filter(isVisible);
        try {
          // Native top-layer dialogs opened via showModal() match :modal.
          for (const el of Array.from(document.querySelectorAll<HTMLElement>(':modal'))) {
            if (!modalEls.includes(el)) modalEls.push(el);
          }
        } catch {
          // :modal unsupported in this engine — semantic selectors still apply.
        }
        const inModal = (el: Element): boolean => modalEls.some((m) => m.contains(el));

        const modalNameFor = (m: Element): string => {
          const aria = m.getAttribute('aria-label');
          if (aria && aria.trim()) return aria.trim();
          const labelledby = m.getAttribute('aria-labelledby');
          if (labelledby) {
            const parts = labelledby
              .split(/\s+/)
              .map((id) => document.getElementById(id)?.textContent?.trim())
              .filter(Boolean);
            if (parts.length) return parts.join(' ');
          }
          const heading = m.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
          const headingText = (heading as HTMLElement | null)?.innerText?.trim();
          if (headingText) return headingText;
          return '';
        };
        // The last matched dialog is the most recently opened / topmost one.
        const topModal = modalEls.length ? modalEls[modalEls.length - 1] : null;
        const modal = topModal
          ? { present: true, name: normalize(modalNameFor(topModal)) }
          : { present: false, name: '' };

        // Cache: count of matches per selector so we can compute nth index.
        const matchCache = new Map<string, Element[]>();
        const matchesFor = (selector: string): Element[] => {
          const cached = matchCache.get(selector);
          if (cached) return cached;
          let found: Element[] = [];
          try {
            found = Array.from(document.querySelectorAll(selector));
          } catch {
            found = [];
          }
          matchCache.set(selector, found);
          return found;
        };

        const interactive: Array<{
          role: string;
          name: string;
          selector: string;
          domIndex: number;
          order: number;
          inModal: boolean;
        }> = [];

        for (const el of interactiveEls) {
          if (interactive.length >= maxInteractive) break;
          const selector = selectorFor(el);
          const matches = matchesFor(selector);
          const domIndex = matches.indexOf(el);
          if (domIndex < 0) continue; // selector cannot resolve this element — skip
          interactive.push({
            role: roleFor(el),
            name: normalize(nameFor(el)),
            selector,
            domIndex,
            order: orderOf.get(el) ?? 0,
            inModal: inModal(el),
          });
        }

        const headingEls = Array.from(
          document.querySelectorAll<HTMLElement>(
            'h1, h2, h3, h4, h5, h6, [role="heading"]',
          ),
        ).filter(isVisible);

        const headings: Array<{ level: number; name: string; order: number }> = [];
        for (const el of headingEls) {
          if (headings.length >= maxHeadings) break;
          const name = normalize(nameFor(el));
          if (!name) continue;
          const tag = el.tagName.toLowerCase();
          const level = /^h[1-6]$/.test(tag)
            ? Number(tag.slice(1))
            : Number(el.getAttribute('aria-level') ?? '2') || 2;
          headings.push({ level, name, order: orderOf.get(el) ?? 0 });
        }

        // Body text: readable content the agent may need to summarize. We take
        // each element's DIRECT text (own text nodes only) so nesting doesn't
        // duplicate content, skip text inside interactive controls (already shown
        // as element names) and headings, normalize, and dedupe.
        const interactiveContainer = 'a, button, select, textarea, [role="button"], [role="link"]';
        const directText = (el: Element): string => {
          let out = '';
          for (const node of Array.from(el.childNodes)) {
            if (node.nodeType === Node.TEXT_NODE) out += node.nodeValue ?? '';
          }
          return out;
        };
        const textEls = Array.from(
          document.querySelectorAll<HTMLElement>(
            'p, li, td, th, dt, dd, blockquote, figcaption, caption, summary, pre',
          ),
        ).filter(isVisible);

        const texts: Array<{ text: string; order: number }> = [];
        const seenText = new Set<string>();
        for (const el of textEls) {
          if (texts.length >= maxTexts) break;
          if (el.closest(interactiveContainer)) continue; // text belongs to a control
          const t = normalize(directText(el));
          if (t.length < 2) continue;
          if (seenText.has(t)) continue;
          seenText.add(t);
          texts.push({ text: t, order: orderOf.get(el) ?? 0 });
        }

        return {
          url: window.location.href,
          title: document.title,
          scroll: { x: window.scrollX, y: window.scrollY },
          interactive,
          headings,
          texts,
          modal,
        };
      },
      { maxInteractive: MAX_INTERACTIVE, maxHeadings: MAX_HEADINGS, maxTexts: MAX_TEXTS },
    );

    // Assign refs in document order to interactive elements.
    const ordered = [...raw.interactive].sort((a, b) => a.order - b.order);
    const descriptors: ElementDescriptor[] = ordered.map((row, i) => ({
      ref: `e${i + 1}`,
      role: row.role,
      name: row.name,
      selector: row.selector,
      domIndex: row.domIndex,
    }));

    // Build a combined, document-ordered list of renderable lines (headings
    // without refs for context, interactive elements with refs). Interactive
    // controls inside an active modal are split out so they can be rendered
    // first — a modal injected late in the DOM would otherwise sort last and be
    // truncated out of the bounded tree, leaving the agent unable to dismiss it.
    type Line = { order: number; text: string };
    const lines: Line[] = [];
    const modalLines: Line[] = [];

    ordered.forEach((row, i) => {
      const descriptor = descriptors[i];
      if (!descriptor) return;
      const name = descriptor.name ? ` "${descriptor.name}"` : '';
      const text = `- ${descriptor.role}${name} [ref=${descriptor.ref}]`;
      // Indent modal controls so the tree reads as nested under the dialog line.
      (row.inModal ? modalLines : lines).push({
        order: row.order,
        text: row.inModal ? `  ${text}` : text,
      });
    });

    for (const h of raw.headings) {
      const name = h.name ? ` "${h.name}"` : '';
      lines.push({ order: h.order, text: `- heading${name}` });
    }

    for (const t of raw.texts) {
      lines.push({ order: t.order, text: `- text "${t.text}"` });
    }

    lines.sort((a, b) => a.order - b.order);
    modalLines.sort((a, b) => a.order - b.order);

    // Render the modal block first (header + its controls) so it is never
    // dropped by truncation, then fill the remaining budget with page content.
    let tree = '';
    const append = (text: string): boolean => {
      const candidate = tree ? `${tree}\n${text}` : text;
      if (candidate.length > MAX_TREE_CHARS) return false;
      tree = candidate;
      return true;
    };

    if (raw.modal.present) {
      const name = raw.modal.name ? ` "${raw.modal.name}"` : '';
      append(
        `- dialog${name} (modal — blocks the page; dismiss it before other actions)`,
      );
      for (const line of modalLines) {
        if (!append(line.text)) break;
      }
    }

    for (const line of lines) {
      if (!append(line.text)) break;
    }

    const snapshot: DistilledSnapshot = {
      pageId,
      url: raw.url,
      title: raw.title,
      scroll: raw.scroll,
      tree,
      elementCount: descriptors.length,
    };

    return { snapshot, descriptors };
  }
}
