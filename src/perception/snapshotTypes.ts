/**
 * Shared perception types. The distilled snapshot is what the agent "sees":
 * a token-efficient semantic tree where each interactive element carries a
 * `ref` the agent uses to target atomic actions.
 */

/** A single interactive element, addressable by `ref` within the latest snapshot. */
export type ElementDescriptor = {
  /** Stable within one snapshot only, e.g. 'e1', 'e2'. */
  ref: string;
  /** Semantic role: button | link | textbox | checkbox | radio | combobox | heading | text … */
  role: string;
  /** Human-readable name (innerText / aria-label / associated label / placeholder). */
  name: string;
  /** CSS selector used to resolve the element for actions. */
  selector: string;
  /** Index used with `locator(selector).nth(domIndex)` when the selector matches multiple nodes. */
  domIndex: number;
};

/** The page view returned to the agent after perception / actions. */
export type DistilledSnapshot = {
  pageId: string;
  url: string;
  title: string;
  scroll: { x: number; y: number };
  /**
   * Text tree shown to the agent, e.g.:
   *   - heading "Login"
   *   - textbox "Username" [ref=e7]
   *   - button "Sign in" [ref=e23]
   */
  tree: string;
  /** Number of interactive elements captured (refs assigned). */
  elementCount: number;
};
