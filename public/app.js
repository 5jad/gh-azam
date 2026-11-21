/**
 * Apple-Style Minimal Landing Page Logic
 * Features: Auto & Swipe Image Carousel (RTL), Invisible Turnstile, Meta Pixel Deduplication,
 * Pure Latin Number Formatting, Real-time Stock Polling.
 */

(function () {
  "use strict";

  // State
  let config = null;
  let currentProduct = null;
  let currentQty = 1;
  let maxStock = 20;
  let turnstileWidgetId = null;
  let userCoords = null;
  let hasInitiatedCheckout = false;
  let hasAddedToCart = false;
  let orderEventId = "";

  // Carousel State
  let currentSlideIndex = 0;
  let carouselTimer = null;
  let totalSlides = 0;

  // Helper: Format Iraqi Dinar with Latin Numbers (e.g. 45,000 د.ع)
  function formatPrice(amount) {
    return Number(amount || 0).toLocaleString("en-US") + " د.ع";
  }

  // Helper: Convert Eastern Arabic-Indic numerals (٠-٩) to Latin (0-9)
  function normalizeDigits(str) {
    if (!str) return "";
    const arabicIndic = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
    const persian = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
    let out = str;
    for (let i = 0; i < 10; i++) {
      out = out.replaceAll(arabicIndic[i], i.toString());
      out = out.replaceAll(persian[i], i.toString());
    }
    return out;
  }

  // Unique event ID generator for deduplication
  function generateEventId(prefix) {
    const timestamp = Date.now();
    const rand = Math.random().toString(36).substring(2, 10);
    return `${prefix || "evt"}_${timestamp}_${rand}`;
  }

  // Meta Pixel tracker
  function trackPixel(eventName, params, eventId) {
    if (typeof window.fbq === "function") {
      const eid = eventId || generateEventId(eventName.toLowerCase());
      window.fbq("track", eventName, params || {}, { eventID: eid });
      console.log(`[Pixel] ${eventName} fired with eventID:`, eid);
      return eid;
    }
    return "";
  }

  // Cookies for Meta Pixel
  function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(";").shift();
    return null;
  }

  function getFbp() {
    return getCookie("_fbp") || "";
  }

  function getFbc() {
    const cookieFbc = getCookie("_fbc");
    if (cookieFbc) return cookieFbc;
    const urlParams = new URLSearchParams(window.location.search);
    const fbclid = urlParams.get("fbclid");
    if (fbclid) {
      return `fb.1.${Date.now()}.${fbclid}`;
    }
    return "";
  }

  // DOM Elements
  const productName = document.getElementById("product-name");
  const productTagline = document.getElementById("product-tagline");
  const productPrice = document.getElementById("product-price");
  const productComparePrice = document.getElementById("product-compare-price");
  const productDiscountTag = document.getElementById("product-discount-tag");
  const stockBadge = document.getElementById("stock-badge");
  const stockText = document.getElementById("stock-text");

  const carouselWrapper = document.getElementById("hero-carousel");
  const carouselTrack = document.getElementById("carousel-track");
  const carouselPrev = document.getElementById("carousel-prev");
  const carouselNext = document.getElementById("carousel-next");
  const carouselDots = document.getElementById("carousel-dots");

  const notesSection = document.getElementById("scent-notes-section");
  const cardNotesTop = document.getElementById("card-notes-top");
  const topNotesChips = document.getElementById("top-notes-chips");
  const cardNotesHeart = document.getElementById("card-notes-heart");
  const heartNotesChips = document.getElementById("heart-notes-chips");
  const cardNotesBase = document.getElementById("card-notes-base");
  const baseNotesChips = document.getElementById("base-notes-chips");

  const descSection = document.getElementById("product-desc-section");
  const fullDesc = document.getElementById("product-full-desc");

  const guaranteeText = document.getElementById("guarantee-text");
  const guaranteeDays = document.getElementById("guarantee-days");
  const deliveryNotePill = document.getElementById("delivery-note-pill");
  const trustFreeDelivery = document.getElementById("trust-free-delivery");

  const reviewsSection = document.getElementById("reviews-section");
  const reviewsContainer = document.getElementById("reviews-container");

  // Form Elements
  const form = document.getElementById("perfume-order-form");
  const formProductName = document.getElementById("form-product-name");
  const formProductUnitPrice = document.getElementById("form-product-unit-price");
  const formProductImg = document.getElementById("form-product-img");
  const qtyMinus = document.getElementById("qty-minus");
  const qtyPlus = document.getElementById("qty-plus");
  const qtyInput = document.getElementById("order-qty");
  const summarySubtotal = document.getElementById("summary-subtotal");
  const summaryDiscountRow = document.getElementById("summary-discount-row");
  const summaryDiscountVal = document.getElementById("summary-discount-val");
  const summaryDeliveryVal = document.getElementById("summary-delivery-val");
  const summaryTotal = document.getElementById("summary-total");
  const stickyPriceVal = document.getElementById("sticky-price-val");
  const stickyBar = document.getElementById("sticky-cta-bar");

  const btnGeolocation = document.getElementById("btn-geolocation");
  const geoStatus = document.getElementById("geo-status");
  const btnSubmit = document.getElementById("btn-submit-order");
  const submitSpinner = document.getElementById("submit-spinner");
  const submitBtnText = document.getElementById("submit-btn-text");
  const generalFormError = document.getElementById("general-form-error");

  const whatsappContainer = document.getElementById("footer-whatsapp-container");
  const whatsappLink = document.getElementById("footer-whatsapp-link");
  const footerCopy = document.getElementById("footer-copy");

  // ==========================================
  // INITIALIZATION
  // ==========================================
  async function init() {
    try {
      // 1. Fetch Config
      const confRes = await fetch("/api/config");
      config = await confRes.json();

      // Pixel Init
      if (config.pixelId && typeof window.fbq === "function") {
        window.fbq("init", config.pixelId);
        trackPixel("PageView", {}, generateEventId("pv"));
      }

      orderEventId = generateEventId("order");

      // Store Settings
      applyStoreSettings();

      // 2. Fetch Live Product
      await refreshProductData(false);

      // 3. Initialize Invisible Turnstile
      initInvisibleTurnstile();

      // 4. Setup Stock Polling (every 30s while tab visible)
      setInterval(() => {
        if (document.visibilityState === "visible") {
          refreshProductData(true);
        }
      }, 30000);

      // 5. Setup Events
      setupEventListeners();
    } catch (err) {
      console.error("Initialization error:", err);
    }
  }

  function applyStoreSettings() {
    if (!config || !config.storeSettings) return;
    const s = config.storeSettings;

    if (s.store_name) {
      const brandLogo = document.getElementById("nav-brand-name");
      if (brandLogo) brandLogo.textContent = s.store_name;
      if (footerCopy) footerCopy.textContent = `© 2026 ${s.store_name}. جميع الحقوق محفوظة.`;
    }

    // WhatsApp: Only shown if explicitly enabled AND number provided
    if (s.whatsapp_enabled && s.whatsapp_number && s.whatsapp_number.trim()) {
      const cleanPhone = s.whatsapp_number.replace(/[^0-9]/g, "");
      whatsappLink.href = `https://wa.me/${cleanPhone}?text=${encodeURIComponent("مرحباً، أود الاستفسار عن تفاصيل العطر")}`;
      whatsappContainer.style.display = "block";
    } else {
      whatsappContainer.style.display = "none";
    }
  }

  async function refreshProductData(isSilent) {
    try {
      const res = await fetch("/api/products");
      const data = await res.json();
      if (!data.product) {
        return;
      }

      currentProduct = data.product;
      maxStock = currentProduct.stock;

      renderProductDetails();
      updateStockUI();
      updateOrderSummary();

      if (!isSilent) {
        trackPixel(
          "ViewContent",
          {
            content_ids: [String(currentProduct.id)],
            content_name: currentProduct.name_ar,
            content_type: "product",
            value: currentProduct.price,
            currency: "IQD"
          },
          generateEventId("vc")
        );
      }
    } catch (err) {
      console.error("Product fetch error:", err);
    }
  }

  function renderProductDetails() {
    if (!currentProduct) return;

    if (productName) productName.textContent = currentProduct.name_ar || "";
    if (productTagline) productTagline.textContent = currentProduct.tagline_ar || "";
    if (formProductName) formProductName.textContent = `${currentProduct.name_ar} (${currentProduct.size_ml || 100} مل)`;

    // Price
    if (productPrice) productPrice.textContent = Number(currentProduct.price || 0).toLocaleString("en-US");

    // Old Price
    if (currentProduct.compare_at_price && currentProduct.compare_at_price > currentProduct.price) {
      productComparePrice.textContent = formatPrice(currentProduct.compare_at_price);
      productComparePrice.style.display = "inline";

      const discountPercent = Math.round(
        ((currentProduct.compare_at_price - currentProduct.price) / currentProduct.compare_at_price) * 100
      );
      productDiscountTag.textContent = `خصم ${discountPercent}%`;
      productDiscountTag.style.display = "inline-block";
    } else {
      productComparePrice.style.display = "none";
      productDiscountTag.style.display = "none";
    }

    // Free delivery toggle
    if (trustFreeDelivery) {
      trustFreeDelivery.style.display = currentProduct.free_delivery ? "inline-flex" : "none";
    }
    if (summaryDeliveryVal) {
      summaryDeliveryVal.textContent = currentProduct.free_delivery ? "مجاني" : "بحسب المحافظة";
    }

    // Scent Notes
    const hasTop = currentProduct.notes?.top && currentProduct.notes.top.length > 0;
    const hasHeart = currentProduct.notes?.heart && currentProduct.notes.heart.length > 0;
    const hasBase = currentProduct.notes?.base && currentProduct.notes.base.length > 0;

    if (hasTop || hasHeart || hasBase) {
      notesSection.style.display = "block";

      if (hasTop) {
        cardNotesTop.style.display = "block";
        topNotesChips.innerHTML = currentProduct.notes.top.map((t) => `<span class="note-chip">${escapeHtml(t)}</span>`).join("");
      } else {
        cardNotesTop.style.display = "none";
      }

      if (hasHeart) {
        cardNotesHeart.style.display = "block";
        heartNotesChips.innerHTML = currentProduct.notes.heart.map((h) => `<span class="note-chip">${escapeHtml(h)}</span>`).join("");
      } else {
        cardNotesHeart.style.display = "none";
      }

      if (hasBase) {
        cardNotesBase.style.display = "block";
        baseNotesChips.innerHTML = currentProduct.notes.base.map((b) => `<span class="note-chip">${escapeHtml(b)}</span>`).join("");
      } else {
        cardNotesBase.style.display = "none";
      }
    } else {
      notesSection.style.display = "none";
    }

    // Description
    if (currentProduct.description_ar && currentProduct.description_ar.trim()) {
      descSection.style.display = "block";
      fullDesc.textContent = currentProduct.description_ar;
    } else {
      descSection.style.display = "none";
    }

    // Guarantee
    if (currentProduct.guarantee_text) {
      guaranteeText.textContent = currentProduct.guarantee_text;
    }
    if (guaranteeDays && currentProduct.return_days) {
      guaranteeDays.textContent = currentProduct.return_days;
    }

    // Optional Delivery Note
    if (currentProduct.delivery_note && currentProduct.delivery_note.trim()) {
      deliveryNotePill.textContent = currentProduct.delivery_note;
      deliveryNotePill.style.display = "inline-flex";
    } else {
      deliveryNotePill.style.display = "none";
    }

    // Reviews (Only real reviews from admin)
    if (currentProduct.reviews && currentProduct.reviews.length > 0) {
      reviewsSection.classList.add("has-reviews");
      reviewsContainer.innerHTML = currentProduct.reviews
        .map(
          (r) => `
        <div class="review-card">
          <div class="review-author">${escapeHtml(r.name)}</div>
          <div class="review-comment">${escapeHtml(r.comment)}</div>
        </div>
      `
        )
        .join("");
    } else {
      reviewsSection.classList.remove("has-reviews");
    }

    // Carousel Images
    setupCarousel(currentProduct.images || ["/img/hero.webp"]);
  }

  // ==========================================
  // CAROUSEL LOGIC
  // ==========================================
  function setupCarousel(images) {
    if (!images || images.length === 0) return;
    totalSlides = images.length;
    currentSlideIndex = 0;

    // Single Image vs Multiple
    if (totalSlides <= 1) {
      carouselPrev.style.display = "none";
      carouselNext.style.display = "none";
      carouselDots.style.display = "none";
      clearInterval(carouselTimer);
    } else {
      carouselPrev.style.display = "flex";
      carouselNext.style.display = "flex";
      carouselDots.style.display = "flex";
    }

    // Render slides
    carouselTrack.innerHTML = images
      .map(
        (src, idx) => `
      <div class="carousel-slide" aria-roledescription="slide" aria-label="صورة ${idx + 1} من ${totalSlides}">
        <img src="${src}" alt="صورة ${idx + 1}" width="800" height="800" ${idx === 0 ? 'fetchpriority="high"' : 'loading="lazy"'}>
      </div>
    `
      )
      .join("");

    // Update thumbnail in form
    if (formProductImg && images[0]) {
      formProductImg.src = images[0];
    }

    // Render Dots
    if (totalSlides > 1) {
      carouselDots.innerHTML = images
        .map((_, i) => `<button type="button" class="carousel-dot ${i === 0 ? "active" : ""}" data-idx="${i}" aria-label="الانتقال إلى صورة ${i + 1}"></button>`)
        .join("");

      carouselDots.querySelectorAll(".carousel-dot").forEach((dot) => {
        dot.addEventListener("click", () => {
          const idx = parseInt(dot.getAttribute("data-idx"), 10);
          goToSlide(idx);
        });
      });

      startAutoplay();
    }
  }

  function goToSlide(index) {
    if (totalSlides <= 1) return;
    currentSlideIndex = (index + totalSlides) % totalSlides;
    carouselTrack.style.transform = `translateX(-${currentSlideIndex * 100}%)`;

    // Update dot indicators
    carouselDots.querySelectorAll(".carousel-dot").forEach((dot, idx) => {
      dot.classList.toggle("active", idx === currentSlideIndex);
    });
  }

  function startAutoplay() {
    clearInterval(carouselTimer);
    // Respect prefers-reduced-motion
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    carouselTimer = setInterval(() => {
      if (document.visibilityState === "visible") {
        goToSlide(currentSlideIndex + 1);
      }
    }, 4000);
  }

  function pauseAutoplay() {
    clearInterval(carouselTimer);
  }

  // ==========================================
  // INVISIBLE TURNSTILE
  // ==========================================
  function initInvisibleTurnstile() {
    if (config?.turnstileSiteKey && window.turnstile) {
      try {
        turnstileWidgetId = window.turnstile.render("#turnstile-container", {
          sitekey: config.turnstileSiteKey,
          execution: "execute",
          appearance: "interaction-only"
        });
      } catch (e) {
        console.warn("Turnstile invisible init warning:", e);
      }
    }
  }

  async function getTurnstileToken(): Promise<string> {
    if (!window.turnstile || turnstileWidgetId === null) {
      return "";
    }

    return new Promise((resolve) => {
      try {
        // Explicit execute in invisible mode
        window.turnstile.execute(turnstileWidgetId, {
          callback: function (token) {
            resolve(token);
          },
          "error-callback": function () {
            resolve("");
          }
        });
        // Timeout safeguard
        setTimeout(() => resolve(""), 6000);
      } catch (_) {
        resolve("");
      }
    });
  }

  // ==========================================
  // LIVE STOCK & ORDER SUMMARY
  // ==========================================
  function updateStockUI() {
    if (!currentProduct) return;
    const stock = currentProduct.stock;

    if (stock <= 0) {
      stockBadge.style.display = "inline-flex";
      stockBadge.className = "stock-pill out";
      stockText.textContent = "نفذت الكمية مؤقتاً";
      btnSubmit.disabled = true;
      submitBtnText.textContent = "نفذت الكمية";
      qtyMinus.disabled = true;
      qtyPlus.disabled = true;
      qtyInput.value = "0";
    } else if (stock <= 10) {
      stockBadge.style.display = "inline-flex";
      stockBadge.className = "stock-pill low";
      stockText.textContent = `باقي ${stock} قطع فقط في المخزن`;
      btnSubmit.disabled = false;
      submitBtnText.textContent = "تأكيد الطلب";
    } else {
      stockBadge.style.display = "none";
      btnSubmit.disabled = false;
      submitBtnText.textContent = "تأكيد الطلب";
    }

    if (currentQty > stock && stock > 0) {
      currentQty = stock;
      qtyInput.value = String(currentQty);
    }
  }

  function updateOrderSummary() {
    if (!currentProduct) return;
    const price = currentProduct.price || 0;
    const subtotal = price * currentQty;

    let discount = 0;
    if (currentProduct.quantity_discounts && currentProduct.quantity_discounts.length > 0) {
      const sorted = [...currentProduct.quantity_discounts].sort((a, b) => b.minQty - a.minQty);
      for (const rule of sorted) {
        if (currentQty >= rule.minQty) {
          discount = Math.round((subtotal * rule.percent) / 100);
          break;
        }
      }
    }

    const total = subtotal - discount;

    if (summarySubtotal) summarySubtotal.textContent = formatPrice(subtotal);
    if (formProductUnitPrice) formProductUnitPrice.textContent = formatPrice(price);

    if (discount > 0) {
      summaryDiscountRow.style.display = "flex";
      summaryDiscountVal.textContent = `- ${formatPrice(discount)}`;
    } else {
      summaryDiscountRow.style.display = "none";
    }

    if (summaryTotal) summaryTotal.textContent = formatPrice(total);
    if (stickyPriceVal) stickyPriceVal.textContent = formatPrice(total);

    qtyMinus.disabled = currentQty <= 1;
    qtyPlus.disabled = currentQty >= maxStock;
  }

  // ==========================================
  // EVENT LISTENERS
  // ==========================================
  function setupEventListeners() {
    // Carousel Controls
    if (carouselPrev) {
      carouselPrev.addEventListener("click", () => {
        pauseAutoplay();
        goToSlide(currentSlideIndex - 1);
        startAutoplay();
      });
    }

    if (carouselNext) {
      carouselNext.addEventListener("click", () => {
        pauseAutoplay();
        goToSlide(currentSlideIndex + 1);
        startAutoplay();
      });
    }

    // Touch Swipe (RTL aware)
    let touchStartX = 0;
    let touchEndX = 0;

    if (carouselWrapper) {
      carouselWrapper.addEventListener("mouseenter", pauseAutoplay);
      carouselWrapper.addEventListener("mouseleave", startAutoplay);
      carouselWrapper.addEventListener("focusin", pauseAutoplay);
      carouselWrapper.addEventListener("focusout", startAutoplay);

      carouselWrapper.addEventListener(
        "touchstart",
        (e) => {
          pauseAutoplay();
          touchStartX = e.changedTouches[0].screenX;
        },
        { passive: true }
      );

      carouselWrapper.addEventListener(
        "touchend",
        (e) => {
          touchEndX = e.changedTouches[0].screenX;
          const diff = touchEndX - touchStartX;
          if (Math.abs(diff) > 40) {
            if (diff > 0) {
              // Swiped right -> in RTL, next slide
              goToSlide(currentSlideIndex - 1);
            } else {
              // Swiped left
              goToSlide(currentSlideIndex + 1);
            }
          }
          startAutoplay();
        },
        { passive: true }
      );
    }

    // Quantity Stepper
    if (qtyMinus) {
      qtyMinus.addEventListener("click", () => {
        if (currentQty > 1) {
          currentQty--;
          qtyInput.value = String(currentQty);
          updateOrderSummary();
          triggerAddToCartPixel();
        }
      });
    }

    if (qtyPlus) {
      qtyPlus.addEventListener("click", () => {
        if (currentQty < maxStock) {
          currentQty++;
          qtyInput.value = String(currentQty);
          updateOrderSummary();
          triggerAddToCartPixel();
        }
      });
    }

    // Hero CTA click
    const heroCta = document.getElementById("hero-cta");
    if (heroCta) {
      heroCta.addEventListener("click", () => triggerAddToCartPixel());
    }

    // Phone input: convert Eastern Arabic numbers to Latin in real-time
    const phoneInput = document.getElementById("phone");
    if (phoneInput) {
      phoneInput.addEventListener("input", (e) => {
        const cursor = e.target.selectionStart;
        const normalized = normalizeDigits(e.target.value);
        if (normalized !== e.target.value) {
          e.target.value = normalized;
          e.target.setSelectionRange(cursor, cursor);
        }
        hideFieldError("phone");
      });
    }

    // InitiateCheckout Pixel
    const formInputs = form.querySelectorAll("input, select, textarea");
    formInputs.forEach((input) => {
      input.addEventListener("focus", () => triggerInitiateCheckoutPixel());
      input.addEventListener("input", () => hideFieldError(input.name || input.id));
    });

    // Geolocation
    if (btnGeolocation) {
      btnGeolocation.addEventListener("click", handleGeolocation);
    }

    // Sticky CTA bar auto-hide when order form is in view
    if (stickyBar && form) {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            stickyBar.classList.toggle("hidden", entry.isIntersecting);
          });
        },
        { threshold: 0.1 }
      );
      observer.observe(form);
    }

    // Form Submit
    if (form) {
      form.addEventListener("submit", handleOrderSubmit);
    }
  }

  function triggerAddToCartPixel() {
    if (hasAddedToCart || !currentProduct) return;
    hasAddedToCart = true;
    trackPixel(
      "AddToCart",
      {
        content_ids: [String(currentProduct.id)],
        content_name: currentProduct.name_ar,
        content_type: "product",
        value: currentProduct.price * currentQty,
        currency: "IQD"
      },
      generateEventId("atc")
    );
  }

  function triggerInitiateCheckoutPixel() {
    if (hasInitiatedCheckout || !currentProduct) return;
    hasInitiatedCheckout = true;
    trackPixel(
      "InitiateCheckout",
      {
        content_ids: [String(currentProduct.id)],
        content_name: currentProduct.name_ar,
        content_type: "product",
        value: currentProduct.price * currentQty,
        currency: "IQD",
        num_items: currentQty
      },
      generateEventId("ic")
    );
  }

  function handleGeolocation() {
    if (!navigator.geolocation) {
      showGeoStatus("المتصفح لا يدعم تحديد الموقع", false);
      return;
    }

    showGeoStatus("جارٍ تحديد موقعك...", true);
    btnGeolocation.disabled = true;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        userCoords = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };
        btnGeolocation.disabled = false;
        showGeoStatus("✅ تم تحديد الموقع بنجاح", true);
      },
      () => {
        btnGeolocation.disabled = false;
        showGeoStatus("تعذر تحديد الموقع، يرجى كتابة العنوان يدوياً", false);
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  }

  function showGeoStatus(msg, isSuccess) {
    if (!geoStatus) return;
    geoStatus.textContent = msg;
    geoStatus.style.color = isSuccess ? "var(--success)" : "var(--danger)";
    geoStatus.classList.add("active");
  }

  function showFieldError(fieldId, message) {
    const field = document.getElementById(fieldId);
    const errorEl = document.getElementById(`error-${fieldId}`);
    if (field) field.classList.add("error");
    if (errorEl) {
      if (message) errorEl.textContent = message;
      errorEl.classList.add("active");
    }
  }

  function hideFieldError(fieldId) {
    const field = document.getElementById(fieldId);
    const errorEl = document.getElementById(`error-${fieldId}`);
    if (field) field.classList.remove("error");
    if (errorEl) errorEl.classList.remove("active");
  }

  async function handleOrderSubmit(e) {
    e.preventDefault();
    if (generalFormError) {
      generalFormError.classList.remove("error");
      generalFormError.style.display = "none";
      generalFormError.textContent = "";
    }

    const customerName = document.getElementById("customer_name")?.value?.trim() || "";
    const rawPhone = document.getElementById("phone")?.value || "";
    const phone = normalizeDigits(rawPhone).trim();
    const governorate = document.getElementById("governorate")?.value || "";
    const address = document.getElementById("address")?.value?.trim() || "";
    const notes = document.getElementById("notes")?.value?.trim() || "";
    const honeypot = document.getElementById("honeypot")?.value || "";

    let hasError = false;

    if (!customerName || customerName.length < 2) {
      showFieldError("customer_name", "يرجى كتابة الاسم الكامل");
      hasError = true;
    }

    const cleanedPhone = phone.replace(/[^0-9]/g, "");
    const isValidIraqiPhone = /^07[3-9]\d{8}$/.test(cleanedPhone) || /^7[3-9]\d{8}$/.test(cleanedPhone) || /^9647[3-9]\d{8}$/.test(cleanedPhone);
    if (!isValidIraqiPhone) {
      showFieldError("phone", "رقم الهاتف غير صحيح. يرجى إدخال 11 رقماً تبدأ بـ 07");
      hasError = true;
    }

    if (!governorate) {
      showFieldError("governorate", "يرجى اختيار المحافظة");
      hasError = true;
    }

    if (!address || address.length < 4) {
      showFieldError("address", "يرجى كتابة العنوان بالتفصيل");
      hasError = true;
    }

    if (hasError) return;

    // Set Submitting
    setSubmitting(true);

    try {
      // Execute Invisible Turnstile on submit
      const turnstileToken = await getTurnstileToken();

      const payload = {
        customer_name: customerName,
        phone: phone,
        governorate: governorate,
        address: address,
        notes: notes,
        lat: userCoords?.lat || null,
        lng: userCoords?.lng || null,
        items: [
          {
            productId: currentProduct.id,
            qty: currentQty
          }
        ],
        event_id: orderEventId,
        fbp: getFbp(),
        fbc: getFbc(),
        turnstileToken: turnstileToken,
        honeypot: honeypot,
        event_source_url: window.location.href
      };

      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (!response.ok || !result.ok) {
        setSubmitting(false);
        showGeneralError(result.error || "تعذر إتمام طلبك، يرجى المحاولة مرة أخرى");
        return;
      }

      sessionStorage.setItem("last_order_code", result.code);
      sessionStorage.setItem("last_order_event_id", result.event_id || orderEventId);

      window.location.href = `/thanks?o=${encodeURIComponent(result.code)}`;
    } catch (err) {
      console.error("Order submit exception:", err);
      setSubmitting(false);
      showGeneralError("حدث خطأ في الاتصال، يرجى التأكد من الإنترنت والمحاولة ثانية");
    }
  }

  function setSubmitting(isSubmitting) {
    if (!btnSubmit) return;
    btnSubmit.disabled = isSubmitting;
    if (submitSpinner) submitSpinner.style.display = isSubmitting ? "inline-block" : "none";
    if (submitBtnText) submitBtnText.textContent = isSubmitting ? "جارٍ التأكيد..." : "تأكيد الطلب";
  }

  function showGeneralError(msg) {
    if (!generalFormError) return;
    generalFormError.textContent = msg;
    generalFormError.classList.add("error");
    generalFormError.style.display = "block";
    generalFormError.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/[&<>"']/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m];
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
