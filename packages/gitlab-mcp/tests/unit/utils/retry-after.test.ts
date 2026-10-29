import { parseRetryAfterSeconds } from '../../../src/utils/retry-after';

const receivedAt = Date.parse('2026-10-29T12:00:00.500Z');

// One parser owns both retry scheduling and the optional MCP hint; never invent a wait.
it.each([
  ['30', 30],
  ['0', 0],
  ['001', 1],
  [' 30\t', 30],
  [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
  ['Thu, 29 Oct 2026 12:00:31 GMT', 30.5],
  ['Thursday, 29-Oct-26 12:00:31 GMT', 30.5],
  ['Thu Oct 29 12:00:31 2026', 30.5],
  ['Thu, 29 Oct 2026 11:59:59 GMT', 0],
  ['Thu, 29 Oct 2026 12:00:60 GMT', 59.5],
  [null, null],
  ['', null],
  ['-1', null],
  ['1.5', null],
  ['1e3', null],
  ['Infinity', null],
  ['NaN', null],
  ['9007199254740992', null],
  ['9'.repeat(400), null],
  ['tomorrow', null],
  ['2026-10-29T12:00:31Z', null],
  ['30, 60', null],
  ['Thu, 29 Oct 2026 25:00:00 GMT', null],
  ['Mon, 30 Feb 2026 12:00:00 GMT', null],
  ['Fri, 29 Oct 2026 12:00:31 GMT', null],
])('normalizes Retry-After %j to %j seconds', (header, expected) => {
  expect(parseRetryAfterSeconds(header, receivedAt)).toBe(expected);
});

// RFC 850 years must use the receipt clock rather than JavaScript's fixed two-digit pivot.
it('accepts a future two-digit year within fifty years and rolls a later year back', () => {
  const receipt = Date.parse('2050-01-01T00:00:00Z');
  const future = Date.parse('2076-10-29T12:00:00Z');
  const weekday = new Date(future).toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: 'UTC',
  });
  expect(parseRetryAfterSeconds(`${weekday}, 29-Oct-76 12:00:00 GMT`, receipt)).toBe(
    (future - receipt) / 1000,
  );
  expect(parseRetryAfterSeconds('Sunday, 06-Nov-94 08:49:37 GMT', receivedAt)).toBe(0);
});

// A two-digit year can name the next century when that date is within the fifty-year window.
it('interprets an RFC 850 date across the century boundary', () => {
  const receipt = Date.parse('2090-01-01T00:00:00Z');
  const future = Date.parse('2101-01-01T00:00:00Z');
  const weekday = new Date(future).toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: 'UTC',
  });
  expect(parseRetryAfterSeconds(`${weekday}, 01-Jan-01 00:00:00 GMT`, receipt)).toBe(
    (future - receipt) / 1000,
  );
});
