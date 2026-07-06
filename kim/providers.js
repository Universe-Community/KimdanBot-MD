// kim/providers.js — Cadenas de proveedores para descargas multimedia.
// ─────────────────────────────────────────────────────────────────────
// Cada función prueba VARIOS endpoints públicos en orden y devuelve el
// primero que responda con datos válidos (patrón tryProviders de
// helpers.js). Así, la caída de un proveedor no rompe el comando: solo
// se pasa al siguiente. Los extractores normalizan las distintas formas
// de respuesta de cada API a un objeto uniforme por comando.
//
// Proveedores usados (públicos, sin key o con key comunitaria):
//   delirius   → api.delirius.store / delirius-apiofc.vercel.app
//   dorratz    → api.dorratz.com
//   vreden     → api.vreden.my.id
//   siputzx    → api.siputzx.my.id
//   ryzendesu  → api.ryzendesu.vip
//   zenkey     → api.zenkey.my.id
//
// NOTA: son servicios de terceros y pueden caer en cualquier momento;
// por eso TODO va en cadenas de 2-4 proveedores.

import { tryProviders } from './helpers.js';

const DELIRIUS = ['https://api.delirius.store', 'https://delirius-apiofc.vercel.app'];
const enc = encodeURIComponent;

// ─── YouTube ────────────────────────────────────────────────────────
// (ytAudioUrl / ytVideoUrl viven en helpers.js por compatibilidad; aquí
// solo están los DEMÁS servicios.)

// ─── TikTok ─────────────────────────────────────────────────────────

/** Video de TikTok sin marca de agua. → { url, title } | null */
export async function tiktokVideo(link) {
    const u = enc(link);
    return tryProviders([
        { url: `https://api.tiklydown.eu.org/api/download?url=${u}`,
          extract: d => d?.video?.noWatermark ? { url: d.video.noWatermark, title: d.title } : null },
        { url: `https://api.dorratz.com/v2/tiktok-dl?url=${u}`,
          extract: d => d?.data?.media?.org ? { url: d.data.media.org, title: d.data.title || d.data.author?.nickname } : null },
        { url: `${DELIRIUS[0]}/download/tiktok?url=${u}`,
          extract: d => { const v = d?.data?.meta?.media?.find?.(x => x?.org || x?.hd) || d?.data; const url = v?.org || v?.hd || v?.play; return url ? { url, title: d?.data?.title } : null; } },
        { url: `https://api.vreden.my.id/api/tiktok?url=${u}`,
          extract: d => { const url = d?.result?.data?.play || d?.result?.play || d?.result?.video; return url ? { url, title: d?.result?.title } : null; } },
    ], { timeout: 30000 });
}

/** Fotos de un TikTok tipo carrusel. → { images: string[], title } | null */
export async function tiktokImages(link) {
    const u = enc(link);
    return tryProviders([
        { url: `https://api.tiklydown.eu.org/api/download?url=${u}`,
          extract: d => Array.isArray(d?.images) && d.images.length
              ? { images: d.images.map(i => i?.url || i).filter(Boolean), title: d.title } : null },
        { url: `https://api.dorratz.com/v2/tiktok-dl?url=${u}`,
          extract: d => Array.isArray(d?.data?.images) && d.data.images.length
              ? { images: d.data.images, title: d.data.title } : null },
    ], { timeout: 30000 });
}

// ─── Facebook ───────────────────────────────────────────────────────

/** Video de Facebook. → { url, quality } | null */
export async function facebookVideo(link) {
    const u = enc(link);
    return tryProviders([
        { url: `https://api.vreden.my.id/api/fbdl?url=${u}`,
          extract: d => { const r = d?.result; const url = r?.[0]?.url || r?.hd || r?.sd; return url ? { url, quality: r?.hd ? 'HD' : 'SD' } : null; } },
        { url: `https://api.dorratz.com/fbvideo?url=${u}`,
          extract: d => { const list = (Array.isArray(d) ? d : d?.data || []).filter(v => typeof v?.url === 'string' && v.url.startsWith('http'));
              const best = list.find(v => /1080|720/.test(v.resolution || v.quality || '')) || list[0];
              return best ? { url: best.url, quality: best.resolution || best.quality } : null; } },
        { url: `${DELIRIUS[0]}/download/facebook?url=${u}`,
          extract: d => { const r = d?.data || d?.result; const url = r?.hd || r?.sd || r?.url; return url ? { url } : null; } },
    ], { timeout: 30000 });
}

// ─── Instagram ──────────────────────────────────────────────────────

/** Medios de un post/reel de Instagram. → { items: [{url,type}] } | null */
export async function instagramMedia(link) {
    const u = enc(link);
    const norm = (arr) => {
        const items = (Array.isArray(arr) ? arr : []).map(x => {
            const url = x?.url || x?.download_url || (typeof x === 'string' ? x : null);
            if (!url) return null;
            const type = x?.type === 'video' || /\.mp4(\?|$)/i.test(url) ? 'video' : 'image';
            return { url, type };
        }).filter(Boolean);
        return items.length ? { items } : null;
    };
    return tryProviders([
        { url: `https://api.vreden.my.id/api/igdl?url=${u}`,   extract: d => norm(d?.result) },
        { url: `https://api.siputzx.my.id/api/d/igdl?url=${u}`, extract: d => norm(d?.data) },
        { url: `${DELIRIUS[0]}/download/instagram?url=${u}`,    extract: d => norm(d?.data) },
    ], { timeout: 30000 });
}

// ─── Pinterest (búsqueda de imágenes) ───────────────────────────────

/** Imágenes de Pinterest por búsqueda. → string[] (urls) | null */
export async function pinterestSearch(query) {
    const q = enc(query);
    const norm = (arr) => {
        const urls = (Array.isArray(arr) ? arr : [])
            .map(x => x?.image_large_url || x?.images_url || x?.image || x?.url || (typeof x === 'string' ? x : null))
            .filter(u => typeof u === 'string' && u.startsWith('http'));
        return urls.length ? urls : null;
    };
    return tryProviders([
        { url: `https://api.vreden.my.id/api/pinterest?query=${q}`,     extract: d => norm(d?.result || d?.data) },
        { url: `https://api.dorratz.com/v2/pinterest?q=${q}`,           extract: d => norm(d?.data || d) },
        { url: `https://api.siputzx.my.id/api/s/pinterest?query=${q}`,  extract: d => norm(d?.data) },
    ], { timeout: 25000 });
}

// ─── Twitter / X ────────────────────────────────────────────────────

/** Video/imagen de un tweet. → { url, type } | null */
export async function twitterMedia(link) {
    const u = enc(link);
    return tryProviders([
        { url: `https://api.vreden.my.id/api/twitter?url=${u}`,
          extract: d => { const media = d?.result?.media; const v = media?.find?.(x => x.type === 'video') || media?.[0];
              const url = v?.url || d?.result?.url; return url ? { url, type: v?.type || 'video' } : null; } },
        { url: `${DELIRIUS[0]}/download/twitterv2?url=${u}`,
          extract: d => { const md = d?.data?.media || d?.data; const v = md?.videos?.[0]?.url || md?.video || md?.url;
              return v ? { url: v, type: 'video' } : null; } },
    ], { timeout: 30000 });
}

// ─── MediaFire ──────────────────────────────────────────────────────

/** Enlace directo de MediaFire vía API. → { url, name, size } | null */
export async function mediafireDl(link) {
    const u = enc(link);
    return tryProviders(DELIRIUS.map(base => ({
        url: `${base}/download/mediafire?url=${u}`,
        extract: d => { const r = d?.data || d?.result || d;
            const url = r?.url || r?.link || r?.download || r?.dl;
            return url ? { url, name: r?.title || r?.filename || r?.name, size: r?.size || r?.filesize } : null; },
    })), { timeout: 25000 });
}

// ─── Spotify ────────────────────────────────────────────────────────

/** Busca una pista en Spotify. → { title, artist, url, image } | null */
export async function spotifySearch(query) {
    const q = enc(query);
    return tryProviders(DELIRIUS.map(base => ({
        url: `${base}/search/spotify?q=${q}&limit=1`,
        extract: d => { const t = d?.data?.[0] || d?.result?.[0];
            return t?.url ? { title: t.title || t.name, artist: t.artist || t.artists, url: t.url, image: t.image } : null; },
    })), { timeout: 20000 });
}

/** Descarga una pista de Spotify por URL. → { url, title } | null */
export async function spotifyDl(trackUrl) {
    const u = enc(trackUrl);
    return tryProviders(DELIRIUS.map(base => ({
        url: `${base}/download/spotifydl?url=${u}`,
        extract: d => { const r = d?.data || d?.result;
            const url = r?.download || r?.url || r?.link;
            return url ? { url, title: r?.title || r?.name } : null; },
    })), { timeout: 45000 });
}

// ─── SoundCloud ─────────────────────────────────────────────────────

/** Descarga de SoundCloud por URL. → { url, title, image, author } | null */
export async function soundcloudDl(scUrl) {
    const u = enc(scUrl);
    return tryProviders(DELIRIUS.map(base => ({
        url: `${base}/download/soundcloud?url=${u}`,
        extract: d => { const r = d?.data || d?.result;
            const url = r?.download || r?.url;
            return url ? { url, title: r?.title, image: r?.image, author: r?.author } : null; },
    })), { timeout: 40000 });
}

/**
 * Busca pistas en SoundCloud (scrape del sitio móvil, sin API key).
 * → [{ url, name }] (máx `limit`)
 */
export async function soundcloudSearch(query, limit = 5) {
    try {
        const res = await fetch(`https://m.soundcloud.com/search/sounds?q=${enc(query)}`, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        if (!res.ok) return [];
        const html = await res.text();
        const urls = html.match(/(?<="permalink_url":")[^"]*/g) || [];
        const names = html.match(/(?<="permalink":")[^"]*/g) || [];
        const out = [];
        for (let i = 0; i < urls.length && out.length < limit; i++) {
            // Solo URLs de pista (usuario/cancion → 4+ segmentos)
            if ((urls[i].split('/').length - 1) > 3) out.push({ url: urls[i], name: names[i] || urls[i].split('/').pop() });
        }
        return out;
    } catch { return []; }
}

// ─── Threads ────────────────────────────────────────────────────────

/** Video/imagen de un post de Threads. → { url, type, description } | null */
export async function threadsMedia(link) {
    const u = enc(link);
    return tryProviders(DELIRIUS.map(base => ({
        url: `${base}/download/threads?url=${u}`,
        extract: d => { const md = d?.data?.media?.[0] || d?.result?.media?.[0];
            const url = md?.url || md;
            return (typeof url === 'string' && url.startsWith('http'))
                ? { url, type: md?.type === 'image' ? 'image' : 'video', description: d?.data?.description || '' } : null; },
    })), { timeout: 30000 });
}

// ─── Perfil de Instagram (stalk) ────────────────────────────────────

export async function igStalk(username) {
    const q = enc(username.replace('@', '').trim());
    return tryProviders([
        { url: `https://api.vreden.my.id/api/igstalk?username=${q}`,
          extract: d => d?.result || null },
        { url: `${DELIRIUS[0]}/tools/igstalk?username=${q}`,
          extract: d => d?.data || d?.result || null },
    ], { timeout: 25000 });
}
