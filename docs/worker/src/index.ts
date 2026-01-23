/**
 * Cloudflare Worker: API backend for gitlab-mcp.sw.foundation
 *
 * Handles POST /api/report-bug — creates GitHub issues from the docs feedback widget.
 * Deployed as a standalone Worker with a route rule that intercepts /api/* before GitHub Pages.
 *
 * Required secrets (set via `wrangler secret put` or CF dashboard):
 * - GITHUB_APP_ID
 * - GITHUB_APP_PEM (base64-encoded RSA private key)
 * - GITHUB_APP_INSTALLATION_ID
 *
 * Optional bindings:
 * - RATE_LIMIT_KV (KV namespace for IP-based rate limiting)
 */

interface Env {
  GITHUB_APP_ID: string;
  GITHUB_APP_PEM: string;
  GITHUB_APP_INSTALLATION_ID: string;
  RATE_LIMIT_KV?: KVNamespace;
}

interface BugReport {
  page: string;
  description: string;
  expected?: string;
  category?: string;
}

const REPO_OWNER = "structured-world";
const REPO_NAME = "gitlab-mcp";
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_SECONDS = 3600;
const MIN_DESCRIPTION_LENGTH = 10;

const CATEGORIES = [
  "Documentation is wrong/outdated",
  "Tool not working as described",
  "Missing information",
  "Installation/setup issue",
  "Other",
];

const ALLOWED_ORIGINS = [
  "https://gitlab-mcp.sw.foundation",
  "https://structured-world.github.io",
  "http://localhost:5173",
  "http://localhost:4173",
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname !== "/api/report-bug") {
      return new Response("Not Found", { status: 404 });
    }

    if (request.method === "OPTIONS") {
      return handleOptions(request);
    }

    if (request.method === "POST") {
      return handlePost(request, env);
    }

    return new Response("Method Not Allowed", { status: 405 });
  },
};

function corsHeaders(origin: string): Record<string, string> {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function handleOptions(request: Request): Response {
  const origin = request.headers.get("Origin") || "";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

async function handlePost(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };

  try {
    // Rate limit
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const rateLimit = await checkRateLimit(env.RATE_LIMIT_KV, ip);
    if (!rateLimit.allowed) {
      return new Response(JSON.stringify({ error: "Too many reports. Please try again later." }), {
        status: 429,
        headers,
      });
    }

    // Validate
    const body = await request.json();
    const validation = validateReport(body);
    if (!validation.valid) {
      return new Response(JSON.stringify({ error: validation.error }), { status: 400, headers });
    }

    // Create GitHub issue via App authentication
    const jwt = await createAppJWT(env.GITHUB_APP_ID, env.GITHUB_APP_PEM);
    const token = await getInstallationToken(jwt, env.GITHUB_APP_INSTALLATION_ID);
    const issue = await createGitHubIssue(token, validation.report);

    return new Response(JSON.stringify({ success: true, issue: issue.number }), {
      status: 201,
      headers,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Bug report error:", message);
    return new Response(
      JSON.stringify({ error: "Failed to submit report. Please try again later." }),
      { status: 500, headers }
    );
  }
}

// --- Validation ---

function validateReport(
  data: unknown
): { valid: true; report: BugReport } | { valid: false; error: string } {
  if (!data || typeof data !== "object") {
    return { valid: false, error: "Invalid request body" };
  }

  const raw = data as Record<string, unknown>;

  // Honeypot
  if (typeof raw.honeypot === "string" && raw.honeypot.trim() !== "") {
    return { valid: false, error: "Invalid submission" };
  }

  // Description required
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

  const page = typeof raw.page === "string" ? raw.page.trim().slice(0, 200) : "/unknown";
  const expected =
    typeof raw.expected === "string" ? raw.expected.trim().slice(0, 2000) : undefined;

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

// --- Rate Limiting ---

async function checkRateLimit(
  kv: KVNamespace | undefined,
  ip: string
): Promise<{ allowed: boolean }> {
  if (!kv) return { allowed: true };

  const key = `rate:${ip}`;
  const current = await kv.get(key);
  const count = current ? parseInt(current, 10) : 0;

  if (count >= RATE_LIMIT_MAX) {
    return { allowed: false };
  }

  await kv.put(key, String(count + 1), { expirationTtl: RATE_LIMIT_WINDOW_SECONDS });
  return { allowed: true };
}

// --- GitHub App JWT ---

function base64url(input: string | ArrayBuffer): string {
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

async function createAppJWT(appId: string, pemBase64: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iat: now - 60, exp: now + 600, iss: appId };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const cryptoKey = await importPemKey(pemBase64);
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  return `${signingInput}.${base64url(signature)}`;
}

async function importPemKey(pem: string): Promise<CryptoKey> {
  let pemContent = pem;
  if (!pem.includes("-----BEGIN")) {
    pemContent = atob(pem);
  }

  const pemBody = pemContent
    .replace(/-----BEGIN [A-Z ]+-----/, "")
    .replace(/-----END [A-Z ]+-----/, "")
    .replace(/\s/g, "");

  const binaryDer = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));
  const isPkcs1 = pemContent.includes("BEGIN RSA");

  const keyData = isPkcs1 ? wrapInPkcs8(binaryDer) : binaryDer.buffer;

  return crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

// --- PKCS#1 → PKCS#8 wrapping ---

function asn1Length(length: number): Uint8Array {
  if (length < 0x80) return new Uint8Array([length]);
  const bytes: number[] = [];
  let temp = length;
  while (temp > 0) {
    bytes.unshift(temp & 0xff);
    temp >>= 8;
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function concatBuffers(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function wrapAsn1(tag: number, content: Uint8Array): Uint8Array {
  const lengthBytes = asn1Length(content.length);
  const result = new Uint8Array(1 + lengthBytes.length + content.length);
  result[0] = tag;
  result.set(lengthBytes, 1);
  result.set(content, 1 + lengthBytes.length);
  return result;
}

function wrapInPkcs8(pkcs1: Uint8Array): ArrayBuffer {
  const rsaOid = new Uint8Array([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  ]);
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  const octetString = wrapAsn1(0x04, pkcs1);
  const inner = concatBuffers(version, rsaOid, octetString);
  const pkcs8 = wrapAsn1(0x30, inner);
  return pkcs8.buffer as ArrayBuffer;
}

// --- GitHub API ---

async function getInstallationToken(jwt: string, installationId: string): Promise<string> {
  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "gitlab-mcp-bug-reporter",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to get installation token: ${response.status} ${text}`);
  }

  const data = (await response.json()) as { token: string };
  return data.token;
}

async function createGitHubIssue(
  token: string,
  report: BugReport
): Promise<{ number: number; url: string }> {
  const categoryLine = report.category ? `**Category:** ${report.category}\n` : "";
  const expectedSection = report.expected ? `\n### What did you expect?\n${report.expected}\n` : "";

  const body = `## Bug Report from Documentation

**Page:** ${report.page}
${categoryLine}
### What happened?
${report.description}
${expectedSection}
---
*Reported via docs feedback widget*`;

  const title = `[Docs] Bug report: ${report.page}`;

  const response = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues`, {
    method: "POST",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "gitlab-mcp-bug-reporter",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ title, body, labels: ["bug", "docs"] }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create issue: ${response.status} ${text}`);
  }

  const data = (await response.json()) as { number: number; html_url: string };
  return { number: data.number, url: data.html_url };
}
