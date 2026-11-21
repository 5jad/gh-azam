import { Hono } from "hono";
import { Env, OrderStatus } from "../types";
import {
  getOrders,
  getDashboardStats,
  getProducts,
  getProductById,
  updateProduct,
  updateOrderStatus,
  updateOrderAdminNote,
  checkRateLimit,
  getStoreSettings,
  updateStoreSettings,
  getProductImagesList,
  addProductImage,
  deleteProductImage,
  reorderProductImages,
  wipeTestOrders,
  getOrderByCode
} from "../services/db";
import {
  createAdminSessionToken,
  verifyAdminSessionToken,
  getAdminCookieHeader,
  getClearAdminCookieHeader,
  getAdminTokenFromRequest
} from "../services/auth";
import { hashIp } from "../utils/crypto";
import { pingSheetWebhook, syncOrderToSheet } from "../services/sheets";
import { TECHNICAL_CONFIG } from "../config";

export const admin = new Hono<{ Bindings: Env }>();

/**
 * Security headers on all admin routes
 */
admin.use("*", async (c, next) => {
  c.header("X-Robots-Tag", "noindex, nofollow, noarchive");
  c.header("X-Frame-Options", "DENY");
  c.header("Content-Security-Policy", "frame-ancestors 'none'");
  await next();
});

/**
 * Admin Login API
 */
admin.post("/api/admin/login", async (c) => {
  const clientIp = c.req.header("cf-connecting-ip") || "127.0.0.1";
  const ipHash = await hashIp(clientIp);

  const allowed = await checkRateLimit(c.env.DB, `login-ip-${ipHash}`, 5, 900);
  if (!allowed) {
    return c.json(
      { ok: false, error: "تم حظر محاولات تسجيل الدخول مؤقتاً لتكرار المحاولات الخاطئة" },
      429
    );
  }

  const body = await c.req.json().catch(() => ({}));
  const password = body.password;

  if (!password || !c.env.ADMIN_PASSWORD || password !== c.env.ADMIN_PASSWORD) {
    return c.json({ ok: false, error: "كلمة المرور غير صحيحة" }, 401);
  }

  const token = await createAdminSessionToken(c.env.SESSION_SECRET);
  c.header("Set-Cookie", getAdminCookieHeader(token));

  return c.json({ ok: true, message: "تم تسجيل الدخول بنجاح" });
});

/**
 * Admin Logout API
 */
admin.post("/api/admin/logout", (c) => {
  c.header("Set-Cookie", getClearAdminCookieHeader());
  return c.json({ ok: true, message: "تم تسجيل الخروج" });
});

/**
 * Protected routes middleware
 */
admin.use("/api/admin/*", async (c, next) => {
  if (c.req.path === "/api/admin/login" || c.req.path === "/api/admin/logout") {
    return next();
  }
  const token = getAdminTokenFromRequest(c.req.header("cookie"));
  const isValid = await verifyAdminSessionToken(token, c.env.SESSION_SECRET);
  if (!isValid) {
    return c.json({ ok: false, error: "غير مصرح لك بالدخول، يرجى تسجيل الدخول" }, 401);
  }
  await next();
});

/**
 * Dashboard stats
 */
admin.get("/api/admin/stats", async (c) => {
  const stats = await getDashboardStats(c.env.DB);
  return c.json({ ok: true, stats });
});

/**
 * Orders listing with filters, pagination, and Google Sheets status
 */
admin.get("/api/admin/orders", async (c) => {
  const status = c.req.query("status") || "all";
  const search = c.req.query("search") || "";
  const startDate = c.req.query("startDate") || "";
  const endDate = c.req.query("endDate") || "";
  const page = parseInt(c.req.query("page") || "1", 10);
  const limit = parseInt(c.req.query("limit") || "20", 10);

  const { orders, totalCount } = await getOrders(c.env.DB, {
    status,
    search,
    startDate,
    endDate,
    page,
    limit
  });

  return c.json({
    ok: true,
    orders,
    totalCount,
    page,
    limit,
    totalPages: Math.ceil(totalCount / limit) || 1
  });
});

/**
 * Update order status (with stock restoration and Google Sheets sync)
 */
admin.post("/api/admin/orders/:id/status", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await c.req.json().catch(() => ({}));
  const status = body.status as OrderStatus;

  const validStatuses: OrderStatus[] = ["new", "confirmed", "shipped", "delivered", "cancelled"];
  if (!validStatuses.includes(status)) {
    return c.json({ ok: false, error: "الحالة غير صالحة" }, 400);
  }

  const result = await updateOrderStatus(c.env.DB, id, status);
  if (!result.success) {
    return c.json({ ok: false, error: result.error || "فشل تحديث الحالة" }, 400);
  }

  // Sync update to Google Sheets
  const orderRes = await c.env.DB.prepare("SELECT code FROM orders WHERE id = ?").bind(id).first<{ code: string }>();
  if (orderRes) {
    const fullOrder = await getOrderByCode(c.env.DB, orderRes.code);
    if (fullOrder) {
      c.executionCtx.waitUntil(
        syncOrderToSheet(c.env.DB, fullOrder, c.env.SHEETS_WEBHOOK_URL, c.env.SHEETS_WEBHOOK_TOKEN)
      );
    }
  }

  return c.json({ ok: true, status });
});

/**
 * Update order admin note (and sync to Google Sheets)
 */
admin.post("/api/admin/orders/:id/note", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await c.req.json().catch(() => ({}));
  const note = String(body.note || "");

  await updateOrderAdminNote(c.env.DB, id, note);

  // Sync update to Google Sheets
  const orderRes = await c.env.DB.prepare("SELECT code FROM orders WHERE id = ?").bind(id).first<{ code: string }>();
  if (orderRes) {
    const fullOrder = await getOrderByCode(c.env.DB, orderRes.code);
    if (fullOrder) {
      c.executionCtx.waitUntil(
        syncOrderToSheet(c.env.DB, fullOrder, c.env.SHEETS_WEBHOOK_URL, c.env.SHEETS_WEBHOOK_TOKEN)
      );
    }
  }

  return c.json({ ok: true });
});

/**
 * Sync single order to Google Sheets manually
 */
admin.post("/api/admin/orders/:id/sync-sheet", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const orderRes = await c.env.DB.prepare("SELECT code FROM orders WHERE id = ?").bind(id).first<{ code: string }>();
  if (!orderRes) return c.json({ ok: false, error: "الطلب غير موجود" }, 404);

  const fullOrder = await getOrderByCode(c.env.DB, orderRes.code);
  if (!fullOrder) return c.json({ ok: false, error: "بيانات الطلب غير مكتملة" }, 404);

  const res = await syncOrderToSheet(c.env.DB, fullOrder, c.env.SHEETS_WEBHOOK_URL, c.env.SHEETS_WEBHOOK_TOKEN);
  return c.json(res);
});

/**
 * Re-sync all orders to Google Sheets
 */
admin.post("/api/admin/orders/resync-all-sheets", async (c) => {
  const { results: orders } = await c.env.DB.prepare("SELECT code FROM orders ORDER BY id DESC LIMIT 500").all<{ code: string }>();
  if (!orders || orders.length === 0) {
    return c.json({ ok: true, count: 0 });
  }

  c.executionCtx.waitUntil(
    (async () => {
      for (const o of orders) {
        const full = await getOrderByCode(c.env.DB, o.code);
        if (full) {
          await syncOrderToSheet(c.env.DB, full, c.env.SHEETS_WEBHOOK_URL, c.env.SHEETS_WEBHOOK_TOKEN);
        }
      }
    })()
  );

  return c.json({ ok: true, message: `جارٍ مزامنة ${orders.length} طلب مع Google Sheets في الخلفية` });
});

/**
 * Test Google Sheets connection
 */
admin.post("/api/admin/sheets/test", async (c) => {
  const res = await pingSheetWebhook(c.env.SHEETS_WEBHOOK_URL, c.env.SHEETS_WEBHOOK_TOKEN);
  return c.json(res);
});

// ==========================================
// PRODUCT MANAGEMENT
// ==========================================
admin.get("/api/admin/product", async (c) => {
  const products = await getProducts(c.env.DB);
  const product = products[0] || null;
  if (!product) {
    return c.json({ ok: true, product: null, images: [] });
  }

  const images = await getProductImagesList(c.env.DB, product.id);
  return c.json({ ok: true, product, images });
});

admin.post("/api/admin/product", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const products = await getProducts(c.env.DB);
  let productId = products[0]?.id;

  if (!productId) {
    // Create first product
    const insertRes = await c.env.DB
      .prepare(
        "INSERT INTO products (slug, name_ar, price, stock, active) VALUES ('perfume-1', ?, ?, ?, 1)"
      )
      .bind(body.name_ar || "عطر جديد", body.price || 45000, body.stock || 20)
      .run();
    productId = insertRes.meta.last_row_id;
  }

  await updateProduct(c.env.DB, productId, {
    name_ar: body.name_ar,
    tagline_ar: body.tagline_ar,
    description_ar: body.description_ar,
    price: body.price !== undefined ? parseInt(body.price, 10) : undefined,
    compare_at_price: body.compare_at_price ? parseInt(body.compare_at_price, 10) : null,
    stock: body.stock !== undefined ? parseInt(body.stock, 10) : undefined,
    size_ml: body.size_ml ? parseInt(body.size_ml, 10) : 100,
    notes_top: body.notes_top,
    notes_heart: body.notes_heart,
    notes_base: body.notes_base,
    guarantee_text: body.guarantee_text,
    return_days: body.return_days !== undefined ? parseInt(body.return_days, 10) : 3,
    free_delivery: body.free_delivery ? 1 : 0,
    delivery_note: body.delivery_note,
    quantity_discounts: body.quantity_discounts !== undefined ? (typeof body.quantity_discounts === "string" ? body.quantity_discounts : JSON.stringify(body.quantity_discounts)) : null,
    reviews_json: body.reviews_json !== undefined ? (typeof body.reviews_json === "string" ? body.reviews_json : JSON.stringify(body.reviews_json)) : null,
    active: body.active !== undefined ? (body.active ? 1 : 0) : (body.is_active !== undefined ? (body.is_active ? 1 : 0) : 1)
  });

  return c.json({ ok: true, message: "تم حفظ بيانات المنتج بنجاح" });
});

/**
 * Backwards-compatible single product update by ID (e.g. stock, price)
 */
admin.post("/api/admin/products/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await c.req.json().catch(() => ({}));
  await updateProduct(c.env.DB, id, {
    price: body.price !== undefined ? parseInt(body.price, 10) : undefined,
    stock: body.stock !== undefined ? parseInt(body.stock, 10) : undefined,
    active: body.active !== undefined ? (body.active ? 1 : 0) : (body.is_active !== undefined ? (body.is_active ? 1 : 0) : undefined)
  });
  return c.json({ ok: true, message: "تم تحديث المنتج بنجاح" });
});

/**
 * Image upload (BLOB into D1 product_images)
 */
admin.post("/api/admin/products/:id/images", async (c) => {
  let productId = parseInt(c.req.param("id"), 10);
  const products = await getProducts(c.env.DB);
  if (!products.length) {
    const insertRes = await c.env.DB
      .prepare(
        "INSERT INTO products (slug, name_ar, price, stock, active) VALUES ('perfume-1', 'عطور عزام الشمري', 45000, 20, 1)"
      )
      .run();
    productId = insertRes.meta.last_row_id;
  } else if (!productId || isNaN(productId)) {
    productId = products[0].id;
  }

  const currentImages = await getProductImagesList(c.env.DB, productId);
  if (currentImages.length >= TECHNICAL_CONFIG.maxImagesPerProduct) {
    return c.json({ ok: false, error: `الحد الأقصى للصور هو ${TECHNICAL_CONFIG.maxImagesPerProduct} صور` }, 400);
  }

  const formData = await c.req.parseBody();
  const file = formData["image"] as any;

  if (!file || typeof file === "string") {
    return c.json({ ok: false, error: "لم يتم تحديد أي ملف" }, 400);
  }

  let mime = file.type || "image/webp";
  if (mime === "image/jpg") mime = "image/jpeg";
  const validMimes = ["image/webp", "image/jpeg", "image/png", "image/jpg", "image/avif"];
  if (!validMimes.includes(mime)) {
    return c.json({ ok: false, error: "صيغة الصورة غير مدعومة (فقط WebP, JPEG, PNG)" }, 400);
  }

  const arrayBuffer = await file.arrayBuffer();
  if (arrayBuffer.byteLength > TECHNICAL_CONFIG.maxImageSizeBytes) {
    return c.json({ ok: false, error: "حجم الصورة يتجاوز الحد المسموح (450KB)" }, 400);
  }

  const imageId = await addProductImage(c.env.DB, productId, mime, null, null, arrayBuffer);
  return c.json({ ok: true, id: imageId, imageId, url: `/media/${imageId}` });
});

admin.delete("/api/admin/images/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  await deleteProductImage(c.env.DB, id);
  return c.json({ ok: true });
});

admin.post("/api/admin/images/reorder", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const imageIds = (body.imageIds || body.order) as number[];
  if (Array.isArray(imageIds)) {
    await reorderProductImages(c.env.DB, imageIds);
  }
  return c.json({ ok: true });
});

// ==========================================
// STORE SETTINGS
// ==========================================
admin.get("/api/admin/settings", async (c) => {
  const settings = await getStoreSettings(c.env.DB);
  return c.json({
    ok: true,
    ...settings,
    settings,
    sheets_configured: Boolean(c.env.SHEETS_WEBHOOK_URL && c.env.SHEETS_WEBHOOK_URL.trim()),
    sheetsConnected: Boolean(c.env.SHEETS_WEBHOOK_URL && c.env.SHEETS_WEBHOOK_URL.trim())
  });
});

admin.post("/api/admin/settings", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  await updateStoreSettings(c.env.DB, {
    store_name: body.store_name,
    whatsapp_enabled: Boolean(body.whatsapp_enabled),
    whatsapp_number: body.whatsapp_number
  });
  return c.json({ ok: true, message: "تم حفظ إعدادات المتجر بنجاح" });
});

/**
 * Danger Zone: Wipe test orders before launch
 */
admin.post("/api/admin/danger/wipe-orders", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const confirmation = String(body.confirmation || body.confirm || "").trim();

  if (confirmation !== "حذف الطلبات") {
    return c.json({ ok: false, error: "يرجى كتابة جملة التأكيد بدقة: حذف الطلبات" }, 400);
  }

  const rawReset = body.resetStockTo !== undefined ? body.resetStockTo : body.resetStock;
  const resetStockTo = rawReset !== undefined && rawReset !== "" && rawReset !== null ? parseInt(rawReset, 10) : null;
  await wipeTestOrders(c.env.DB, resetStockTo);

  return c.json({ ok: true, message: "تم حذف جميع الطلبات وإعادة تعيين المخزون بنجاح" });
});

/**
 * Export orders as CSV with UTF-8 BOM
 */
admin.get("/api/admin/export.csv", async (c) => {
  const status = c.req.query("status") || "all";
  const search = c.req.query("search") || "";
  const startDate = c.req.query("startDate") || "";
  const endDate = c.req.query("endDate") || "";

  const { orders } = await getOrders(c.env.DB, {
    status,
    search,
    startDate,
    endDate,
    page: 1,
    limit: 5000
  });

  const statusMap: Record<string, string> = {
    new: "جديد",
    confirmed: "تم التأكيد",
    shipped: "مشحون",
    delivered: "مسلّم",
    cancelled: "ملغي"
  };

  const headers = [
    "رمز الطلب",
    "التاريخ (بغداد)",
    "الحالة",
    "الاسم الكامل",
    "رقم الهاتف",
    "المحافظة",
    "العنوان",
    "المنتجات",
    "المجموع الفرعي",
    "الخصم",
    "الإجمالي (د.ع)",
    "رابط الموقع",
    "ملاحظات العميل",
    "ملاحظات الإدارة",
    "مزامنة Google Sheets",
    "حالة Meta CAPI"
  ];

  const csvEscape = (field: any) => {
    if (field == null) return '""';
    const str = String(field).replace(/"/g, '""');
    return `"${str}"`;
  };

  const rows = orders.map((o) => {
    const itemsStr = o.items.map((i) => `${i.name_snapshot} (${i.qty}×${i.unit_price})`).join(" | ");
    const mapUrl = o.lat && o.lng ? `https://maps.google.com/?q=${o.lat},${o.lng}` : "";
    return [
      csvEscape(o.code),
      csvEscape(o.created_at),
      csvEscape(statusMap[o.status] || o.status),
      csvEscape(o.customer_name),
      csvEscape(`'${o.phone}`), // Keep leading 0
      csvEscape(o.governorate),
      csvEscape(o.address),
      csvEscape(itemsStr),
      csvEscape(o.subtotal),
      csvEscape(o.discount),
      csvEscape(o.total),
      csvEscape(mapUrl),
      csvEscape(o.notes || ""),
      csvEscape(o.admin_note || ""),
      csvEscape(o.sheet_sync_status || ""),
      csvEscape(o.capi_status || "")
    ].join(",");
  });

  const csvContent = "\uFEFF" + [headers.map(csvEscape).join(","), ...rows].join("\r\n");

  return new Response(csvContent, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="orders-backup-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store"
    }
  });
});
