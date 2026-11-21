/**
 * Technical Configuration & Constants
 * Note: All product details, copy, pricing, stock, guarantees, and store settings
 * are managed exclusively through Cloudflare D1 and the Admin panel (/admin).
 */

export const TECHNICAL_CONFIG = {
  currency: "IQD",
  metaApiVersion: "v21.0",
  maxImagesPerProduct: 8,
  maxImageSizeBytes: 450 * 1024, // ~450KB
  stockUrgencyThreshold: 10,
  defaultReturnDays: 3
};

export const IRAQI_GOVERNORATES = [
  "بغداد",
  "البصرة",
  "نينوى",
  "أربيل",
  "النجف",
  "كربلاء",
  "كركوك",
  "ذي قار",
  "بابل",
  "الأنبار",
  "ديالى",
  "المثنى",
  "القادسية",
  "ميسان",
  "واسط",
  "دهوك",
  "صلاح الدين",
  "السليمانية"
] as const;
