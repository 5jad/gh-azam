import { D1Database } from "@cloudflare/workers-types";
import { OrderWithItems } from "./db";

export interface SheetOrderPayload {
  code: string;
  created_at: string;
  status: string;
  customer_name: string;
  phone: string;
  governorate: string;
  address: string;
  lat: number | null;
  lng: number | null;
  notes: string | null;
  admin_note: string | null;
  total: number;
  items: {
    product_id: number;
    name: string;
    unit_price: number;
    qty: number;
  }[];
}

export async function pingSheetWebhook(
  webhookUrl?: string,
  webhookToken?: string
): Promise<{ ok: boolean; message?: string; error?: string }> {
  if (!webhookUrl || !webhookUrl.trim()) {
    return { ok: false, error: "رابط Google Apps Script Webhook غير معرّف" };
  }

  try {
    const res = await fetch(webhookUrl.trim(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      redirect: "follow",
      body: JSON.stringify({
        action: "ping",
        token: webhookToken || ""
      })
    });

    if (!res.ok) {
      return { ok: false, error: `فشل الاتصال: رمز الاستجابة ${res.status}` };
    }

    const data = (await res.json().catch(() => ({}))) as any;
    if (data.ok) {
      return { ok: true, message: "تم الاتصال بنجاح مع جدول Google Sheets!" };
    }

    return { ok: false, error: data.error || "استجابة غير صحيحة من Google Script" };
  } catch (err: any) {
    return { ok: false, error: `تعذر الاتصال بـ Google Sheets: ${err.message || String(err)}` };
  }
}

export async function syncOrderToSheet(
  db: D1Database,
  order: OrderWithItems,
  webhookUrl?: string,
  webhookToken?: string
): Promise<{ success: boolean; error?: string }> {
  if (!webhookUrl || !webhookUrl.trim()) {
    await db
      .prepare(
        "UPDATE orders SET sheet_sync_status = 'failed', sheet_error = 'Google Sheets Webhook URL not configured' WHERE id = ?"
      )
      .bind(order.id)
      .run();
    return { success: false, error: "Webhook not configured" };
  }

  const payload: { action: string; token: string; order: SheetOrderPayload } = {
    action: "upsert",
    token: webhookToken || "",
    order: {
      code: order.code,
      created_at: order.created_at,
      status: order.status,
      customer_name: order.customer_name,
      phone: order.phone,
      governorate: order.governorate,
      address: order.address,
      lat: order.lat,
      lng: order.lng,
      notes: order.notes,
      admin_note: order.admin_note,
      total: order.total,
      items: (order.items || []).map((i) => ({
        product_id: i.product_id,
        name: i.name_snapshot,
        unit_price: i.unit_price,
        qty: i.qty
      }))
    }
  };

  try {
    const res = await fetch(webhookUrl.trim(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      redirect: "follow",
      body: JSON.stringify(payload)
    });

    const data = (await res.json().catch(() => ({}))) as any;

    if (res.ok && data.ok) {
      await db
        .prepare(
          "UPDATE orders SET sheet_sync_status = 'synced', sheet_synced_at = CURRENT_TIMESTAMP, sheet_attempts = sheet_attempts + 1, sheet_error = NULL WHERE id = ?"
        )
        .bind(order.id)
        .run();
      console.log(`[Google Sheets] Order #${order.code} synced successfully`);
      return { success: true };
    }

    const errMsg = data.error || `HTTP ${res.status}`;
    await db
      .prepare(
        "UPDATE orders SET sheet_sync_status = 'failed', sheet_attempts = sheet_attempts + 1, sheet_error = ? WHERE id = ?"
      )
      .bind(errMsg.substring(0, 300), order.id)
      .run();
    console.warn(`[Google Sheets] Order #${order.code} sync failed: ${errMsg}`);
    return { success: false, error: errMsg };
  } catch (err: any) {
    const errMsg = err.message || String(err);
    await db
      .prepare(
        "UPDATE orders SET sheet_sync_status = 'failed', sheet_attempts = sheet_attempts + 1, sheet_error = ? WHERE id = ?"
      )
      .bind(errMsg.substring(0, 300), order.id)
      .run();
    console.error(`[Google Sheets] Network error syncing #${order.code}:`, err);
    return { success: false, error: errMsg };
  }
}

/**
 * Background Cron Job: retry pending or failed orders (up to 10 attempts)
 */
export async function retryPendingSheetSyncs(
  db: D1Database,
  webhookUrl?: string,
  webhookToken?: string,
  limit: number = 10
): Promise<number> {
  if (!webhookUrl || !webhookUrl.trim()) return 0;

  const { results: pendingOrders } = await db
    .prepare(
      "SELECT id, code FROM orders WHERE sheet_sync_status != 'synced' AND sheet_attempts < 10 ORDER BY id ASC LIMIT ?"
    )
    .bind(limit)
    .all<{ id: number; code: string }>();

  if (!pendingOrders || pendingOrders.length === 0) return 0;

  let syncedCount = 0;
  for (const o of pendingOrders) {
    const { getOrderByCode } = await import("./db");
    const fullOrder = await getOrderByCode(db, o.code);
    if (fullOrder) {
      const res = await syncOrderToSheet(db, fullOrder, webhookUrl, webhookToken);
      if (res.success) syncedCount++;
    }
  }

  return syncedCount;
}
