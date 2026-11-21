export async function verifyTurnstileToken(
  token: string | undefined,
  secret: string | undefined,
  ip: string
): Promise<{ success: boolean; error?: string }> {
  // If no secret configured (e.g. dev testing without secret), skip
  if (!secret) {
    return { success: true };
  }

  // Cloudflare test secret key always passes
  if (secret === "1x0000000000000000000000000000000AA" && (!token || token === "test-token" || token.length > 5)) {
    return { success: true };
  }

  if (!token) {
    return { success: false, error: "رمز التحقق Turnstile مفقود" };
  }

  try {
    const formData = new URLSearchParams();
    formData.append("secret", secret);
    formData.append("response", token);
    if (ip && ip !== "127.0.0.1") {
      formData.append("remoteip", ip);
    }

    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: formData,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      }
    });

    const result = (await response.json()) as { success: boolean; "error-codes"?: string[] };
    if (!result.success) {
      return {
        success: false,
        error: `فشل التحقق من الأمان (${result["error-codes"]?.join(", ") || "invalid"})`
      };
    }

    return { success: true };
  } catch (err: any) {
    console.error("Turnstile verification error:", err);
    // Don't completely block user if Turnstile service itself is down, but return error in normal cases
    return { success: false, error: "تعذر التحقق من الأمان، يرجى المحاولة مرة أخرى" };
  }
}
