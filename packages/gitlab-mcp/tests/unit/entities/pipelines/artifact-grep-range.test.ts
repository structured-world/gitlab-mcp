import {
  ARTIFACT_GREP_MAX_BYTES,
  assertLeadingRange,
} from '../../../../src/entities/pipelines/artifact-grep';
import { ArtifactReadError } from '../../../../src/entities/pipelines/artifact-window';

const LIMIT = ARTIFACT_GREP_MAX_BYTES;

// A partial response is searched only when it covers the whole file or reaches the byte past
// the scan limit; anything shorter would leave bytes unsearched behind a complete result.
describe('assertLeadingRange', () => {
  it.each([
    ['a whole known file', 'bytes 0-9/10', 10],
    ['the full range of a longer known file', `bytes 0-${LIMIT}/${LIMIT + 50}`, LIMIT + 1],
    // With an unknown total only the full range shows whether the file continues.
    ['the full range of unknown total', `bytes 0-${LIMIT}/*`, LIMIT + 1],
  ])('accepts %s and returns its length', (_, header, length) => {
    expect(assertLeadingRange(header)).toBe(length);
  });

  it.each([
    ['part of a known file', 'bytes 0-4/10'],
    ['a short range of unknown total', 'bytes 0-4/*'],
    ['one byte short of the full range of unknown total', `bytes 0-${LIMIT - 1}/*`],
  ])('refuses %s', (_, header) => {
    expect(() => assertLeadingRange(header)).toThrow(
      expect.objectContaining({ reason: 'invalid_range' }) as ArtifactReadError,
    );
  });
});
