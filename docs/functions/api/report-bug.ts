/**
 * Cloudflare Pages Function: POST /api/report-bug
 *
 * Receives bug reports from the docs feedback widget and creates
 * GitHub issues via a GitHub App installation token.
 *
 * Required env vars (set in Cloudflare Pages dashboard):
 * - GITHUB_APP_ID
 * - GITHUB_APP_PEM (base64-encoded PEM for JWT signing)
 * - GITHUB_APP_INSTALLATION_ID
 * - RATE_LIMIT_KV (optional KV namespace binding)
 */

import {
  type BugReport,
  RATE_LIMIT_MAX,
  corsHeaders,
  validateReport,
  base64url,
  asn1Length,
  concatBuffers,
} from "./utils.js";

interface Env {
  GITHUB_APP_ID: string;
  GITHUB_APP_PEM: string;
  GITHUB_APP_INSTALLATION_ID: string;
  RATE_LIMIT_KV?: KVNamespace;
}

const REPO_OWNER = "structured-world";
const REPO_NAME = "gitlab-mcp";
const RATE_LIMIT_WINDOW_SECONDS = 3600;

/**
 * Create a JWT for GitHub App authentication using Web Crypto API.
 */
async function createAppJWT(appId: string, pemBase64: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iat: now - 60,
    exp: now + 600,
    iss: appId,
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const cryptoKey = await importPemKey(pemBase64);
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const encodedSignature = base64url(signature);
  return `${signingInput}.${encodedSignature}`;
}

/**
 * Import a PEM-encoded RSA signing credential for use with Web Crypto API.
 * Accepts either raw PEM text or base64-encoded PEM.
 */
async function importPemKey(pem: string): Promise<CryptoKey> {
  // Decode if base64-wrapped
  let pemContent = pem;
  if (!pem.includes("-----BEGIN")) {
    pemContent = atob(pem);
  }

  // Extract the base64 body between PEM markers
  const pemBody = pemContent
    .replace(/-----BEGIN [A-Z ]+-----/, "")
    .replace(/-----END [A-Z ]+-----/, "")
    .replace(/\s/g, "");

  const binaryDer = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  // PKCS#1 headers contain "RSA" (e.g. "BEGIN RSA ..."), PKCS#8 do not.
  // GitHub App PEMs are typically PKCS#1 and need wrapping for Web Crypto.
  const isPkcs1 = pemContent.includes("BEGIN RSA");
  const isPkcs8 = !isPkcs1;

  let keyData: ArrayBuffer;
  if (!isPkcs8) {
    keyData = wrapInPkcs8(binaryDer);
  } else {
    keyData = binaryDer.buffer;
  }

  return crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

/**
 * Wrap a PKCS#1 RSA credential in a PKCS#8 envelope.
 * Required because Web Crypto API only accepts PKCS#8 format.
 */
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

function wrapAsn1(tag: number, content: Uint8Array): Uint8Array {
  const lengthBytes = asn1Length(content.length);
  const result = new Uint8Array(1 + lengthBytes.length + content.length);
  result[0] = tag;
  result.set(lengthBytes, 1);
  result.set(content, 1 + lengthBytes.length);
  return result;
}

/**
 * Exchange the App JWT for an installation access token.
 */
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

/**
 * Create a GitHub issue using the installation token.
 */
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
    body: JSON.stringify({
      title,
      body,
      labels: ["bug", "docs"],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create issue: ${response.status} ${text}`);
  }

  const data = (await response.json()) as { number: number; html_url: string };
  return { number: data.number, url: data.html_url };
}

/**
 * IP-based rate limiting using Cloudflare KV.
 */
async function checkRateLimit(
  kv: KVNamespace | undefined,
  ip: string
): Promise<{ allowed: boolean; remaining: number }> {
  if (!kv) {
    return { allowed: true, remaining: RATE_LIMIT_MAX };
  }

  const key = `rate:${ip}`;
  const current = await kv.get(key);
  const count = current ? parseInt(current, 10) : 0;

  if (count >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0 };
  }

  await kv.put(key, String(count + 1), { expirationTtl: RATE_LIMIT_WINDOW_SECONDS });
  return { allowed: true, remaining: RATE_LIMIT_MAX - count - 1 };
}

/**
 * Handle OPTIONS preflight requests.
 */
export const onRequestOptions: PagesFunction<Env> = async context => {
  const origin = context.request.headers.get("Origin") || "";
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
};

/**
 * Handle POST requests — create a bug report issue on GitHub.
 */
export const onRequestPost: PagesFunction<Env> = async context => {
  const origin = context.request.headers.get("Origin") || "";
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };

  try {
    // Rate limit check
    const ip = context.request.headers.get("CF-Connecting-IP") || "unknown";
    const rateLimit = await checkRateLimit(context.env.RATE_LIMIT_KV, ip);
    if (!rateLimit.allowed) {
      return new Response(JSON.stringify({ error: "Too many reports. Please try again later." }), {
        status: 429,
        headers,
      });
    }

    // Parse and validate input
    const body = await context.request.json();
    const validation = validateReport(body);
    if (!validation.valid) {
      return new Response(JSON.stringify({ error: validation.error }), { status: 400, headers });
    }

    const { report } = validation;

    // Generate GitHub App JWT using PEM from env
    const jwt = await createAppJWT(context.env.GITHUB_APP_ID, context.env.GITHUB_APP_PEM);

    // Get installation access token
    const token = await getInstallationToken(jwt, context.env.GITHUB_APP_INSTALLATION_ID);

    // Create the issue
    const issue = await createGitHubIssue(token, report);

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
};
