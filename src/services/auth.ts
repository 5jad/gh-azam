import { signHmac, verifyHmac } from "../utils/crypto";

const SESSION_COOKIE_NAME = "perfume_admin_session";
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days

export async function createAdminSessionToken(sessionSecret: string): Promise<string> {
  const timestamp = Date.now().toString();
  const signature = await signHmac(`admin:${timestamp}`, sessionSecret);
  return `${timestamp}.${signature}`;
}

export async function verifyAdminSessionToken(
  token: string | undefined,
  sessionSecret: string
): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;

  const [timestampStr, signature] = parts;
  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) return false;

  // Check expiration (7 days)
  const ageSeconds = (Date.now() - timestamp) / 1000;
  if (ageSeconds < 0 || ageSeconds > SESSION_MAX_AGE_SECONDS) {
    return false;
  }

  // Verify HMAC signature
  return verifyHmac(`admin:${timestampStr}`, signature, sessionSecret);
}

export function parseCookies(cookieHeader: string | null | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    if (idx !== -1) {
      const key = pair.substring(0, idx).trim();
      const val = pair.substring(idx + 1).trim();
      cookies[key] = decodeURIComponent(val);
    }
  }
  return cookies;
}

export function getAdminCookieHeader(token: string): string {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(
    token
  )}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

export function getClearAdminCookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

export function getAdminTokenFromRequest(cookieHeader: string | null | undefined): string | undefined {
  const cookies = parseCookies(cookieHeader);
  return cookies[SESSION_COOKIE_NAME];
}
