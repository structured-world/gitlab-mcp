/** Reject path syntax that URL parsing could reinterpret before GitLab receives it. */
export function assertNoDotSegments(value: string): void {
  // WHATWG URL, URL path state: even percent-encoded dot segments shorten the path.
  // https://url.spec.whatwg.org/#path-state
  let start = 0;
  for (let end = 0; end <= value.length; end++) {
    if (end !== value.length && value[end] !== '/' && value[end] !== '\\') continue;
    const length = end - start;
    if (value[start] === '.' && (length === 1 || (length === 2 && value[start + 1] === '.'))) {
      throw new Error('Invalid API path: dot segment');
    }
    start = end + 1;
  }
}

/** Encode one raw API argument, preserving filenames, refs and names as one segment. */
export function encodeApiSegment(value: string | number): string {
  const text = String(value);
  assertNoDotSegments(text);
  return encodeURIComponent(text);
}

/** Validate a relative REST path before query serialization or any authenticated I/O. */
export function assertSafeApiPath(path: string): void {
  if (/[?#\\]/.test(path) || path.startsWith('/') || hasAsciiControlOrSpace(path)) {
    throw new Error('Invalid API path: unencoded path delimiter');
  }
  assertNoDotSegments(decodeURIComponent(path));
}

/** Apply the same path boundary to REST calls returning raw bytes or custom responses. */
export function assertSafeApiUrl(url: string): void {
  const start = url.indexOf('/api/v4/');
  if (start === -1) return;
  const query = url.indexOf('?', start);
  assertSafeApiPath(url.slice(start + '/api/v4/'.length, query === -1 ? undefined : query));
}

/** One canonical identity shared by project/group URLs and scope comparisons. */
export function canonicalProjectPath(input: string): string {
  const path = decodeURIComponent(input.trim());
  assertNoDotSegments(path);
  if (!path || /[?#\\%]/.test(path) || hasAsciiControlOrSpace(path)) {
    throw new Error('Invalid project identifier');
  }
  return path;
}

function hasAsciiControlOrSpace(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 32 || code === 127) return true;
  }
  return false;
}
