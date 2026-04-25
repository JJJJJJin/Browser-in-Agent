import type { Page } from 'playwright';

export type ClickableCandidate = {
  tag: string;
  role?: string | null;
  name?: string | null;
  text?: string;
  selector?: string;
};

export type InputCandidate = {
  tag: string;
  type?: string | null;
  label?: string | null;
  placeholder?: string | null;
  nameAttr?: string | null;
  idAttr?: string | null;
  selector?: string;
};

export type PageSnapshot = {
  url: string;
  title: string;
  viewport: { width: number; height: number } | null;
  scroll: { x: number; y: number };
  visibleText: string;
  clickables: ClickableCandidate[];
  inputs: InputCandidate[];
};

type SnapshotOptions = {
  maxTextChars?: number;
  maxCandidates?: number;
};

function normalizeWhitespace(s: string) {
  return s.replace(/\s+/g, ' ').trim();
}

export async function snapshotPage(page: Page, opts: SnapshotOptions = {}): Promise<PageSnapshot> {
  const maxTextChars = opts.maxTextChars ?? 6000;
  const maxCandidates = opts.maxCandidates ?? 60;

  const url = page.url();
  const title = await page.title().catch(() => '');
  const viewport = page.viewportSize();

  const data = await page.evaluate(
    ({ maxTextChars, maxCandidates }) => {
      const getVisibleText = () => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let out = '';
        // Accumulate visible text nodes (best-effort)
        while (walker.nextNode()) {
          const node = walker.currentNode as Text;
          const text = node.nodeValue ?? '';
          if (!text.trim()) continue;
          const el = node.parentElement;
          if (!el) continue;
          const style = window.getComputedStyle(el);
          if (style.visibility === 'hidden' || style.display === 'none') continue;
          out += text.trim() + '\n';
          if (out.length >= maxTextChars) break;
        }
        return out.slice(0, maxTextChars);
      };

      const cssEscape =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).CSS?.escape ??
        ((s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (m) => `\\${m}`));

      const selectorFor = (el: Element) => {
        const id = el.getAttribute('id');
        if (id) return `#${cssEscape(id)}`;
        const testId = el.getAttribute('data-testid') ?? el.getAttribute('data-test');
        if (testId) return `[data-testid=\"${testId}\"]`;
        const name = el.getAttribute('name');
        if (name && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) {
          return `${el.tagName.toLowerCase()}[name=\"${name}\"]`;
        }
        const cls = (el.getAttribute('class') ?? '')
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2);
        if (cls.length) return `${el.tagName.toLowerCase()}.${cls.map(cssEscape).join('.')}`;
        return el.tagName.toLowerCase();
      };

      const clickables: Array<{
        tag: string;
        text?: string;
        role?: string | null;
        name?: string | null;
        selector?: string;
      }> = [];

      const inputs: Array<{
        tag: string;
        type?: string | null;
        label?: string | null;
        placeholder?: string | null;
        nameAttr?: string | null;
        idAttr?: string | null;
        selector?: string;
      }> = [];

      const isVisible = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect?.();
        if (!r) return false;
        if (r.width <= 1 || r.height <= 1) return false;
        const style = window.getComputedStyle(el);
        return style.visibility !== 'hidden' && style.display !== 'none';
      };

      const clickableEls = Array.from(document.querySelectorAll('a,button,[role=\"button\"],input[type=\"button\"],input[type=\"submit\"]'))
        .filter(isVisible)
        .slice(0, maxCandidates);

      for (const el of clickableEls) {
        const text = (el as HTMLElement).innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '';
        clickables.push({
          tag: el.tagName.toLowerCase(),
          text: text.slice(0, 140),
          role: el.getAttribute('role'),
          name: el.getAttribute('aria-label'),
          selector: selectorFor(el),
        });
      }

      const inputEls = Array.from(document.querySelectorAll('input,textarea,select'))
        .filter(isVisible)
        .slice(0, maxCandidates);

      for (const el of inputEls) {
        const idAttr = el.getAttribute('id');
        const label = idAttr ? document.querySelector(`label[for=\"${cssEscape(idAttr)}\"]`)?.textContent ?? null : null;
        inputs.push({
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('type'),
          label: label?.slice(0, 120) ?? null,
          placeholder: el.getAttribute('placeholder'),
          nameAttr: el.getAttribute('name'),
          idAttr,
          selector: selectorFor(el),
        });
      }

      return {
        visibleText: getVisibleText(),
        clickables,
        inputs,
        scroll: { x: window.scrollX, y: window.scrollY },
      };
    },
    { maxTextChars, maxCandidates },
  );

  return {
    url,
    title,
    viewport,
    scroll: data.scroll,
    visibleText: normalizeWhitespace(data.visibleText),
    clickables: data.clickables,
    inputs: data.inputs,
  };
}

