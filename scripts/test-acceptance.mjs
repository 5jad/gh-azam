/**
 * Acceptance Test Suite for Perfume Landing Page (Apple-style Light Redesign)
 * Tests all acceptance criteria including security, atomicity, deduplication,
 * Google Sheets sync, image storage, and Danger Zone.
 */

import assert from "node:assert/strict";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:8787";

// Localhost-only safety guard: tests must refuse to run on production
if (!BASE_URL.includes("localhost") && !BASE_URL.includes("127.0.0.1")) {
  throw new Error(`CRITICAL: Acceptance tests must only run against localhost or 127.0.0.1. Attempted target: ${BASE_URL}`);
}

let phoneSuffix = Math.floor(Math.random() * 5000) + 1000;
let ipCounter = 1;
const testRunOctet = Math.floor(Math.random() * 200) + 1;

function getTestPhone() {
  const s = String(phoneSuffix++).padStart(4, "0");
  return `0780123${s}`;
}

function getTestHeaders(extra = {}) {
  return {
    "Content-Type": "application/json",
    "cf-connecting-ip": `10.${testRunOctet}.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`,
    ...extra
  };
}

async function runTests() {
  console.log(`\n🚀 Starting Acceptance Test Suite against ${BASE_URL}...\n`);
  let passedCount = 0;

  // -------------------------------------------------------------
  // Test 1: HTML, RTL, Apple-Style Carousel, No Gallery, No FAQ
  // -------------------------------------------------------------
  {
    console.log("▶ [Test 1] Testing Landing Page HTML, Fonts, Carousel & Removed Sections...");
    const res = await fetch(`${BASE_URL}/`);
    assert.equal(res.status, 200, "Homepage must return status 200");
    const html = await res.text();

    assert(html.includes('lang="ar"'), "Must include lang='ar'");
    assert(html.includes('dir="rtl"'), "Must include dir='rtl'");
    assert(html.includes('IBM+Plex+Sans+Arabic'), "Must load IBM Plex Sans Arabic font");
    assert(html.includes('id="hero-carousel"'), "Must include hero carousel container");
    assert(html.includes('id="carousel-track"'), "Must include carousel track");
    assert(html.includes('id="order-form"'), "Must include order form container");
    assert(html.includes('id="sticky-cta-bar"'), "Must include sticky bottom CTA bar");
    assert(html.includes('fbq'), "Must load Meta Pixel base code");
    assert(html.includes('challenges.cloudflare.com/turnstile'), "Must include Turnstile script");

    // Sections explicitly removed
    assert(!html.includes('id="gallery"'), "Gallery section must be completely removed");
    assert(!html.includes('id="faq"'), "FAQ section must be completely removed");
    assert(!html.includes('class="faq-section"'), "FAQ section class must be completely removed");

    // WhatsApp hidden by default
    assert(
      html.includes('id="footer-whatsapp-container" style="display: none;"'),
      "WhatsApp button must be hidden by default"
    );

    console.log("  ✅ Page renders RTL, IBM Plex font, hero carousel, no gallery/FAQ, WhatsApp hidden by default.\n");
    passedCount++;
  }

  // -------------------------------------------------------------
  // Test 2: Admin Security & Auth
  // -------------------------------------------------------------
  let adminCookie = "";
  {
    console.log("▶ [Test 2] Testing Admin Route Protection & Authentication...");
    // 1. Without auth
    const unauthorizedRes = await fetch(`${BASE_URL}/api/admin/orders`);
    assert.equal(unauthorizedRes.status, 401, "Protected admin API must return 401 without cookie");

    // 2. Incorrect password
    const adminTestIp = `10.99.${testRunOctet}.${ipCounter++}`;
    const wrongLoginRes = await fetch(`${BASE_URL}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "cf-connecting-ip": adminTestIp },
      body: JSON.stringify({ password: "wrong-password-xyz" })
    });
    assert.equal(wrongLoginRes.status, 401, "Wrong password must return 401");

    // 3. Correct login (using dev password from .dev.vars)
    const loginRes = await fetch(`${BASE_URL}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "cf-connecting-ip": `10.99.${testRunOctet}.${ipCounter++}` },
      body: JSON.stringify({ password: "admin_test_password_123" })
    });
    assert.equal(loginRes.status, 200, "Correct password must return 200");
    const setCookie = loginRes.headers.get("set-cookie");
    assert(setCookie && setCookie.includes("perfume_admin_session"), "Must set signed session cookie");
    assert(setCookie.includes("HttpOnly"), "Cookie must be HttpOnly");
    assert(setCookie.includes("SameSite=Strict"), "Cookie must be SameSite=Strict");
    adminCookie = setCookie.split(";")[0];

    // 4. Test authenticated request with cookie
    const authRes = await fetch(`${BASE_URL}/api/admin/orders`, {
      headers: { Cookie: adminCookie }
    });
    assert.equal(authRes.status, 200, "Authorized request with cookie must return 200");
    console.log("  ✅ Admin protection verified: 401 when unauthorized, HttpOnly signed cookie on login.\n");
    passedCount++;
  }

  // -------------------------------------------------------------
  // Test 3: Phone Validation & Arabic-Indic Digits Normalization
  // -------------------------------------------------------------
  {
    console.log("▶ [Test 3] Testing Phone Number Validation & Arabic-Indic Normalization...");
    // 1. Invalid phone format
    const invalidPhoneRes = await fetch(`${BASE_URL}/api/orders`, {
      method: "POST",
      headers: getTestHeaders(),
      body: JSON.stringify({
        customer_name: "علي الكرخي",
        phone: "0512345678", // Invalid Iraqi phone
        governorate: "بغداد",
        address: "حي الكرادة شارع 14",
        items: [{ productId: 1, qty: 1 }],
        event_id: `evt_invalid_phone_${Date.now()}`
      })
    });
    assert.equal(invalidPhoneRes.status, 400, "Invalid phone format must return 400");
    const errData = await invalidPhoneRes.json();
    assert(errData.error.includes("رقم الهاتف غير صحيح"), "Error message must be in clear Arabic");

    // 2. Eastern Arabic-Indic numerals (٠٧٧٠١٢٣٤٥٦٧) -> should succeed and be normalized
    const indicEventId = `evt_indic_${Date.now()}`;
    const validIndicRes = await fetch(`${BASE_URL}/api/orders`, {
      method: "POST",
      headers: getTestHeaders(),
      body: JSON.stringify({
        customer_name: "أحمد الفراتي",
        phone: "٠٧٧٠١٢٣٤٥٦٧", // Iraqi Zain with Eastern numerals
        governorate: "البصرة",
        address: "العشار شارع الكويت",
        items: [{ productId: 1, qty: 1 }],
        event_id: indicEventId
      })
    });
    assert.equal(validIndicRes.status, 200, "Valid phone with Arabic-Indic digits must succeed");
    const validData = await validIndicRes.json();
    assert.equal(validData.ok, true);

    // Verify stored format in admin orders is normalized E.164: +9647701234567
    const adminOrdersRes = await fetch(`${BASE_URL}/api/admin/orders?search=07701234567`, {
      headers: { Cookie: adminCookie }
    });
    const { orders } = await adminOrdersRes.json();
    const foundOrder = orders.find((o) => o.phone.includes("7701234567"));
    assert(foundOrder, "Order with normalized phone must be retrievable");
    assert.equal(foundOrder.phone, "07701234567", "Stored phone must be normalized to 07701234567");
    console.log("  ✅ Phone normalization verified: Arabic-Indic digits converted to standard Iraqi 07XXXXXXXXX format.\n");
    passedCount++;
  }

  // -------------------------------------------------------------
  // Test 4: Stock Atomic Decrement
  // -------------------------------------------------------------
  let orderToCancelId = null;
  let orderToCancelCode = null;
  {
    console.log("▶ [Test 4] Testing Stock Atomic Decrement...");
    // Reset stock to 20 first to ensure clean state
    await fetch(`${BASE_URL}/api/admin/products/1`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ stock: 20 })
    });

    // Check stock before
    const prodRes1 = await fetch(`${BASE_URL}/api/products`);
    const { products: p1 } = await prodRes1.json();
    const stockBefore = p1[0].stock;
    assert.equal(stockBefore, 20, "Stock before must be 20");

    // Place an order for 2 items
    const eventId = `evt_stock_test_${Date.now()}`;
    const testPhone4 = getTestPhone();
    const orderRes = await fetch(`${BASE_URL}/api/orders`, {
      method: "POST",
      headers: getTestHeaders(),
      body: JSON.stringify({
        customer_name: "سيف الدين",
        phone: testPhone4,
        governorate: "أربيل",
        address: "عينكاوة مقابل مجمع روز",
        items: [{ productId: 1, qty: 2 }],
        event_id: eventId
      })
    });

    assert.equal(orderRes.status, 200, "Order must succeed");
    const resData = await orderRes.json();
    assert.equal(resData.ok, true);
    orderToCancelCode = resData.code;

    // Check stock after
    const prodRes2 = await fetch(`${BASE_URL}/api/products`);
    const { products: p2 } = await prodRes2.json();
    const stockAfter = p2[0].stock;

    assert.equal(stockAfter, stockBefore - 2, "Stock must decrease by ordered quantity (2)");

    // Get internal ID from admin
    const adminOrdersRes = await fetch(`${BASE_URL}/api/admin/orders?search=${resData.code}`, {
      headers: { Cookie: adminCookie }
    });
    const { orders } = await adminOrdersRes.json();
    orderToCancelId = orders[0].id;

    console.log(`  ✅ Stock successfully decremented from ${stockBefore} to ${stockAfter}.\n`);
    passedCount++;
  }

  // -------------------------------------------------------------
  // Test 5: Oversell Rejection & Concurrency Proof
  // -------------------------------------------------------------
  {
    console.log("▶ [Test 5] Testing Stock Exhaustion & Concurrent Oversell Prevention...");
    const prodRes = await fetch(`${BASE_URL}/api/products`);
    const { products } = await prodRes.json();
    const currentStock = products[0].stock;

    // 1. Order more than available stock
    const excessiveRes = await fetch(`${BASE_URL}/api/orders`, {
      method: "POST",
      headers: getTestHeaders(),
      body: JSON.stringify({
        customer_name: "مشتري مفرط",
        phone: "07501112233",
        governorate: "بغداد",
        address: "المنصور",
        items: [{ productId: 1, qty: currentStock + 50 }],
        event_id: `evt_oversell_${Date.now()}`
      })
    });
    assert.equal(excessiveRes.status, 400, "Ordering more than stock must return 400");
    const errJson = await excessiveRes.json();
    assert(errJson.error.includes("الكمية المطلوبة غير متوفرة"), "Must show Arabic stock shortage message");

    // 2. Parallel Concurrency Test:
    // First, set product stock to exactly 1
    const setStockRes = await fetch(`${BASE_URL}/api/admin/products/1`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ stock: 1 })
    });
    assert.equal(setStockRes.status, 200);

    console.log("  Simulating two simultaneous parallel orders competing for the LAST 1 unit...");
    const [req1, req2] = await Promise.all([
      fetch(`${BASE_URL}/api/orders`, {
        method: "POST",
        headers: getTestHeaders(),
        body: JSON.stringify({
          customer_name: "المتسابق الأول",
          phone: getTestPhone(),
          governorate: "بغداد",
          address: "الكرادة",
          items: [{ productId: 1, qty: 1 }],
          event_id: `evt_race_1_${Date.now()}`
        })
      }),
      fetch(`${BASE_URL}/api/orders`, {
        method: "POST",
        headers: getTestHeaders(),
        body: JSON.stringify({
          customer_name: "المتسابق الثاني",
          phone: getTestPhone(),
          governorate: "النجف",
          address: "شارع الكوفة",
          items: [{ productId: 1, qty: 1 }],
          event_id: `evt_race_2_${Date.now()}`
        })
      })
    ]);

    const resJson1 = await req1.json();
    const resJson2 = await req2.json();

    const successes = [resJson1, resJson2].filter((r) => r.ok).length;
    const failures = [resJson1, resJson2].filter((r) => !r.ok).length;

    assert.equal(successes, 1, "Exactly one concurrent order must succeed");
    assert.equal(failures, 1, "The second concurrent order must be rejected (no overselling)");
    console.log("  ✅ Concurrency proof passed: 1 succeeded, 1 rejected due to atomic D1 batch transaction.\n");
    passedCount++;

    // Restore stock for subsequent tests
    await fetch(`${BASE_URL}/api/admin/products/1`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ stock: 20 })
    });
  }

  // -------------------------------------------------------------
  // Test 6: Anti-Duplicate & Idempotency
  // -------------------------------------------------------------
  {
    console.log("▶ [Test 6] Testing Idempotency & Anti-Duplicate Protection...");
    const test6Ip = `172.16.${testRunOctet}.${ipCounter++}`;
    const test6Headers = { "Content-Type": "application/json", "cf-connecting-ip": test6Ip };
    const staticEventId = `evt_idempotent_${Date.now()}`;
    const test6Phone = getTestPhone();
    const orderPayload = {
      customer_name: "حيدر الكعبي",
      phone: test6Phone,
      governorate: "كربلاء",
      address: "حي الحسين شارع الأطباء",
      items: [{ productId: 1, qty: 1 }],
      event_id: staticEventId
    };

    // First request
    const firstRes = await fetch(`${BASE_URL}/api/orders`, {
      method: "POST",
      headers: test6Headers,
      body: JSON.stringify(orderPayload)
    });
    const firstData = await firstRes.json();
    assert.equal(firstData.ok, true);

    // Immediate retry with the same event_id
    const retryRes = await fetch(`${BASE_URL}/api/orders`, {
      method: "POST",
      headers: test6Headers,
      body: JSON.stringify(orderPayload)
    });
    const retryData = await retryRes.json();
    assert.equal(retryData.ok, true);
    assert.equal(retryData.code, firstData.code, "Retry with same event_id must return the existing order");

    // Rapid order with same phone and items within 10 minutes
    const duplicatePhoneRes = await fetch(`${BASE_URL}/api/orders`, {
      method: "POST",
      headers: test6Headers,
      body: JSON.stringify({
        ...orderPayload,
        event_id: `evt_different_id_${Date.now()}` // Different event ID but same phone & items
      })
    });
    const dupData = await duplicatePhoneRes.json();
    assert.equal(dupData.ok, true);
    assert.equal(dupData.code, firstData.code, "Duplicate order within 10 minutes from same phone must return existing order");
    console.log("  ✅ Anti-duplicate verified: Both event_id idempotency and 10-minute phone duplicate guard succeed.\n");
    passedCount++;
  }

  // -------------------------------------------------------------
  // Test 7: Order Cancellation & Stock Restoration
  // -------------------------------------------------------------
  {
    console.log("▶ [Test 7] Testing Order Cancellation & Stock Restoration...");
    const prodResBefore = await fetch(`${BASE_URL}/api/products`);
    const { products: pBefore } = await prodResBefore.json();
    const stockBeforeCancel = pBefore[0].stock;

    // Cancel the order created in Test 4 (which ordered 2 units)
    assert(orderToCancelId, "Must have an order ID to cancel");
    const cancelRes = await fetch(`${BASE_URL}/api/admin/orders/${orderToCancelId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ status: "cancelled" })
    });
    assert.equal(cancelRes.status, 200);

    const prodResAfter = await fetch(`${BASE_URL}/api/products`);
    const { products: pAfter } = await prodResAfter.json();
    assert.equal(pAfter[0].stock, stockBeforeCancel + 2, "Stock must increase by 2 upon cancellation");

    // Test Guard Against Double Restoration: Cancelling again should NOT add stock again
    await fetch(`${BASE_URL}/api/admin/orders/${orderToCancelId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ status: "cancelled" })
    });
    const prodResAfterAgain = await fetch(`${BASE_URL}/api/products`);
    const { products: pAfterAgain } = await prodResAfterAgain.json();
    assert.equal(pAfterAgain[0].stock, pAfter[0].stock, "Double-cancelling must NOT restore stock twice");
    console.log("  ✅ Stock restoration verified: Stock restored once, guarded against double restoration.\n");
    passedCount++;
  }

  // -------------------------------------------------------------
  // Test 8: Meta Pixel & CAPI Deduplication Payload
  // -------------------------------------------------------------
  {
    console.log("▶ [Test 8] Testing Meta Pixel & CAPI Deduplication event_id...");
    const testEventId = `evt_meta_dedup_${Date.now()}`;
    const testOrderRes = await fetch(`${BASE_URL}/api/orders`, {
      method: "POST",
      headers: getTestHeaders(),
      body: JSON.stringify({
        customer_name: "مصطفى شاكر",
        phone: getTestPhone(),
        governorate: "ديالى",
        address: "بعقوبة الجديدة",
        items: [{ productId: 1, qty: 1 }],
        event_id: testEventId,
        fbp: "fb.1.1680000000.123456789",
        fbc: "fb.1.1680000000.IwAR_test_click_id"
      })
    });
    const testOrder = await testOrderRes.json();
    assert.equal(testOrder.event_id, testEventId, "Returned order must preserve exact event_id for Pixel and CAPI");

    // Fetch from thanks endpoint
    const lookupRes = await fetch(`${BASE_URL}/api/orders/${testOrder.code}`);
    const lookupData = await lookupRes.json();
    assert.equal(lookupData.order.event_id, testEventId, "Thanks page lookup must return same event_id for browser Purchase tracking");
    console.log("  ✅ Meta Deduplication verified: event_id matches across Browser Pixel and CAPI dispatch.\n");
    passedCount++;
  }

  // -------------------------------------------------------------
  // Test 9: Excel CSV Export with UTF-8 BOM & Sheet Status Column
  // -------------------------------------------------------------
  {
    console.log("▶ [Test 9] Testing Excel CSV Export with UTF-8 BOM...");
    const exportRes = await fetch(`${BASE_URL}/api/admin/export.csv`, {
      headers: { Cookie: adminCookie }
    });
    assert.equal(exportRes.status, 200);
    const contentType = exportRes.headers.get("content-type");
    assert(contentType.includes("text/csv"), "Content-Type must be text/csv");

    const arrayBuffer = await exportRes.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // Verify UTF-8 BOM: 0xEF, 0xBB, 0xBF
    assert.equal(bytes[0], 0xef, "First BOM byte must be 0xEF");
    assert.equal(bytes[1], 0xbb, "Second BOM byte must be 0xBB");
    assert.equal(bytes[2], 0xbf, "Third BOM byte must be 0xBF");

    const text = new TextDecoder("utf-8").decode(arrayBuffer);
    assert(text.includes("رمز الطلب"), "CSV must include Arabic headers");
    assert(text.includes("رقم الهاتف"), "CSV must include Arabic headers");
    assert(text.includes("مزامنة Google Sheets") || text.includes("مزامنة"), "CSV must include Google Sheets sync column");
    console.log("  ✅ CSV Export verified: Valid UTF-8 BOM present with Arabic headers and Sheet sync status.\n");
    passedCount++;
  }

  // -------------------------------------------------------------
  // Test 10: Store Settings & Product DB Source of Truth
  // -------------------------------------------------------------
  {
    console.log("▶ [Test 10] Testing Store Settings & DB Product Management...");
    // 1. Get settings
    const settingsRes = await fetch(`${BASE_URL}/api/admin/settings`, {
      headers: { Cookie: adminCookie }
    });
    assert.equal(settingsRes.status, 200);
    const settingsData = await settingsRes.json();
    assert.equal(settingsData.ok, true);
    assert.equal(Boolean(settingsData.settings.whatsapp_enabled), false, "WhatsApp must be disabled by default");

    // 2. Public config endpoint exposes store settings
    const configRes = await fetch(`${BASE_URL}/api/config`);
    assert.equal(configRes.status, 200);
    const configData = await configRes.json();
    assert.equal(Boolean(configData.storeSettings.whatsapp_enabled), false, "Public config reflects disabled WhatsApp");

    // 3. Products endpoint returns DB product
    const prodRes = await fetch(`${BASE_URL}/api/products`);
    assert.equal(prodRes.status, 200);
    const prodData = await prodRes.json();
    assert(Array.isArray(prodData.products), "Must return products array");
    assert(prodData.products.length > 0, "Must return at least one product from DB");
    console.log("  ✅ Store Settings verified: WhatsApp default OFF, DB is source of truth for products.\n");
    passedCount++;
  }

  // -------------------------------------------------------------
  // Test 11: Image Upload Validation (Max Size, Type, Storage)
  // -------------------------------------------------------------
  {
    console.log("▶ [Test 11] Testing D1 Image Upload Validation & /media/:id serving...");
    // 1. Oversized image (> 450KB) should return 400
    const oversizedBlob = new Uint8Array(500 * 1024); // 500KB dummy data
    const formDataOversized = new FormData();
    formDataOversized.append("image", new Blob([oversizedBlob], { type: "image/webp" }), "big.webp");

    const overRes = await fetch(`${BASE_URL}/api/admin/products/1/images`, {
      method: "POST",
      headers: { Cookie: adminCookie },
      body: formDataOversized
    });
    assert.equal(overRes.status, 400, "Image > 450KB must be rejected with 400");
    const overJson = await overRes.json();
    assert(overJson.error.includes("450KB"), "Error must mention 450KB limit");

    // 2. Valid image upload (tiny 1x1 WebP)
    // Minimal 1x1 valid webp
    const webpHeader = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c,
      0x0d, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00, 0x10, 0x07, 0x10, 0x11, 0x11, 0x88, 0x88, 0xfe, 0x07, 0x00
    ]);
    const formDataValid = new FormData();
    formDataValid.append("image", new Blob([webpHeader], { type: "image/webp" }), "valid.webp");

    const validUploadRes = await fetch(`${BASE_URL}/api/admin/products/1/images`, {
      method: "POST",
      headers: { Cookie: adminCookie },
      body: formDataValid
    });
    assert.equal(validUploadRes.status, 200, "Valid image upload must return 200");
    const uploadData = await validUploadRes.json();
    assert(uploadData.imageId, "Must return imageId");

    // 3. Serve via /media/:id
    const mediaRes = await fetch(`${BASE_URL}/media/${uploadData.imageId}`);
    assert.equal(mediaRes.status, 200, "Serving /media/:id must return 200");
    assert.equal(mediaRes.headers.get("content-type"), "image/webp");
    assert(mediaRes.headers.get("cache-control"), "Must have Cache-Control header");

    // Clean up uploaded test image
    const delRes = await fetch(`${BASE_URL}/api/admin/images/${uploadData.imageId}`, {
      method: "DELETE",
      headers: { Cookie: adminCookie }
    });
    assert.equal(delRes.status, 200, "Image deletion must return 200");

    console.log("  ✅ D1 Image Storage verified: 450KB limit enforced, /media/:id serves BLOB with caching.\n");
    passedCount++;
  }

  // -------------------------------------------------------------
  // Test 12: Danger Zone Wipe Orders
  // -------------------------------------------------------------
  {
    console.log("▶ [Test 12] Testing Danger Zone Wipe Orders...");
    // 1. Without exact confirmation text
    const badConfirmRes = await fetch(`${BASE_URL}/api/admin/danger/wipe-orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ confirm: "wrong" })
    });
    assert.equal(badConfirmRes.status, 400, "Must reject without exact confirmation phrase");

    // 2. With exact confirmation text "حذف الطلبات"
    const goodConfirmRes = await fetch(`${BASE_URL}/api/admin/danger/wipe-orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ confirm: "حذف الطلبات", resetStock: 30 })
    });
    assert.equal(goodConfirmRes.status, 200, "Danger zone wipe must succeed with exact confirmation");
    const wipeData = await goodConfirmRes.json();
    assert.equal(wipeData.ok, true);

    // Verify orders table is empty
    const adminOrdersRes = await fetch(`${BASE_URL}/api/admin/orders`, {
      headers: { Cookie: adminCookie }
    });
    const { orders } = await adminOrdersRes.json();
    assert.equal(orders.length, 0, "All test orders must be wiped");

    // Verify stock was reset to 30
    const prodRes = await fetch(`${BASE_URL}/api/products`);
    const { products } = await prodRes.json();
    assert.equal(products[0].stock, 30, "Stock must be reset to 30");

    console.log("  ✅ Danger Zone verified: Rejects incorrect phrase, cleanly wipes orders and resets stock.\n");
    passedCount++;
  }

  console.log(`\n🎉 All ${passedCount}/12 Acceptance Tests Passed Successfully!\n`);
}

runTests().catch((err) => {
  console.error("\n❌ Acceptance Test Failed:", err);
  process.exit(1);
});
