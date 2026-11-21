/**
 * SHA-256 hashing using Web Crypto
 */
export async function sha256(message: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Hash an IP address for privacy-preserving rate limiting
 */
export async function hashIp(ip: string): Promise<string> {
  const normalized = (ip || "unknown").trim();
  return sha256(`ip-salt-${normalized}`);
}

/**
 * Crockford Base32 alphabet (excludes I, L, O, U to avoid confusion)
 */
const CROCKFORD_CHARS = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Generate a random unguessable public order code (e.g. 8 characters Crockford Base32)
 */
export function generateOrderCode(length: number = 8): string {
  const randomBytes = new Uint8Array(length);
  crypto.getRandomValues(randomBytes);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += CROCKFORD_CHARS[randomBytes[i] % CROCKFORD_CHARS.length];
  }
  return result;
}

/**
 * Sign a string with HMAC-SHA256
 */
export async function signHmac(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  const sigArray = Array.from(new Uint8Array(signature));
  return sigArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Timing-safe HMAC-SHA256 verification
 */
export async function verifyHmac(
  message: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const expected = await signHmac(message, secret);
  if (expected.length !== signature.length) return false;
  let result = 0;
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Escape HTML special characters to prevent XSS
 */
export function escapeHtml(unsafe: string | null | undefined): string {
  if (unsafe == null) return "";
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
