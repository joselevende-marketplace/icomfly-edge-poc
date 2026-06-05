/**
 * BAKE (Horneador) — Fase 0 / prueba de concepto
 * ------------------------------------------------
 * Toma el slug de UNA tienda, lee su configuracion y sus productos desde las
 * APIs PUBLICAS de iComfly (solo lectura, sin tocar nada), y genera una pagina
 * HTML estatica autocontenida en dist/<slug>/index.html.
 *
 * Esto NO modifica iComfly. Solo CONSUME sus endpoints publicos. Es el paso que
 * en produccion correria automaticamente cada vez que una tienda guarda cambios.
 *
 * Uso:
 *   node bake.mjs                 -> hornea el slug por defecto (joselevende)
 *   node bake.mjs mitienda        -> hornea el slug "mitienda"
 *   API_BASE=... node bake.mjs    -> apunta a otra API (default api.icomfly.com)
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderStorePage } from './src/template.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const API_BASE = process.env.API_BASE || 'https://api.icomfly.com/api';
// argv[2] = SUBDOMINIO = carpeta de salida dist/<subdomain>/ (lo que el Worker
// comodin rutea como <subdomain>.myicomfly.com). Puede diferir del slug real.
const slug = (process.argv[2] || 'joselevende').trim();
// CONFIG_SLUG = slug REAL de la tienda para leer su config/tema desde la API.
// Si la tienda eligio un subdominio distinto de su slug, el folder es el
// subdominio pero la config se busca por el slug real. Default: el mismo arg.
const configSlug = (process.env.CONFIG_SLUG || slug).trim();
const PRODUCT_LIMIT = Number(process.env.PRODUCT_LIMIT || 40);

function log(msg) {
  console.log(`[bake] ${msg}`);
}

async function fetchJson(url, label) {
  const t0 = performance.now();
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  const ms = (performance.now() - t0).toFixed(0);
  if (!res.ok) {
    throw new Error(`${label} respondio ${res.status} (${url})`);
  }
  const data = await res.json();
  log(`${label}: OK en ${ms}ms`);
  return data;
}

async function main() {
  log(`API_BASE = ${API_BASE}`);

  // STORE_ID override: util cuando el slug publico no es el que tiene catalogo
  // (algunas tiendas tienen el catalogo en otro store_id). Si se pasa STORE_ID,
  // horneamos los productos de ESE id y usamos el config del slug solo para tema.
  const overrideId = process.env.STORE_ID ? Number(process.env.STORE_ID) : null;
  log(`Horneando subdominio="${slug}" (config slug="${configSlug}")${overrideId ? ` (store_id override=${overrideId})` : ''} ...`);

  // 1. Config de la tienda (igual que hace el frontend real al resolver el dominio).
  //    Se busca por el SLUG REAL (configSlug), no por el subdominio de salida.
  //    Si el slug no resuelve y hay override, seguimos con un store minimo por defecto.
  let store = null;
  try {
    store = await fetchJson(
      `${API_BASE}/public/store/config?slug=${encodeURIComponent(configSlug)}`,
      'store/config'
    );
  } catch (e) {
    log(`store/config no disponible (${e.message})`);
  }
  if ((!store || !store.id) && !overrideId) {
    throw new Error(`No se encontro tienda para slug="${configSlug}" (y no hay STORE_ID override)`);
  }
  if (!store) store = {};
  // Defaults razonables para que el render siempre funcione.
  // Overrides por env (utiles para el demo): CURRENCY, CURRENCY_SYMBOL,
  // CURRENCY_LOCALE, WHATSAPP, STORE_NAME.
  store = {
    name: process.env.STORE_NAME || store.name || slug,
    description: store.description || null,
    logo_url: store.logo_url || null,
    theme_config: store.theme_config || {},
    currency: process.env.CURRENCY || store.currency || 'COP',
    currency_symbol: process.env.CURRENCY_SYMBOL || store.currency_symbol || '$',
    currency_locale: process.env.CURRENCY_LOCALE || store.currency_locale || 'es-CO',
    web_page_html: store.web_page_html || '',
    web_sections: store.web_sections || [],
    contact: { ...(store.contact || {}), whatsapp: process.env.WHATSAPP || (store.contact && store.contact.whatsapp) || store.whatsapp || '' },
    id: store.id,
  };

  // 2. Productos: por override o por el id resuelto del config
  const productsStoreId = overrideId || store.id;
  log(`Tienda: "${store.name}" (productos de store_id=${productsStoreId}, ${store.currency})`);
  const products = await fetchJson(
    `${API_BASE}/public/products?store_id=${productsStoreId}&limit=${PRODUCT_LIMIT}`,
    'products'
  );
  log(`Productos recibidos: ${Array.isArray(products) ? products.length : 0}`);

  // 3. Hornear el HTML (cero llamadas al backend en runtime del cliente)
  const bakedAt = new Date().toISOString();
  const html = renderStorePage({ store, products, bakedAt });

  // 4. Escribir a dist/<slug>/index.html
  const outDir = join(__dirname, 'dist', slug);
  await mkdir(outDir, { recursive: true });
  const outFile = join(outDir, 'index.html');
  await writeFile(outFile, html, 'utf8');

  // 5. Guardar un manifiesto para auditoria/medicion
  await writeFile(
    join(outDir, 'meta.json'),
    JSON.stringify(
      {
        slug,                    // = subdominio (carpeta de salida / ruta del Worker)
        config_slug: configSlug, // slug real de la tienda en iComfly
        store_id: productsStoreId,
        store_name: store.name,
        products: Array.isArray(products) ? products.length : 0,
        bytes_html: Buffer.byteLength(html, 'utf8'),
        baked_at: bakedAt,
        api_base: API_BASE,
      },
      null,
      2
    ),
    'utf8'
  );

  log(`LISTO -> ${outFile}`);
  log(`Tamano HTML: ${(Buffer.byteLength(html, 'utf8') / 1024).toFixed(1)} KB`);
  log(`Abrelo en el navegador o despliega la carpeta dist/ a Cloudflare Pages.`);
}

main().catch((err) => {
  console.error(`[bake] ERROR: ${err.message}`);
  process.exit(1);
});
