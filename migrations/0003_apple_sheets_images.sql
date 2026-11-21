-- Migration 0003: Google Sheets Sync, Product Images BLOB Storage, Extended Product & Store Settings

-- 1. Add Google Sheets Sync tracking columns to orders table
ALTER TABLE orders ADD COLUMN sheet_sync_status TEXT DEFAULT 'pending';
ALTER TABLE orders ADD COLUMN sheet_synced_at DATETIME;
ALTER TABLE orders ADD COLUMN sheet_attempts INTEGER DEFAULT 0;
ALTER TABLE orders ADD COLUMN sheet_error TEXT;

-- 2. Create product_images table to store image BLOBs directly in D1
CREATE TABLE IF NOT EXISTS product_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  mime TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  position INTEGER NOT NULL DEFAULT 0,
  data BLOB NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON product_images(product_id);
CREATE INDEX IF NOT EXISTS idx_product_images_position ON product_images(position);

-- 3. Extend products table with admin-managed copy and attributes
ALTER TABLE products ADD COLUMN tagline_ar TEXT;
ALTER TABLE products ADD COLUMN description_ar TEXT;
ALTER TABLE products ADD COLUMN compare_at_price INTEGER;
ALTER TABLE products ADD COLUMN size_ml INTEGER DEFAULT 100;
ALTER TABLE products ADD COLUMN notes_top TEXT;
ALTER TABLE products ADD COLUMN notes_heart TEXT;
ALTER TABLE products ADD COLUMN notes_base TEXT;
ALTER TABLE products ADD COLUMN guarantee_text TEXT;
ALTER TABLE products ADD COLUMN return_days INTEGER DEFAULT 3;
ALTER TABLE products ADD COLUMN free_delivery INTEGER DEFAULT 1;
ALTER TABLE products ADD COLUMN delivery_note TEXT;
ALTER TABLE products ADD COLUMN quantity_discounts TEXT;
ALTER TABLE products ADD COLUMN reviews_json TEXT;

-- 4. Store settings table for general store configuration
CREATE TABLE IF NOT EXISTS store_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Seed initial basic store settings (WhatsApp default OFF as requested)
INSERT OR IGNORE INTO store_settings (key, value) VALUES ('store_name', 'عطور عزام الشمري');
INSERT OR IGNORE INTO store_settings (key, value) VALUES ('whatsapp_enabled', '0');
INSERT OR IGNORE INTO store_settings (key, value) VALUES ('whatsapp_number', '');
