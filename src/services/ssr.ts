import { FullProduct, StoreSettings } from "../types";

export function renderComingSoonPage(storeSettings: StoreSettings): string {
  const storeName = storeSettings.store_name || "عطور عزام الشمري";
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${storeName} | قريباً</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@300;400;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #ffffff;
      --text: #1d1d1f;
      --secondary: #6e6e73;
      --font: 'IBM Plex Sans Arabic', -apple-system, sans-serif;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--font);
      background: var(--bg);
      color: var(--text);
      display: flex;
      min-height: 100vh;
      align-items: center;
      justify-content: center;
      direction: rtl;
      text-align: center;
      padding: 1.5rem;
    }
    .coming-box {
      max-width: 500px;
    }
    .logo {
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--text);
      margin-bottom: 2rem;
      letter-spacing: -0.02em;
    }
    h1 {
      font-size: clamp(2rem, 5vw, 3rem);
      font-weight: 600;
      line-height: 1.15;
      margin-bottom: 1rem;
      letter-spacing: -0.03em;
    }
    p {
      font-size: 1.15rem;
      color: var(--secondary);
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="coming-box">
    <div class="logo">${storeName}</div>
    <h1>قريباً.</h1>
    <p>نعمل حالياً على تجهيز هذه التجربة الاستثنائية. انتظرونا قريباً جداً.</p>
  </div>
</body>
</html>`;
}

export function renderLandingPageSSR(
  html: string,
  product: FullProduct,
  storeSettings: StoreSettings
): string {
  const storeName = storeSettings.store_name || "عطور عزام الشمري";
  const productName = product.name_ar || "";
  const tagline = product.tagline_ar || "";
  const desc = product.description_ar || "";
  const priceFormatted = Number(product.price || 0).toLocaleString("en-US");
  const comparePriceFormatted = product.compare_at_price ? Number(product.compare_at_price).toLocaleString("en-US") : "";

  const heroImageSrc = product.images.length > 0 ? `/media/${product.images[0].id}` : "/img/hero.webp";

  // Preload tag for first image
  const preloadTag = `<link rel="preload" as="image" href="${heroImageSrc}" fetchpriority="high">`;

  // Dynamic OG tags
  const title = `${productName} | ${storeName}`;
  const ogTitle = `<title>${title}</title>\n  <meta property="og:title" content="${title}">`;
  const ogDesc = `<meta name="description" content="${tagline || desc}">\n  <meta property="og:description" content="${tagline || desc}">`;
  const ogImage = `<meta property="og:image" content="${heroImageSrc}">`;

  let rendered = html
    .replace(/<title>.*?<\/title>/i, ogTitle)
    .replace(/<meta name="description"[^>]*>/i, ogDesc)
    .replace(/<meta property="og:title"[^>]*>/i, "")
    .replace(/<meta property="og:description"[^>]*>/i, "")
    .replace(/<meta property="og:image"[^>]*>/i, ogImage)
    .replace(/<!-- SSR_PRELOAD -->/g, preloadTag);

  return rendered;
}
