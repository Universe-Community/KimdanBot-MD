// kim/commands_pack5.js — Sistema BL/Yaoi/Jinx: búsqueda de obras (manga,
// manhwa, novelas BL) vía APIs PÚBLICAS legales (AniList GraphQL, MangaDex)
// + comandos de colección/personajes. NO descarga contenido: enlaza a
// lectores legales. Arquitectura nativa: COMMAND_META + switch/case.

import { command } from './registry.js';
import { getUser, db } from './db.js';
import { box, softbox } from './ui.js';
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
    { names: ['favcharacter', 'favchar', 'micharfav'], category: 'gacha', description: '💖 Tu personaje favorito' },
    { names: ['date', 'cita'], category: 'rpg', description: '💕 Lleva a alguien a una cita BL (200 JX, +AP)' },
    { names: ['gift', 'regalohg'], category: 'rpg', description: '🎁 Regala un Heart Gem (+AP mutuo)' },
    { names: ['propose', 'proponer'], category: 'rpg', description: '💍 Propón matrimonio a alguien' },
    { names: ['relationship', 'relacion'], category: 'rpg', description: '💑 Estado de tu relación BL' },
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

    case 'favcharacter': {
        const u = getUser(m.sender);
        if (!u.favorite) return m.reply('🎴 No tienes personaje favorito. Usa .setfavourite <nombre>.');
        const c = findCharacter(u.favorite);
        await conn.sendMessage(m.chat, { text: box('💖 TU PERSONAJE FAVORITO', [
            `💜 *${c?.name || u.favorite}*`, c?.series ? `📺 ${c.series}` : '', '🤝 Tu corazón le pertenece',
        ].filter(Boolean)), mentions: [m.sender] }, { quoted: m });
        break;
    }

    case 'date': {
        // Cita BL: cuesta 200 JX, da afinidad con la pareja (o aleatoria).
        const u = getUser(m.sender);
        const COST = 200;
        if ((u.money || 0) < COST) return m.reply(`💸 Una cita cuesta ${COST} JX y no tienes suficiente.`);
        const t = m.mentionedJid?.[0] || u.married;
        if (!t) return m.reply('💞 Etiqueta a alguien para tu cita: .date @usuario');
        u.money -= COST;
        const ap = 10 + Math.floor(Math.random() * 20);
        u.affinity = (u.affinity || 0) + ap;
        const tu = getUser(t); tu.affinity = (tu.affinity || 0) + ap;
        db.markDirty();
        const lugares = ['una cafetería temática 🍰', 'el cine viendo un drama BL 🎬', 'un parque al atardecer 🌇', 'una librería de manhwa 📚', 'un festival de anime 🎴'];
        await conn.sendMessage(m.chat, { text: softbox('Cita BL 💕', [
            `@${m.sender.split('@')[0]} llevó a @${t.split('@')[0]} a ${lugares[Math.floor(Math.random()*lugares.length)]}`,
            `🤝 +${ap} AP para ambos`, `💸 -${COST} JX`,
        ], 'love'), mentions: [m.sender, t] }, { quoted: m });
        break;
    }

    case 'gift': {
        // Regalar HG a alguien (sube afinidad mutua).
        const u = getUser(m.sender);
        const t = m.mentionedJid?.[0];
        if (!t) return m.reply('🎁 Etiqueta a quién regalar: .gift @usuario');
        if (t === m.sender) return m.reply('🎁 No puedes regalarte a ti mismo.');
        if ((u.corazones || 0) < 1) return m.reply('💎 Necesitas al menos 1 Heart Gem para regalar.');
        u.corazones -= 1;
        const tu = getUser(t); tu.corazones = (tu.corazones || 0) + 1;
        u.affinity = (u.affinity || 0) + 5; tu.affinity = (tu.affinity || 0) + 5;
        db.markDirty();
        const regalos = ['un ramo de rosas 🌹', 'chocolates 🍫', 'un peluche 🧸', 'una carta de amor 💌', 'un manhwa firmado 📖'];
        await conn.sendMessage(m.chat, { text: softbox('Regalo BL 🎁', [
            `@${m.sender.split('@')[0]} le regaló ${regalos[Math.floor(Math.random()*regalos.length)]} a @${t.split('@')[0]}`,
            `💎 -1 HG  ·  🤝 +5 AP mutuo`,
        ], 'hug'), mentions: [m.sender, t] }, { quoted: m });
        break;
    }

    case 'propose': {
        // Proponer matrimonio (formaliza con .marry; aquí es el gesto romántico).
        const t = m.mentionedJid?.[0];
        if (!t) return m.reply('💍 Etiqueta a tu amado/a: .propose @usuario');
        if (t === m.sender) return m.reply('💍 No puedes proponerte matrimonio a ti mismo 😅');
        const u = getUser(m.sender);
        if (u.married) return m.reply('💔 Ya estás comprometido/a. Usa .divorce primero.');
        await conn.sendMessage(m.chat, { text: softbox('Propuesta BL 💍', [
            `@${m.sender.split('@')[0]} se arrodilla ante @${t.split('@')[0]} 💞`,
            '"¿Quieres pasar la eternidad conmigo?"',
            `Acepta con: .marry @${m.sender.split('@')[0]}`,
        ], 'shy'), mentions: [m.sender, t] }, { quoted: m });
        break;
    }

    case 'relationship': {
        // Estado de relación: pareja + afinidad combinada.
        const u = getUser(m.sender);
        if (!u.married) return m.reply('💔 Estás soltero/a. Usa .propose y .marry.');
        const tu = getUser(u.married);
        const combined = (u.affinity || 0) + (tu.affinity || 0);
        const niveles = combined > 500 ? 'Almas gemelas 💞' : combined > 200 ? 'Enamorados 💕' : combined > 50 ? 'Conociéndose 💗' : 'Recién empezando 🌱';
        await conn.sendMessage(m.chat, { text: softbox('Relación BL 💑', [
            `@${m.sender.split('@')[0]} 💍 @${u.married.split('@')[0]}`,
            `🤝 Afinidad combinada: ${combined} AP`,
            `✨ Estado: ${niveles}`,
        ]), mentions: [m.sender, u.married] }, { quoted: m });
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
