import { D1Database, Fetcher } from "@cloudflare/workers-types";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  META_PIXEL_ID: string;
  TURNSTILE_SITE_KEY: string;
  META_TEST_EVENT_CODE?: string;
  CAPI_EVENT_NAME?: string;
  TURNSTILE_SECRET: string;
  META_ACCESS_TOKEN: string;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
  SHEETS_WEBHOOK_URL?: string;
  SHEETS_WEBHOOK_TOKEN?: string;
}

export interface ReviewItem {
  name: string;
  comment: string;
}

export interface QuantityDiscountRule {
  minQty: number;
  percent: number;
}

export interface ProductRow {
  id: number;
  slug: string;
  name_ar: string;
  tagline_ar: string | null;
  description_ar: string | null;
  price: number;
  compare_at_price: number | null;
  stock: number;
  size_ml: number;
  notes_top: string | null;
  notes_heart: string | null;
  notes_base: string | null;
  guarantee_text: string | null;
  return_days: number;
  free_delivery: number;
  delivery_note: string | null;
  quantity_discounts: string | null;
  reviews_json: string | null;
  active: number;
  created_at: string;
}

export interface FullProduct extends ProductRow {
  images: { id: number; position: number; mime: string }[];
  quantityDiscountParsed: QuantityDiscountRule[];
  reviewsParsed: ReviewItem[];
}

export interface ProductImageRow {
  id: number;
  product_id: number;
  mime: string;
  width: number | null;
  height: number | null;
  position: number;
  data: ArrayBuffer;
  created_at: string;
}

export interface StoreSettings {
  store_name: string;
  whatsapp_enabled: boolean;
  whatsapp_number: string;
}

export type OrderStatus = "new" | "confirmed" | "shipped" | "delivered" | "cancelled";
export type SheetSyncStatus = "pending" | "synced" | "failed";

export interface OrderRow {
  id: number;
  code: string;
  event_id: string;
  status: OrderStatus;
  customer_name: string;
  phone: string;
  governorate: string;
  address: string;
  lat: number | null;
  lng: number | null;
  notes: string | null;
  subtotal: number;
  discount: number;
  total: number;
  ip_hash: string;
  user_agent: string | null;
  source_url: string | null;
  fbp: string | null;
  fbc: string | null;
  capi_status: string;
  capi_response: string | null;
  admin_note: string | null;
  stock_restored: number;
  sheet_sync_status: SheetSyncStatus;
  sheet_synced_at: string | null;
  sheet_attempts: number;
  sheet_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItemRow {
  id: number;
  order_id: number;
  product_id: number;
  name_snapshot: string;
  unit_price: number;
  qty: number;
}

export interface CreateOrderPayload {
  customer_name: string;
  phone: string;
  governorate: string;
  address: string;
  notes?: string;
  lat?: number | null;
  lng?: number | null;
  items: { productId: number; qty: number }[];
  event_id: string;
  fbp?: string;
  fbc?: string;
  turnstileToken?: string;
  honeypot?: string;
  event_source_url?: string;
}
