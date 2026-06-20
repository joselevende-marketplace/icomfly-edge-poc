/**
 * PLANTILLA DE RENDER ESTATICO + HIDRATACION (Fase 0-2)
 * ------------------------------------------------------
 * Convierte { store, products } en una pagina HTML COMPLETA y RAPIDA:
 *  - El HTML ya trae los productos pintados (server-side bake) -> render instantaneo.
 *  - CSS critico inline -> no pide hojas externas.
 *  - Un pequeno JS "hidrata" la pagina: carrito con localStorage + checkout por
 *    WhatsApp (patron iComfly Colombia). Lo estatico es instantaneo; lo interactivo
 *    se activa encima sin bloquear el primer pintado.
 *
 * Sin frameworks. Sin dependencias. Cero llamadas al backend para mostrar la pagina.
 */

// --- Helpers de seguridad/formato ---

function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// JSON seguro para incrustar dentro de <script>: escapa '<' como < para
// que un dato con "</script>" (p.ej. el nombre de un producto) no pueda cerrar
// el tag y ejecutar HTML/JS arbitrario (XSS). JSON.parse/JS lo leen identico.
const safeJson = (o) => JSON.stringify(o).replace(/</g, '\\u003c');

// Segmento de ruta legible para la ficha de producto (producto/<X>/). Devuelve
// el SLUG (SEO) cuando es valido ([a-z0-9-], el mismo set que acepta el Worker
// comodin); si no hay slug o no es valido, cae al id numerico de siempre
// (retrocompat total). ADITIVO: nunca rompe una URL existente.
export function productPath(product) {
  const slug = product && product.slug != null ? String(product.slug).trim().toLowerCase() : '';
  if (/^[a-z0-9-]+$/.test(slug)) return slug;
  return product && product.id != null ? String(product.id) : '';
}

function formatPrice(value, store) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  try {
    return new Intl.NumberFormat(store.currency_locale || 'es-CO', {
      style: 'currency',
      currency: store.currency || 'COP',
      maximumFractionDigits: 0,
    }).format(num);
  } catch {
    const symbol = store.currency_symbol || '$';
    return `${symbol}${num.toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;
  }
}

function firstImage(product) {
  const imgs = Array.isArray(product.images) ? product.images : [];
  return imgs.find((u) => typeof u === 'string' && u.startsWith('http')) || '';
}

// Categoria normalizada (minusculas, sin espacios extremos). "Sin categoria"
// y vacios devuelven '' -> sin chip; el producto solo aparece en "Todos".
function normalizeCategory(c) {
  const n = String(c || '').trim().toLowerCase();
  if (!n || n === 'sin categoria' || n === 'sin categoría') return '';
  return n;
}

// Optimizacion de imagenes via Cloudflare Image Transformations: reescribe la URL
// a su version redimensionada/comprimida servida por la zona myicomfly.com
// (/cdn-cgi/image/). Requiere habilitar Transformations en el dashboard + permitir
// los origenes externos (Shopify CDN / R2). Si no esta habilitado o falla, el <img>
// hace fallback a la URL original via onerror (ver renderProductCard).
//
// INTERRUPTOR: solo se activa con IMAGE_CDN=1 en el entorno del horneado. Apagado
// (default) devuelve la URL original -> cero regresion si Transformations aun no
// esta habilitado en Cloudflare (evita una peticion fallida + fallback por imagen).
const IMAGE_CDN_ENABLED = process.env.IMAGE_CDN === '1';
function cdnImage(src, w = 440, q = 75) {
  if (!IMAGE_CDN_ENABLED || typeof src !== 'string' || !/^https?:\/\//i.test(src)) return src;
  return `https://myicomfly.com/cdn-cgi/image/width=${w},quality=${q},format=auto,fit=cover/${src}`;
}

// Optimiza las imagenes DENTRO del web_page_html (la pagina personalizada del
// editor): reescribe URLs raster de Shopify/R2 a su version Cloudflare. Aqui esta
// el grueso del peso de la pagina (hero + secciones), que antes iba sin optimizar.
// No toca SVGs ni otros origenes, ni envuelve dos veces. Gated por IMAGE_CDN.
function optimizeHtmlImages(html) {
  if (!IMAGE_CDN_ENABLED || typeof html !== 'string') return html;
  let out = html.replace(/https?:\/\/(?:cdn\.shopify\.com|pub-[a-z0-9]+\.r2\.dev)\/[^\s"')]+/gi, (url) => {
    if (url.includes('/cdn-cgi/')) return url;               // ya optimizada
    if (!/\.(?:jpe?g|png|webp)(?:$|\?)/i.test(url)) return url; // solo raster
    return `https://myicomfly.com/cdn-cgi/image/width=1000,quality=75,format=auto/${url}`;
  });
  // Fallback onerror (igual que la galeria): si el resizer de Cloudflare falla
  // (p.ej. el origen le niega el fetch -> 403/9408), el <img> vuelve a la URL
  // original y la imagen se ve igual, solo sin optimizar. Sin esto, una falla
  // del resizer deja iconos rotos en descripcion/pagina personalizada.
  out = out.replace(/<img\b[^>]*>/gi, (tag) => {
    if (/\bonerror=/i.test(tag)) return tag;
    const m = tag.match(/\bsrc="https:\/\/myicomfly\.com\/cdn-cgi\/image\/[^"/]+\/(https?:\/\/[^"]+)"/i);
    if (!m) return tag;
    const orig = m[1].replace(/'/g, '%27');
    return tag.replace(/^<img\b/i, `<img onerror="this.onerror=null;this.src='${orig}'"`);
  });
  return out;
}

// --- Render de una tarjeta de producto ---

function renderProductCard(product, store) {
  const img = firstImage(product);
  const price = formatPrice(product.price, store);
  const hasCompare =
    product.compare_price && Number(product.compare_price) > Number(product.price);
  const compare = hasCompare ? formatPrice(product.compare_price, store) : '';

  let discountBadge = '';
  if (hasCompare) {
    const pct = Math.round(
      (1 - Number(product.price) / Number(product.compare_price)) * 100
    );
    if (pct > 0) discountBadge = `<span class="badge">-${pct}%</span>`;
  }

  const imgTag = img
    ? `<img src="${esc(cdnImage(img))}" alt="${esc(product.name)}" loading="lazy" decoding="async" width="400" height="400" onerror="this.onerror=null;this.src='${esc(img)}'">`
    : `<div class="noimg">Sin imagen</div>`;

  // Link RELATIVO a la ficha horneada (producto/<slug>/ si hay slug, si no
  // producto/<id>/). Relativo para que funcione igual via Worker
  // (tienda.myicomfly.com/producto/X/) y accediendo directo a Pages
  // (.../<slug>/producto/X/). La imagen y el titulo navegan a la ficha; el
  // boton sigue agregando al carrito por id (data-buy) sin salir de la pagina.
  const href = `producto/${esc(productPath(product))}/`;

  // Categoria normalizada para el filtro por chips (data-cat). "Sin categoria"
  // queda vacia: el producto solo aparece en "Todos".
  const cat = normalizeCategory(product.category);

  return `
      <article class="card" data-cat="${esc(cat)}">
        <a class="card-link" href="${href}" aria-label="${esc(product.name)}">
          <div class="card-img">${discountBadge}${imgTag}</div>
        </a>
        <div class="card-body">
          <h3 class="card-title"><a class="card-link" href="${href}">${esc(product.name)}</a></h3>
          <div class="card-prices">
            <span class="price">${esc(price)}</span>
            ${compare ? `<span class="compare">${esc(compare)}</span>` : ''}
          </div>
          <button class="buy" type="button" data-buy="${esc(product.id)}">Comprar</button>
        </div>
      </article>`;
}

// --- CSS critico ---

function criticalCss(theme) {
  const primary = esc(theme.primary_color || '#108EE3');
  const secondary = esc(theme.secondary_color || '#1E40AF');
  return `
    :root{--primary:${primary};--secondary:${secondary};--bg:#f7f8fa;--card:#fff;--text:#1f2430;--muted:#7b8494}
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--text);line-height:1.45}
    header.hero{background:linear-gradient(135deg,var(--primary),var(--secondary));color:#fff;padding:36px 20px;text-align:center}
    header.hero h1{font-size:1.9rem;font-weight:800;letter-spacing:-.5px}
    header.hero p{opacity:.9;margin-top:6px;font-size:.95rem}
    main{max-width:1180px;margin:0 auto;padding:26px 16px 80px}
    .grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}
    .card{background:var(--card);border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(16,24,40,.08);transition:transform .12s,box-shadow .12s;display:flex;flex-direction:column}
    .card:hover{transform:translateY(-3px);box-shadow:0 10px 24px rgba(16,24,40,.14)}
    .card-img{position:relative;aspect-ratio:1/1;background:#eef1f5;overflow:hidden}
    .card-img img{width:100%;height:100%;object-fit:cover;display:block}
    .noimg{display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted);font-size:.85rem}
    .badge{position:absolute;top:10px;left:10px;background:#e11d48;color:#fff;font-weight:700;font-size:.78rem;padding:3px 8px;border-radius:999px;z-index:2}
    .card-body{padding:12px 14px 16px;display:flex;flex-direction:column;gap:8px;flex:1}
    .card-title{font-size:.98rem;font-weight:600;line-height:1.3;min-height:2.6em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .card-prices{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
    .price{font-size:1.12rem;font-weight:800;color:var(--text)}
    .compare{font-size:.85rem;color:var(--muted);text-decoration:line-through}
    .buy{margin-top:auto;cursor:pointer;border:0;text-align:center;background:var(--primary);color:#fff;font-weight:700;padding:10px 12px;border-radius:10px;font-size:.9rem}
    .buy:hover{filter:brightness(.94)}
    .buyrow{margin-top:auto;display:flex;gap:8px}
    .buyrow .buy{flex:1;margin-top:0}
    .addcart{flex:0 0 auto;cursor:pointer;border:1px solid #d8dee8;background:#fff;border-radius:10px;width:42px;font-size:1rem}
    .addcart:hover{border-color:var(--primary)}
    .pp-add{display:block;width:100%;border:1px solid #d8dee8;background:#fff;color:var(--text);font-weight:700;font-size:.95rem;padding:12px;border-radius:12px;cursor:pointer;margin-top:10px}
    .pp-add:hover{border-color:var(--primary)}
    /* Chips de categorias (filtro del catalogo) */
    .cats{display:flex;gap:8px;overflow-x:auto;padding:2px 2px 12px;scrollbar-width:thin}
    .cats button{flex:0 0 auto;cursor:pointer;border:1px solid #d8dee8;background:#fff;color:var(--text);font-weight:700;font-size:.86rem;padding:7px 14px;border-radius:999px}
    .cats button.on{background:var(--primary);border-color:var(--primary);color:#fff}
    .cats .cnt{opacity:.6;font-weight:600}
    .empty{text-align:center;color:var(--muted);padding:60px 20px}
    footer.ico{text-align:center;color:var(--muted);font-size:.8rem;padding:24px}
    .meta{text-align:center;color:var(--muted);font-size:.72rem;padding:4px 0 0}
    /* Carrito */
    .cart-fab{position:fixed;right:18px;bottom:18px;z-index:40;background:var(--primary);color:#fff;border:0;cursor:pointer;border-radius:999px;padding:14px 18px;font-weight:800;box-shadow:0 8px 24px rgba(16,24,40,.25);display:flex;align-items:center;gap:8px}
    .cart-fab .count{background:#fff;color:var(--primary);border-radius:999px;min-width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;font-size:.8rem;padding:0 6px}
    .drawer-bg{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:50;display:none}
    .drawer-bg.open{display:block}
    .drawer{position:fixed;top:0;right:0;height:100%;width:min(400px,92vw);background:#fff;z-index:51;transform:translateX(100%);transition:transform .22s;display:flex;flex-direction:column}
    .drawer.open{transform:translateX(0)}
    .drawer h2{padding:18px 18px 10px;font-size:1.1rem;display:flex;justify-content:space-between;align-items:center}
    .drawer .close{cursor:pointer;border:0;background:none;font-size:1.4rem;color:var(--muted)}
    .drawer .items{flex:1;overflow:auto;padding:6px 18px}
    .ci{display:flex;gap:10px;padding:10px 0;border-bottom:1px solid #eef1f5}
    .ci img{width:54px;height:54px;object-fit:cover;border-radius:8px;background:#eef1f5}
    .ci .info{flex:1;font-size:.86rem}
    .ci .qty{display:flex;align-items:center;gap:6px;margin-top:4px}
    .ci .qty button{width:24px;height:24px;border:1px solid #ddd;background:#fff;border-radius:6px;cursor:pointer}
    .drawer .foot{padding:16px 18px;border-top:1px solid #eef1f5}
    .drawer .total{display:flex;justify-content:space-between;font-weight:800;margin-bottom:12px}
    .wa{display:block;width:100%;text-align:center;background:#25D366;color:#fff;border:0;cursor:pointer;font-weight:800;padding:13px;border-radius:12px;font-size:.95rem;text-decoration:none}
    .cart-empty{color:var(--muted);text-align:center;padding:40px 10px}
    /* Checkout por formulario (drawer) */
    .dview{flex:1;display:flex;flex-direction:column;min-height:0}
    .co{overflow:auto;padding:14px 18px;display:block}
    .co label{font-size:.8rem;font-weight:700;color:var(--muted)}
    .co input{width:100%;padding:11px 12px;border:1px solid #d8dee8;border-radius:10px;margin:4px 0 12px;font-size:.95rem;font-family:inherit}
    .co input.bad{border-color:#e11d48}
    .co-error{background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;border-radius:10px;padding:10px 12px;font-size:.85rem;margin-bottom:10px}
    .co-submit{margin-top:2px}
    /* Selector de unidades (ofertas de cantidad) */
    .offs{display:flex;flex-direction:column;gap:9px;margin-bottom:12px}
    .off{display:flex;align-items:center;gap:10px;border:1.5px solid #e2e7f0;border-radius:12px;padding:9px 12px;cursor:pointer;background:#fff}
    .off.on{border-color:var(--primary);background:#f4f9ff;box-shadow:0 0 0 1px var(--primary)}
    .off img{width:44px;height:44px;object-fit:cover;border-radius:8px;background:#eef1f5;flex:0 0 auto}
    .off-mid{flex:1;min-width:0}
    .off-t{font-weight:800;font-size:.95rem}
    .off-b{display:inline-block;margin-top:3px;background:#22c55e;color:#fff;font-weight:700;font-size:.72rem;padding:2px 8px;border-radius:6px}
    .off-p{text-align:right;font-size:.95rem}
    .off-p s{display:block;color:var(--muted);font-size:.78rem}
    .off-p b{font-weight:800}
    /* Envio + totales */
    .shiprow{display:flex;justify-content:space-between;align-items:center;border:1px solid #e2e7f0;border-radius:12px;padding:10px 14px;font-weight:700;font-size:.92rem;margin-bottom:12px}
    .totrows{border:1px solid #e2e7f0;border-radius:12px;padding:10px 14px;margin-bottom:16px;font-size:.92rem}
    .totrows>div{display:flex;justify-content:space-between;padding:4px 0}
    .totrows .tt{border-top:1px solid #e9edf3;margin-top:4px;padding-top:8px;font-weight:800}
    .freegreen{color:#16a34a;font-weight:700}
    .co-head{text-align:center;font-weight:800;font-size:1.02rem;margin:2px 0 12px}
    .co label i{color:#e11d48;font-style:normal}
    .co select{width:100%;padding:11px 12px;border:1px solid #d8dee8;border-radius:10px;margin:4px 0 12px;font-size:.95rem;font-family:inherit;background:#fff}
    .co select.bad{border-color:#e11d48}
    .finish{display:block;width:100%;border:0;cursor:pointer;background:#22c55e;color:#06250f;font-weight:800;padding:14px;border-radius:12px;font-size:.98rem}
    .finish:hover{filter:brightness(.96)}
    .finish:disabled{opacity:.6;cursor:wait}
    /* Resumen del producto arriba del formulario (compra directa) */
    .co-sum{display:flex;gap:12px;align-items:center;background:#f4f6fa;border:1px solid #e4e8f0;border-radius:12px;padding:10px 12px;margin-bottom:14px}
    .co-sum img{width:54px;height:54px;object-fit:cover;border-radius:9px;background:#e8ecf3;flex:0 0 auto}
    .co-sum-name{font-weight:700;font-size:.92rem;line-height:1.3}
    .co-sum-price{color:var(--muted);font-size:.85rem;margin-top:2px}
    .co-submit:disabled{opacity:.6;cursor:wait}
    .co-back{display:block;width:100%;background:none;border:0;color:var(--muted);font-weight:700;padding:12px;cursor:pointer;font-size:.9rem;margin-top:6px}
    .co-done{text-align:center;padding:26px 8px}
    .co-check{width:64px;height:64px;margin:0 auto 14px;border-radius:999px;background:#dcfce7;color:#16a34a;font-size:2rem;font-weight:800;display:flex;align-items:center;justify-content:center}
    .co-done h3{font-size:1.2rem;margin-bottom:8px}
    .co-done p{color:var(--muted);font-size:.92rem;line-height:1.55;margin-bottom:16px}
    .co-done .wa{margin-bottom:6px}
    /* Tarjeta clickeable (ficha de producto) */
    a.card-link{color:inherit;text-decoration:none;display:block}
    .card-title a.card-link:hover{color:var(--primary)}
    /* Ficha de producto */
    .pp-top{display:flex;gap:10px;align-items:center;padding:14px 16px;background:#fff;box-shadow:0 1px 3px rgba(16,24,40,.06)}
    .pp-top a{color:var(--primary);font-weight:700;text-decoration:none;font-size:.92rem}
    .pp{display:grid;gap:26px;grid-template-columns:1fr;max-width:1080px;margin:0 auto;padding:22px 16px 90px}
    @media(min-width:880px){.pp{grid-template-columns:1.05fr 1fr;align-items:start}}
    .pp-main{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:16px;background:#eef1f5;display:block}
    .pp-thumbs{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
    .pp-thumbs img{width:64px;height:64px;object-fit:cover;border-radius:10px;cursor:pointer;border:2px solid transparent;background:#eef1f5}
    .pp-thumbs img.active{border-color:var(--primary)}
    .pp-info h1{font-size:1.55rem;font-weight:800;line-height:1.25;margin-bottom:8px}
    .pp-rating{color:#f59e0b;font-weight:700;font-size:.92rem;margin-bottom:10px}
    .pp-prices{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin:6px 0 14px}
    .pp-price{font-size:1.7rem;font-weight:800}
    .pp-compare{color:var(--muted);text-decoration:line-through;font-size:1rem}
    .pp-badge{background:#e11d48;color:#fff;font-weight:700;font-size:.8rem;padding:3px 9px;border-radius:999px}
    .pp-buy{display:block;width:100%;border:0;cursor:pointer;background:var(--primary);color:#fff;font-weight:800;font-size:1.05rem;padding:15px;border-radius:12px}
    .pp-buy:hover{filter:brightness(.94)}
    .pp-desc{margin-top:22px;background:#fff;border-radius:14px;padding:18px;box-shadow:0 1px 3px rgba(16,24,40,.08);line-height:1.65;overflow-wrap:anywhere}
    .pp-desc img{max-width:100%;height:auto;border-radius:10px}
    .pp-desc h2,.pp-desc h3{margin:14px 0 8px}
    .pp-desc p{margin:8px 0}
    /* === Ficha de producto v2: paridad con la SPA (ProductPage.jsx) === */
    body.pp-page{background:#fff}
    /* En la ficha de producto el checkout abre CENTRADO como el CheckoutModal
       de la SPA (CheckoutModal.jsx: fixed inset-0 items-center, max-w-lg,
       rounded-2xl, max-h 90vh). La portada conserva el drawer lateral. */
    body.pp-page .drawer{top:50%;left:50%;right:auto;bottom:auto;height:auto;max-height:90vh;width:min(512px,92vw);border-radius:16px;box-shadow:0 25px 50px -12px rgba(0,0,0,.25);transform:translate(-50%,-50%) scale(.96);opacity:0;pointer-events:none;transition:opacity .2s,transform .2s}
    body.pp-page .drawer.open{transform:translate(-50%,-50%) scale(1);opacity:1;pointer-events:auto}
    .pp-wrap{max-width:1080px;margin:0 auto;padding:22px 16px 90px}
    .pp2{display:grid;gap:26px;grid-template-columns:1fr}
    @media(min-width:880px){.pp2{grid-template-columns:1.05fr 1fr;align-items:start}}
    .ppg{width:100%;user-select:none}
    @media(min-width:880px){.ppg{max-width:70%;margin:0 auto}}
    .ppg-stage{position:relative;background:#fff}
    .ppg-track{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;-ms-overflow-style:none;touch-action:pan-x pan-y}
    .ppg-track::-webkit-scrollbar{display:none}
    .ppg-slide{width:100%;flex:0 0 100%;scroll-snap-align:center;aspect-ratio:1/1;background:#fff;display:flex;align-items:center;justify-content:center}
    .ppg-slide img{width:100%;height:100%;object-fit:cover;display:block}
    @media(min-width:880px){.ppg-slide img{object-fit:contain}}
    .ppg-noimg{aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;color:var(--muted);background:#eef1f5;border-radius:16px}
    .ppg-dots{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);display:flex;gap:6px;z-index:10}
    .ppg-dots button{width:9px;height:9px;border-radius:999px;border:0;cursor:pointer;background:rgba(255,255,255,.6);box-shadow:0 1px 2px rgba(0,0,0,.18);padding:0}
    .ppg-dots button.on{background:#fff;transform:scale(1.15);box-shadow:0 0 0 1px rgba(0,0,0,.1)}
    .ppg-thumbs{display:none}
    @media(min-width:880px){.ppg-thumbs{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:14px}}
    .ppg-thumbs button{aspect-ratio:1/1;border:2px solid transparent;border-radius:10px;overflow:hidden;cursor:pointer;background:#fff;opacity:.7;padding:0}
    .ppg-thumbs button.on{border-color:#000;opacity:1}
    .ppg-thumbs button:hover{opacity:1;border-color:#e5e7eb}
    .ppg-thumbs img{width:100%;height:100%;object-fit:contain;display:block}
    .pp-info2 h1{font-size:1.5rem;font-weight:700;line-height:1.25;margin-bottom:12px}
    @media(min-width:880px){.pp-info2 h1{font-size:1.875rem}}
    .pp-rrow{display:flex;align-items:center;gap:8px;margin-bottom:16px}
    .pp-stars{color:#f59e0b;font-size:1.05rem;letter-spacing:1px;line-height:1}
    .pp-stars .soff{color:#d1d5db}
    .pp-rcount{color:#4b5563;font-weight:500;font-size:.875rem}
    .pp-prices2{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px}
    .pp-price2{font-size:1.875rem;font-weight:700}
    @media(min-width:880px){.pp-price2{font-size:2.25rem}}
    .pp-compare2{color:#6b7280;text-decoration:line-through;font-size:1.125rem}
    .pp-save{background:#000;color:#fff;padding:4px 12px;border-radius:4px;font-size:.875rem;font-weight:600}
    .pp-bens{display:flex;flex-direction:column;gap:8px;margin:0 0 24px}
    .pp-bens div{display:flex;align-items:center;gap:8px;font-size:.875rem;color:#374151}
    .pp-cta{width:100%;border:0;cursor:pointer;padding:16px;border-radius:12px;font-weight:700;font-size:1.125rem;display:flex;align-items:center;justify-content:center;gap:12px;transition:transform .15s;animation:ppshake 2.5s ease-in-out infinite;animation-delay:1s}
    .pp-cta:hover{transform:scale(1.03);animation:none}
    .pp-cta svg{flex:0 0 auto}
    @keyframes ppshake{0%{transform:rotate(0)}6%{transform:rotate(3deg)}12%{transform:rotate(-3deg)}18%{transform:rotate(3deg)}24%{transform:rotate(-3deg)}30%{transform:rotate(2deg)}36%{transform:rotate(-2deg)}42%{transform:rotate(1deg)}48%{transform:rotate(-1deg)}54%,100%{transform:rotate(0)}}
    .pp-desc2{margin:48px auto 0;max-width:896px;line-height:1.65;color:#374151;overflow-wrap:anywhere}
    .pp-desc2 img{max-width:100%;height:auto;border-radius:10px}
    .pp-desc2 h2,.pp-desc2 h3{margin:14px 0 8px;color:var(--text)}
    .pp-desc2 p{margin:8px 0}
  `.trim();
}

// --- JS de hidratacion (carrito + checkout WhatsApp) ---
// Escrito SIN backticks ni ${...} para poder incrustarlo en el template literal.

function hydrationScript() {
  return [
    '(function(){',
    '  var S=window.__STORE__||{}; var P=window.__PRODUCTS__||{};',
    '  var bg=document.getElementById("drawerBg"), dr=document.getElementById("drawer");',
    '  function map(id){return P[id]||{name:"Producto",price:0,image:"",offers:[]};}',
    // Escapa HTML antes de concatenar a innerHTML (DOM XSS).
    '  function eh(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/\'/g,"&#39;");}',
    '  function fmt(n){try{return new Intl.NumberFormat(S.locale||"es-CO",{style:"currency",currency:S.currency||"COP",maximumFractionDigits:0}).format(n);}catch(e){return (S.symbol||"$")+Math.round(n).toLocaleString("es-CO");}}',
    '  var API="https://api.icomfly.com/api";',
    '  function view(name){',
    '    var ids=["coView","doneView"];',
    '    for(var i=0;i<ids.length;i++){var el=document.getElementById(ids[i]);if(el){el.style.display=(ids[i]===name)?"":"none";}}',
    '  }',
    '  function close(){bg.classList.remove("open");dr.classList.remove("open");}',
    // PEDIDO DIRECTO con OFERTAS DE CANTIDAD (mismo funnel que la SPA):
    // OPTS[0] = 1 unidad a precio base; el resto vienen de quantity_offers del
    // producto (descuento % sobre el unitario). SEL.i = opcion elegida.
    '  var OPTS=[];var SEL={id:null,i:0};',
    '  function curOpt(){return OPTS[SEL.i]||OPTS[0];}',
    '  function unitPrice(base,d){return Math.round(base*(100-d)/100);}',
    '  function updateTotals(){',
    '    var p=map(SEL.id);var o=curOpt();var tot=unitPrice(p.price,o.d)*o.q;',
    '    var sub=document.getElementById("tSub");if(sub){sub.textContent=fmt(tot);}',
    '    var t=document.getElementById("tTot");if(t){t.textContent=fmt(tot);}',
    // Texto base del CTA configurable (S.ctaText viene de buildStoreJs).
    '    var b=document.getElementById("coSubmit");if(b&&!b.disabled){b.textContent=(S.ctaText||"Finaliza Tu Pedido Contra Entrega")+" - "+fmt(tot);}',
    '  }',
    '  function renderOffers(){',
    '    var p=map(SEL.id);var box=document.getElementById("coOffers");if(!box){return;}',
    '    var img=eh(p.image||"");var html="";',
    '    for(var i=0;i<OPTS.length;i++){var o=OPTS[i];var tot=unitPrice(p.price,o.d)*o.q;var strike=o.d?fmt(p.price*o.q):"";',
    '      html+="<div class=\\"off"+(i===SEL.i?" on":"")+"\\" data-off=\\""+i+"\\">"',
    '        +"<img src=\\""+img+"\\" alt=\\"\\">"',
    '        +"<div class=\\"off-mid\\"><div class=\\"off-t\\">"+eh(o.t)+"</div>"+(o.d?"<div class=\\"off-b\\">Ahorra "+o.d+"% adicional</div>":"")+"</div>"',
    '        +"<div class=\\"off-p\\">"+(strike?"<s>"+strike+"</s>":"")+"<b>"+fmt(tot)+"</b></div></div>";}',
    '    box.innerHTML=html;updateTotals();',
    '  }',
    // "Comprar": abre el drawer DIRECTO en el formulario con este producto.
    '  function buyNow(id){',
    '    var p=map(id);if(!p||!p.price){return;}',
    '    SEL.id=id;SEL.i=0;OPTS=[{q:1,d:0,t:"1 unidad"}];',
    '    var of=p.offers||[];',
    '    for(var i=0;i<of.length;i++){if(of[i]&&of[i].q>=2){OPTS.push({q:of[i].q,d:of[i].d||0,t:of[i].t||(of[i].q+" unidades")});}}',
    '    renderOffers();',
    '    var err=document.getElementById("coError");if(err){err.style.display="none";}',
    '    bg.classList.add("open");dr.classList.add("open");',
    '    view("coView");',
    '  }',
    '  function fieldVal(id){var el=document.getElementById(id);return el?String(el.value||"").replace(/^\\s+|\\s+$/g,""):"";}',
    '  function markBad(id,bad){var el=document.getElementById(id);if(el){el.classList.toggle("bad",!!bad);}}',
    '  function submitOrder(ev){',
    '    ev.preventDefault();',
    '    var name=fieldVal("coName"),last=fieldVal("coLast"),phone=fieldVal("coPhone"),dept=fieldVal("coDept"),city=fieldVal("coCity"),addr=fieldVal("coAddr"),hood=fieldVal("coHood"),mail=fieldVal("coMail");',
    '    var digits=phone.replace(/\\D/g,"");',
    '    var ok=true;',
    '    markBad("coName",!name); if(!name){ok=false;}',
    '    markBad("coLast",!last); if(!last){ok=false;}',
    '    markBad("coPhone",digits.length<7); if(digits.length<7){ok=false;}',
    '    markBad("coDept",!dept); if(!dept){ok=false;}',
    '    markBad("coCity",!city); if(!city){ok=false;}',
    '    markBad("coAddr",!addr); if(!addr){ok=false;}',
    '    markBad("coHood",!hood); if(!hood){ok=false;}',
    '    var err=document.getElementById("coError");',
    '    if(!ok){err.style.display="block";err.textContent="Completa los campos marcados para crear tu pedido.";return;}',
    '    err.style.display="none";',
    '    var p=map(SEL.id);var o=curOpt();var unit=unitPrice(p.price,o.d);var tot=unit*o.q;',
    '    var btn=document.getElementById("coSubmit");btn.disabled=true;btn.textContent="Creando tu pedido...";',
    // Restaura el CTA configurable tras el intento (updateTotals re-agrega el total).
    '    function restoreBtn(){btn.disabled=false;btn.textContent=(S.ctaText||"Finaliza Tu Pedido Contra Entrega");updateTotals();}',
    '    var pid=isNaN(Number(SEL.id))?SEL.id:Number(SEL.id);',
    // El orderNumber del intento se persiste y REUSA en reintentos (si la red
    // falla despues de crear la orden, un numero nuevo duplicaria pedidos).
    '    var att=null;try{att=localStorage.getItem("ico_order_attempt");}catch(e){}',
    '    if(!att){att="#"+(Math.floor(Math.random()*90000)+10000);try{localStorage.setItem("ico_order_attempt",att);}catch(e){}}',
    '    var body={orderNumber:att,',
    '      product:{id:pid,name:p.name,price:tot},',
    '      products:[{id:pid,name:p.name,price:unit,originalPrice:p.price,quantity:o.q,offerApplied:(o.d?{title:o.t,quantityReq:o.q,discount:o.d}:null),image:p.image||null}],',
    '      quantity:1,subtotal:tot,shippingCost:0,total:tot,shippingOption:"standard",paymentMethod:"Contra Entrega",status:"Confirmado",',
    '      customer:{fullName:(name+" "+last),phone:phone,whatsapp:phone,address:(addr+", "+hood),department:dept,city:city,email:mail},',
    '      quantityOfferApplied:!!o.d,quantityOfferTitle:(o.d?o.t:null),quantityOfferDiscount:(o.d||null),',
    '      isCartOrder:true,itemsCount:1,source:"edge_storefront"};',
    '    var resumen=(o.q+"x "+p.name);var totalTxt=fmt(tot);',
    '    fetch(API+"/orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})',
    '      .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};}).catch(function(){return {ok:false,j:null};});})',
    '      .then(function(res){',
    '        restoreBtn();',
    '        if(!res.ok||!res.j||res.j.success===false){',
    '          var m=(res.j&&res.j.message)||"No pudimos crear tu pedido. Intenta de nuevo.";',
    '          err.style.display="block";err.textContent=m;return;',
    '        }',
    '        var num=String((res.j.data&&res.j.data.order_number)||body.orderNumber).replace(/^#/,"");',
    '        try{localStorage.removeItem("ico_order_attempt");}catch(e){}',
    '        var msgEl=document.getElementById("doneMsg");',
    '        if(msgEl){msgEl.textContent="Tu pedido #"+num+" quedo registrado y pagas al recibirlo (contra entrega). Te contactaremos para coordinar la entrega.";}',
    '        var waBtn=document.getElementById("doneWa");',
    '        var wa=(S.whatsapp||"").replace(/[^0-9]/g,"");',
    '        if(waBtn&&wa){',
    '          var msg="Hola "+(S.name||"")+", soy "+name+", acabo de comprar "+resumen+" por valor de "+totalTxt+", escribo para confirmar el pedido #"+num;',
    '          waBtn.href="https://wa.me/"+wa+"?text="+encodeURIComponent(msg);waBtn.style.display="block";',
    '        } else if(waBtn){waBtn.style.display="none";}',
    '        view("doneView");',
    '      })',
    '      .catch(function(){restoreBtn();err.style.display="block";err.textContent="Sin conexion. Revisa tu internet e intenta de nuevo.";});',
    '  }',
    // Delegacion con closest(): el click puede caer en un HIJO del boton.
    '  document.addEventListener("click",function(e){',
    '    var t=e.target; if(!t||!t.closest){return;}',
    '    var el;',
    '    if((el=t.closest("[data-buy]"))){buyNow(el.dataset.buy);}',
    '    else if((el=t.closest("[data-off]"))){SEL.i=parseInt(el.dataset.off,10)||0;renderOffers();}',
    '    else if(t.id==="drawerBg"||t.closest("#cartClose")){close();}',
    '    else if((el=t.closest("[data-catbtn]"))){',
    '      var sel=el.dataset.catbtn;',
    '      var btns=document.querySelectorAll("[data-catbtn]");',
    '      for(var bi=0;bi<btns.length;bi++){btns[bi].classList.toggle("on",btns[bi]===el);}',
    '      var cards=document.querySelectorAll(".card[data-cat]");',
    '      for(var ci=0;ci<cards.length;ci++){var cc=cards[ci].getAttribute("data-cat");cards[ci].style.display=(!sel||cc===sel)?"":"none";}',
    '    }',
    '    else if(t.closest("#coBack")){close();}',
    '    else if(t.closest("#doneClose")){close();}',
    '  });',
    '  var coForm=document.getElementById("coForm"); if(coForm){coForm.addEventListener("submit",submitOrder);}',
    '})();',
  ].join('\n');
}

// --- Piezas COMPARTIDAS entre la portada y las fichas de producto ---
// (mismo carrito/drawer en todas las paginas: el localStorage es por dominio,
// asi que el carrito sobrevive al navegar entre portada y fichas)

function buildProductMap(list) {
  const productMap = {};
  for (const p of list || []) {
    // Ofertas de cantidad normalizadas para el selector del formulario:
    // q (unidades), d (descuento %), t (titulo). Misma semantica que la SPA.
    const offers = (Array.isArray(p.quantity_offers) ? p.quantity_offers : [])
      .map((o) => ({
        q: parseInt(o && o.quantity, 10) || 0,
        d: parseInt(o && o.discount, 10) || 0,
        t: String((o && o.title) || '').trim(),
      }))
      .filter((o) => o.q >= 2 && o.d > 0 && o.d < 100);
    productMap[p.id] = {
      name: p.name,
      price: Number(p.price) || 0,
      image: firstImage(p),
      offers,
    };
  }
  return productMap;
}

function buildStoreJs(store) {
  return {
    name: store.name || '',
    whatsapp: (store.contact && store.contact.whatsapp) || store.whatsapp || '',
    currency: store.currency || 'COP',
    symbol: store.currency_symbol || '$',
    locale: store.currency_locale || 'es-CO',
    // Texto base del CTA: la hidratacion lo re-pinta con el total
    // (S.ctaText + ' - ' + fmt(tot)). Configurable via checkout_form.ctaText.
    ctaText: String(checkoutCfg(store).ctaText || CTA_DEFAULT),
  };
}

// --- Personalizacion del formulario de checkout (theme_config.checkout_form) ---
// Contrato compartido: { title, subtitle, ctaText, labels:{...}, colors:{...},
// font, radius, showEmail }. TODO opcional; sin config el drawer queda IDENTICO
// al look actual (cero regresion).

// Saneo de valores CSS del dueño: solo caracteres seguros para un color/valor
// simple. Evita que un "}" o "<" en la config rompa el <style> o inyecte HTML.
function cssVal(v) {
  const s = String(v == null ? '' : v).trim();
  return /^[#a-zA-Z0-9(),.%\s-]{1,64}$/.test(s) ? s : '';
}

// Texto del CTA por defecto (compartido entre HTML, hidratacion y buildStoreJs).
const CTA_DEFAULT = 'Finaliza Tu Pedido Contra Entrega';

// Config del formulario (objeto vacio si la tienda no configuro nada).
function checkoutCfg(store) {
  return (store && store.theme_config && store.theme_config.checkout_form) || {};
}

// Font-family del drawer segun cfg.font ('' = sin override -> hereda el actual).
function checkoutFont(font) {
  if (font === 'serif') return "Georgia,'Times New Roman',serif";
  if (font === 'rounded') return "'Trebuchet MS',Verdana,sans-serif";
  return ''; // 'system' o ausente -> inherit (look actual)
}

// Bloque <style> con overrides SOLO de las claves presentes en la config.
// Sin config devuelve '' -> no se emite nada (HTML identico al actual).
function checkoutCss(cfg) {
  const c = cfg.colors || {};
  const rules = [];
  const bg = cssVal(c.bg);
  const text = cssVal(c.text);
  if (bg) rules.push(`.drawer{background:${bg}}`);
  if (text) rules.push(`.drawer,.drawer h2,.co label,.co-head{color:${text}}`);
  const fieldBg = cssVal(c.fieldBg);
  const fieldBorder = cssVal(c.fieldBorder);
  if (fieldBg) rules.push(`.co input,.co select,.off{background:${fieldBg}}`);
  if (fieldBorder) rules.push(`.co input,.co select,.off{border-color:${fieldBorder}}`);
  const accent = cssVal(c.accent);
  if (accent) rules.push(`.off.on{border-color:${accent};box-shadow:0 0 0 1px ${accent};background:${fieldBg || '#f4f9ff'}}`);
  const cta = cssVal(c.cta);
  const ctaText = cssVal(c.ctaText);
  if (cta) rules.push(`.finish{background:${cta}}`);
  if (ctaText) rules.push(`.finish{color:${ctaText}}`);
  const radius = Number(cfg.radius);
  if (Number.isFinite(radius) && radius >= 0) {
    const r = Math.min(Math.round(radius), 40);
    rules.push(`.co input,.co select,.off{border-radius:${r}px}`);
    rules.push(`.finish{border-radius:${r}px}`);
  }
  const font = checkoutFont(cfg.font);
  if (font) rules.push(`.drawer{font-family:${font}}`);
  return rules.length ? `\n  <style>${rules.join('')}</style>` : '';
}

// SIN CARRITO (decisión del dueño): el único flujo es Comprar → FORMULARIO de
// pedido (contra entrega) → orden en iComfly. El drawer abre directo en el
// formulario con el resumen del producto arriba.
function cartShellHtml(store) {
  // SIN CARRITO: Comprar -> formulario directo (mismo funnel que la SPA:
  // selector de unidades con ofertas, envio gratis, totales y datos de envio).
  // Departamento: <select> con la lista de Colombia cuando aplica; si la
  // tienda es de otro pais, campo de texto libre.
  const isCO = String((store && store.country) || 'Colombia').trim().toLowerCase().indexOf('colombia') === 0;
  const DEPTS_CO = ['Amazonas','Antioquia','Arauca','Atlántico','Bogotá D.C.','Bolívar','Boyacá','Caldas','Caquetá','Casanare','Cauca','Cesar','Chocó','Córdoba','Cundinamarca','Guainía','Guaviare','Huila','La Guajira','Magdalena','Meta','Nariño','Norte de Santander','Putumayo','Quindío','Risaralda','San Andrés y Providencia','Santander','Sucre','Tolima','Valle del Cauca','Vaupés','Vichada'];

  // Personalizacion del formulario (theme_config.checkout_form). Todos los
  // textos del dueño pasan por esc(); defaults = look actual (cero regresion).
  const cfg = checkoutCfg(store);
  const L = cfg.labels || {};
  const title = esc(cfg.title || 'Ordena ya y paga al recibir');
  const subtitle = esc(cfg.subtitle || 'Ingresa los datos de envío');
  const ctaText = esc(cfg.ctaText || CTA_DEFAULT);
  const lblNombre = esc(L.nombre || 'Nombre');
  const lblApellido = esc(L.apellido || 'Apellido');
  const lblWhatsapp = esc(L.whatsapp || 'Whatsapp / Celular');
  const lblDepto = esc(L.departamento || 'Departamento');
  const lblCiudad = esc(L.ciudad || 'Ciudad');
  const lblDireccion = esc(L.direccion || 'Dirección de residencia');
  const lblBarrio = esc(L.barrio || 'Nombre Barrio - Número casa o Apto');
  const lblCorreo = esc(L.correo || 'Correo electrónico');

  const deptField = isCO
    ? `<select id="coDept"><option value="">${lblDepto}</option>${DEPTS_CO.map((d) => `<option>${d}</option>`).join('')}</select>`
    : `<input id="coDept" type="text" placeholder="${lblDepto} / Provincia">`;

  // Campo correo: opcional en el pedido; si showEmail === false NO se emite.
  // La hidratacion lo tolera: fieldVal() devuelve '' cuando el id no existe.
  const mailField = cfg.showEmail === false
    ? ''
    : `<label for="coMail">${lblCorreo}</label>
        <input id="coMail" type="email" autocomplete="email" placeholder="${lblCorreo}">`;

  return `${checkoutCss(cfg)}
  <div id="drawerBg" class="drawer-bg"></div>
  <aside id="drawer" class="drawer" aria-label="Pedido">
    <h2>${title} <button id="cartClose" class="close" type="button">&times;</button></h2>
    <div id="coView" class="dview co">
      <div id="coOffers" class="offs"></div>
      <div class="shiprow"><span>&#9679;&nbsp; Envío Gratis</span><b>Gratis</b></div>
      <div class="totrows">
        <div><span>Subtotal</span><span id="tSub"></span></div>
        <div><span>Envío</span><span class="freegreen">Gratis</span></div>
        <div class="tt"><span>Total</span><span id="tTot"></span></div>
      </div>
      <div class="co-head">${subtitle}</div>
      <form id="coForm" novalidate>
        <label for="coName">${lblNombre} <i>*</i></label>
        <input id="coName" type="text" autocomplete="given-name" placeholder="${lblNombre}">
        <label for="coLast">${lblApellido} <i>*</i></label>
        <input id="coLast" type="text" autocomplete="family-name" placeholder="${lblApellido}">
        <label for="coPhone">${lblWhatsapp} <i>*</i></label>
        <input id="coPhone" type="tel" autocomplete="tel" inputmode="tel" placeholder="${lblWhatsapp}">
        <label for="coDept">${lblDepto} <i>*</i></label>
        ${deptField}
        <label for="coCity">${lblCiudad} <i>*</i></label>
        <input id="coCity" type="text" autocomplete="address-level2" placeholder="${lblCiudad}">
        <label for="coAddr">${lblDireccion} <i>*</i></label>
        <input id="coAddr" type="text" autocomplete="street-address" placeholder="Dirección detallada (OBLIGATORIO)">
        <label for="coHood">${lblBarrio} <i>*</i></label>
        <input id="coHood" type="text" placeholder="Barrio/Conjunto/Torre/#Apto/#Casa">
        ${mailField}
        <div id="coError" class="co-error" style="display:none"></div>
        <button id="coSubmit" class="finish" type="submit">${ctaText}</button>
        <button id="coBack" class="co-back" type="button">Cancelar</button>
      </form>
    </div>
    <div id="doneView" class="dview co" style="display:none">
      <div class="co-done">
        <div class="co-check">&#10003;</div>
        <h3>&iexcl;Pedido confirmado!</h3>
        <p id="doneMsg"></p>
        <a id="doneWa" class="wa" target="_blank" rel="noopener" style="display:none">Confirmar por WhatsApp (opcional)</a>
        <button id="doneClose" class="co-back" type="button">Seguir comprando</button>
      </div>
    </div>
  </aside>`;
}

function runtimeScripts(storeJs, productMap) {
  // safeJson: evita que un "</script>" dentro de los datos rompa el tag (XSS).
  return `<script>window.__STORE__=${safeJson(storeJs)};window.__PRODUCTS__=${safeJson(productMap)};</script>
  <script>${hydrationScript()}</script>`;
}

// Descripcion del producto: viene del editor de la tienda (HTML propio). Se
// inyecta quitando <script>, otros tags ejecutables/peligrosos (iframe, object,
// embed, style, svg), handlers inline (on*) y URLs javascript:/data:text/html
// en href/src. Si es texto plano, se convierte saltos en <br>.
function sanitizeDescription(html) {
  if (typeof html !== 'string' || !html.trim()) return '';
  let out = html
    // Bloques completos con su contenido
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<(iframe|object|embed|style|svg)\b[\s\S]*?<\/\1\s*>/gi, '')
    // Tags sueltos (apertura sin cierre, cierres huerfanos, self-closing)
    .replace(/<\/?(script|iframe|object|embed|style|svg)\b[^>]*>/gi, '')
    // Handlers inline (onclick, onerror, ...)
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // href/src con esquemas ejecutables -> neutralizados a "#"
    .replace(/\s(href|src)\s*=\s*("\s*(?:javascript:|data:text\/html)[^"]*"|'\s*(?:javascript:|data:text\/html)[^']*'|(?:javascript:|data:text\/html)[^\s>]*)/gi, ' $1="#"');
  // SIN tags: varias descripciones se guardaron con las etiquetas perdidas y
  // el CSS del generador quedo como texto visible (".dpd-wrap {...}"). Se
  // limpia el CSS (comentarios y bloques regla{...}, iterativo para @media) y
  // se formatea en parrafos. OJO: sin esc() — escapar '&' rompia entidades ya
  // guardadas (&nbsp; se veia literal) y por definicion aqui no hay tags.
  if (!/[<>]/.test(out)) {
    if (/\/\*|[.#@][\w-]+[^{}\n]*\{/.test(out)) {
      out = out.replace(/\/\*[\s\S]*?\*\//g, ' ');
      let prev;
      do { prev = out; out = out.replace(/[^{}]*\{[^{}]*\}/g, ' '); } while (out !== prev && out.includes('{'));
      out = out.replace(/[{}]/g, ' ');
    }
    out = out.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
    out = out ? out.split(/\n+/).map((p) => `<p>${p}</p>`).join('') : '';
  }
  return optimizeHtmlImages(out);
}

// Texto plano (para meta description / JSON-LD), recortado.
function plainText(html, max = 160) {
  const t = String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// --- Facebook Pixel (PageView) ---
// Inyecta el pixel SOLO para los pixels que la tienda marcó "mostrar en la web"
// (toggle por pixel en Conexiones → llegan en store.web_pixels desde /store/config).
// 100% aditivo y genérico por tienda: sin web_pixels devuelve '' y el <head> queda
// byte-idéntico al de hoy. Los pixels de WhatsApp/CAPI NO se incluyen (van en OFF).
function fbPixelHead(store) {
  const ids = Array.isArray(store && store.web_pixels) ? store.web_pixels.filter(Boolean) : [];
  if (ids.length === 0) return '';
  const inits = ids.map((id) => `fbq('init',${JSON.stringify(String(id))});`).join('');
  const firstId = encodeURIComponent(String(ids[0]));
  return `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');${inits}fbq('track','PageView');</script>
<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${firstId}&ev=PageView&noscript=1"/></noscript>`;
}

// --- Render de la pagina completa ---

export function renderStorePage({ store, products, bakedAt }) {
  const theme = store.theme_config || {};
  const title = store.name || 'Tienda';
  const list = products || [];
  const cards = list.map((p) => renderProductCard(p, store)).join('\n');
  const customHtml = optimizeHtmlImages((store.web_page_html || '').trim());

  // Chips de CATEGORIAS: solo si la tienda categoriza de verdad (>=2). Van
  // pegados a la grilla, asi viajan con el catalogo donde el editor lo ponga.
  const catCount = new Map();
  for (const p of list) {
    const k = normalizeCategory(p.category);
    if (!k) continue;
    if (!catCount.has(k)) {
      const raw = String(p.category).trim();
      catCount.set(k, { label: raw.charAt(0).toUpperCase() + raw.slice(1), n: 0 });
    }
    catCount.get(k).n += 1;
  }
  const cats = Array.from(catCount.entries()).sort((a, b) => b[1].n - a[1].n);
  const catsBar = cats.length >= 2
    ? `<nav class="cats" aria-label="Categorias">
        <button type="button" class="on" data-catbtn="">Todos</button>
        ${cats.map(([k, v]) => `<button type="button" data-catbtn="${esc(k)}">${esc(v.label)} <span class="cnt">(${v.n})</span></button>`).join('')}
      </nav>`
    : '';

  const grid = list.length
    ? `${catsBar}<section class="grid">${cards}</section>`
    : `<div class="empty">Esta tienda aun no tiene productos publicados.</div>`;

  // El web_page_html del editor trae el marcador <!--WB_CATALOG--> donde debe ir
  // el catalogo (igual que el storefront real de icomfly.com). Si existe, partimos
  // el HTML e insertamos la grilla ahi; si no, va al final. La pagina publicada
  // trae su propio diseno completo, asi que NO ponemos el hero/footer genericos.
  const MARKER = '<!--WB_CATALOG-->';
  let mainContent;
  if (customHtml && customHtml.includes(MARKER)) {
    const parts = customHtml.split(MARKER);
    mainContent = parts[0] + grid + parts.slice(1).join('');
  } else if (customHtml) {
    mainContent = customHtml + '\n' + grid;
  } else {
    mainContent = grid;
  }
  // Hero generico SOLO cuando la tienda no publico su propia pagina (fallback).
  const heroHtml = customHtml
    ? ''
    : `<header class="hero"><h1>${esc(title)}</h1>${store.description ? `<p>${esc(store.description)}</p>` : ''}</header>`;

  // Datos minimos para el carrito (id -> {name, price, image}) y la tienda.
  const productMap = buildProductMap(list);
  const storeJs = buildStoreJs(store);

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(store.description || title)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:type" content="website">
  ${store.logo_url ? `<link rel="icon" href="${esc(store.logo_url)}">` : ''}
  <style>${criticalCss(theme)}</style>
  ${fbPixelHead(store)}
</head>
<body>
  ${heroHtml}
  <main>
    ${mainContent}
  </main>
  <!-- baked: ${esc(bakedAt)} | ${list.length} productos -->

${cartShellHtml(store)}

  ${runtimeScripts(storeJs, productMap)}
</body>
</html>`;
}

// --- Render de la FICHA de producto (producto/<id>/index.html) ---
// Misma filosofia que la portada: HTML completo horneado, CSS inline, cero
// llamadas al backend para mostrarse. El carrito es el MISMO (localStorage del
// dominio), asi que agregar desde la ficha y volver a la portada conserva todo.

// Bloques "Diseno libre" (estilo Canva) POR PRODUCTO: lienzos free_canvas que el
// dueño ubica arriba/abajo de la ficha (placement product_top/product_bottom),
// guardados en product_page_customizations.sections_json.blocks y resueltos en
// product.page_customization por /api/public/products. El HTML ya viene
// pre-renderizado y con CSS acotado desde el admin (renderSectionHtml): aqui solo
// se inyecta. Aditivo y fail-safe: sin bloques devuelve '' (ficha igual que hoy).
function renderProductBlocks(product, placement) {
  const pc = (product && typeof product.page_customization === 'object') ? product.page_customization : null;
  const blocks = (pc && Array.isArray(pc.blocks)) ? pc.blocks : [];
  return blocks
    .filter((b) => b && b.enabled !== false && b.placement === placement && typeof b.html === 'string' && b.html)
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
    .map((b) => `<div class="pp-freeblock" style="margin:18px 0">${b.html}</div>`)
    .join('\n');
}

export function renderProductPage({ store, product, products, bakedAt }) {
  const theme = store.theme_config || {};
  const storeName = store.name || 'Tienda';
  const imgs = (Array.isArray(product.images) ? product.images : [])
    .filter((u) => typeof u === 'string' && u.startsWith('http'));
  const mainImg = imgs[0] || '';
  const price = formatPrice(product.price, store);
  const hasCompare =
    product.compare_price && Number(product.compare_price) > Number(product.price);
  const compare = hasCompare ? formatPrice(product.compare_price, store) : '';

  // Personalización de la ficha (theme_config.product_page) con los MISMOS
  // defaults que la SPA (src/components/product/ProductInfo.jsx). Si no hay
  // config, se ve exactamente como la product page React por defecto.
  const cfg = (theme && typeof theme.product_page === 'object' && theme.product_page) || {};
  const secCfg = (cfg.sections && typeof cfg.sections === 'object') ? cfg.sections : {};
  const showDiscountBadge = secCfg.discountBadge !== false;
  const defaultBenefits = [
    { icon: '📦', text: 'Puedes revisar tu pedido antes de pagar' },
    { icon: '💡', text: 'Garantía de 1 año' },
    { icon: '🚚', text: 'Envió gratis' },
  ];
  const benefits = (Array.isArray(cfg.benefits) && cfg.benefits.length) ? cfg.benefits : defaultBenefits;
  const ctaText = (cfg.cta && typeof cfg.cta.text === 'string' && cfg.cta.text.trim()) ? cfg.cta.text : '¡PIDE CONTRA ENTREGA AQUÍ!';
  const ctaColor = (cfg.cta && typeof cfg.cta.color === 'string' && cfg.cta.color.trim()) ? cfg.cta.color : '';
  const ctaStyle = ctaColor
    ? `background:${esc(ctaColor)};box-shadow:0 4px 15px ${esc(ctaColor)}66;color:#fff`
    : 'background:linear-gradient(135deg,#00FF85 0%,#00E676 50%,#00C853 100%);box-shadow:0 4px 15px rgba(0,255,133,.4);color:#000';

  // "Ahorra $X" en badge NEGRO, igual que la SPA (no "-NN%").
  const savings = hasCompare ? formatPrice(Number(product.compare_price) - Number(product.price), store) : '';

  // Rating: 5 estrellas (llenas según rating) + contador de reseñas, como
  // RatingStars + "N reseñas" de la SPA (siempre visible, incluso con 0).
  const rating = Number(product.rating);
  const reviews = Number(product.reviews_count) || 0;
  const full = Number.isFinite(rating) ? Math.max(0, Math.min(5, Math.round(rating))) : 0;
  const starsHtml = `<span class="pp-stars" aria-label="${full} de 5">${'★'.repeat(full)}<span class="soff">${'★'.repeat(5 - full)}</span></span>`;
  const ratingHtml = `<div class="pp-rrow">${starsHtml}<span class="pp-rcount">${reviews} reseña${reviews === 1 ? '' : 's'}</span></div>`;

  const descHtml = sanitizeDescription(product.description || '');
  const metaDesc = plainText(product.description || '', 160) || `${product.name} en ${storeName}`;

  // Lienzos "Diseno libre" propios de ESTE producto (arriba/abajo de la ficha).
  const blocksTop = renderProductBlocks(product, 'product_top');
  const blocksBottom = renderProductBlocks(product, 'product_bottom');

  // Galería con swipe (scroll-snap) + dots + thumbnails desktop, espejo de
  // src/components/product/ProductGallery.jsx.
  const slides = imgs.length
    ? imgs.map((u, i) =>
        `<div class="ppg-slide"><img src="${esc(cdnImage(u, 900, 80))}" alt="${esc(product.name)} - Imagen ${i + 1}" ${i === 0 ? 'decoding="sync" fetchpriority="high"' : 'loading="lazy" decoding="async"'} draggable="false" onerror="this.onerror=null;this.src='${esc(u)}'"></div>`
      ).join('')
    : '<div class="ppg-noimg">Sin imagen</div>';
  const dots = imgs.length > 1
    ? `<div class="ppg-dots" id="ppgDots">${imgs.map((_, i) => `<button type="button" class="${i === 0 ? 'on' : ''}" aria-label="Ir a imagen ${i + 1}"></button>`).join('')}</div>`
    : '';
  const thumbs = imgs.length > 1
    ? `<div class="ppg-thumbs" id="ppgThumbs">${imgs.map((u, i) =>
        `<button type="button" class="${i === 0 ? 'on' : ''}" aria-label="Ver imagen ${i + 1}"><img src="${esc(cdnImage(u, 128, 70))}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${esc(u)}'"></button>`
      ).join('')}</div>`
    : '';
  const cartSvg = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>';

  // SEO: JSON-LD de producto (la Edge es la variante orientada a velocidad/SEO).
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    image: imgs,
    description: plainText(product.description || '', 500),
    offers: {
      '@type': 'Offer',
      price: Number(product.price) || 0,
      priceCurrency: store.currency || 'COP',
      availability: 'https://schema.org/InStock',
    },
  };
  if (Number.isFinite(rating) && rating > 0 && reviews > 0) {
    jsonLd.aggregateRating = { '@type': 'AggregateRating', ratingValue: rating, reviewCount: reviews };
  }

  const storeJs = buildStoreJs(store);
  // Mapa COMPLETO de productos: el drawer muestra bien items agregados desde
  // otras paginas (portada u otras fichas).
  const productMap = buildProductMap(products && products.length ? products : [product]);

  // Galería: sincroniza dots/thumbs con el scroll-snap (requestAnimationFrame
  // como ProductGallery.jsx para evitar forced reflow). Sin dependencias.
  const galleryScript = [
    '(function(){',
    '  var tr=document.getElementById("ppgTrack"); if(!tr) return;',
    '  var dots=document.querySelectorAll("#ppgDots button");',
    '  var ths=document.querySelectorAll("#ppgThumbs button");',
    '  function setOn(i){',
    '    var k;for(k=0;k<dots.length;k++){dots[k].classList.toggle("on",k===i);}',
    '    for(k=0;k<ths.length;k++){ths[k].classList.toggle("on",k===i);}',
    '  }',
    '  tr.addEventListener("scroll",function(){',
    '    window.requestAnimationFrame(function(){',
    '      if(!tr.offsetWidth) return;',
    '      setOn(Math.round(tr.scrollLeft/tr.offsetWidth));',
    '    });',
    '  });',
    '  function go(i){tr.scrollTo({left:tr.offsetWidth*i,behavior:"smooth"});setOn(i);}',
    '  function bind(list){var k;for(k=0;k<list.length;k++){(function(i){list[i].addEventListener("click",function(){go(i);});})(k);}}',
    '  bind(dots);bind(ths);',
    '})();',
  ].join('\n');

  // Diseño libre de PÁGINA COMPLETA por producto: si está activo, su lienzo
  // REEMPLAZA la ficha estándar (galería/precio/botón/descripción). Se conserva
  // el <head> (SEO/JSON-LD) y SIEMPRE se añade una barra de compra flotante + el
  // carrito, así la venta nunca depende del diseño. Lee de page_customization
  // directo (no del cfg) para no depender del merge per-product.
  const pageCust = (product && typeof product.page_customization === 'object') ? product.page_customization : null;
  const fullPage = (pageCust && pageCust.fullPage && pageCust.fullPage.enabled !== false
    && typeof pageCust.fullPage.html === 'string' && pageCust.fullPage.html) ? pageCust.fullPage : null;

  const buyBar = fullPage
    ? `<div class="pp-buybar" style="position:fixed;left:0;right:0;bottom:0;z-index:45;background:#fff;box-shadow:0 -4px 20px rgba(0,0,0,.14);padding:10px 14px;display:flex;align-items:center;gap:12px;justify-content:center;flex-wrap:wrap">
      <div style="display:flex;flex-direction:column;line-height:1.05">
        <span style="font-weight:800;font-size:18px;color:#111">${esc(price)}</span>
        ${showDiscountBadge && compare ? `<span style="font-size:12px;color:#888;text-decoration:line-through">${esc(compare)}</span>` : ''}
      </div>
      <button class="pp-cta" type="button" data-buy="${esc(product.id)}" style="${ctaStyle}">${cartSvg}${esc(ctaText)}</button>
    </div>`
    : '';

  // En modo página completa, un botón "Comprar" del lienzo (href #comprar/#buy)
  // dispara la compra REAL reusando el botón de la barra flotante (data-buy).
  // Delegado en document → funciona sin importar cuándo se monte el elemento.
  const fullPageBuyScript = fullPage
    ? `<script>(function(){document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href*="#comprar"],a[href*="#buy"]');if(!a)return;e.preventDefault();var b=document.querySelector('.pp-buybar [data-buy]');if(b){b.click();}},true);})();</script>`
    : '';

  let mainInner;
  if (fullPage) {
    mainInner = `${fullPage.html}<div style="height:96px" aria-hidden="true"></div>`;
  } else {
    mainInner = `${blocksTop}
    <div class="pp2">
      <section class="ppg">
        <div class="ppg-stage">
          <div class="ppg-track" id="ppgTrack">${slides}</div>
          ${dots}
        </div>
        ${thumbs}
      </section>
      <section class="pp-info pp-info2">
        <h1>${esc(product.name)}</h1>
        ${ratingHtml}
        <div class="pp-prices2">
          <span class="pp-price2">${esc(price)}</span>
          ${showDiscountBadge && compare ? `<span class="pp-compare2">${esc(compare)}</span><span class="pp-save">Ahorra ${esc(savings)}</span>` : ''}
        </div>
        <div class="pp-bens">
          ${benefits.map((b) => `<div><span>${esc((b && b.icon) || '')}</span><span>${esc((b && b.text) || '')}</span></div>`).join('')}
        </div>
        <button class="pp-cta" type="button" data-buy="${esc(product.id)}" style="${ctaStyle}">${cartSvg}${esc(ctaText)}</button>
      </section>
    </div>
    ${descHtml ? `<div class="pp-desc2">${descHtml}</div>` : ''}
    ${blocksBottom}`;
  }

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(product.name)} — ${esc(storeName)}</title>
  <meta name="description" content="${esc(metaDesc)}">
  <meta property="og:title" content="${esc(product.name)}">
  <meta property="og:type" content="product">
  ${mainImg ? `<meta property="og:image" content="${esc(mainImg)}">` : ''}
  ${store.logo_url ? `<link rel="icon" href="${esc(store.logo_url)}">` : ''}
  <link rel="canonical" href="../${esc(productPath(product))}/">
  <style>${criticalCss(theme)}</style>
  <script type="application/ld+json">${safeJson(jsonLd)}</script>
  ${fbPixelHead(store)}
</head>
<body class="pp-page">
  <nav class="pp-top">
    <a href="../../">← Volver a ${esc(storeName)}</a>
  </nav>
  <main class="pp-wrap"${fullPage ? ' style="max-width:none;padding:0"' : ''}>
    ${mainInner}
  </main>
  ${buyBar}
  <!-- baked: ${esc(bakedAt)} | producto ${esc(product.id)} -->

${cartShellHtml(store)}

  ${runtimeScripts(storeJs, productMap)}
  <script>${galleryScript}</script>
  ${fullPageBuyScript}
</body>
</html>`;
}
