/**
 * Retry-After in seconds, relative to receipt of the response, or null when invalid.
 * RFC 9110: https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3
 * and section 5.6.7 require delay-seconds and all three HTTP-date formats.
 */
export function parseRetryAfterSeconds(value: string | null, receivedAt: number): number | null {
  if (value === null) return null;
  const text = value.trim();
  if (/^\d+$/.test(text)) {
    const seconds = Number(text);
    return Number.isSafeInteger(seconds) ? seconds : null;
  }
  const timestamp = parseHttpDate(text, receivedAt);
  if (timestamp === null) return null;
  return Math.max(0, (timestamp - receivedAt) / 1000);
}

const DAY = '(Mon|Tue|Wed|Thu|Fri|Sat|Sun)';
const MONTH = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
const TIME = '(\\d{2}:\\d{2}:\\d{2})';
const IMF_DATE = new RegExp(`^${DAY}, (\\d{2}) ${MONTH} (\\d{4}) ${TIME} GMT$`);
const RFC850_DATE = new RegExp(
  `^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\\d{2})-${MONTH}-(\\d{2}) ${TIME} GMT$`,
);
const ASCTIME_DATE = new RegExp(`^${DAY} ${MONTH} ( \\d|\\d{2}) ${TIME} (\\d{4})$`);

function parseHttpDate(text: string, receivedAt: number): number | null {
  let canonical: string;
  const imf = IMF_DATE.exec(text);
  const rfc850 = RFC850_DATE.exec(text);
  const asctime = ASCTIME_DATE.exec(text);
  if (imf) {
    canonical = text;
  } else if (rfc850) {
    const [, weekday, day, month, shortYear, time] = rfc850;
    const currentYear = new Date(receivedAt).getUTCFullYear();
    let year = Math.floor((currentYear + 50) / 100) * 100 + Number(shortYear);
    const threshold = new Date(receivedAt);
    threshold.setUTCFullYear(currentYear + 50);
    // RFC 9110 section 5.6.7 requires a rolling 50-year interpretation, not Date.parse's pivot.
    if (Date.parse(`${day} ${month} ${year} ${time} GMT`) > threshold.getTime()) year -= 100;
    canonical = `${weekday.slice(0, 3)}, ${day} ${month} ${year} ${time} GMT`;
  } else if (asctime) {
    const [, weekday, month, day, time, year] = asctime;
    canonical = `${weekday}, ${day.trim().padStart(2, '0')} ${month} ${year} ${time} GMT`;
  } else {
    return null;
  }
  // Date.parse normalizes impossible calendar dates; round-trip before accepting them.
  // HTTP-date also permits a leap second, represented by the following instant.
  const leapSecond = canonical.endsWith(':60 GMT');
  const normalized = leapSecond ? `${canonical.slice(0, -7)}:59 GMT` : canonical;
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toUTCString() !== normalized) return null;
  return timestamp + (leapSecond ? 1000 : 0);
}
