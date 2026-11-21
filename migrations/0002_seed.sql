-- Migration 0002: Seed initial product
INSERT OR REPLACE INTO products (id, slug, name_ar, price, stock, active)
VALUES (1, 'perfume-1', 'عطر عزام الشمري الملكي', 45000, 25, 1);
