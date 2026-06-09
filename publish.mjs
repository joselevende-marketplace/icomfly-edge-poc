/**
 * PUBLISH (Publicador) — Fase 1
 * ------------------------------
 * Hornea TODAS las tiendas listadas en stores.json y, opcionalmente, las
 * despliega al CDN en vivo (repo demo de GitHub Pages) con --deploy.
 *
 * En produccion, este publicador lo dispararia el backend cada vez que una
 * tienda guarda cambios (o un cron cada X minutos). Aqui es un script
 * autonomo que NO toca el backend de iComfly.
 *
 * Uso:
 *   node publish.mjs              -> hornea todas las tiendas de stores.json
 *   node publish.mjs --deploy     -> hornea y ademas git push al repo demo
 *
 * El deploy usa el repo git que vive en dist/ (remote origin = repo demo).
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

const exec = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, 'dist');
const DEPLOY = process.argv.includes('--deploy');

function log(m) {
  console.log(`[publish] ${m}`);
}

// El subdominio (carpeta de salida / ruta del Worker) puede diferir del slug
// real de la tienda. Si la tienda no eligio subdominio, cae a su slug.
function subdomainOf(s) {
  return (s.subdomain || s.slug || '').trim();
}

async function bakeStore(s) {
  const env = { ...process.env };
  if (s.store_id) env.STORE_ID = String(s.store_id);
  if (s.slug) env.CONFIG_SLUG = s.slug;            // slug REAL para leer config/tema
  if (s.currency) env.CURRENCY = s.currency;
  if (s.currency_symbol) env.CURRENCY_SYMBOL = s.currency_symbol;
  if (s.currency_locale) env.CURRENCY_LOCALE = s.currency_locale;
  if (s.whatsapp) env.WHATSAPP = s.whatsapp;
  if (s.store_name) env.STORE_NAME = s.store_name;

  const sub = subdomainOf(s);
  const { stdout } = await exec('node', ['bake.mjs', sub], { cwd: __dirname, env });
  // Mostrar solo la linea LISTO de cada bake
  const done = stdout.split('\n').find((l) => l.includes('LISTO')) || '(horneado)';
  log(`  ${sub}: ${done.replace('[bake] ', '')}`);
}

// Origen en vivo del CDN (Cloudflare Pages). Se usa para PRESERVAR la pagina ya
// publicada de una tienda cuyo horneado FALLO este run, y NO sacarla del edge por
// un fallo transitorio (el deploy de Pages reemplaza todo el dist/).
const PAGES_ORIGIN = process.env.PAGES_ORIGIN || 'https://icomfly-storefronts.pages.dev';

async function preserveLive(sub) {
  const idx = await fetch(`${PAGES_ORIGIN}/${sub}/index.html`);
  if (!idx.ok) throw new Error(`sin pagina en vivo (${idx.status})`);
  await mkdir(join(DIST, sub), { recursive: true });
  await writeFile(join(DIST, sub, 'index.html'), await idx.text(), 'utf8');
  // meta.json es lo que el Worker usa para validar que la tienda existe; preservarlo.
  const meta = await fetch(`${PAGES_ORIGIN}/${sub}/meta.json`);
  if (meta.ok && (meta.headers.get('content-type') || '').includes('json')) {
    await writeFile(join(DIST, sub, 'meta.json'), await meta.text(), 'utf8');
  }
}

function indexHtml(stores) {
  const links = stores
    .map((s) => {
      const sub = subdomainOf(s);
      return `<li><a href="./${sub}/">${s.store_name || sub}</a> <span class="muted">/${sub}/</span></li>`;
    })
    .join('\n');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>iComfly Edge — tiendas horneadas</title>
<style>body{font-family:Inter,system-ui,sans-serif;background:#f7f8fa;color:#1f2430;max-width:680px;margin:40px auto;padding:0 18px}
h1{font-size:1.4rem}ul{line-height:2.2;list-style:none;padding:0}a{color:#108EE3;font-weight:600;text-decoration:none}
.muted{color:#7b8494;font-size:.8rem}.note{background:#fff;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(16,24,40,.08);margin-top:16px;font-size:.9rem;color:#555}</style>
</head><body>
<h1>iComfly Edge — tiendas horneadas (CDN)</h1>
<ul>${links}</ul>
<div class="note">Banco de pruebas de velocidad (Fase 0-2). Cada tienda es HTML estatico servido desde el edge, sin depender del backend de iComfly para mostrarse.</div>
</body></html>`;
}

// SHA-256 del contenido horneado de todas las tiendas, normalizando (quitando)
// el timestamp "Pagina horneada: <fecha>" que cambia en cada horneado. Si dos
// horneados dan el mismo hash, el contenido real es identico -> no redesplegar.
async function contentHash(stores) {
  const h = createHash('sha256');
  for (const s of stores) {
    const sub = subdomainOf(s);
    try {
      let html = await readFile(join(DIST, sub, 'index.html'), 'utf8');
      html = html.replace(/(Pagina horneada: )[^&]*/i, '$1');
      h.update(sub + '\n' + html + '\n');
    } catch { /* tienda sin index: se ignora en el hash */ }
  }
  return h.digest('hex');
}

async function git(args) {
  const { stdout } = await exec('git', args, { cwd: DIST });
  return stdout.trim();
}

async function deploy() {
  log('Desplegando dist/ al repo demo (GitHub Pages)...');
  await git(['add', '-A']);
  // Si no hay cambios, commit falla; lo toleramos.
  try {
    const stamp = new Date().toISOString();
    await exec(
      'git',
      ['-c', 'user.name=joselevende-marketplace', '-c', 'user.email=soporte@joselevende.com', 'commit', '-q', '-m', `republicar tiendas horneadas ${stamp}`],
      { cwd: DIST }
    );
  } catch (e) {
    log('  (sin cambios que commitear)');
  }
  await git(['push', '-q', 'origin', 'main']);
  log('  push OK -> el CDN se actualiza en ~1 min');
}

// Lista de tiendas a hornear: las que tienen pagina web ACTIVA, segun el backend.
// Cae a stores.json si el endpoint no responde (para no romper el horneado).
async function loadStores() {
  const API_BASE = process.env.API_BASE || 'https://api.icomfly.com/api';
  try {
    const res = await fetch(`${API_BASE}/public/stores-to-bake`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const stores = Array.isArray(data) ? data : data.stores || [];
    log(`Tiendas con web activa (API): ${stores.length}`);
    return stores;
  } catch (e) {
    log(`API /public/stores-to-bake fallo (${e.message}); uso stores.json`);
    const cfg = JSON.parse(await readFile(join(__dirname, 'stores.json'), 'utf8'));
    return cfg.stores || [];
  }
}

async function main() {
  const stores = await loadStores();
  log(`Tiendas a hornear: ${stores.length}`);

  await mkdir(DIST, { recursive: true });
  // AISLAMIENTO POR TIENDA: un fallo en UNA tienda NO debe tumbar el horneado de las
  // demas (clave para 121 tiendas). Se captura por tienda; si una falla, se PRESERVA
  // su pagina ya publicada (re-bajandola del edge) para no sacarla por un fallo
  // transitorio. Las demas continuan normalmente.
  const failures = [];
  for (const s of stores) {
    const sub = subdomainOf(s);
    try {
      await bakeStore(s);
    } catch (e) {
      failures.push(sub);
      log(`  ⚠️ FALLO ${sub}: ${e.message}`);
      try {
        await preserveLive(sub);
        log(`     preservada la pagina actual de ${sub} (no se saca del edge)`);
      } catch (pe) {
        log(`     no se pudo preservar ${sub} (${pe.message}); quedara ausente este deploy`);
      }
    }
  }
  if (failures.length) {
    log(`⚠️ ${failures.length}/${stores.length} tienda(s) fallaron al hornear: ${failures.join(', ')}. Las demas continuaron.`);
  }

  // Indice raiz
  await writeFile(join(DIST, 'index.html'), indexHtml(stores), 'utf8');
  await writeFile(join(DIST, '.nojekyll'), '', 'utf8');
  log('Indice raiz generado.');

  // Huella del contenido horneado (excluye el timestamp volatil "Pagina horneada")
  // para que el workflow solo redespliegue a Cloudflare cuando algo cambio de
  // verdad, y no queme la cuota de 500 deploys/mes con redeploys identicos.
  await writeFile(join(DIST, 'content-hash.txt'), (await contentHash(stores)) + '\n', 'utf8');
  log('Huella de contenido generada (content-hash.txt).');

  if (DEPLOY) {
    await deploy();
  } else {
    log('Hecho (local). Usa --deploy para publicar al CDN.');
  }
}

main().catch((e) => {
  console.error(`[publish] ERROR: ${e.message}`);
  process.exit(1);
});
