/**
 * HMAC-SHA-256 job token sign/verify for the agent runner bridge.
 *
 * Payload: { versionId: string, exp: number (unix ms) }
 * Uses crypto.subtle (Web Crypto API) — available in both Convex isolate
 * runtime and Node 18+. No top-level node:crypto import so the Convex
 * bundler never sees a node-native specifier.
 *
 * No "use node" directive — this file MUST stay isolate-safe.
 */

export interface TokenPayload {
  versionId: string;
  exp: number; // unix timestamp ms
}

export type TokenVerifyResult =
  | { valid: true; payload: TokenPayload }
  | { valid: false; reason: string };

const ALGO = { name: "HMAC", hash: "SHA-256" } as const;

async function importKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey("raw", enc.encode(secret), ALGO, false, [
    "sign",
    "verify",
  ]);
}

function toBase64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64url(s: string): ArrayBuffer {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer as ArrayBuffer;
}

/** Sign a payload and return a compact token: base64url(payload).base64url(sig) */
export async function signToken(
  payload: TokenPayload,
  secret: string,
): Promise<string> {
  const enc = new TextEncoder();
  const payloadB64 = toBase64url(enc.encode(JSON.stringify(payload)));
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign(ALGO, key, enc.encode(payloadB64));
  return `${payloadB64}.${toBase64url(sig)}`;
}

/** Verify a token. Returns the payload if valid, or an error reason. */
export async function verifyToken(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<TokenVerifyResult> {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return { valid: false, reason: "malformed token: expected 2 parts" };
  }
  const [payloadB64, sigB64] = parts as [string, string];

  const key = await importKey(secret);
  const enc = new TextEncoder();
  let isValid: boolean;
  try {
    isValid = await crypto.subtle.verify(
      ALGO,
      key,
      fromBase64url(sigB64),
      enc.encode(payloadB64),
    );
  } catch {
    return { valid: false, reason: "signature verification error" };
  }

  if (!isValid) return { valid: false, reason: "signature mismatch" };

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64url(payloadB64)));
  } catch {
    return { valid: false, reason: "payload JSON parse error" };
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as Record<string, unknown>)["versionId"] !== "string" ||
    typeof (payload as Record<string, unknown>)["exp"] !== "number"
  ) {
    return { valid: false, reason: "payload shape invalid" };
  }

  const typed = payload as TokenPayload;
  if (now > typed.exp) {
    return { valid: false, reason: "token expired" };
  }

  return { valid: true, payload: typed };
}
