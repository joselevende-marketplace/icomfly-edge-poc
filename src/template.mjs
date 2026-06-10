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
  return html.replace(/https?:\/\/(?:cdn\.shopify\.com|pub-[a-z0-9]+\.r2\.dev)\/[^\s"')]+/gi, (url) => {
    if (url.includes('/cdn-cgi/')) return url;               // ya optimizada
    if (!/\.(?:jpe?g|png|webp)(?:$|\?)/i.test(url)) return url; // solo raster
    return `https://myicomfly.com/cdn-cgi/image/width=1000,quality=75,format=auto/${url}`;
  });
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

  // Link RELATIVO a la ficha horneada (producto/<id>/). Relativo para que
  // funcione igual via Worker (tienda.myicomfly.com/producto/1/) y accediendo
  // directo a Pages (.../<slug>/producto/1/). La imagen y el titulo navegan a
  // la ficha; el boton sigue agregando al carrito sin salir de la pagina.
  const href = `producto/${esc(product.id)}/`;

  return `
      <article class="card">
        <a class="card-link" href="${href}" aria-label="${esc(product.name)}">
          <div class="card-img">${discountBadge}${imgTag}</div>
        </a>
        <div class="card-body">
          <h3 class="card-title"><a class="card-link" href="${href}">${esc(product.name)}</a></h3>
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
    /* Checkout por formulario (drawer) */
    .dview{flex:1;display:flex;flex-direction:column;min-height:0}
    .co{overflow:auto;padding:14px 18px;display:block}
    .co label{font-size:.8rem;font-weight:700;color:var(--muted)}
    .co input{width:100%;padding:11px 12px;border:1px solid #d8dee8;border-radius:10px;margin:4px 0 12px;font-size:.95rem;font-family:inherit}
    .co input.bad{border-color:#e11d48}
    .co-error{background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;border-radius:10px;padding:10px 12px;font-size:.85rem;margin-bottom:10px}
    .co-submit{margin-top:2px}
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
    '  var API="https://api.icomfly.com/api";',
    '  function view(name){',
    '    var ids=["cartView","coView","doneView"];',
    '    for(var i=0;i<ids.length;i++){var el=document.getElementById(ids[i]);if(el){el.style.display=(ids[i]===name)?"":"none";}}',
    '  }',
    '  function open(){view("cartView");bg.classList.add("open");dr.classList.add("open");}',
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
    // CHECKOUT POR FORMULARIO (Fase 2c): crea la orden REAL en iComfly via',
    // POST /api/orders (el backend deduce el store por el producto). WhatsApp
    // pasa a ser un boton OPCIONAL en la pantalla de confirmacion.
    '  function checkout(){',
    '    var c=get(); if(Object.keys(c).length===0){return;}',
    '    view("coView");',
    '  }',
    '  function summary(){',
    '    var c=get(),keys=Object.keys(c),parts=[];',
    '    for(var i=0;i<keys.length;i++){var p=map(keys[i]);parts.push(c[keys[i]]+"x "+p.name);}',
    '    return parts.join(", ");',
    '  }',
    '  function buildPayload(d){',
    '    var c=get(),keys=Object.keys(c),items=[],tot=0;',
    '    for(var i=0;i<keys.length;i++){var id=keys[i],p=map(id),q=c[id];tot+=p.price*q;',
    '      items.push({id:isNaN(Number(id))?id:Number(id),name:p.name,price:p.price,originalPrice:p.price,quantity:q,image:p.image||null});}',
    '    var main={id:items[0].id,name:(items.length>1?("Pedido de "+items.length+" productos"):items[0].name),price:tot};',
    '    return {orderNumber:"#"+(Math.floor(Math.random()*90000)+10000),product:main,products:items,quantity:1,subtotal:tot,shippingCost:0,total:tot,shippingOption:"standard",paymentMethod:"Contra Entrega",status:"Confirmado",customer:d,isCartOrder:true,itemsCount:items.length,source:"edge_storefront"};',
    '  }',
    '  function fieldVal(id){var el=document.getElementById(id);return el?el.value.replace(/^\\s+|\\s+$/g,""):"";}',
    '  function markBad(id,bad){var el=document.getElementById(id);if(el){el.className=bad?"bad":"";}}',
    '  function submitOrder(ev){',
    '    ev.preventDefault();',
    '    var name=fieldVal("coName"),phone=fieldVal("coPhone"),addr=fieldVal("coAddr"),dept=fieldVal("coDept"),city=fieldVal("coCity");',
    '    var digits=phone.replace(/\\D/g,"");',
    '    var ok=true;',
    '    markBad("coName",!name); if(!name){ok=false;}',
    '    markBad("coPhone",digits.length<7); if(digits.length<7){ok=false;}',
    '    markBad("coAddr",!addr); if(!addr){ok=false;}',
    '    markBad("coDept",!dept); if(!dept){ok=false;}',
    '    markBad("coCity",!city); if(!city){ok=false;}',
    '    var err=document.getElementById("coError");',
    '    if(!ok){err.style.display="block";err.textContent="Completa los campos marcados para crear tu pedido.";return;}',
    '    err.style.display="none";',
    '    var btn=document.getElementById("coSubmit");btn.disabled=true;var prev=btn.textContent;btn.textContent="Creando tu pedido...";',
    '    var d={fullName:name,phone:phone,whatsapp:phone,address:addr,department:dept,city:city,email:""};',
    '    var resumen=summary(); var totalTxt=fmt(total());',
    '    var body=buildPayload(d);',
    '    fetch(API+"/orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})',
    '      .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};}).catch(function(){return {ok:false,j:null};});})',
    '      .then(function(res){',
    '        btn.disabled=false;btn.textContent=prev;',
    '        if(!res.ok||!res.j||res.j.success===false){',
    '          var m=(res.j&&res.j.message)||"No pudimos crear tu pedido. Intenta de nuevo.";',
    '          err.style.display="block";err.textContent=m;return;',
    '        }',
    '        var num=String((res.j.data&&res.j.data.order_number)||body.orderNumber).replace(/^#/,"");',
    '        localStorage.removeItem(KEY); render();',
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
    '      .catch(function(){btn.disabled=false;btn.textContent=prev;err.style.display="block";err.textContent="Sin conexion. Revisa tu internet e intenta de nuevo.";});',
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
    '    else if(t.id==="coBack"){view("cartView");}',
    '    else if(t.id==="doneClose"){view("cartView");close();}',
    '  });',
    '  var coForm=document.getElementById("coForm"); if(coForm){coForm.addEventListener("submit",submitOrder);}',
    '  render();',
    '})();',
  ].join('\n');
}

// --- Piezas COMPARTIDAS entre la portada y las fichas de producto ---
// (mismo carrito/drawer en todas las paginas: el localStorage es por dominio,
// asi que el carrito sobrevive al navegar entre portada y fichas)

function buildProductMap(list) {
  const productMap = {};
  for (const p of list || []) {
    productMap[p.id] = {
      name: p.name,
      price: Number(p.price) || 0,
      image: firstImage(p),
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
  };
}

function cartShellHtml() {
  return `
  <button id="cartFab" class="cart-fab" type="button">🛒 Carrito <span id="cartCount" class="count">0</span></button>
  <div id="drawerBg" class="drawer-bg"></div>
  <aside id="drawer" class="drawer" aria-label="Carrito">
    <h2>Tu carrito <button id="cartClose" class="close" type="button">&times;</button></h2>
    <div id="cartView" class="dview">
      <div id="cartItems" class="items"></div>
      <div class="foot">
        <div class="total"><span>Total</span><span id="cartTotal">$0</span></div>
        <button id="cartCheckout" class="wa" type="button">Finalizar pedido</button>
      </div>
    </div>
    <div id="coView" class="dview co" style="display:none">
      <form id="coForm" novalidate>
        <label for="coName">Nombre completo</label>
        <input id="coName" type="text" autocomplete="name" placeholder="Tu nombre y apellido">
        <label for="coPhone">Celular / WhatsApp</label>
        <input id="coPhone" type="tel" autocomplete="tel" inputmode="tel" placeholder="3001234567">
        <label for="coAddr">Direcci&oacute;n exacta</label>
        <input id="coAddr" type="text" autocomplete="street-address" placeholder="Calle 1 # 2-34, barrio">
        <label for="coDept">Departamento</label>
        <input id="coDept" type="text" placeholder="Cundinamarca">
        <label for="coCity">Ciudad</label>
        <input id="coCity" type="text" autocomplete="address-level2" placeholder="Bogot&aacute;">
        <div id="coError" class="co-error" style="display:none"></div>
        <button id="coSubmit" class="wa co-submit" type="submit">Confirmar pedido — pago contra entrega</button>
        <button id="coBack" class="co-back" type="button">&larr; Volver al carrito</button>
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
  return `<script>window.__STORE__=${JSON.stringify(storeJs)};window.__PRODUCTS__=${JSON.stringify(productMap)};</script>
  <script>${hydrationScript()}</script>`;
}

// Descripcion del producto: viene del editor de la tienda (HTML propio). Se
// inyecta quitando <script> y handlers inline (defensa minima, mismo criterio
// que el web_page_html). Si es texto plano, se convierte saltos en <br>.
function sanitizeDescription(html) {
  if (typeof html !== 'string' || !html.trim()) return '';
  let out = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  if (!/[<>]/.test(out)) out = esc(out).replace(/\r?\n/g, '<br>');
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

// --- Render de la pagina completa ---

export function renderStorePage({ store, products, bakedAt }) {
  const theme = store.theme_config || {};
  const title = store.name || 'Tienda';
  const list = products || [];
  const cards = list.map((p) => renderProductCard(p, store)).join('\n');
  const customHtml = optimizeHtmlImages((store.web_page_html || '').trim());

  const grid = list.length
    ? `<section class="grid">${cards}</section>`
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
</head>
<body>
  ${heroHtml}
  <main>
    ${mainContent}
  </main>
  <!-- baked: ${esc(bakedAt)} | ${list.length} productos -->

${cartShellHtml()}

  ${runtimeScripts(storeJs, productMap)}
</body>
</html>`;
}

// --- Render de la FICHA de producto (producto/<id>/index.html) ---
// Misma filosofia que la portada: HTML completo horneado, CSS inline, cero
// llamadas al backend para mostrarse. El carrito es el MISMO (localStorage del
// dominio), asi que agregar desde la ficha y volver a la portada conserva todo.

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
  let pct = 0;
  if (hasCompare) {
    pct = Math.round((1 - Number(product.price) / Number(product.compare_price)) * 100);
  }

  const rating = Number(product.rating);
  const reviews = Number(product.reviews_count) || 0;
  const ratingHtml = Number.isFinite(rating) && rating > 0
    ? `<div class="pp-rating">★ ${rating.toFixed(1)}${reviews ? ` · ${reviews} reseña${reviews === 1 ? '' : 's'}` : ''}</div>`
    : '';

  const descHtml = sanitizeDescription(product.description || '');
  const metaDesc = plainText(product.description || '', 160) || `${product.name} en ${storeName}`;

  // Galeria: imagen principal + miniaturas (swap con un JS minimo, sin deps).
  const mainTag = mainImg
    ? `<img id="ppMain" class="pp-main" src="${esc(cdnImage(mainImg, 900, 80))}" alt="${esc(product.name)}" decoding="async" onerror="this.onerror=null;this.src='${esc(mainImg)}'">`
    : `<div class="pp-main noimg">Sin imagen</div>`;
  const thumbs = imgs.length > 1
    ? `<div class="pp-thumbs">${imgs.map((u, i) =>
        `<img src="${esc(cdnImage(u, 128, 70))}" data-full="${esc(cdnImage(u, 900, 80))}" data-orig="${esc(u)}" alt="" class="${i === 0 ? 'active' : ''}" loading="lazy" onerror="this.onerror=null;this.src='${esc(u)}'">`
      ).join('')}</div>`
    : '';

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

  const galleryScript = [
    'document.addEventListener("click",function(e){',
    '  var t=e.target; if(!t || !t.closest) return;',
    '  var th=t.closest(".pp-thumbs img"); if(!th) return;',
    '  var m=document.getElementById("ppMain"); if(!m) return;',
    '  m.onerror=function(){m.onerror=null;m.src=th.getAttribute("data-orig")||th.src;};',
    '  m.src=th.getAttribute("data-full")||th.src;',
    '  var all=document.querySelectorAll(".pp-thumbs img");',
    '  for(var i=0;i<all.length;i++){all[i].classList.remove("active");}',
    '  th.classList.add("active");',
    '});',
  ].join('\n');

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
  <style>${criticalCss(theme)}</style>
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
  <nav class="pp-top">
    <a href="../../">← Volver a ${esc(storeName)}</a>
  </nav>
  <main class="pp">
    <section class="pp-gallery">
      ${mainTag}
      ${thumbs}
    </section>
    <section class="pp-info">
      <h1>${esc(product.name)}</h1>
      ${ratingHtml}
      <div class="pp-prices">
        <span class="pp-price">${esc(price)}</span>
        ${compare ? `<span class="pp-compare">${esc(compare)}</span>` : ''}
        ${pct > 0 ? `<span class="pp-badge">-${pct}%</span>` : ''}
      </div>
      <button class="pp-buy" type="button" data-add="${esc(product.id)}">Agregar al carrito</button>
      ${descHtml ? `<div class="pp-desc">${descHtml}</div>` : ''}
    </section>
  </main>
  <!-- baked: ${esc(bakedAt)} | producto ${esc(product.id)} -->

${cartShellHtml()}

  ${runtimeScripts(storeJs, productMap)}
  <script>${galleryScript}</script>
</body>
</html>`;
}
