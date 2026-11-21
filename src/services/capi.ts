import { D1Database } from "@cloudflare/workers-types";
import { OrderWithItems } from "./db";
import { sha256 } from "../utils/crypto";
import { normalizeIraqiPhone } from "../utils/phone";
import { updateOrderCapiStatus } from "./db";

export const META_API_VERSION = "v21.0";

export interface CapiConfig {
  pixelId: string;
  accessToken: string;
  testEventCode?: string;
  eventName?: string; // "Purchase" by default, or "Lead"
}

export interface CapiUserDataInput {
  phone: string;
  customerName: string;
  governorate: string;
  clientIp: string;
  userAgent: string;
  fbp?: string | null;
  fbc?: string | null;
}

export async function sendMetaConversionEvent(
  db: D1Database,
  order: OrderWithItems,
  clientIp: string,
  userAgent: string,
  config: CapiConfig
): Promise<{ success: boolean; status: string; responseText: string }> {
  if (!config.pixelId || !config.accessToken || config.accessToken === "mock_meta_access_token_for_dev") {
    const msg = "Meta CAPI skipped: Pixel ID or valid Access Token not configured";
    console.log(`[CAPI] ${msg} for order #${order.code}`);
    await updateOrderCapiStatus(db, order.id, "skipped", msg);
    return { success: true, status: "skipped", responseText: msg };
  }

  const eventName = config.eventName || "Purchase";
  const eventTime = Math.floor(Date.now() / 1000);

  // Phone normalization
  const phoneInfo = normalizeIraqiPhone(order.phone);
  const internationalPhone = phoneInfo.international || order.phone.replace(/[^0-9]/g, "");

  // Split name
  const nameParts = order.customer_name.trim().split(/\s+/);
  const firstName = nameParts[0] || "";
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";

  // Hashing PII according to Meta documentation
  const hashedPhone = await sha256(internationalPhone.trim().toLowerCase());
  const hashedFn = firstName ? await sha256(firstName.trim().toLowerCase()) : undefined;
  const hashedLn = lastName ? await sha256(lastName.trim().toLowerCase()) : undefined;
  const hashedCountry = await sha256("iq");
  const hashedCt = order.governorate ? await sha256(order.governorate.trim().toLowerCase()) : undefined;
  const hashedExternalId = await sha256(internationalPhone);

  const userData: Record<string, any> = {
    ph: [hashedPhone],
    country: [hashedCountry],
    external_id: [hashedExternalId],
    client_ip_address: clientIp,
    client_user_agent: userAgent
  };

  if (hashedFn) userData.fn = [hashedFn];
  if (hashedLn) userData.ln = [hashedLn];
  if (hashedCt) userData.ct = [hashedCt];
  if (order.fbp) userData.fbp = order.fbp;
  if (order.fbc) userData.fbc = order.fbc;

  const totalQty = order.items.reduce((sum, item) => sum + item.qty, 0);

  const customData: Record<string, any> = {
    value: order.total,
    currency: "IQD",
    content_type: "product",
    content_ids: order.items.map((i) => String(i.product_id)),
    contents: order.items.map((i) => ({
      id: String(i.product_id),
      quantity: i.qty,
      item_price: i.unit_price
    })),
    num_items: totalQty,
    order_id: order.code
  };

  const eventPayload: Record<string, any> = {
    event_name: eventName,
    event_time: eventTime,
    event_id: order.event_id,
    event_source_url: order.source_url || "https://perfume.workers.dev",
    action_source: "website",
    user_data: userData,
    custom_data: customData
  };

  const body: Record<string, any> = {
    data: [eventPayload]
  };

  if (config.testEventCode && config.testEventCode.trim()) {
    body.test_event_code = config.testEventCode.trim();
  }

  // Redacted log for debugging
  console.log("[CAPI] Sending event:", {
    event_name: eventName,
    event_id: order.event_id,
    order_code: order.code,
    total: order.total,
    test_mode: Boolean(body.test_event_code),
    has_fbp: Boolean(order.fbp),
    has_fbc: Boolean(order.fbc)
  });

  const url = `https://graph.facebook.com/${META_API_VERSION}/${config.pixelId}/events?access_token=${encodeURIComponent(
    config.accessToken
  )}`;

  // Send with 1 retry on network/server error
  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      const responseText = await response.text();

      if (response.ok) {
        console.log(`[CAPI] Event successfully sent for order #${order.code}`);
        await updateOrderCapiStatus(db, order.id, "sent", responseText);
        return { success: true, status: "sent", responseText };
      }

      console.warn(`[CAPI] Attempt ${attempt} failed with status ${response.status}: ${responseText}`);
      lastError = `Status ${response.status}: ${responseText}`;

      // If client-side error (4xx except 429), don't retry
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        break;
      }
    } catch (err: any) {
      console.error(`[CAPI] Network error on attempt ${attempt}:`, err);
      lastError = err.message || String(err);
    }
  }

  await updateOrderCapiStatus(db, order.id, "failed", lastError);
  return { success: false, status: "failed", responseText: lastError };
}
