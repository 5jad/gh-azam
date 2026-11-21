/**
 * Google Apps Script Webhook for Order Synchronization
 * Google Sheet Live Mirror for Cloudflare D1
 *
 * Setup:
 * 1. Open Google Sheet -> Extensions -> Apps Script
 * 2. Paste this code into Code.gs
 * 3. Go to Project Settings -> Script Properties -> Add property:
 *    Key: TOKEN
 *    Value: (Your secret token, e.g. a strong random string)
 * 4. Deploy -> New deployment -> Select type: Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5. Copy the Web App URL and set in Cloudflare Secrets:
 *    npx wrangler secret put SHEETS_WEBHOOK_URL
 *    npx wrangler secret put SHEETS_WEBHOOK_TOKEN
 */

var HEADERS = [
  "رقم الطلب",
  "التاريخ والوقت (توقيت بغداد)",
  "الحالة",
  "الاسم",
  "الهاتف",
  "المحافظة",
  "العنوان",
  "رابط الموقع",
  "المنتجات",
  "إجمالي القطع",
  "الإجمالي (د.ع)",
  "ملاحظات الزبون",
  "ملاحظة الإدارة"
];

var STATUS_MAP = {
  new: "جديد",
  confirmed: "تم التأكيد",
  shipped: "مشحون",
  delivered: "مسلّم",
  cancelled: "ملغي"
};

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    // Acquire lock for up to 30 seconds to handle concurrent syncs safely
    lock.waitLock(30000);

    var expectedToken = PropertiesService.getScriptProperties().getProperty("TOKEN");
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ ok: false, error: "Empty request body" }, 400);
    }

    var payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return jsonResponse({ ok: false, error: "Invalid JSON format" }, 400);
    }

    // Verify authentication token
    var providedToken = payload.token || (e.parameter && e.parameter.token);
    if (expectedToken && providedToken !== expectedToken) {
      return jsonResponse({ ok: false, error: "Unauthorized: Invalid or missing token" }, 401);
    }

    // Ping check
    if (payload.action === "ping") {
      return jsonResponse({ ok: true, message: "pong", timestamp: new Date().toISOString() });
    }

    if (payload.action === "upsert") {
      return handleUpsertOrder(payload.order);
    }

    return jsonResponse({ ok: false, error: "Unknown action: " + payload.action }, 400);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.toString() }, 500);
  } finally {
    lock.releaseLock();
  }
}

function handleUpsertOrder(order) {
  if (!order || !order.code) {
    return jsonResponse({ ok: false, error: "Order code is required for upsert" }, 400);
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  // Initialize sheet header if empty
  if (sheet.getLastRowNum() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    var headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
    headerRange.setFontWeight("bold");
    headerRange.setBackground("#f5f5f7");
    headerRange.setFontColor("#1d1d1f");
  }

  // Format date to Asia/Baghdad timezone
  var dateStr = "";
  try {
    var d = order.created_at ? new Date(order.created_at) : new Date();
    dateStr = Utilities.formatDate(d, "Asia/Baghdad", "yyyy-MM-dd HH:mm:ss");
  } catch (_) {
    dateStr = String(order.created_at || "");
  }

  var statusText = STATUS_MAP[order.status] || order.status || "جديد";
  var mapUrl = order.lat && order.lng ? "https://maps.google.com/?q=" + order.lat + "," + order.lng : "";

  // Format items summary
  var itemsStr = "";
  var totalQty = 0;
  if (Array.isArray(order.items)) {
    itemsStr = order.items
      .map(function (item) {
        var qty = item.qty || 1;
        totalQty += qty;
        return (item.name || item.name_snapshot || "عطر") + " × " + qty;
      })
      .join(" + ");
  }

  // Force phone number as plain text with leading quote to preserve leading 0
  var rawPhone = String(order.phone || "");
  var formattedPhone = "'" + rawPhone;

  var rowValues = [
    String(order.code),
    dateStr,
    statusText,
    String(order.customer_name || ""),
    formattedPhone,
    String(order.governorate || ""),
    String(order.address || ""),
    mapUrl,
    itemsStr,
    totalQty,
    Number(order.total || 0),
    String(order.notes || ""),
    String(order.admin_note || "")
  ];

  // Search if order already exists in Column A
  var lastRow = sheet.getLastRow();
  var foundRow = null;

  if (lastRow > 1) {
    var finder = sheet.getRange(2, 1, lastRow - 1, 1).createTextFinder(String(order.code)).matchEntireCell(true);
    var match = finder.findNext();
    if (match) {
      foundRow = match.getRow();
    }
  }

  if (foundRow) {
    // Update existing row
    sheet.getRange(foundRow, 1, 1, rowValues.length).setValues([rowValues]);
    // Ensure column E format is plain text
    sheet.getRange(foundRow, 5).setNumberFormat("@");
    return jsonResponse({ ok: true, action: "updated", row: foundRow, code: order.code });
  } else {
    // Append new row
    sheet.appendRow(rowValues);
    var newRow = sheet.getLastRow();
    // Ensure column E format is plain text
    sheet.getRange(newRow, 5).setNumberFormat("@");
    return jsonResponse({ ok: true, action: "created", row: newRow, code: order.code });
  }
}

function jsonResponse(obj, statusCode) {
  var output = ContentService.createTextOutput(JSON.stringify(obj));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
