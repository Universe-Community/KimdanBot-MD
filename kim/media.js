// kim/media.js — Gestión optimizada de medios (GIFs anime/BL/Yaoi).
//
// Estructura: ./media/gifs/<categoria>/  (descargas cacheadas en disco)
// Optimizaciones:
//   • Caché en disco con dedupe por hash de URL → no se descarga 2 veces.
//   • Índice en memoria (LRU simple) de buffers calientes para no leer disco
//     en cada uso → evita picos de RAM y latencia.
//   • Envío como video con gifPlayback:true (forma correcta de "GIF" en
//     WhatsApp MD; los .gif reales no se reproducen, se mandan como mp4).

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getBuffer } from './helpers.js';

const GIF_ROOT = path.resolve('./media/gifs');

// Caché en RAM (LRU acotada para no crecer sin límite).
const HOT = new Map();          // key → Buffer
const HOT_MAX = 40;

// Caché del listado de GIFs propios por categoría (evita readdirSync en CADA
// interacción anime, que bloquea el event loop en grupos activos). La carpeta
// cambia rara vez, así que un TTL corto es seguro.
const _dirCache = new Map();    // dir → { files:[], ts }
const DIR_TTL = 60000;
function ownGifsOf(dir) {
    const now = Date.now();
    const c = _dirCache.get(dir);
    if (c && now - c.ts < DIR_TTL) return c.files;
    let files = [];
    try {
        if (fs.existsSync(dir)) {
            files = fs.readdirSync(dir).filter(f =>
                /\.(mp4|gif|webp)$/i.test(f) && !/^[0-9a-f]{16}\./i.test(f));
        }
    } catch { /* */ }
    _dirCache.set(dir, { files, ts: now });
    if (_dirCache.size > 200) { for (const [k, v] of _dirCache) if (now - v.ts > DIR_TTL) _dirCache.delete(k); }
    return files;
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
function hashUrl(url) {
    return crypto.createHash('md5').update(String(url)).digest('hex').slice(0, 16);
}
function touchHot(key, buf) {
    HOT.delete(key);
    HOT.set(key, buf);
    if (HOT.size > HOT_MAX) HOT.delete(HOT.keys().next().value); // expulsa el más viejo
}

/**
 * Obtiene un buffer de GIF/MP4 para una categoría, dada su URL remota.
 * Reutiliza disco (./media/gifs/<cat>/<hash>.mp4) y RAM. Descarga solo si
 * no existe localmente.
 */
export async function getGifBuffer(category, url) {
    const safeCat = String(category).replace(/[^\w-]/g, '_');
    const dir = path.join(GIF_ROOT, safeCat);

    // 1) PRIORIDAD: GIFs/MP4 propios que el usuario haya colocado en
    //    media/gifs/<categoria>/  (cualquier nombre, p.ej. miclip.mp4).
    //    Se ignoran los archivos-caché (nombre = hash de 16 hex) y los
    //    marcadores .gitkeep/README. Si hay propios, se usa uno al azar.
    try {
        const own = ownGifsOf(dir);
        if (own.length) {
            const pick = own[Math.floor(Math.random() * own.length)];
            const fp = path.join(dir, pick);
            if (HOT.has(fp)) { const b = HOT.get(fp); touchHot(fp, b); return b; }
            const buf = await fs.promises.readFile(fp);
            if (buf?.length > 100) { touchHot(fp, buf); return buf; }
        }
    } catch { /* si algo falla, se usa la fuente remota */ }

    // 2) Si no hay propios, cae a la caché por URL / descarga remota.
    const ext = (url.split('?')[0].split('.').pop() || 'mp4').toLowerCase().slice(0, 4);
    const file = path.join(dir, `${hashUrl(url)}.${/gif|mp4|webp/.test(ext) ? ext : 'mp4'}`);
    const key = file;

    if (HOT.has(key)) { const b = HOT.get(key); touchHot(key, b); return b; }

    try {
        if (fs.existsSync(file)) {
            const buf = await fs.promises.readFile(file);
            if (buf?.length > 100) { touchHot(key, buf); return buf; }
        }
    } catch { /* */ }

    const buf = await getBuffer(url, { timeout: 30000 });
    if (!buf || buf.length < 100) return null;
    try { ensureDir(dir); await fs.promises.writeFile(file, buf); } catch { /* */ }
    touchHot(key, buf);
    return buf;
}

/**
 * Envía un GIF (o lista de imágenes locales) como video reproducible.
 * @param conn, jid, buf  buffer de video/gif
 */
export async function sendGif(conn, jid, buf, { caption = '', mentions = [], quoted } = {}) {
    return conn.sendMessage(jid, {
        video: buf,
        gifPlayback: true,
        caption,
        mentions,
    }, quoted ? { quoted } : {});
}

/**
 * Devuelve un buffer de un GIF/MP4 PROPIO de media/gifs/<categoria>/ elegido
 * al azar, o null si el usuario no ha colocado archivos propios ahí.
 * Ignora los archivos-caché (nombre = hash de 16 hex) y los marcadores.
 */
export async function getLocalGif(category) {
    const safeCat = String(category).replace(/[^\w-]/g, '_');
    const dir = path.join(GIF_ROOT, safeCat);
    try {
        const own = ownGifsOf(dir);
        if (!own.length) return null;
        const pick = own[Math.floor(Math.random() * own.length)];
        const fp = path.join(dir, pick);
        if (HOT.has(fp)) { const b = HOT.get(fp); touchHot(fp, b); return b; }
        const buf = await fs.promises.readFile(fp);
        if (buf?.length > 100) { touchHot(fp, buf); return buf; }
    } catch { /* */ }
    return null;
}

/** Limpieza opcional: borra GIFs cacheados más viejos que `days`. */
export function pruneGifCache(days = 14) {
    const cutoff = Date.now() - days * 86400000;
    let removed = 0;
    try {
        for (const cat of fs.readdirSync(GIF_ROOT, { withFileTypes: true })) {
            if (!cat.isDirectory()) continue;
            const dir = path.join(GIF_ROOT, cat.name);
            for (const f of fs.readdirSync(dir)) {
                const fp = path.join(dir, f);
                try { if (fs.statSync(fp).mtimeMs < cutoff) { fs.unlinkSync(fp); removed++; } } catch { /* */ }
            }
        }
    } catch { /* */ }
    return removed;
}

export const GIF_DIR = GIF_ROOT;

// ─── Imágenes locales aleatorias (para .pruebaimagen y afines) ──────────
// Lee imágenes de una carpeta local y devuelve una al azar. Busca la
// carpeta tanto en la raíz del proyecto (./<nombre>) como dentro de
// ./media/<nombre>, para que "una carpeta con el mismo título" funcione
// sin importar dónde la coloque el usuario. Usa la misma caché de listado
// con TTL que los GIFs, para no hacer readdir en cada invocación.
const IMG_EXT = /\.(jpe?g|png|webp|gif|bmp)$/i;

function imagesOf(dir) {
    const now = Date.now();
    const cacheKey = 'img:' + dir;
    const c = _dirCache.get(cacheKey);
    if (c && now - c.ts < DIR_TTL) return c.files;
    let files = [];
    try {
        if (fs.existsSync(dir)) files = fs.readdirSync(dir).filter(f => IMG_EXT.test(f));
    } catch { /* */ }
    _dirCache.set(cacheKey, { files, ts: now });
    return files;
}

/**
 * Devuelve { buffer, filename, dir, count } de una imagen aleatoria de la
 * carpeta `folderName`, o null si no hay ninguna. Prueba ./<folder> y
 * ./media/<folder>.
 */
export async function getRandomImage(folderName) {
    const safe = String(folderName).replace(/[^\w-]/g, '_');
    const candidates = [
        path.resolve('.', safe),
        path.join(GIF_ROOT, '..', safe),   // ./media/<folder>
    ];
    for (const dir of candidates) {
        const files = imagesOf(dir);
        if (!files.length) continue;
        const pick = files[Math.floor(Math.random() * files.length)];
        const fp = path.join(dir, pick);
        try {
            if (HOT.has(fp)) { const b = HOT.get(fp); touchHot(fp, b); return { buffer: b, filename: pick, dir, count: files.length }; }
            const buf = await fs.promises.readFile(fp);
            if (buf?.length > 100) { touchHot(fp, buf); return { buffer: buf, filename: pick, dir, count: files.length }; }
        } catch { /* siguiente candidato */ }
    }
    return null;
}
