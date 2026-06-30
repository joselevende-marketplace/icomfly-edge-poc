import { renderStorePage, renderProductPage } from './src/template.mjs';

// Prueba de aceptacion del fix "Buscador del lienzo libre" (Neox-Fix #781): la lupa
// decorativa del encabezado en modo "diseno libre" (chrome.layout='free', store 11)
// debe quedar cableada al buscador. Portada: filtra el catalogo (?q= pre-filtra al
// llegar de una ficha). Ficha: Enter lleva a la portada con ?q=. Sin icono de
// busqueda / sin modo libre / otra tienda -> NADA (pagina byte-identica).

const products = [
  { id: 1, name: 'Lampara Solar', price: 50000, category: 'hogar', images: ['https://x/a.jpg'], slug: 'lampara-solar', status: 'active' },
  { id: 2, name: 'Cepillo UV', price: 80000, category: 'hogar', images: ['https://x/b.jpg'], slug: 'cepillo-uv', status: 'active' },
];

// Encabezado en modo libre con una lupa (id h_lupa) + carrito (sin accion). El
// canvasHtml es el snapshot pre-renderizado (lo que el edge inyecta verbatim).
const freeChrome = (iconId) => ({
  enabled: true,
  layout: 'free',
  canvasHtml: '<div data-wb-obj="h_logo">joselevende</div><div data-wb-obj="' + iconId + '"><svg><circle cx="11" cy="11" r="8"></circle></svg></div>',
  canvas: { width: 1180, sections: [{ height: 64, objects: [
    { id: 'h_logo', type: 'text', content: 'joselevende', href: '../../' },
    { id: iconId, type: 'icon', iconName: 'search' },
    { id: 'h_cart', type: 'icon', iconName: 'shopping-cart' },
  ] }] },
});

const storeFree = (iconId = 'h_lupa') => ({ id: 11, name: 'joselevende', description: 'd', web_page_html: '<div>hero</div><!--WB_CATALOG-->', theme_config: { product_page: { chrome: freeChrome(iconId) } } });
const storeClassic = () => ({ id: 11, name: 'joselevende', description: 'd', web_page_html: '<div>hero</div><!--WB_CATALOG-->', theme_config: { product_page: { chrome: { enabled: true, layout: 'classic', menu: { links: [] } } } } });
const storeOther = () => ({ id: 99, name: 'otra', description: 'd', web_page_html: '<div>hero</div><!--WB_CATALOG-->', theme_config: { product_page: { chrome: freeChrome('h_lupa') } } });
const product = { id: 1, name: 'Lampara Solar', price: 50000, images: ['https://x/a.jpg'], slug: 'lampara-solar', status: 'active', category: 'hogar' };

let fails = 0;
const assert = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fails++; };

// --- PORTADA con lupa funcional ---
const home = renderStorePage({ store: storeFree(), products, bakedAt: 'now' });
console.log('PORTADA (modo libre, store 11) — la lupa debe cablearse:');
assert(home.includes('id="wbCanvasSearch"'), 'inyecta la barra de busqueda');
assert(home.includes('id="wbCanvasSearchInput"'), 'inyecta el input');
assert(home.includes('ICON="h_lupa"') && home.includes('data-wb-obj="'), 'el runtime apunta a la lupa por su id');
assert(home.includes('URLSearchParams') && home.includes('"q"'), 'portada lee ?q= para pre-filtrar');
assert(!home.includes('window.location.href='), 'portada NO navega (filtra en sitio)');
assert(home.indexOf('id="wbCanvasSearch"') > home.indexOf('<body'), 'la barra va dentro del body, tras el header');
assert(!home.includes('wb-search-toggle'), 'sin runtime huerfano viejo en modo libre (lo reemplaza el del lienzo)');

// --- FICHA con lupa -> navega a la portada ---
const ficha = renderProductPage({ store: storeFree(), product, products, bakedAt: 'now' });
console.log('FICHA (modo libre, store 11) — Enter lleva a la portada:');
assert(ficha.includes('id="wbCanvasSearch"'), 'inyecta la barra de busqueda en la ficha');
assert(ficha.includes('ICON="h_lupa"') && ficha.includes('data-wb-obj="'), 'el runtime apunta a la lupa');
assert(ficha.includes('window.location.href="../../"'), 'ficha navega a la portada (../../) con ?q=');

// --- GATING: nada cuando no aplica ---
console.log('GATING — debe quedar byte-identico (sin barra):');
const homeClassic = renderStorePage({ store: storeClassic(), products, bakedAt: 'now' });
assert(!homeClassic.includes('wbCanvasSearch'), 'header clasico (no free): SIN barra');
const homeNoIcon = renderStorePage({ store: { id: 11, name: 'j', description: 'd', web_page_html: '<!--WB_CATALOG-->', theme_config: { product_page: { chrome: { enabled: true, layout: 'free', canvasHtml: '<div>x</div>', canvas: { sections: [{ objects: [{ id: 'h_logo', type: 'text', content: 'j' }] }] } } } } }, products, bakedAt: 'now' });
assert(!homeNoIcon.includes('wbCanvasSearch'), 'modo libre SIN lupa: SIN barra');
const homeOther = renderStorePage({ store: storeOther(), products, bakedAt: 'now' });
assert(!homeOther.includes('wbCanvasSearch'), 'otra tienda (no store 11): SIN barra');

// REGRESION (Hallazgo 1 code-review): layout='free' PERO canvasHtml vacio ->
// chromeHeaderHtml cae al header CLASICO, que en la portada SI trae lupa funcional
// (wbHeaderSearchHtml + wbSearchRuntime). El gate NO debe matar esa lupa.
console.log('REGRESION — free sin canvasHtml cae a clasico (lupa clasica debe vivir):');
const storeFreeNoCanvas = { id: 11, name: 'j', description: 'd', web_page_html: '<div>hero</div><!--WB_CATALOG-->', theme_config: { product_page: { chrome: { enabled: true, layout: 'free', canvasHtml: '   ', canvas: { sections: [{ objects: [{ id: 'h_lupa', type: 'icon', iconName: 'search' }] }] } } } } };
const homeFreeNoCanvas = renderStorePage({ store: storeFreeNoCanvas, products, bakedAt: 'now' });
assert(homeFreeNoCanvas.includes('wb-search-toggle'), 'lupa CLASICA funcional presente (wbHeaderSearchHtml)');
assert(homeFreeNoCanvas.includes('var term="";'), 'wbSearchRuntime emitido (la lupa clasica abre/filtra)');
assert(!homeFreeNoCanvas.includes('wbCanvasSearch'), 'sin barra del lienzo (no hay canvas que cablear)');

// --- SEGURIDAD: id con caracteres peligrosos -> se descarta (anti-inyeccion) ---
console.log('SEGURIDAD — id de icono no sanitizable se descarta:');
const homeBadId = renderStorePage({ store: storeFree('h"]</script><script>x'), products, bakedAt: 'now' });
assert(!homeBadId.includes('wbCanvasSearch'), 'id con comillas/markup: NO cablea (fail-safe)');

console.log(fails === 0 ? '\nTODO VERDE' : `\n${fails} FALLO(S)`);
process.exit(fails === 0 ? 0 : 1);
