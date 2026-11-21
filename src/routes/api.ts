import { Hono } from "hono";
import { Env, CreateOrderPayload } from "../types";
import { IRAQI_GOVERNORATES } from "../config";
import {
  getFirstActiveProduct,
  getOrderByCode,
  createOrderAtomic,
  checkRateLimit,
  findRecentOrderByPhone,
  findOrderByEventId,
  getStoreSettings,
  getProductImageById
} from "../services/db";
import { normalizeIraqiPhone } from "../utils/phone";
import { hashIp } from "../utils/crypto";
import { verifyTurnstileToken } from "../services/turnstile";
import { sendMetaConversionEvent } from "../services/capi";
import { syncOrderToSheet } from "../services/sheets";

export const api = new Hono<{ Bindings: Env }>();

/**
 * Public configuration endpoint
 */
api.get("/config", async (c) => {
  const storeSettings = await getStoreSettings(c.env.DB);
  return c.json({
    pixelId: c.env.META_PIXEL_ID || "",
    turnstileSiteKey: c.env.TURNSTILE_SITE_KEY || "",
    capiEventName: c.env.CAPI_EVENT_NAME || "Purchase",
    storeSettings,
    governorates: IRAQI_GOVERNORATES
  });
});

/**
 * Live active product details endpoint (DB is single source of truth)
 */
api.get("/products", async (c) => {
  const activeProduct = await getFirstActiveProduct(c.env.DB);
  if (!activeProduct) {
    return c.json({ product: null });
  }

  const imageUrls = activeProduct.images.map((img) => `/media/${img.id}`);

  const productObj = {
    id: activeProduct.id,
    slug: activeProduct.slug,
    name_ar: activeProduct.name_ar,
    tagline_ar: activeProduct.tagline_ar,
    description_ar: activeProduct.description_ar,
    price: activeProduct.price,
    compare_at_price: activeProduct.compare_at_price,
    stock: activeProduct.stock,
    size_ml: activeProduct.size_ml,
    notes: {
      top: activeProduct.notes_top ? activeProduct.notes_top.split(",").map((s) => s.trim()).filter(Boolean) : [],
      heart: activeProduct.notes_heart ? activeProduct.notes_heart.split(",").map((s) => s.trim()).filter(Boolean) : [],
      base: activeProduct.notes_base ? activeProduct.notes_base.split(",").map((s) => s.trim()).filter(Boolean) : []
    },
    guarantee_text: activeProduct.guarantee_text,
    return_days: activeProduct.return_days,
    free_delivery: activeProduct.free_delivery === 1,
    delivery_note: activeProduct.delivery_note,
    quantity_discounts: activeProduct.quantityDiscountParsed,
    reviews: activeProduct.reviewsParsed,
    images: imageUrls,
    active: activeProduct.active
  };

  return c.json({
    product: productObj,
    products: [productObj],
    images: activeProduct.images
  });
});

/**
 * Media serving endpoint for image BLOBs
 */
api.get("/media/:id", async (c) => {
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

/**
 * Create Order endpoint
 */
api.post("/orders", async (c) => {
  const clientIp = c.req.header("cf-connecting-ip") || "127.0.0.1";
  const userAgent = c.req.header("user-agent") || "";
  const ipHash = await hashIp(clientIp);

  // 1. IP Rate Limiting: max 5 order attempts per 10 minutes
  const allowed = await checkRateLimit(c.env.DB, `order-ip-${ipHash}`, 5, 600);
  if (!allowed) {
    return c.json(
      { ok: false, error: "تم تجاوز الحد المسموح من المحاولات، يرجى الانتظار قليلاً" },
      429
    );
  }

  let body: CreateOrderPayload;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "بيانات الطلب غير صالحة" }, 400);
  }

  // 2. Honeypot check
  if (body.honeypot && body.honeypot.trim().length > 0) {
    return c.json({ ok: true, code: "SUBMITTED", total: 0 });
  }

  // 3. Turnstile verification (Invisible Mode)
  const turnstileCheck = await verifyTurnstileToken(
    body.turnstileToken,
    c.env.TURNSTILE_SECRET,
    clientIp
  );
  if (!turnstileCheck.success) {
    return c.json({ ok: false, error: turnstileCheck.error || "فشل التحقق الأمني" }, 400);
  }

  // 4. Input validation
  if (!body.customer_name || body.customer_name.trim().length < 2) {
    return c.json({ ok: false, error: "يرجى إدخال الاسم الكامل بشكل صحيح" }, 400);
  }

  const phoneInfo = normalizeIraqiPhone(body.phone);
  if (!phoneInfo.isValid) {
    return c.json(
      {
        ok: false,
        error: "رقم الهاتف غير صحيح. يرجى إدخال رقم هاتف عراقي يبدأ بـ 07 ويتكون من 11 رقماً"
      },
      400
    );
  }

  if (!body.governorate || !IRAQI_GOVERNORATES.includes(body.governorate as any)) {
    return c.json({ ok: false, error: "يرجى اختيار المحافظة من القائمة" }, 400);
  }

  if (!body.address || body.address.trim().length < 4) {
    return c.json({ ok: false, error: "يرجى كتابة العنوان وأقرب نقطة دالة" }, 400);
  }

  if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
    return c.json({ ok: false, error: "سلة الطلب فارغة" }, 400);
  }

  for (const item of body.items) {
    if (!item.productId || !item.qty || item.qty <= 0) {
      return c.json({ ok: false, error: "بيانات المنتجات غير صالحة" }, 400);
    }
  }

  if (!body.event_id) {
    return c.json({ ok: false, error: "معرف الحدث (event_id) مفقود" }, 400);
  }

  // 5. Anti-duplicate idempotency check by event_id
  const existingByEvent = await findOrderByEventId(c.env.DB, body.event_id);
  if (existingByEvent) {
    const fullOrder = await getOrderByCode(c.env.DB, existingByEvent.code);
    return c.json({
      ok: true,
      code: existingByEvent.code,
      event_id: existingByEvent.event_id,
      total: existingByEvent.total,
      items: fullOrder?.items || []
    });
  }

  // 6. Anti-duplicate by phone within the last 10 minutes
  const recentOrder = await findRecentOrderByPhone(c.env.DB, phoneInfo.normalized, 10);
  if (recentOrder) {
    const fullRecent = await getOrderByCode(c.env.DB, recentOrder.code);
    if (fullRecent) {
      const recentItemsMap = new Map<number, number>();
      fullRecent.items.forEach((i) => recentItemsMap.set(i.product_id, i.qty));

      let isIdentical = body.items.length === fullRecent.items.length;
      if (isIdentical) {
        for (const it of body.items) {
          if (recentItemsMap.get(it.productId) !== it.qty) {
            isIdentical = false;
            break;
          }
        }
      }

      if (isIdentical) {
        return c.json({
          ok: true,
          code: recentOrder.code,
          event_id: recentOrder.event_id,
          total: recentOrder.total,
          items: fullRecent.items
        });
      }
    }
  }

  // 7. Atomic order creation with stock check
  const orderResult = await createOrderAtomic(
    c.env.DB,
    {
      ...body,
      phone: phoneInfo.normalized
    },
    ipHash,
    userAgent
  );

  if (!orderResult.ok || !orderResult.order) {
    return c.json({ ok: false, error: orderResult.error || "تعذر إتمام الطلب" }, 400);
  }

  const newOrder = orderResult.order;

  // 8. Non-blocking Google Sheets sync via ctx.waitUntil
  c.executionCtx.waitUntil(
    syncOrderToSheet(c.env.DB, newOrder, c.env.SHEETS_WEBHOOK_URL, c.env.SHEETS_WEBHOOK_TOKEN)
  );

  // 9. Non-blocking CAPI dispatch via ctx.waitUntil
  c.executionCtx.waitUntil(
    sendMetaConversionEvent(c.env.DB, newOrder, clientIp, userAgent, {
      pixelId: c.env.META_PIXEL_ID,
      accessToken: c.env.META_ACCESS_TOKEN,
      testEventCode: c.env.META_TEST_EVENT_CODE,
      eventName: c.env.CAPI_EVENT_NAME || "Purchase"
    })
  );

  // 10. Respond immediately
  return c.json({
    ok: true,
    code: newOrder.code,
    event_id: newOrder.event_id,
    total: newOrder.total,
    items: newOrder.items
  });
});

/**
 * Public order summary for confirmation page
 */
api.get("/orders/:code", async (c) => {
  const code = c.req.param("code");
  const clientIp = c.req.header("cf-connecting-ip") || "127.0.0.1";
  const ipHash = await hashIp(clientIp);

  const allowed = await checkRateLimit(c.env.DB, `lookup-ip-${ipHash}`, 30, 600);
  if (!allowed) {
    return c.json({ ok: false, error: "تم تجاوز حد الاستعلامات المسموح" }, 429);
  }

  const order = await getOrderByCode(c.env.DB, code);
  if (!order) {
    return c.json({ ok: false, error: "الطلب غير موجود" }, 404);
  }

  const activeProduct = await getFirstActiveProduct(c.env.DB);

  return c.json({
    ok: true,
    order: {
      code: order.code,
      event_id: order.event_id,
      customer_name: order.customer_name,
      phone: order.phone,
      governorate: order.governorate,
      address: order.address,
      lat: order.lat,
      lng: order.lng,
      notes: order.notes,
      subtotal: order.subtotal,
      discount: order.discount,
      total: order.total,
      status: order.status,
      created_at: order.created_at,
      items: order.items.map((i) => ({
        product_id: i.product_id,
        name: i.name_snapshot,
        price: i.unit_price,
        qty: i.qty
      })),
      return_days: activeProduct?.return_days || 3,
      currency: "IQD"
    }
  });
});
