/**
 * Shared utility functions for the bug report API.
 * Extracted for testability — these are pure functions with no CF runtime dependencies.
 */

export interface BugReport {
  page: string;
  description: string;
  expected?: string;
  category?: string;
  honeypot?: string;
}

export const ALLOWED_ORIGINS = [
  "https://structured-world.github.io",
  "http://localhost:5173",
  "http://localhost:4173",
];

export const RATE_LIMIT_MAX = 5;
export const MIN_DESCRIPTION_LENGTH = 10;

export const CATEGORIES = [
  "Documentation is wrong/outdated",
  "Tool not working as described",
  "Missing information",
  "Installation/setup issue",
  "Other",
];

/**
 * Generate CORS headers restricted to allowed origins.
 */
export function corsHeaders(origin: string): Record<string, string> {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

/**
 * Validate and sanitize the bug report input.
 */
export function validateReport(
  data: unknown
): { valid: true; report: BugReport } | { valid: false; error: string } {
  if (!data || typeof data !== "object") {
    return { valid: false, error: "Invalid request body" };
  }

  const raw = data as Record<string, unknown>;

  // Honeypot check — must be empty
  const honeypot = raw.honeypot;
  if (typeof honeypot === "string" && honeypot.trim() !== "") {
    return { valid: false, error: "Invalid submission" };
  }

  // Required: description
  const rawDescription = raw.description;
  if (!rawDescription || typeof rawDescription !== "string") {
    return { valid: false, error: "Description is required" };
  }

  const description = rawDescription.trim();
  if (description.length < MIN_DESCRIPTION_LENGTH) {
    return {
      valid: false,
      error: `Description must be at least ${MIN_DESCRIPTION_LENGTH} characters`,
    };
  }

  // Sanitize page path
  const page = typeof raw.page === "string" ? raw.page.trim().slice(0, 200) : "/unknown";

  // Optional: expected
  const expected =
    typeof raw.expected === "string" ? raw.expected.trim().slice(0, 2000) : undefined;

  // Optional: category (validate against allowed values)
  let category: string | undefined;
  if (typeof raw.category === "string" && CATEGORIES.includes(raw.category)) {
    category = raw.category;
  }

  return {
    valid: true,
    report: {
      page,
      description: description.slice(0, 2000),
      expected: expected || undefined,
      category,
    },
  };
}

/**
 * Base64url encoding for JWT components.
 */
export function base64url(input: string | ArrayBuffer): string {
  let base64: string;
  if (typeof input === "string") {
    base64 = btoa(input);
  } else {
    const bytes = new Uint8Array(input);
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    base64 = btoa(binary);
  }
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * ASN.1 DER length encoding.
 */
export function asn1Length(length: number): Uint8Array {
  if (length < 0x80) {
    return new Uint8Array([length]);
  }
  const bytes: number[] = [];
  let temp = length;
  while (temp > 0) {
    bytes.unshift(temp & 0xff);
    temp >>= 8;
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

/**
 * Concatenate multiple Uint8Arrays into one.
 */
export function concatBuffers(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}
