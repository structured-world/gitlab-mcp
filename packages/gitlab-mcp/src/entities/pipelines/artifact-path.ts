import { encodeApiSegment } from '../../utils/api-path';

export const ARTIFACT_DEFAULT_BYTES = 64 * 1024;
export const ARTIFACT_MAX_BYTES = 1024 * 1024;
export const ARTIFACT_MAX_OFFSET = 20 * 1024 * 1024;

/** Keep a nested archive path relative and unambiguous through URL and Rails decoding. */
export function encodeArtifactPath(path: string): string {
  if (!path || path.length > 4096 || path.includes('\\') || hasControl(path)) {
    throw new Error('Artifact path must be a relative file path without control characters');
  }
  return path
    .split('/')
    .map((segment) => {
      if (!segment) throw new Error('Artifact path cannot contain empty segments');
      let decoded = segment;
      for (;;) {
        if (decoded === '.' || decoded === '..' || /[/\\]/.test(decoded) || hasControl(decoded)) {
          throw new Error('Artifact path cannot contain traversal or encoded separators');
        }
        if (!/%[0-9a-f]{2}/i.test(decoded)) break;
        const next = decodeURIComponent(decoded);
        if (next === decoded) break;
        decoded = next;
      }
      return encodeApiSegment(segment);
    })
    .join('/');
}

function hasControl(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}
