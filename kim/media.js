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
