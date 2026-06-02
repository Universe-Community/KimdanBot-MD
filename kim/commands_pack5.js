// kim/commands_pack5.js — Sistema BL/Yaoi/Jinx: búsqueda de obras (manga,
// manhwa, novelas BL) vía APIs PÚBLICAS legales (AniList GraphQL, MangaDex)
// + comandos de colección/personajes. NO descarga contenido: enlaza a
// lectores legales. Arquitectura nativa: COMMAND_META + switch/case.

import { command } from './registry.js';
import { getUser, db } from './db.js';
import { box } from './ui.js';
import { CHARACTERS, charsBySeries, findCharacter, RARITIES } from './theme.js';

const ANILIST = 'https://graphql.anilist.co';
const MANGADEX = 'https://api.mangadex.org';

// AniList GraphQL: busca obras BL (genre/tag) por término.
async function anilistSearch(term, format /* MANGA|NOVEL */) {
    const query = `
      query ($search: String, $format: MediaFormat) {
        Page(perPage: 6) {
          media(search: $search, type: MANGA, format: $format, sort: SEARCH_MATCH) {
            title { romaji english }
            genres
            tags { name }
            siteUrl
            description(asHtml: false)
            status
            chapters
          }
        }
      }`;
    const res = await fetch(ANILIST, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ query, variables: { search: term, format: format || undefined } }),
        signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error('AniList HTTP ' + res.status);
    const data = await res.json();
    let media = data?.data?.Page?.media || [];
    // Filtra a BL/Yaoi por género o tag cuando sea posible.
    const isBL = (m) => (m.genres || []).some(g => /yaoi|boys'? love/i.test(g))
        || (m.tags || []).some(t => /yaoi|boys'? love|shounen ai/i.test(t.name));
    const bl = media.filter(isBL);
    return (bl.length ? bl : media).slice(0, 5);
}

// MangaDex: busca manga BL (tag yaoi/boys' love) y arma enlaces legales.
async function mangadexSearch(term) {
    const url = `${MANGADEX}/manga?title=${encodeURIComponent(term)}&limit=5`
        + `&availableTranslatedLanguage[]=es&availableTranslatedLanguage[]=en`
        + `&includedTags[]=` + '5920b825-4181-4a17-beeb-9918b0ff7a30'; // tag "Boys' Love"
    const res = await fetch(url, { headers: { 'User-Agent': 'KimdanBot/1.0' }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error('MangaDex HTTP ' + res.status);
    const data = await res.json();
    return (data?.data || []).slice(0, 5).map(m => {
        const at = m.attributes || {};
        const title = at.title?.es || at.title?.en || Object.values(at.title || {})[0] || 'Sin título';
        return { title, status: at.status, year: at.year, url: `https://mangadex.org/title/${m.id}` };
    });
}

const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

const COMMAND_META = [
    { names: ['blsearch', 'buscarbl'], category: 'search', description: '💜 Busca manga/manhwa BL (AniList)' },
    { names: ['manhwasearch', 'manhwabl'], category: 'search', description: '💜 Busca manhwa BL (MangaDex)' },
    { names: ['mangabl', 'mangasearchbl'], category: 'search', description: '💜 Busca manga BL (MangaDex)' },
    { names: ['novelbl', 'novelabl'], category: 'search', description: '💜 Busca novelas ligeras BL (AniList)' },
    { names: ['blrecommend2', 'blpick'], category: 'fun', description: '💜 Recomendación BL al azar del catálogo' },
    { names: ['personajes', 'characters', 'rosterbl'], category: 'gacha', description: '🎴 Lista de personajes BL del gacha' },
    { names: ['coleccion', 'collection', 'micoleccion'], category: 'gacha', description: '🎴 Tu colección de personajes' },
    { names: ['husbandobl', 'husbando'], category: 'gacha', description: '🎴 Husbando BL aleatorio del catálogo' },
    { names: ['pareja', 'mipareja'], category: 'rpg', description: '💞 Muestra tu pareja actual' },
];

export async function execute(conn, m, cmd, args, text) {
    switch (cmd) {

    case 'blsearch':
    case 'novelbl': {
        if (!text) return m.reply(`Uso: .${cmd} <título o tema BL>`);
        const fmt = cmd === 'novelbl' ? 'NOVEL' : null;
        await m.reply('💜 Buscando en AniList...');
        try {
            const results = await anilistSearch(text, fmt);
            if (!results.length) return m.reply('No encontré obras BL con ese término.');
            const lines = results.map((r, i) => {
                const t = r.title.english || r.title.romaji;
                return `${i + 1}. *${t}*${r.chapters ? ` · ${r.chapters} caps` : ''}\n   🔗 ${r.siteUrl}`;
            });
            await conn.sendMessage(m.chat, { text: box(`💜 ${cmd === 'novelbl' ? 'NOVELAS BL' : 'BÚSQUEDA BL'}`, lines) }, { quoted: m });
        } catch (e) { await m.reply('⚠️ AniList no respondió ahora mismo. Intenta más tarde.'); }
        break;
    }

    case 'manhwasearch':
    case 'mangabl': {
        if (!text) return m.reply(`Uso: .${cmd} <título BL>`);
        await m.reply('💜 Buscando en MangaDex...');
        try {
            const results = await mangadexSearch(text);
            if (!results.length) return m.reply('No encontré obras BL con ese término en MangaDex.');
            const lines = results.map((r, i) => `${i + 1}. *${r.title}*${r.year ? ` (${r.year})` : ''}${r.status ? ` · ${r.status}` : ''}\n   🔗 ${r.url}`);
            await conn.sendMessage(m.chat, { text: box('💜 MANGA/MANHWA BL', lines) }, { quoted: m });
        } catch (e) { await m.reply('⚠️ MangaDex no respondió ahora mismo. Intenta más tarde.'); }
        break;
    }

    case 'blrecommend2': {
        // Recomendación combinando catálogo local + AniList trending BL.
        try {
            const results = await anilistSearch('love', null);
            if (results.length) {
                const r = results[Math.floor(Math.random() * results.length)];
                const t = r.title.english || r.title.romaji;
                return conn.sendMessage(m.chat, { text: box('💜 RECOMENDACIÓN BL', [
                    `*${t}*`, stripHtml(r.description).slice(0, 200) + '…', `🔗 ${r.siteUrl}`,
                ]) }, { quoted: m });
            }
        } catch { /* cae al catálogo local */ }
        const series = [...new Set(CHARACTERS.map(c => c.series))];
        const pick = series[Math.floor(Math.random() * series.length)];
        await m.reply(box('💜 RECOMENDACIÓN BL', [`Te recomiendo explorar: *${pick}*`, 'Usa .blsearch para más detalles.']));
        break;
    }

    case 'personajes': {
        const by = charsBySeries();
        const lines = Object.entries(by).slice(0, 25).map(([s, cs]) => `💜 *${s}*: ${cs.map(c => c.name).join(', ')}`);
        await conn.sendMessage(m.chat, { text: box(`🎴 PERSONAJES BL · ${CHARACTERS.length}`, lines) }, { quoted: m });
        break;
    }

    case 'coleccion': {
        const t = (m.mentionedJid?.[0]) || m.sender;
        const u = getUser(t); const chars = u.characters || [];
        if (!chars.length) return m.reply(t === m.sender ? 'Tu colección está vacía. Usa .roll y .claim.' : 'Ese usuario no tiene personajes.');
        const byRar = {}; for (const c of chars) (byRar[c.rarity] ||= []).push(c);
        const lines = [];
        for (const r of RARITIES) { const l = byRar[r.key]; if (!l) continue; lines.push(`${r.emoji} *${r.name}*: ${l.map(c => c.name).join(', ')}`); }
        await conn.sendMessage(m.chat, { text: box(`🎴 COLECCIÓN · @${t.split('@')[0]} (${chars.length})`, lines), mentions: [t] }, { quoted: m });
        break;
    }

    case 'husbandobl': {
        const c = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
        await conn.sendMessage(m.chat, { text: box('🎴 HUSBANDO BL', [
            `💜 *${c.name}*`, `📺 ${c.series}`, 'Invócalo en el gacha con .roll',
        ]) }, { quoted: m });
        break;
    }

    case 'pareja': {
        const u = getUser(m.sender);
        if (!u.married) return m.reply('💔 No tienes pareja. Usa .marry @alguien.');
        await conn.sendMessage(m.chat, { text: box('💞 TU PAREJA', [`@${m.sender.split('@')[0]} 💍 @${u.married.split('@')[0]}`]), mentions: [m.sender, u.married] }, { quoted: m });
        break;
    }

    }
}

for (const meta of COMMAND_META) {
    const canonical = meta.names[0];
    command({ name: canonical, aliases: meta.names.slice(1), category: meta.category, description: meta.description },
        (conn, m, args, text) => execute(conn, m, canonical, args, text));
}
export { COMMAND_META };
export default true;
