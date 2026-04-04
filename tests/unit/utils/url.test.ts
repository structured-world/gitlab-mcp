/**
 * Unit tests for normalizeInstanceUrl utility
 * Covers trailing-slash stripping and API path suffix removal
 */

import { normalizeInstanceUrl } from '../../../src/utils/url';

// Both API suffixes must be stripped identically
const API_SUFFIXES = ['/api/v4', '/api/graphql'] as const;

describe('normalizeInstanceUrl', () => {
  it('should return the input unchanged when it is falsy (empty string)', () => {
    expect(normalizeInstanceUrl('')).toBe('');
  });

  it('should return a clean URL unchanged', () => {
    expect(normalizeInstanceUrl('https://gitlab.example.com')).toBe('https://gitlab.example.com');
  });

  it('should strip a single trailing slash', () => {
    expect(normalizeInstanceUrl('https://gitlab.example.com/')).toBe('https://gitlab.example.com');
  });

  it('should strip multiple trailing slashes', () => {
    expect(normalizeInstanceUrl('https://gitlab.example.com///')).toBe(
      'https://gitlab.example.com',
    );
  });

  it.each(API_SUFFIXES)('should strip %s suffix', (suffix) => {
    expect(normalizeInstanceUrl(`https://gitlab.example.com${suffix}`)).toBe(
      'https://gitlab.example.com',
    );
  });

  it.each(API_SUFFIXES)('should strip trailing slash before %s suffix', (suffix) => {
    expect(normalizeInstanceUrl(`https://gitlab.example.com${suffix}/`)).toBe(
      'https://gitlab.example.com',
    );
  });

  it.each(API_SUFFIXES)('should strip multiple trailing slashes after %s suffix', (suffix) => {
    expect(normalizeInstanceUrl(`https://gitlab.example.com${suffix}///`)).toBe(
      'https://gitlab.example.com',
    );
  });

  it.each(API_SUFFIXES)(
    'should trim trailing slashes exposed after removing %s suffix',
    (suffix) => {
      // "https://host//api/v4" → strip suffix → "https://host/" → trim → "https://host"
      expect(normalizeInstanceUrl(`https://gitlab.example.com/${suffix}`)).toBe(
        'https://gitlab.example.com',
      );
    },
  );

  it('should not strip partial API path matches', () => {
    expect(normalizeInstanceUrl('https://gitlab.example.com/api/v4extra')).toBe(
      'https://gitlab.example.com/api/v4extra',
    );
  });

  it('should handle URLs without a trailing slash or API suffix', () => {
    const url = 'https://self-hosted.gitlab.company.org/gitlab';
    expect(normalizeInstanceUrl(url)).toBe(url);
  });

  it.each(API_SUFFIXES)(
    'should strip %s suffix for self-managed instances on a subpath',
    (suffix) => {
      const trailing = suffix === '/api/graphql' ? '/' : '';
      expect(
        normalizeInstanceUrl(`https://self-hosted.gitlab.company.org/gitlab${suffix}${trailing}`),
      ).toBe('https://self-hosted.gitlab.company.org/gitlab');
    },
  );

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
    expect(normalizeInstanceUrl('not-a-url')).toBe('not-a-url');
    expect(normalizeInstanceUrl('/just/a/path/api/v4')).toBe('/just/a/path');
  });

  it.each([
    ['https://host.com/api/v4?private_token=x', 'https://host.com'],
    ['https://host.com/gitlab/api/graphql#section', 'https://host.com/gitlab'],
  ])('should strip query/fragment from %s', (input, expected) => {
    expect(normalizeInstanceUrl(input)).toBe(expected);
  });
});
