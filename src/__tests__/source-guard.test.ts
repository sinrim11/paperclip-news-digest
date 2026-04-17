import { describe, it, expect } from 'vitest';
import {
  assertSourceAllowed,
  isSourceAllowed,
  isSourceDeferred,
  getAllowedSourceTypes,
  DeferredSourceError,
  UnknownSourceError,
} from '../lib/source-guard';

describe('source-guard: allowed sources', () => {
  it('passes for all 6 allowed source types', () => {
    const allowed = ['rss', 'github', 'arxiv', 'hn', 'pwc', 'newsletter'];
    for (const t of allowed) {
      expect(() => assertSourceAllowed(t)).not.toThrow();
    }
  });

  it('isSourceAllowed returns true for rss and false for unknown', () => {
    expect(isSourceAllowed('rss')).toBe(true);
    expect(isSourceAllowed('tiktok')).toBe(false);
  });

  it('getAllowedSourceTypes returns exactly 6 types', () => {
    expect(getAllowedSourceTypes()).toHaveLength(6);
    expect(getAllowedSourceTypes()).toContain('rss');
    expect(getAllowedSourceTypes()).toContain('newsletter');
  });
});

describe('source-guard: deferred sources', () => {
  it('throws DeferredSourceError for podcast', () => {
    expect(() => assertSourceAllowed('podcast')).toThrow(DeferredSourceError);
    expect(() => assertSourceAllowed('podcast')).toThrow(/deferred/);
  });

  it('throws DeferredSourceError for twitter', () => {
    expect(() => assertSourceAllowed('twitter')).toThrow(DeferredSourceError);
    expect(() => assertSourceAllowed('twitter')).toThrow(/deferred/);
  });

  it('isSourceDeferred correctly identifies deferred types', () => {
    expect(isSourceDeferred('podcast')).toBe(true);
    expect(isSourceDeferred('twitter')).toBe(true);
    expect(isSourceDeferred('rss')).toBe(false);
  });
});

describe('source-guard: unknown sources', () => {
  it('throws UnknownSourceError for an arbitrary unknown type', () => {
    expect(() => assertSourceAllowed('tiktok')).toThrow(UnknownSourceError);
    expect(() => assertSourceAllowed('tiktok')).toThrow(/not in the frozen allowlist/);
  });

  it('error message includes the list of allowed types', () => {
    try {
      assertSourceAllowed('facebook');
    } catch (e) {
      expect(e).toBeInstanceOf(UnknownSourceError);
      expect((e as UnknownSourceError).message).toContain('rss');
    }
  });

  it('throws for empty string source type', () => {
    expect(() => assertSourceAllowed('')).toThrow(UnknownSourceError);
  });
});
