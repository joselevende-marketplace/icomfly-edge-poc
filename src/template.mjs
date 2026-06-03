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
    ? `<img src="${esc(img)}" alt="${esc(product.name)}" loading="lazy" decoding="async" width="400" height="400">`
    : `<div class="noimg">Sin imagen</div>`;

  return `
      <article class="card">
        <div class="card-img">${discountBadge}${imgTag}</div>
        <div class="card-body">
          <h3 class="card-title">${esc(product.name)}</h3>
          <div class="card-prices">
            <span class="price">${esc(price)}</span>
            ${compare ? `<span class="compare">${esc(compare)}</span>` : ''}
          </div>
          <button class="buy" type="button" data-add="${esc(product.id)}">Agregar al carrito</button>
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
  `.trim();
}

// --- JS de hidratacion (carrito + checkout WhatsApp) ---
// Escrito SIN backticks ni ${...} para poder incrustarlo en el template literal.

function hydrationScript() {
  return [
    '(function(){',
    "  var KEY='ico_cart_v1';",
    '  var S=window.__STORE__||{}; var P=window.__PRODUCTS__||{};',
    '  var bg=document.getElementById("drawerBg"), dr=document.getElementById("drawer");',
    '  function map(id){return P[id]||{name:"Producto",price:0,image:""};}',
    '  function fmt(n){try{return new Intl.NumberFormat(S.locale||"es-CO",{style:"currency",currency:S.currency||"COP",maximumFractionDigits:0}).format(n);}catch(e){return (S.symbol||"$")+Math.round(n).toLocaleString("es-CO");}}',
    '  function get(){try{return JSON.parse(localStorage.getItem(KEY))||{};}catch(e){return {};}}',
    '  function save(c){localStorage.setItem(KEY,JSON.stringify(c));render();}',
    '  function add(id){var c=get();c[id]=(c[id]||0)+1;save(c);open();}',
    '  function setQ(id,q){var c=get();if(q<=0){delete c[id];}else{c[id]=q;}save(c);}',
    '  function count(){var c=get(),n=0;for(var k in c){n+=c[k];}return n;}',
    '  function total(){var c=get(),t=0;for(var k in c){t+=map(k).price*c[k];}return t;}',
    '  function open(){bg.classList.add("open");dr.classList.add("open");}',
    '  function close(){bg.classList.remove("open");dr.classList.remove("open");}',
    '  function render(){',
    '    var fab=document.getElementById("cartCount"); if(fab){fab.textContent=count();}',
    '    var items=document.getElementById("cartItems"); var c=get(); var keys=Object.keys(c);',
    '    if(!items)return;',
    '    if(keys.length===0){items.innerHTML="<div class=\\"cart-empty\\">Tu carrito esta vacio</div>";}',
    '    else{var html="";for(var i=0;i<keys.length;i++){var id=keys[i],p=map(id),q=c[id];',
    '      html+="<div class=\\"ci\\"><img src=\\""+(p.image||"")+"\\" alt=\\"\\"><div class=\\"info\\"><div>"+p.name+"</div><div>"+fmt(p.price)+"</div>"',
    '        +"<div class=\\"qty\\"><button data-dec=\\""+id+"\\">-</button><span>"+q+"</span><button data-inc=\\""+id+"\\">+</button><button data-rm=\\""+id+"\\" style=\\"margin-left:auto\\">x</button></div></div></div>";}',
    '      items.innerHTML=html;}',
    '    var tot=document.getElementById("cartTotal"); if(tot){tot.textContent=fmt(total());}',
    '  }',
    '  function checkout(){',
    '    var c=get(),keys=Object.keys(c); if(keys.length===0){return;}',
    '    var msg="Hola "+(S.name||"")+", quiero pedir:\\n";',
    '    for(var i=0;i<keys.length;i++){var p=map(keys[i]);msg+="- "+p.name+" x"+c[keys[i]]+" ("+fmt(p.price)+")\\n";}',
    '    msg+="Total: "+fmt(total());',
    '    var wa=(S.whatsapp||"").replace(/[^0-9]/g,"");',
    '    var url = wa ? ("https://wa.me/"+wa+"?text="+encodeURIComponent(msg)) : ("https://wa.me/?text="+encodeURIComponent(msg));',
    '    window.open(url,"_blank");',
    '  }',
    '  document.addEventListener("click",function(e){',
    '    var t=e.target;',
    '    if(t.dataset.add){add(t.dataset.add);}',
    '    else if(t.dataset.inc){setQ(t.dataset.inc,(get()[t.dataset.inc]||0)+1);}',
    '    else if(t.dataset.dec){setQ(t.dataset.dec,(get()[t.dataset.dec]||0)-1);}',
    '    else if(t.dataset.rm){setQ(t.dataset.rm,0);}',
    '    else if(t.id==="cartFab"){open();}',
    '    else if(t.id==="drawerBg"||t.id==="cartClose"){close();}',
    '    else if(t.id==="cartCheckout"){checkout();}',
    '  });',
    '  render();',
    '})();',
  ].join('\n');
}

// --- Render de la pagina completa ---

export function renderStorePage({ store, products, bakedAt }) {
  const theme = store.theme_config || {};
  const title = store.name || 'Tienda';
  const list = products || [];
  const cards = list.map((p) => renderProductCard(p, store)).join('\n');
  const customHtml = (store.web_page_html || '').trim();

  const grid = list.length
    ? `<section class="grid">${cards}</section>`
    : `<div class="empty">Esta tienda aun no tiene productos publicados.</div>`;

  // Datos minimos para el carrito (id -> {name, price, image}) y la tienda.
  const productMap = {};
  for (const p of list) {
    productMap[p.id] = {
      name: p.name,
      price: Number(p.price) || 0,
      image: firstImage(p),
    };
  }
  const storeJs = {
    name: store.name || '',
    whatsapp: (store.contact && store.contact.whatsapp) || store.whatsapp || '',
    currency: store.currency || 'COP',
    symbol: store.currency_symbol || '$',
    locale: store.currency_locale || 'es-CO',
  };

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
</head>
<body>
  <header class="hero">
    <h1>${esc(title)}</h1>
    ${store.description ? `<p>${esc(store.description)}</p>` : ''}
  </header>
  <main>
    ${customHtml ? `<section class="custom-html">${customHtml}</section>` : ''}
    ${grid}
  </main>
  <footer class="ico">
    <div>Powered by iComfly Edge</div>
    <div class="meta">Pagina horneada: ${esc(bakedAt)} &middot; ${list.length} productos &middot; Sin dependencia del backend para renderizar</div>
  </footer>

  <button id="cartFab" class="cart-fab" type="button">🛒 Carrito <span id="cartCount" class="count">0</span></button>
  <div id="drawerBg" class="drawer-bg"></div>
  <aside id="drawer" class="drawer" aria-label="Carrito">
    <h2>Tu carrito <button id="cartClose" class="close" type="button">&times;</button></h2>
    <div id="cartItems" class="items"></div>
    <div class="foot">
      <div class="total"><span>Total</span><span id="cartTotal">$0</span></div>
      <button id="cartCheckout" class="wa" type="button">Finalizar pedido por WhatsApp</button>
    </div>
  </aside>

  <script>window.__STORE__=${JSON.stringify(storeJs)};window.__PRODUCTS__=${JSON.stringify(productMap)};</script>
  <script>${hydrationScript()}</script>
</body>
</html>`;
}
