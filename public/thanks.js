/**
 * Order Confirmation Page Logic
 * Pure Latin Number Formatting, Deduplicated Meta Pixel Purchase Tracking
 */

(function () {
  "use strict";

  function formatPrice(amount) {
    return Number(amount || 0).toLocaleString("en-US") + " د.ع";
  }

  async function initThanks() {
    const urlParams = new URLSearchParams(window.location.search);
    const orderCode = urlParams.get("o");

    if (!orderCode) {
      window.location.href = "/";
      return;
    }

    try {
      // 1. Fetch Config
      const configRes = await fetch("/api/config");
      const config = await configRes.json();

      if (config.storeSettings?.store_name) {
        const brandEl = document.getElementById("thanks-brand-name");
        if (brandEl) brandEl.textContent = config.storeSettings.store_name;
      }

      if (config.pixelId && typeof window.fbq === "function") {
        window.fbq("init", config.pixelId);
      }

      // 2. Fetch Order Details
      const orderRes = await fetch(`/api/orders/${encodeURIComponent(orderCode)}`);
      if (!orderRes.ok) {
        document.getElementById("thanks-content").innerHTML = `
          <h2 style="color: var(--danger); margin-bottom: 1rem;">عذراً، لم يتم العثور على تفاصيل الطلب</h2>
          <p style="color: var(--text-secondary);">يرجى التأكد من الرابط أو التواصل مع الدعم.</p>
          <a href="/" class="btn-primary-pill" style="margin-top: 1.5rem;">العودة للمتجر</a>
        `;
        return;
      }

      const { order } = await orderRes.json();

      // Render Order Details with Latin numbers
      document.getElementById("order-code-display").textContent = order.code;
      document.getElementById("order-customer-name").textContent = order.customer_name;
      document.getElementById("order-phone").textContent = order.phone;
      document.getElementById("order-address").textContent = `${order.governorate} - ${order.address}`;
      document.getElementById("order-total-price").textContent = formatPrice(order.total);

      if (order.lat && order.lng) {
        const mapLink = document.getElementById("order-map-link");
        const mapRow = document.getElementById("order-location-row");
        if (mapLink && mapRow) {
          mapLink.href = `https://maps.google.com/?q=${order.lat},${order.lng}`;
          mapRow.style.display = "flex";
        }
      }

      const itemsText = order.items
        .map((i) => `${i.name} (الكمية: ${i.qty})`)
        .join(" + ");
      document.getElementById("order-items-list").textContent = itemsText;

      // WhatsApp Button (Only if configured)
      if (config.storeSettings?.whatsapp_enabled && config.storeSettings?.whatsapp_number) {
        const whatsappBtn = document.getElementById("thanks-whatsapp-btn");
        if (whatsappBtn) {
          const cleanPhone = config.storeSettings.whatsapp_number.replace(/[^0-9]/g, "");
          const msg = `مرحباً، طلبت للتو ورقم طلبي #${order.code}. أود متابعة موعد التوصيل.`;
          whatsappBtn.href = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
          whatsappBtn.style.display = "inline-flex";
        }
      }

      // 3. Track Browser Purchase Event (Once only, guarded by localStorage to prevent refresh duplicates)
      const storageKey = `purchase_tracked_${order.code}`;
      const alreadyTracked = localStorage.getItem(storageKey);

      if (!alreadyTracked && typeof window.fbq === "function") {
        const eventName = config.capiEventName || "Purchase";
        const eventId = order.event_id;

        const totalQty = order.items.reduce((s, i) => s + i.qty, 0);

        window.fbq(
          "track",
          eventName,
          {
            content_ids: order.items.map((i) => String(i.product_id)),
            content_type: "product",
            contents: order.items.map((i) => ({
              id: String(i.product_id),
              quantity: i.qty,
              item_price: i.price
            })),
            value: order.total,
            currency: "IQD",
            num_items: totalQty,
            order_id: order.code
          },
          { eventID: eventId }
        );

        localStorage.setItem(storageKey, "1");
        console.log(`[Pixel] Browser ${eventName} fired for order #${order.code} with eventID: ${eventId}`);
      }
    } catch (err) {
      console.error("Thanks page error:", err);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initThanks);
  } else {
    initThanks();
  }
})();
