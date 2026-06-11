import type { Action } from '../actions/Action.js';
import type { ActionOutcome } from '../actions/types.js';
import type { Logger } from '../logger.js';
import type { PageDistiller } from '../perception/PageDistiller.js';
import type { DistilledSnapshot } from '../perception/snapshotTypes.js';
import type { BrowserRouter } from '../router/BrowserRouter.js';

import { PageLock } from './PageLock.js';

/**
 * Runs a single atomic action against a page, then returns a fresh distilled
 * snapshot. Actions on the same pageId are serialized via PageLock (different
 * pages run concurrently). After the action, the page is re-distilled and the
 * page's RefRegistry is refreshed so the returned snapshot's refs are valid.
 */
export class Executor {
  private readonly locks = new PageLock();

  constructor(
    private readonly router: BrowserRouter,
    private readonly distiller: PageDistiller,
    private readonly logger: Logger,
  ) {}

  async run(
    agentId: string,
    pageId: string,
    action: Action,
  ): Promise<{ outcome: ActionOutcome; snapshot: DistilledSnapshot }> {
    // Ownership / existence is enforced here; throws OwnershipError/NotFoundError.
    const record = this.router.resolvePage(agentId, pageId);

    return this.locks.run(pageId, async () => {
      const log = this.logger.child({ scope: 'executor', agentId, pageId });

      const outcome = await action.start({
        page: record.page,
        refs: record.refs,
        logger: log,
      });

      // Always re-distill so the agent sees the post-action page, even on a
      // failed action (the failure detail is in `outcome`).
      const { snapshot, descriptors } = await this.distiller.distill(
        record.page,
        pageId,
      );
      record.refs.set(descriptors);

      log.info(
        { kind: outcome.kind, ok: outcome.ok, elementCount: snapshot.elementCount },
        'executor.run.complete',
      );

      return { outcome, snapshot };
    });
  }
}
