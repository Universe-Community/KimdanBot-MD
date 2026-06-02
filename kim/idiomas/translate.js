// kim/idiomas/translate.js — Capa de traducción opcional con caché + fallback.
//
// Resolución de idioma (precedencia): usuario > grupo > global > 'es'.
// API: LibreTranslate (keyless público). Si falla → caché → texto original.
// Caché LRU en memoria para minimizar llamadas y latencia. Diseñado para
// NO romper el bot nunca: cualquier error devuelve el texto de entrada.

import { getUser, getChat } from '../db.js';

const ENDPOINT = process.env.LIBRETRANSLATE_URL || 'https://libretranslate.com/translate';
const CACHE = new Map();          // `${lang}:${text}` → traducción
const CACHE_MAX = 1000;
let GLOBAL_LANG = process.env.BOT_LANG || 'es';

export function setGlobalLang(l) { GLOBAL_LANG = l; }
export function getGlobalLang() { return GLOBAL_LANG; }

/** Idioma efectivo para un mensaje: usuario > grupo > global. */
export function resolveLang(m) {
    try {
        const u = m?.sender ? getUser(m.sender)?.lang : null;
        if (u) return u;
        const g = m?.isGroup ? getChat(m.chat)?.lang : null;
        if (g) return g;
    } catch { /* */ }
    return GLOBAL_LANG;
}

function cacheSet(k, v) { CACHE.set(k, v); if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value); }

/**
 * Traduce `text` a `lang`. Si lang === 'es' o vacío, devuelve el texto tal cual
 * (el bot está escrito en español, su idioma base). Nunca lanza: ante error
 * devuelve el texto original.
 */
export async function translate(text, lang, { source = 'es' } = {}) {
    if (!text || !lang || lang === source) return text;
    const key = `${lang}:${text}`;
    if (CACHE.has(key)) return CACHE.get(key);
    try {
        const res = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: text, source, target: lang, format: 'text' }),
            signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const out = data?.translatedText || text;
        cacheSet(key, out);
        return out;
    } catch {
        return text; // fallback: idioma base, sin romper nada
    }
}

/** Traduce según el idioma efectivo del mensaje. */
export async function t(m, text) {
    const lang = resolveLang(m);
    return translate(text, lang);
}
