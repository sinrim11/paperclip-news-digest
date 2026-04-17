import allowlistData from '../../config/source-allowlist.json';

export interface SourceTypeEntry {
  type: string;
  label: string;
  deferred: boolean;
  deferredReason?: string;
}

const allowlist: SourceTypeEntry[] = allowlistData.sourceTypes as SourceTypeEntry[];

const allowedSet = new Set(
  allowlist.filter((s) => !s.deferred).map((s) => s.type)
);

const deferredSet = new Set(
  allowlist.filter((s) => s.deferred).map((s) => s.type)
);

export class DeferredSourceError extends Error {
  constructor(public readonly sourceType: string, reason?: string) {
    super(
      `Source type "${sourceType}" is deferred and not yet supported` +
        (reason ? `: ${reason}` : '')
    );
    this.name = 'DeferredSourceError';
  }
}

export class UnknownSourceError extends Error {
  constructor(public readonly sourceType: string) {
    super(
      `Source type "${sourceType}" is not in the frozen allowlist. ` +
        `Allowed types: ${[...allowedSet].join(', ')}`
    );
    this.name = 'UnknownSourceError';
  }
}

/**
 * Throws if sourceType is not in the frozen allowlist or is explicitly deferred.
 * Call before adding any new source to the pipeline.
 */
export function assertSourceAllowed(sourceType: string): void {
  if (deferredSet.has(sourceType)) {
    const entry = allowlist.find((s) => s.type === sourceType)!;
    throw new DeferredSourceError(sourceType, entry.deferredReason);
  }
  if (!allowedSet.has(sourceType)) {
    throw new UnknownSourceError(sourceType);
  }
}

export function isSourceAllowed(sourceType: string): boolean {
  return allowedSet.has(sourceType);
}

export function isSourceDeferred(sourceType: string): boolean {
  return deferredSet.has(sourceType);
}

export function getAllowedSourceTypes(): string[] {
  return [...allowedSet];
}
