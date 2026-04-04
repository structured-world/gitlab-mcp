/**
 * Unit tests for normalizeInstanceUrl utility
 * Covers trailing-slash stripping and API path suffix removal
 */

import { normalizeInstanceUrl } from '../../../src/utils/url';

describe('normalizeInstanceUrl', () => {
  it('should return the input unchanged when it is falsy (empty string)', () => {
    // Empty string is falsy — early return preserves it as-is
    expect(normalizeInstanceUrl('')).toBe('');
  });

  it('should return a clean URL unchanged', () => {
    expect(normalizeInstanceUrl('https://gitlab.example.com')).toBe('https://gitlab.example.com');
  });

  it('should strip a single trailing slash', () => {
    // Trailing slash is removed before suffix checks
    expect(normalizeInstanceUrl('https://gitlab.example.com/')).toBe('https://gitlab.example.com');
  });

  it('should strip multiple trailing slashes', () => {
    expect(normalizeInstanceUrl('https://gitlab.example.com///')).toBe(
      'https://gitlab.example.com',
    );
  });

  it('should strip /api/v4 suffix', () => {
    // /api/v4 suffix removal
    expect(normalizeInstanceUrl('https://gitlab.example.com/api/v4')).toBe(
      'https://gitlab.example.com',
    );
  });

  it('should strip /api/graphql suffix', () => {
    // /api/graphql suffix removal
    expect(normalizeInstanceUrl('https://gitlab.example.com/api/graphql')).toBe(
      'https://gitlab.example.com',
    );
  });

  it('should strip trailing slash before checking API path suffix', () => {
    // Trailing slash stripped first, then suffix checked — /api/v4/ → /api/v4 → base
    expect(normalizeInstanceUrl('https://gitlab.example.com/api/v4/')).toBe(
      'https://gitlab.example.com',
    );
    // Same for /api/graphql/ combined path
    expect(normalizeInstanceUrl('https://gitlab.example.com/api/graphql/')).toBe(
      'https://gitlab.example.com',
    );
  });

  it('should strip multiple trailing slashes before checking API path suffix', () => {
    // Multiple trailing slashes are collapsed first, then suffix is removed — verifies
    // single-pass normalization order handles both patterns simultaneously
    expect(normalizeInstanceUrl('https://gitlab.example.com/api/v4///')).toBe(
      'https://gitlab.example.com',
    );
    expect(normalizeInstanceUrl('https://gitlab.example.com/api/graphql///')).toBe(
      'https://gitlab.example.com',
    );
  });

  it('should trim trailing slashes exposed after suffix removal', () => {
    // Regression: "https://host//api/v4" → strip slashes leaves "https://host//api/v4"
    // (first / is not trailing) → strip suffix → "https://host/" → second trim → "https://host"
    expect(normalizeInstanceUrl('https://gitlab.example.com//api/v4')).toBe(
      'https://gitlab.example.com',
    );
    expect(normalizeInstanceUrl('https://gitlab.example.com//api/graphql')).toBe(
      'https://gitlab.example.com',
    );
  });

  it('should not strip partial API path matches', () => {
    // /api/v4extra does not end with /api/v4 so it is preserved
    expect(normalizeInstanceUrl('https://gitlab.example.com/api/v4extra')).toBe(
      'https://gitlab.example.com/api/v4extra',
    );
  });

  it('should handle URLs without a trailing slash or API suffix', () => {
    const url = 'https://self-hosted.gitlab.company.org/gitlab';
    expect(normalizeInstanceUrl(url)).toBe(url);
  });

  it('should strip API suffixes for self-managed instances on a subpath', () => {
    expect(normalizeInstanceUrl('https://self-hosted.gitlab.company.org/gitlab/api/v4')).toBe(
      'https://self-hosted.gitlab.company.org/gitlab',
    );
    expect(normalizeInstanceUrl('https://self-hosted.gitlab.company.org/gitlab/api/graphql/')).toBe(
      'https://self-hosted.gitlab.company.org/gitlab',
    );
  });

  it('should strip default ports for canonical map keys', () => {
    expect(normalizeInstanceUrl('https://gitlab.example.com:443')).toBe(
      'https://gitlab.example.com',
    );
    expect(normalizeInstanceUrl('http://gitlab.example.com:80')).toBe('http://gitlab.example.com');
    // Non-default ports preserved
    expect(normalizeInstanceUrl('https://gitlab.example.com:8443')).toBe(
      'https://gitlab.example.com:8443',
    );
    // Self-hosted with subpath + default port
    expect(normalizeInstanceUrl('https://host.com:443/gitlab/api/v4')).toBe(
      'https://host.com/gitlab',
    );
  });

  it('should gracefully fall back when URL parsing fails', () => {
    // Malformed URLs that new URL() rejects — fallback to string-based normalization
    expect(normalizeInstanceUrl('not-a-url')).toBe('not-a-url');
    expect(normalizeInstanceUrl('/just/a/path/api/v4')).toBe('/just/a/path');
  });

  it('should strip query/fragment and re-strip API suffix after URL parsing', () => {
    // URL constructor drops query/fragment but preserves pathname — second suffix
    // strip pass catches the remaining /api/v4
    expect(normalizeInstanceUrl('https://host.com/api/v4?private_token=x')).toBe(
      'https://host.com',
    );
    expect(normalizeInstanceUrl('https://host.com/gitlab/api/graphql#section')).toBe(
      'https://host.com/gitlab',
    );
  });
});
