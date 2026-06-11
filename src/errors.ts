/**
 * Domain errors. Tool handlers map these to MCP error responses with the `code`
 * so agents can react (e.g. re-snapshot on RefNotFoundError, ask the user on
 * VisionNotConfiguredError).
 */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** pageId / browserId exists but does not belong to the requesting agent. */
export class OwnershipError extends DomainError {
  constructor(message: string) {
    super('OWNERSHIP_DENIED', message);
  }
}

/** browserId / pageId does not exist. */
export class NotFoundError extends DomainError {
  constructor(message: string) {
    super('NOT_FOUND', message);
  }
}

/** ref is not present in the current snapshot (page changed — agent should re-snapshot). */
export class RefNotFoundError extends DomainError {
  constructor(message: string) {
    super('REF_NOT_FOUND', message);
  }
}

/** vision_query called but no vision provider is configured. */
export class VisionNotConfiguredError extends DomainError {
  constructor(message: string) {
    super('VISION_NOT_CONFIGURED', message);
  }
}
