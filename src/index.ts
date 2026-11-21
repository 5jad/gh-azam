import { Hono } from "hono";
import { Env } from "./types";
import { api } from "./routes/api";
import { admin } from "./routes/admin";
import { getFirstActiveProduct, getStoreSettings, getProductImageById } from "./services/db";
import { renderComingSoonPage, renderLandingPageSSR } from "./services/ssr";
import { retryPendingSheetSyncs } from "./services/sheets";

const app = new Hono<{ Bindings: Env }>();

// Security headers middleware
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");

  // Content Security Policy
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://connect.facebook.net; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com data:; " +
      "img-src 'self' data: blob: https://www.facebook.com https://*.fbcdn.net; " +
      "connect-src 'self' https://challenges.cloudflare.com https://www.facebook.com https://graph.facebook.com; " +
      "frame-src https://challenges.cloudflare.com;"
  );
});

// Mount APIs and admin
app.route("/api", api);
app.route("/", admin);

// Serve product media BLOBs from D1
app.get("/media/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id) || id <= 0) {
    return c.text("Invalid media ID", 400);
  }

  const image = await getProductImageById(c.env.DB, id);
  if (!image) {
    return c.text("Image not found", 404);
  }

  return new Response(image.data, {
    headers: {
      "Content-Type": image.mime || "image/webp",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=31536000, immutable"
    }
  });
});

// Homepage with SSR
app.get("/", async (c) => {
  const [activeProduct, storeSettings] = await Promise.all([
    getFirstActiveProduct(c.env.DB),
    getStoreSettings(c.env.DB)
  ]);

  // If no active product in DB, render neutral Apple-style "Coming Soon" page
  if (!activeProduct) {
    return c.html(renderComingSoonPage(storeSettings));
  }

  // Fetch raw index.html template from assets
  const assetReq = new Request(new URL("/index.html", c.req.url).toString());
  const assetRes = await c.env.ASSETS.fetch(assetReq);
  const rawHtml = await assetRes.text();

  const renderedHtml = renderLandingPageSSR(rawHtml, activeProduct, storeSettings);
  return c.html(renderedHtml);
});

// Handle /admin page route
app.get("/admin", async (c) => {
  const url = new URL(c.req.url);
  url.pathname = "/admin.html";
  return c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
});

// Handle /thanks page route
app.get("/thanks", (c) => {
  const url = new URL(c.req.url);
  url.pathname = "/thanks.html";
  return c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
});

// Static assets fallback
app.all("*", (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default {
  fetch: app.fetch,
  // Cloudflare Cron Trigger (Runs every 5 minutes)
  async scheduled(event: any, env: Env, ctx: any) {
    ctx.waitUntil(retryPendingSheetSyncs(env.DB, env.SHEETS_WEBHOOK_URL, env.SHEETS_WEBHOOK_TOKEN, 10));
  }
};
