/**
 * Admin Panel — Apple-light edition
 * All numbers in Latin digits (en-US locale).
 * Dates in Baghdad timezone (Asia/Baghdad).
 */

(function () {
  "use strict";

  // ── State ──────────────────────────────────────────────────────────────────
  let currentPage = 1;
  let totalPages = 1;
  let lastNewOrderCount = null;
  let audioCtx = null;
  let productData = null;   // cached product from API
  let discounts = [];       // [{minQty, percent}]
  let reviews = [];         // [{name, stars, text}]
  let imageOrder = [];      // [imageId, ...]

  // ── Helpers ────────────────────────────────────────────────────────────────

  function n(val, opts) {
    return Number(val || 0).toLocaleString("en-US", opts);
  }

  function price(val) {
    return n(val) + " د.ع";
  }

  function formatDate(iso) {
    if (!iso) return "—";
    return new Intl.DateTimeFormat("ar-IQ", {
      timeZone: "Asia/Baghdad",
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
      numberingSystem: "latn"
    }).format(new Date(iso));
  }

  function esc(str) {
    if (!str) return "";
    return String(str).replace(/[&<>"']/g, m => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[m]));
  }

  function statusPill(status) {
    const map = {
      new: ["pill-new", "جديد"],
      confirmed: ["pill-confirmed", "تم التأكيد"],
      shipped: ["pill-shipped", "مشحون"],
      delivered: ["pill-delivered", "مسلّم"],
      cancelled: ["pill-cancelled", "ملغي"]
    };
    const [cls, label] = map[status] || ["", status];
    return `<span class="pill ${cls}">${label}</span>`;
  }

  function sheetPill(syncStatus) {
    if (!syncStatus || syncStatus === "pending") return `<span class="pill pill-pending">⏳</span>`;
    if (syncStatus === "synced") return `<span class="pill pill-synced">✓</span>`;
    if (syncStatus === "failed") return `<span class="pill pill-failed">✗</span>`;
    return "";
  }

  function toast(msg, type = "default") {
    const c = document.getElementById("toast-container");
    const t = document.createElement("div");
    t.className = `toast${type !== "default" ? " " + type : ""}`;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  function beep() {
    const enabled = document.getElementById("sound-alert-toggle")?.checked;
    if (!enabled) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime);
      osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(); osc.stop(audioCtx.currentTime + 0.45);
    } catch (_) {}
  }

  // ── Auth ───────────────────────────────────────────────────────────────────

  async function checkAuth() {
    try {
      const r = await fetch("/api/admin/stats");
      if (r.ok) { showDashboard(); initDashboard(); }
      else showLogin();
    } catch (_) { showLogin(); }
  }

  function showLogin() {
    document.getElementById("view-login").style.display = "flex";
    document.getElementById("view-dashboard").style.display = "none";
  }

  function showDashboard() {
    document.getElementById("view-login").style.display = "none";
    document.getElementById("view-dashboard").style.display = "block";
  }

  document.getElementById("login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const pw = document.getElementById("login-password").value;
    const err = document.getElementById("login-error");
    err.style.display = "none";
    try {
      const r = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw })
      });
      if (r.ok) { showDashboard(); initDashboard(); }
      else {
        err.textContent = "كلمة المرور غير صحيحة";
        err.style.display = "block";
      }
    } catch (_) {
      err.textContent = "خطأ في الاتصال";
      err.style.display = "block";
    }
  });

  document.getElementById("btn-logout").addEventListener("click", async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    showLogin();
  });

  // ── Tab nav ────────────────────────────────────────────────────────────────

  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
      if (btn.dataset.tab === "product") loadProduct();
      if (btn.dataset.tab === "settings") loadSettings();
    });
  });

  // ── Init dashboard ─────────────────────────────────────────────────────────

  function initDashboard() {
    fetchStats();
    fetchOrders();
    // poll for new orders every 30s
    setInterval(async () => {
      const r = await fetch("/api/admin/stats").catch(() => null);
      if (!r || !r.ok) return;
      const d = await r.json();
      const newNow = d.newOrders || 0;
      if (lastNewOrderCount !== null && newNow > lastNewOrderCount) beep();
      lastNewOrderCount = newNow;
      updateStats(d);
    }, 30000);
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  async function fetchStats() {
    const r = await fetch("/api/admin/stats").catch(() => null);
    if (!r || !r.ok) return;
    const d = await r.json();
    lastNewOrderCount = d.newOrders || 0;
    updateStats(d);
  }

  function updateStats(d) {
    document.getElementById("stat-total").textContent = n(d.totalOrders);
    document.getElementById("stat-new").textContent = n(d.newOrders);
    document.getElementById("stat-delivered").textContent = n(d.deliveredOrders);
    document.getElementById("stat-value").textContent = n(d.totalValue);
    document.getElementById("stat-stock").textContent = d.remainingStock != null ? n(d.remainingStock) : "—";
  }

  // ── Orders ─────────────────────────────────────────────────────────────────

  async function fetchOrders() {
    const search = document.getElementById("filter-search").value.trim();
    const status = document.getElementById("filter-status").value;
    const start = document.getElementById("filter-start").value;
    const end = document.getElementById("filter-end").value;

    const params = new URLSearchParams({ page: currentPage, limit: 25 });
    if (search) params.set("search", search);
    if (status !== "all") params.set("status", status);
    if (start) params.set("startDate", start);
    if (end) params.set("endDate", end);

    const r = await fetch("/api/admin/orders?" + params).catch(() => null);
    if (!r || !r.ok) return;
    const d = await r.json();
    totalPages = d.totalPages || 1;
    renderOrders(d.orders || []);
    document.getElementById("pagination-info").textContent =
      `عرض ${n(d.orders?.length || 0)} من ${n(d.total || 0)} طلب`;
    document.getElementById("btn-prev").disabled = currentPage <= 1;
    document.getElementById("btn-next").disabled = currentPage >= totalPages;
  }

  function renderOrders(orders) {
    // Desktop
    const tbody = document.getElementById("orders-tbody");
    if (!orders.length) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;color:var(--text-sec);padding:2rem;">لا توجد طلبات</td></tr>`;
    } else {
      tbody.innerHTML = orders.map(o => `
        <tr>
          <td style="font-family:monospace;font-size:.82rem;">${esc(o.order_code)}</td>
          <td style="white-space:nowrap;font-size:.82rem;">${formatDate(o.created_at)}</td>
          <td>${esc(o.customer_name)}</td>
          <td>
            <a href="tel:${esc(o.phone)}">${esc(o.phone)}</a>
            ${o.whatsapp_link ? `<a href="${esc(o.whatsapp_link)}" target="_blank" style="margin-inline-start:.35rem;font-size:.8rem;">💬</a>` : ""}
          </td>
          <td>${esc(o.governorate)}</td>
          <td style="font-size:.82rem;">${esc(o.items_summary || "")}</td>
          <td style="white-space:nowrap;">${price(o.total_price)}</td>
          <td>${statusPill(o.status)}</td>
          <td>${sheetPill(o.sheet_sync_status)}</td>
          <td>
            <div style="display:flex;gap:.3rem;flex-wrap:wrap;">
              <select class="order-status-select" data-id="${o.id}" style="border:1px solid var(--border);border-radius:8px;padding:.25rem .5rem;font-size:.8rem;background:var(--bg-alt);">
                <option value="new" ${o.status==="new"?"selected":""}>جديد</option>
                <option value="confirmed" ${o.status==="confirmed"?"selected":""}>تم التأكيد</option>
                <option value="shipped" ${o.status==="shipped"?"selected":""}>مشحون</option>
                <option value="delivered" ${o.status==="delivered"?"selected":""}>مسلّم</option>
                <option value="cancelled" ${o.status==="cancelled"?"selected":""}>ملغي</option>
              </select>
              <button class="btn btn-secondary btn-sm order-sync-btn" data-id="${o.id}" title="مزامنة مع Sheets">🔄</button>
            </div>
            <textarea class="note-textarea" data-id="${o.id}" placeholder="ملاحظة…" style="margin-top:.4rem;width:180px;">${esc(o.admin_note || "")}</textarea>
            <button class="btn btn-secondary btn-sm order-note-btn" data-id="${o.id}" style="margin-top:.25rem;">حفظ الملاحظة</button>
          </td>
        </tr>
      `).join("");
    }

    // Mobile cards
    const cards = document.getElementById("orders-cards");
    if (!orders.length) {
      cards.innerHTML = `<div style="text-align:center;color:var(--text-sec);padding:2rem;">لا توجد طلبات</div>`;
    } else {
      cards.innerHTML = orders.map(o => `
        <div class="order-card">
          <div class="order-card-header">
            <div>
              <div class="order-card-code">${esc(o.order_code)}</div>
              <div style="font-size:.8rem;color:var(--text-sec);">${formatDate(o.created_at)}</div>
            </div>
            <div>${statusPill(o.status)} ${sheetPill(o.sheet_sync_status)}</div>
          </div>
          <div class="order-card-row"><span class="order-card-label">العميل</span><span>${esc(o.customer_name)}</span></div>
          <div class="order-card-row"><span class="order-card-label">الهاتف</span><a href="tel:${esc(o.phone)}">${esc(o.phone)}</a></div>
          <div class="order-card-row"><span class="order-card-label">المحافظة</span><span>${esc(o.governorate)}</span></div>
          <div class="order-card-row"><span class="order-card-label">المجموع</span><span>${price(o.total_price)}</span></div>
          <div class="order-card-actions">
            <select class="order-status-select" data-id="${o.id}" style="border:1px solid var(--border);border-radius:8px;padding:.35rem .6rem;font-size:.85rem;background:var(--bg-alt);">
              <option value="new" ${o.status==="new"?"selected":""}>جديد</option>
              <option value="confirmed" ${o.status==="confirmed"?"selected":""}>تم التأكيد</option>
              <option value="shipped" ${o.status==="shipped"?"selected":""}>مشحون</option>
              <option value="delivered" ${o.status==="delivered"?"selected":""}>مسلّم</option>
              <option value="cancelled" ${o.status==="cancelled"?"selected":""}>ملغي</option>
            </select>
            ${o.whatsapp_link ? `<a href="${esc(o.whatsapp_link)}" target="_blank" class="btn btn-success-soft btn-sm">💬 واتساب</a>` : ""}
            <button class="btn btn-secondary btn-sm order-sync-btn" data-id="${o.id}">🔄</button>
          </div>
          <textarea class="note-textarea" data-id="${o.id}" placeholder="ملاحظة…" style="margin-top:.5rem;width:100%;">${esc(o.admin_note || "")}</textarea>
          <button class="btn btn-secondary btn-sm order-note-btn" data-id="${o.id}" style="margin-top:.25rem;">حفظ الملاحظة</button>
        </div>
      `).join("");
    }

    // Bind status change
    document.querySelectorAll(".order-status-select").forEach(sel => {
      sel.addEventListener("change", async () => {
        const id = sel.dataset.id;
        const r = await fetch(`/api/admin/orders/${id}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: sel.value })
        });
        if (r.ok) { toast("تم تحديث الحالة", "success"); fetchStats(); }
        else toast("خطأ في التحديث", "error");
      });
    });

    // Bind note save
    document.querySelectorAll(".order-note-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        const ta = document.querySelector(`.note-textarea[data-id="${id}"]`);
        const r = await fetch(`/api/admin/orders/${id}/note`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: ta?.value || "" })
        });
        if (r.ok) toast("تم حفظ الملاحظة", "success");
        else toast("خطأ في الحفظ", "error");
      });
    });

    // Bind sheet sync buttons
    document.querySelectorAll(".order-sync-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        btn.disabled = true;
        const r = await fetch(`/api/admin/orders/${id}/sync-sheet`, { method: "POST" });
        btn.disabled = false;
        if (r.ok) { toast("تمت المزامنة", "success"); fetchOrders(); }
        else toast("فشلت المزامنة", "error");
      });
    });
  }

  // Filters
  ["filter-search", "filter-status", "filter-start", "filter-end"].forEach(id => {
    document.getElementById(id)?.addEventListener("change", () => {
      currentPage = 1; fetchOrders();
    });
  });
  document.getElementById("filter-search").addEventListener("input", debounce(() => {
    currentPage = 1; fetchOrders();
  }, 400));

  document.getElementById("btn-prev").addEventListener("click", () => { if (currentPage > 1) { currentPage--; fetchOrders(); } });
  document.getElementById("btn-next").addEventListener("click", () => { if (currentPage < totalPages) { currentPage++; fetchOrders(); } });

  document.getElementById("btn-resync-all").addEventListener("click", async () => {
    const btn = document.getElementById("btn-resync-all");
    btn.disabled = true;
    const r = await fetch("/api/admin/orders/resync-all-sheets", { method: "POST" });
    btn.disabled = false;
    if (r.ok) { const d = await r.json(); toast(`تمت مزامنة ${n(d.queued)} طلب`, "success"); }
    else toast("خطأ في المزامنة", "error");
  });

  function debounce(fn, ms) {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  // ── Product Tab ────────────────────────────────────────────────────────────

  async function loadProduct() {
    if (productData) { renderProductForm(productData); return; }
    const r = await fetch("/api/admin/product").catch(() => null);
    if (!r || !r.ok) { toast("خطأ في تحميل المنتج", "error"); return; }
    productData = await r.json();
    discounts = productData.quantity_discounts ? JSON.parse(productData.quantity_discounts) : [];
    reviews = productData.reviews_json ? JSON.parse(productData.reviews_json) : [];
    imageOrder = [];
    renderProductForm(productData);
    loadProductImages(productData.id);
  }

  function renderProductForm(p) {
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ""; };
    const setChecked = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };

    setChecked("prod-active", p.is_active);
    document.getElementById("prod-active-label").textContent = p.is_active ? "نشط" : "غير نشط";
    setVal("prod-name", p.name_ar);
    setVal("prod-tagline", p.tagline_ar);
    setVal("prod-desc", p.description_ar);
    setVal("prod-price", p.price);
    setVal("prod-compare-price", p.compare_at_price || "");
    setVal("prod-stock", p.stock);
    setVal("prod-size", p.size_ml || "");
    setVal("prod-notes-top", p.notes_top || "");
    setVal("prod-notes-heart", p.notes_heart || "");
    setVal("prod-notes-base", p.notes_base || "");
    setVal("prod-return-days", p.return_days || 3);
    setChecked("prod-free-delivery", p.free_delivery !== false);
    setVal("prod-delivery-note", p.delivery_note || "");
    setVal("prod-guarantee", p.guarantee_text || "");

    // Active toggle label
    document.getElementById("prod-active").addEventListener("change", function() {
      document.getElementById("prod-active-label").textContent = this.checked ? "نشط" : "غير نشط";
    });

    renderChips();
    renderDiscounts();
    renderReviews();
  }

  // Chips
  ["top", "heart", "base"].forEach(key => {
    document.getElementById(`prod-notes-${key}`).addEventListener("input", renderChips);
  });

  function renderChips() {
    ["top", "heart", "base"].forEach(key => {
      const val = document.getElementById(`prod-notes-${key}`).value;
      const chips = val.split(",").map(s => s.trim()).filter(Boolean);
      document.getElementById(`chips-${key}`).innerHTML =
        chips.map(c => `<span class="chip">${esc(c)}</span>`).join("");
    });
  }

  // Discounts
  function renderDiscounts() {
    const el = document.getElementById("discounts-list");
    el.innerHTML = discounts.map((d, i) => `
      <div class="discount-row" data-idx="${i}">
        <span style="font-size:.85rem;color:var(--text-sec);">من</span>
        <input type="number" class="disc-qty field input" placeholder="كمية" value="${n(d.minQty)}" min="1" data-idx="${i}" data-field="minQty"
          style="border:1px solid var(--border);border-radius:8px;padding:.35rem .6rem;">
        <span style="font-size:.85rem;color:var(--text-sec);">قطعة → خصم</span>
        <input type="number" class="disc-pct field input" placeholder="%" value="${n(d.percent)}" min="1" max="100" data-idx="${i}" data-field="percent"
          style="border:1px solid var(--border);border-radius:8px;padding:.35rem .6rem;">
        <span style="font-size:.85rem;color:var(--text-sec);">%</span>
        <button class="btn btn-danger-soft btn-sm disc-remove" data-idx="${i}">حذف</button>
      </div>
    `).join("") || `<div style="color:var(--text-sec);font-size:.88rem;margin-bottom:.5rem;">لا توجد خصومات</div>`;

    el.querySelectorAll(".disc-qty, .disc-pct").forEach(inp => {
      inp.addEventListener("change", () => {
        const idx = +inp.dataset.idx;
        discounts[idx][inp.dataset.field] = +inp.value;
      });
    });
    el.querySelectorAll(".disc-remove").forEach(btn => {
      btn.addEventListener("click", () => {
        discounts.splice(+btn.dataset.idx, 1);
        renderDiscounts();
      });
    });
  }

  document.getElementById("btn-add-discount").addEventListener("click", () => {
    discounts.push({ minQty: 2, percent: 10 });
    renderDiscounts();
  });

  // Reviews
  function renderReviews() {
    const el = document.getElementById("reviews-list");
    el.innerHTML = reviews.length ? reviews.map((r, i) => `
      <div class="review-row" data-idx="${i}">
        <div>
          <div class="review-name">${esc(r.name)} ${"★".repeat(r.stars || 5)}</div>
          <div class="review-text">${esc(r.text)}</div>
        </div>
        <button class="btn btn-danger-soft btn-sm review-remove" data-idx="${i}">حذف</button>
      </div>
    `).join("") : `<div style="color:var(--text-sec);font-size:.88rem;margin-bottom:.5rem;">لا توجد مراجعات</div>`;

    el.querySelectorAll(".review-remove").forEach(btn => {
      btn.addEventListener("click", () => {
        reviews.splice(+btn.dataset.idx, 1);
        renderReviews();
      });
    });
  }

  document.getElementById("btn-add-review").addEventListener("click", () => {
    const name = document.getElementById("new-review-name").value.trim();
    const stars = parseInt(document.getElementById("new-review-stars").value) || 5;
    const text = document.getElementById("new-review-text").value.trim();
    if (!name || !text) { toast("أدخل الاسم والنص", "error"); return; }
    reviews.push({ name, stars, text });
    renderReviews();
    document.getElementById("new-review-name").value = "";
    document.getElementById("new-review-text").value = "";
    document.getElementById("new-review-stars").value = "";
  });

  // Save product
  document.getElementById("btn-save-product").addEventListener("click", async () => {
    if (!productData) return;
    const btn = document.getElementById("btn-save-product");
    btn.disabled = true;
    btn.textContent = "جارٍ الحفظ…";

    const payload = {
      name_ar: document.getElementById("prod-name").value.trim(),
      tagline_ar: document.getElementById("prod-tagline").value.trim(),
      description_ar: document.getElementById("prod-desc").value.trim(),
      price: parseFloat(document.getElementById("prod-price").value) || 0,
      compare_at_price: parseFloat(document.getElementById("prod-compare-price").value) || null,
      stock: parseInt(document.getElementById("prod-stock").value) || 0,
      size_ml: parseInt(document.getElementById("prod-size").value) || null,
      notes_top: document.getElementById("prod-notes-top").value.trim(),
      notes_heart: document.getElementById("prod-notes-heart").value.trim(),
      notes_base: document.getElementById("prod-notes-base").value.trim(),
      return_days: parseInt(document.getElementById("prod-return-days").value) || 3,
      free_delivery: document.getElementById("prod-free-delivery").checked,
      delivery_note: document.getElementById("prod-delivery-note").value.trim(),
      guarantee_text: document.getElementById("prod-guarantee").value.trim(),
      is_active: document.getElementById("prod-active").checked,
      quantity_discounts: JSON.stringify(discounts),
      reviews_json: JSON.stringify(reviews),
      image_order: imageOrder
    };

    const r = await fetch("/api/admin/product", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    btn.disabled = false;
    btn.textContent = "حفظ التغييرات";

    if (r.ok) {
      productData = null; // force reload
      toast("تم حفظ المنتج ✓", "success");
    } else {
      const err = await r.json().catch(() => ({}));
      toast("خطأ: " + (err.error || "فشل الحفظ"), "error");
    }
  });

  // ── Images ─────────────────────────────────────────────────────────────────

  async function loadProductImages(productId) {
    const r = await fetch(`/api/products`).catch(() => null);
    if (!r || !r.ok) return;
    const d = await r.json();
    const imgs = d.images || [];
    imageOrder = imgs.map(i => i.id);
    renderImageGrid(imgs);
  }

  function renderImageGrid(imgs) {
    const grid = document.getElementById("img-grid");
    grid.innerHTML = imgs.map((img, idx) => `
      <div class="img-thumb" data-id="${img.id}">
        <img src="/media/${img.id}" alt="صورة ${idx+1}" loading="lazy">
        <div class="img-thumb-actions">
          ${idx > 0 ? `<button class="img-move-up" data-id="${img.id}" title="تقديم">↑</button>` : ""}
          <button class="img-delete" data-id="${img.id}" title="حذف">✕</button>
        </div>
      </div>
    `).join("");

    // Show/hide upload box based on count
    document.getElementById("img-upload-label").style.display = imgs.length >= 8 ? "none" : "flex";

    grid.querySelectorAll(".img-move-up").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = +btn.dataset.id;
        const idx = imageOrder.indexOf(id);
        if (idx <= 0) return;
        [imageOrder[idx - 1], imageOrder[idx]] = [imageOrder[idx], imageOrder[idx - 1]];
        await fetch("/api/admin/images/reorder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order: imageOrder })
        });
        await reloadImages();
      });
    });

    grid.querySelectorAll(".img-delete").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("حذف هذه الصورة؟")) return;
        const id = btn.dataset.id;
        await fetch(`/api/admin/images/${id}`, { method: "DELETE" });
        imageOrder = imageOrder.filter(x => x != id);
        await reloadImages();
      });
    });
  }

  async function reloadImages() {
    const r = await fetch("/api/products").catch(() => null);
    if (!r || !r.ok) return;
    const d = await r.json();
    const imgs = d.images || [];
    imageOrder = imgs.map(i => i.id);
    renderImageGrid(imgs);
  }

  // Image upload with client-side compression
  document.getElementById("img-upload-input").addEventListener("change", async e => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    const status = document.getElementById("img-upload-status");
    status.textContent = "جارٍ ضغط ورفع الصور…";

    for (const file of files) {
      if (imageOrder.length >= 8) { status.textContent = "الحد الأقصى 8 صور"; break; }
      try {
        const blob = await compressImage(file);
        if (blob.size > 450 * 1024) {
          status.textContent = `الصورة كبيرة جداً حتى بعد الضغط (${Math.round(blob.size/1024)}KB)`;
          continue;
        }
        const fd = new FormData();
        fd.append("image", blob, "photo.webp");
        if (productData?.id) {
          const r = await fetch(`/api/admin/products/${productData.id}/images`, { method: "POST", body: fd });
          if (r.ok) {
            const d = await r.json();
            imageOrder.push(d.id);
            await reloadImages();
            status.textContent = "✓ تم الرفع";
          } else {
            const er = await r.json().catch(() => ({}));
            status.textContent = "خطأ: " + (er.error || "فشل الرفع");
          }
        }
      } catch (err) {
        status.textContent = "خطأ في الضغط: " + err.message;
      }
    }
    e.target.value = "";
  });

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const MAX = 1200;
        let w = img.naturalWidth, h = img.naturalHeight;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else { w = Math.round(w * MAX / h); h = MAX; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        canvas.toBlob(blob => {
          if (blob) resolve(blob);
          else reject(new Error("فشل تحويل الصورة"));
        }, "image/webp", 0.82);
      };
      img.onerror = () => reject(new Error("فشل تحميل الصورة"));
      img.src = url;
    });
  }

  // Drag-over highlight for upload box
  const uploadBox = document.getElementById("img-upload-label");
  uploadBox.style.display = "flex";
  uploadBox.style.flexDirection = "column";
  uploadBox.style.alignItems = "center";
  uploadBox.style.justifyContent = "center";
  ["dragover", "dragenter"].forEach(ev => uploadBox.addEventListener(ev, e => { e.preventDefault(); uploadBox.style.borderColor = "var(--accent)"; }));
  ["dragleave", "drop"].forEach(ev => uploadBox.addEventListener(ev, e => { e.preventDefault(); uploadBox.style.borderColor = ""; }));
  uploadBox.addEventListener("drop", e => {
    e.preventDefault();
    const inp = document.getElementById("img-upload-input");
    inp.files = e.dataTransfer.files;
    inp.dispatchEvent(new Event("change"));
  });

  // ── Settings Tab ──────────────────────────────────────────────────────────

  async function loadSettings() {
    const r = await fetch("/api/admin/settings").catch(() => null);
    if (!r || !r.ok) return;
    const d = await r.json();
    document.getElementById("settings-store-name").value = d.store_name || "";
    document.getElementById("settings-wa-enabled").checked = !!d.whatsapp_enabled;
    document.getElementById("settings-wa-number").value = d.whatsapp_number || "";

    const noSheets = !d.sheets_configured;
    document.getElementById("sheets-status-msg").innerHTML =
      noSheets
        ? `<span style="color:var(--text-sec);">⚪ غير مربوط — أضف <code>SHEETS_WEBHOOK_URL</code> في .dev.vars أو wrangler secrets</span>`
        : `<span style="color:var(--success);">🟢 متصل بـ Google Sheets</span>`;
  }

  document.getElementById("btn-save-settings").addEventListener("click", async () => {
    const btn = document.getElementById("btn-save-settings");
    btn.disabled = true;
    const payload = {
      store_name: document.getElementById("settings-store-name").value.trim(),
      whatsapp_enabled: document.getElementById("settings-wa-enabled").checked,
      whatsapp_number: document.getElementById("settings-wa-number").value.trim()
    };
    const r = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    btn.disabled = false;
    if (r.ok) toast("تم حفظ الإعدادات ✓", "success");
    else toast("خطأ في الحفظ", "error");
  });

  document.getElementById("btn-sheets-ping").addEventListener("click", async () => {
    const btn = document.getElementById("btn-sheets-ping");
    btn.disabled = true;
    const r = await fetch("/api/admin/sheets/test", { method: "POST" });
    btn.disabled = false;
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.ok) toast("✓ الاتصال ناجح", "success");
    else toast("✗ فشل الاتصال: " + (d.error || ""), "error");
  });

  document.getElementById("btn-sheets-resync").addEventListener("click", async () => {
    const btn = document.getElementById("btn-sheets-resync");
    btn.disabled = true;
    const r = await fetch("/api/admin/orders/resync-all-sheets", { method: "POST" });
    btn.disabled = false;
    if (r.ok) { const d = await r.json(); toast(`تمت مزامنة ${n(d.queued)} طلب`, "success"); }
    else toast("خطأ", "error");
  });

  // Danger Zone
  document.getElementById("btn-danger-wipe").addEventListener("click", async () => {
    const confirmText = document.getElementById("danger-confirm-text").value.trim();
    if (confirmText !== "حذف الطلبات") {
      toast("اكتب 'حذف الطلبات' للتأكيد", "error");
      return;
    }
    const resetStock = parseInt(document.getElementById("danger-reset-stock").value) || null;
    const btn = document.getElementById("btn-danger-wipe");
    btn.disabled = true;
    const r = await fetch("/api/admin/danger/wipe-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "حذف الطلبات", resetStock })
    });
    btn.disabled = false;
    if (r.ok) {
      const d = await r.json();
      toast(`✓ تم حذف ${n(d.deletedOrders)} طلب`, "success");
      document.getElementById("danger-confirm-text").value = "";
      document.getElementById("danger-reset-stock").value = "";
      currentPage = 1; fetchOrders(); fetchStats();
    } else {
      const d = await r.json().catch(() => ({}));
      toast("خطأ: " + (d.error || ""), "error");
    }
  });

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  checkAuth();
})();
