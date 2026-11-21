import { D1Database } from "@cloudflare/workers-types";
import {
  OrderRow,
  OrderItemRow,
  ProductRow,
  ProductImageRow,
  OrderStatus,
  CreateOrderPayload,
  StoreSettings,
  QuantityDiscountRule,
  ReviewItem,
  FullProduct
} from "../types";
import { generateOrderCode } from "../utils/crypto";

export interface OrderWithItems extends OrderRow {
  items: OrderItemRow[];
}

export async function checkRateLimit(
  db: D1Database,
  key: string,
  maxAttempts: number = 5,
  windowSeconds: number = 600
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  try {
    const existing = await db
      .prepare("SELECT window_start, count FROM rate_limits WHERE key = ?")
      .bind(key)
      .first<{ window_start: number; count: number }>();

    if (!existing) {
      await db
        .prepare("INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)")
        .bind(key, now)
        .run();
      return true;
    }

    if (now - existing.window_start > windowSeconds) {
      // Window expired, reset
      await db
        .prepare("UPDATE rate_limits SET window_start = ?, count = 1 WHERE key = ?")
        .bind(now, key)
        .run();
      return true;
    }

    if (existing.count >= maxAttempts) {
      return false;
    }

    await db
      .prepare("UPDATE rate_limits SET count = count + 1 WHERE key = ?")
      .bind(key)
      .run();
    return true;
  } catch (err) {
    console.error("Rate limit check error:", err);
    return true; // Fail open to avoid blocking valid traffic if rate limit table has an issue
  }
}

// ==========================================
// STORE SETTINGS
// ==========================================
export async function getStoreSettings(db: D1Database): Promise<StoreSettings> {
  try {
    const { results } = await db.prepare("SELECT key, value FROM store_settings").all<{ key: string; value: string }>();
    const map = new Map<string, string>();
    (results || []).forEach((r) => map.set(r.key, r.value));

    return {
      store_name: map.get("store_name") || "عطور عزام الشمري",
      whatsapp_enabled: map.get("whatsapp_enabled") === "1",
      whatsapp_number: map.get("whatsapp_number") || ""
    };
  } catch (err) {
    console.error("Failed to fetch store settings:", err);
    return {
      store_name: "عطور عزام الشمري",
      whatsapp_enabled: false,
      whatsapp_number: ""
    };
  }
}

export async function updateStoreSettings(
  db: D1Database,
  settings: Partial<StoreSettings>
): Promise<void> {
  const stmts: any[] = [];
  if (settings.store_name !== undefined) {
    stmts.push(
      db.prepare("INSERT INTO store_settings (key, value) VALUES ('store_name', ?) ON CONFLICT(key) DO UPDATE SET value = ?")
        .bind(settings.store_name.trim(), settings.store_name.trim())
    );
  }
  if (settings.whatsapp_enabled !== undefined) {
    const val = settings.whatsapp_enabled ? "1" : "0";
    stmts.push(
      db.prepare("INSERT INTO store_settings (key, value) VALUES ('whatsapp_enabled', ?) ON CONFLICT(key) DO UPDATE SET value = ?")
        .bind(val, val)
    );
  }
  if (settings.whatsapp_number !== undefined) {
    stmts.push(
      db.prepare("INSERT INTO store_settings (key, value) VALUES ('whatsapp_number', ?) ON CONFLICT(key) DO UPDATE SET value = ?")
        .bind(settings.whatsapp_number.trim(), settings.whatsapp_number.trim())
    );
  }

  if (stmts.length > 0) {
    await db.batch(stmts);
  }
}

// ==========================================
// PRODUCTS & IMAGES
// ==========================================
export async function getProducts(db: D1Database): Promise<ProductRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM products ORDER BY id ASC")
    .all<ProductRow>();
  return results || [];
}

export async function getFirstActiveProduct(db: D1Database): Promise<FullProduct | null> {
  const product = await db
    .prepare("SELECT * FROM products WHERE active = 1 ORDER BY id ASC LIMIT 1")
    .first<ProductRow>();

  if (!product) return null;

  const images = await getProductImagesList(db, product.id);

  let quantityDiscountParsed: QuantityDiscountRule[] = [];
  if (product.quantity_discounts) {
    try {
      quantityDiscountParsed = JSON.parse(product.quantity_discounts);
    } catch (_) {}
  }

  let reviewsParsed: ReviewItem[] = [];
  if (product.reviews_json) {
    try {
      reviewsParsed = JSON.parse(product.reviews_json);
    } catch (_) {}
  }

  return {
    ...product,
    images,
    quantityDiscountParsed,
    reviewsParsed
  };
}

export async function getProductById(db: D1Database, id: number): Promise<ProductRow | null> {
  const product = await db
    .prepare("SELECT * FROM products WHERE id = ?")
    .bind(id)
    .first<ProductRow>();
  return product || null;
}

export async function getProductImagesList(
  db: D1Database,
  productId: number
): Promise<{ id: number; position: number; mime: string }[]> {
  const { results } = await db
    .prepare("SELECT id, position, mime FROM product_images WHERE product_id = ? ORDER BY position ASC, id ASC")
    .bind(productId)
    .all<{ id: number; position: number; mime: string }>();
  return results || [];
}

export async function getProductImageById(
  db: D1Database,
  imageId: number
): Promise<{ id: number; mime: string; data: ArrayBuffer } | null> {
  const row = await db
    .prepare("SELECT id, mime, data FROM product_images WHERE id = ?")
    .bind(imageId)
    .first<{ id: number; mime: string; data: ArrayBuffer }>();
  return row || null;
}

export async function addProductImage(
  db: D1Database,
  productId: number,
  mime: string,
  width: number | null,
  height: number | null,
  data: ArrayBuffer
): Promise<number> {
  // Get current max position
  const maxPosRow = await db
    .prepare("SELECT MAX(position) as max_pos FROM product_images WHERE product_id = ?")
    .bind(productId)
    .first<{ max_pos: number | null }>();

  const nextPos = (maxPosRow?.max_pos ?? -1) + 1;

  const res = await db
    .prepare(
      "INSERT INTO product_images (product_id, mime, width, height, position, data) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(productId, mime, width, height, nextPos, data)
    .run();

  return res.meta.last_row_id;
}

export async function deleteProductImage(db: D1Database, imageId: number): Promise<void> {
  await db.prepare("DELETE FROM product_images WHERE id = ?").bind(imageId).run();
}

export async function reorderProductImages(db: D1Database, imageIds: number[]): Promise<void> {
  const stmts = imageIds.map((id, index) =>
    db.prepare("UPDATE product_images SET position = ? WHERE id = ?").bind(index, id)
  );
  if (stmts.length > 0) {
    await db.batch(stmts);
  }
}

export async function updateProduct(
  db: D1Database,
  id: number,
  updates: Partial<ProductRow>
): Promise<void> {
  const fields: string[] = [];
  const values: any[] = [];

  const allowedKeys: (keyof ProductRow)[] = [
    "name_ar",
    "tagline_ar",
    "description_ar",
    "price",
    "compare_at_price",
    "stock",
    "size_ml",
    "notes_top",
    "notes_heart",
    "notes_base",
    "guarantee_text",
    "return_days",
    "free_delivery",
    "delivery_note",
    "quantity_discounts",
    "reviews_json",
    "active"
  ];

  for (const key of allowedKeys) {
    if (updates[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(updates[key]);
    }
  }

  if (fields.length === 0) return;

  values.push(id);
  await db
    .prepare(`UPDATE products SET ${fields.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();
}

// ==========================================
// ORDERS & ATOMIC CREATION
// ==========================================
export async function findRecentOrderByPhone(
  db: D1Database,
  phone: string,
  minutes: number = 10
): Promise<OrderRow | null> {
  const row = await db
    .prepare(
      `SELECT * FROM orders 
       WHERE phone = ? 
         AND created_at >= datetime('now', '-' || ? || ' minutes')
       ORDER BY id DESC LIMIT 1`
    )
    .bind(phone, minutes)
    .first<OrderRow>();
  return row || null;
}

export async function findOrderByEventId(
  db: D1Database,
  eventId: string
): Promise<OrderRow | null> {
  const row = await db
    .prepare("SELECT * FROM orders WHERE event_id = ? LIMIT 1")
    .bind(eventId)
    .first<OrderRow>();
  return row || null;
}

export async function getOrderByCode(
  db: D1Database,
  code: string
): Promise<OrderWithItems | null> {
  const order = await db
    .prepare("SELECT * FROM orders WHERE code = ? LIMIT 1")
    .bind(code)
    .first<OrderRow>();

  if (!order) return null;

  const { results: items } = await db
    .prepare("SELECT * FROM order_items WHERE order_id = ?")
    .bind(order.id)
    .all<OrderItemRow>();

  return {
    ...order,
    items: items || []
  };
}

export async function getOrderItems(db: D1Database, orderId: number): Promise<OrderItemRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM order_items WHERE order_id = ?")
    .bind(orderId)
    .all<OrderItemRow>();
  return results || [];
}

/**
 * Creates an order atomically:
 * 1. Computes total server-side strictly from DB prices & admin discounts.
 * 2. In a single db.batch:
 *    - Decrements stock (CHECK(stock >= 0) enforces zero overselling)
 *    - Inserts order
 *    - Inserts order items
 */
export async function createOrderAtomic(
  db: D1Database,
  payload: CreateOrderPayload,
  ipHash: string,
  userAgent: string
): Promise<{ ok: boolean; error?: string; order?: OrderWithItems }> {
  if (!payload.items || payload.items.length === 0) {
    return { ok: false, error: "سلة الطلب فارغة" };
  }

  const productIds = payload.items.map((i) => i.productId);
  const placeholders = productIds.map(() => "?").join(",");
  const { results: dbProducts } = await db
    .prepare(`SELECT * FROM products WHERE id IN (${placeholders})`)
    .bind(...productIds)
    .all<ProductRow>();

  const productMap = new Map<number, ProductRow>();
  (dbProducts || []).forEach((p) => productMap.set(p.id, p));

  let subtotal = 0;
  let totalQty = 0;
  const verifiedItems: {
    productId: number;
    name_snapshot: string;
    unit_price: number;
    qty: number;
  }[] = [];

  let quantityDiscountRules: QuantityDiscountRule[] = [];

  for (const item of payload.items) {
    const product = productMap.get(item.productId);
    if (!product || product.active === 0) {
      return { ok: false, error: `المنتج غير متوفر حالياً` };
    }

    if (item.qty <= 0) {
      return { ok: false, error: "الكمية المطلوبة غير صحيحة" };
    }

    if (product.stock < item.qty) {
      return {
        ok: false,
        error: `الكمية المطلوبة غير متوفرة، المتوفر حالياً: ${product.stock}`
      };
    }

    const itemTotal = product.price * item.qty;
    subtotal += itemTotal;
    totalQty += item.qty;

    if (product.quantity_discounts && quantityDiscountRules.length === 0) {
      try {
        quantityDiscountRules = JSON.parse(product.quantity_discounts);
      } catch (_) {}
    }

    verifiedItems.push({
      productId: product.id,
      name_snapshot: product.name_ar,
      unit_price: product.price,
      qty: item.qty
    });
  }

  // Calculate discount from DB rules
  let discount = 0;
  if (quantityDiscountRules && quantityDiscountRules.length > 0) {
    const sortedDiscounts = [...quantityDiscountRules].sort((a, b) => b.minQty - a.minQty);
    for (const rule of sortedDiscounts) {
      if (totalQty >= rule.minQty) {
        discount = Math.round((subtotal * rule.percent) / 100);
        break;
      }
    }
  }

  const total = subtotal - discount;
  const orderCode = generateOrderCode(8);

  // Batch statements: Decrement stock & Insert order
  const batchStatements: any[] = [];

  for (const item of verifiedItems) {
    batchStatements.push(
      db
        .prepare("UPDATE products SET stock = stock - ? WHERE id = ?")
        .bind(item.qty, item.productId)
    );
  }

  batchStatements.push(
    db
      .prepare(
        `INSERT INTO orders (
          code, event_id, status, customer_name, phone, governorate,
          address, lat, lng, notes, subtotal, discount, total,
          ip_hash, user_agent, source_url, fbp, fbc,
          capi_status, capi_response, admin_note, stock_restored,
          sheet_sync_status, sheet_synced_at, sheet_attempts, sheet_error
        ) VALUES (
          ?, ?, 'new', ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          'pending', NULL, NULL, 0,
          'pending', NULL, 0, NULL
        )`
      )
      .bind(
        orderCode,
        payload.event_id,
        payload.customer_name.trim(),
        payload.phone.trim(),
        payload.governorate.trim(),
        payload.address.trim(),
        payload.lat || null,
        payload.lng || null,
        payload.notes ? payload.notes.trim() : null,
        subtotal,
        discount,
        total,
        ipHash,
        userAgent,
        payload.event_source_url || null,
        payload.fbp || null,
        payload.fbc || null
      )
  );

  try {
    await db.batch(batchStatements);
  } catch (err: any) {
    console.error("Batch order creation failed:", err);
    if (err.message && (err.message.includes("CHECK") || err.message.includes("constraint"))) {
      const current = await getProductById(db, verifiedItems[0].productId);
      return {
        ok: false,
        error: `الكمية المطلوبة غير متوفرة، المتوفر حالياً: ${current?.stock ?? 0}`
      };
    }
    return { ok: false, error: "تعذر حفظ الطلب، يرجى المحاولة مرة أخرى" };
  }

  const createdOrder = await db
    .prepare("SELECT * FROM orders WHERE code = ?")
    .bind(orderCode)
    .first<OrderRow>();

  if (!createdOrder) {
    return { ok: false, error: "حدث خطأ غير متوقع أثناء حفظ الطلب" };
  }

  // Insert order_items
  const itemStatements = verifiedItems.map((item) =>
    db
      .prepare(
        "INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, qty) VALUES (?, ?, ?, ?, ?)"
      )
      .bind(createdOrder.id, item.productId, item.name_snapshot, item.unit_price, item.qty)
  );

  await db.batch(itemStatements);

  const finalOrder = await getOrderByCode(db, orderCode);
  if (!finalOrder) {
    return { ok: false, error: "خطأ في استرجاع تفاصيل الطلب" };
  }

  return { ok: true, order: finalOrder };
}

export async function updateOrderStatus(
  db: D1Database,
  id: number,
  newStatus: OrderStatus
): Promise<{ success: boolean; error?: string }> {
  const order = await db
    .prepare("SELECT * FROM orders WHERE id = ?")
    .bind(id)
    .first<OrderRow>();

  if (!order) {
    return { success: false, error: "الطلب غير موجود" };
  }

  if (order.status === newStatus) {
    return { success: true };
  }

  const items = await getOrderItems(db, id);

  // Restore stock on cancellation
  if (newStatus === "cancelled" && order.stock_restored === 0) {
    const batchStatements: any[] = items.map((item) =>
      db
        .prepare("UPDATE products SET stock = stock + ? WHERE id = ?")
        .bind(item.qty, item.product_id)
    );
    batchStatements.push(
      db
        .prepare(
          "UPDATE orders SET status = 'cancelled', stock_restored = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        )
        .bind(id)
    );
    await db.batch(batchStatements);
    return { success: true };
  }

  // If un-cancelling
  if (order.status === "cancelled" && newStatus !== "cancelled" && order.stock_restored === 1) {
    for (const item of items) {
      const product = await getProductById(db, item.product_id);
      if (!product || product.stock < item.qty) {
        return {
          success: false,
          error: `لا يمكن تنشيط الطلب: المخزون الحالي للمنتج غير كافٍ (${product?.stock ?? 0})`
        };
      }
    }

    const batchStatements: any[] = items.map((item) =>
      db
        .prepare("UPDATE products SET stock = stock - ? WHERE id = ?")
        .bind(item.qty, item.product_id)
    );
    batchStatements.push(
      db
        .prepare(
          "UPDATE orders SET status = ?, stock_restored = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        )
        .bind(newStatus, id)
    );
    await db.batch(batchStatements);
    return { success: true };
  }

  // Normal status update
  await db
    .prepare("UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(newStatus, id)
    .run();

  return { success: true };
}

export async function updateOrderAdminNote(
  db: D1Database,
  id: number,
  adminNote: string
): Promise<void> {
  await db
    .prepare("UPDATE orders SET admin_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(adminNote, id)
    .run();
}

export async function updateOrderCapiStatus(
  db: D1Database,
  orderId: number,
  status: string,
  response: string
): Promise<void> {
  await db
    .prepare("UPDATE orders SET capi_status = ?, capi_response = ? WHERE id = ?")
    .bind(status, response.substring(0, 500), orderId)
    .run();
}

export async function getOrders(
  db: D1Database,
  options: {
    status?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }
): Promise<{ orders: OrderWithItems[]; totalCount: number }> {
  const whereClauses: string[] = [];
  const params: any[] = [];

  if (options.status && options.status !== "all") {
    whereClauses.push("status = ?");
    params.push(options.status);
  }

  if (options.search && options.search.trim()) {
    const q = `%${options.search.trim()}%`;
    whereClauses.push("(customer_name LIKE ? OR phone LIKE ? OR code LIKE ?)");
    params.push(q, q, q);
  }

  if (options.startDate) {
    whereClauses.push("created_at >= ?");
    params.push(options.startDate + " 00:00:00");
  }

  if (options.endDate) {
    whereClauses.push("created_at <= ?");
    params.push(options.endDate + " 23:59:59");
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const countRow = await db
    .prepare(`SELECT COUNT(*) as count FROM orders ${whereSql}`)
    .bind(...params)
    .first<{ count: number }>();
  const totalCount = countRow?.count || 0;

  const page = Math.max(1, options.page || 1);
  const limit = Math.max(1, Math.min(100, options.limit || 20));
  const offset = (page - 1) * limit;

  const { results: orders } = await db
    .prepare(`SELECT * FROM orders ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .bind(...params, limit, offset)
    .all<OrderRow>();

  if (!orders || orders.length === 0) {
    return { orders: [], totalCount };
  }

  const orderIds = orders.map((o) => o.id);
  const placeholders = orderIds.map(() => "?").join(",");
  const { results: allItems } = await db
    .prepare(`SELECT * FROM order_items WHERE order_id IN (${placeholders})`)
    .bind(...orderIds)
    .all<OrderItemRow>();

  const itemsByOrderId = new Map<number, OrderItemRow[]>();
  (allItems || []).forEach((item) => {
    if (!itemsByOrderId.has(item.order_id)) {
      itemsByOrderId.set(item.order_id, []);
    }
    itemsByOrderId.get(item.order_id)!.push(item);
  });

  const ordersWithItems: OrderWithItems[] = orders.map((o) => ({
    ...o,
    items: itemsByOrderId.get(o.id) || []
  }));

  return { orders: ordersWithItems, totalCount };
}

/**
 * Dashboard stats: strictly excludes cancelled orders from total sales value!
 */
export async function getDashboardStats(db: D1Database): Promise<{
  ordersToday: number;
  newOrders: number;
  totalValue: number;
  remainingStock: number;
}> {
  // Today's non-cancelled orders
  const todayRow = await db
    .prepare(
      "SELECT COUNT(*) as count FROM orders WHERE date(created_at) = date('now') AND status != 'cancelled'"
    )
    .first<{ count: number }>();

  // New orders awaiting confirmation
  const newRow = await db
    .prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'new'")
    .first<{ count: number }>();

  // Total sales value strictly EXCLUDING cancelled orders
  const valueRow = await db
    .prepare("SELECT SUM(total) as sum FROM orders WHERE status != 'cancelled'")
    .first<{ sum: number | null }>();

  // Total remaining stock
  const stockRow = await db
    .prepare("SELECT SUM(stock) as sum FROM products WHERE active = 1")
    .first<{ sum: number | null }>();

  return {
    ordersToday: todayRow?.count || 0,
    newOrders: newRow?.count || 0,
    totalValue: valueRow?.sum || 0,
    remainingStock: stockRow?.sum || 0
  };
}

/**
 * Danger Zone: Wipe test orders before launch and optionally reset stock
 */
export async function wipeTestOrders(
  db: D1Database,
  resetStockTo?: number | null
): Promise<void> {
  const stmts = [
    db.prepare("DELETE FROM order_items"),
    db.prepare("DELETE FROM orders"),
    db.prepare("DELETE FROM rate_limits")
  ];

  if (resetStockTo !== undefined && resetStockTo !== null && resetStockTo >= 0) {
    stmts.push(db.prepare("UPDATE products SET stock = ? WHERE active = 1").bind(resetStockTo));
  }

  await db.batch(stmts);
}
