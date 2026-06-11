import type { Engine } from '../browser/BrowserManager.js';
import type { BrowserRecord, PageRecord, SessionRegistry } from './SessionRegistry.js';

/**
 * High-level facade over SessionRegistry. Tools talk only to the router: it
 * resolves pages with ownership enforcement and exposes thin pass-throughs for
 * the lifecycle operations (create / list / close) the tools need, so the tool
 * layer never reaches into the registry's internals.
 */
export class BrowserRouter {
  constructor(private readonly registry: SessionRegistry) {}

  /** Resolve a page for an agent (existence + ownership enforced by the registry). */
  resolvePage(agentId: string, pageId: string): PageRecord {
    return this.registry.getPage(agentId, pageId);
  }

  /** Resolve a browser for an agent (existence + ownership enforced). */
  resolveBrowser(agentId: string, browserId: string): BrowserRecord {
    return this.registry.getBrowser(agentId, browserId);
  }

  createBrowser(agentId: string, engine: Engine): Promise<BrowserRecord> {
    return this.registry.createBrowser(agentId, engine);
  }

  createPage(agentId: string, browserId: string): Promise<PageRecord> {
    return this.registry.createPage(agentId, browserId);
  }

  listBrowsers(agentId: string): BrowserRecord[] {
    return this.registry.listBrowsers(agentId);
  }

  listPages(agentId: string, browserId: string): PageRecord[] {
    return this.registry.listPages(agentId, browserId);
  }

  closePage(agentId: string, pageId: string): Promise<void> {
    return this.registry.closePage(agentId, pageId);
  }

  closeBrowser(agentId: string, browserId: string): Promise<void> {
    return this.registry.closeBrowser(agentId, browserId);
  }

  closeAgent(agentId: string): Promise<void> {
    return this.registry.closeAgent(agentId);
  }
}
