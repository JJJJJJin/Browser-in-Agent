import { RefNotFoundError } from '../errors.js';
import type { ElementDescriptor } from './snapshotTypes.js';

/**
 * Per-page registry mapping refs (e1, e2 …) to ElementDescriptors.
 *
 * Refs are only valid within the most recent snapshot: `set()` replaces the
 * whole table after every `distill()`, and actions call `resolve(ref)` before
 * touching the page. A stale ref (page changed since the last snapshot) throws
 * RefNotFoundError so the agent knows to re-snapshot.
 */
export class RefRegistry {
  private descriptors = new Map<string, ElementDescriptor>();

  /** Replace the table with a fresh set of descriptors from the latest distill. */
  set(descriptors: ElementDescriptor[]): void {
    const next = new Map<string, ElementDescriptor>();
    for (const d of descriptors) {
      next.set(d.ref, d);
    }
    this.descriptors = next;
  }

  /** Resolve a ref to its descriptor; throws RefNotFoundError if absent. */
  resolve(ref: string): ElementDescriptor {
    const d = this.descriptors.get(ref);
    if (!d) {
      throw new RefNotFoundError(
        `ref "${ref}" is not in the current snapshot — the page may have changed, take a new snapshot`,
      );
    }
    return d;
  }
}
