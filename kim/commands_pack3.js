// kim/commands_pack3.js — Gacha BL/Yaoi + interacciones anime SFW (GIFs).

import axios from 'axios';
import { command } from './registry.js';
import { getUser, getChat, db } from './db.js';
import { getBuffer } from './helpers.js';
import { CURRENCY, fmtMoney, RARITIES, rollRarity, rarityByKey, CHARACTERS, findCharacter } from './theme.js';
import { getGifBuffer, sendGif } from './media.js';

const needGroup = (m) => { if (!m.isGroup) { m.reply('⚠️ Solo en grupos.'); return false; } return true; };
const target = (m, text) => {
    if (m.mentionedJid?.[0]) return m.mentionedJid[0];
    if (m.quoted?.sender) return m.quoted.sender;
    if (text) { const n = String(text).replace(/[^0-9]/g, ''); if (n.length >= 8) return n + '@s.whatsapp.net'; }
    return null;
};

// Imagen del personaje: se genera con IA keyless (retrato estilo anime BL).
// Cacheada por nombre para no regenerar. SFW.
async function charImage(name, series) {
    const prompt = `anime portrait of ${name} from ${series}, boys love style, handsome male character, soft lighting, safe for work, fully clothed`;
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=768&nologo=true&seed=${(name.length * 7) % 1000}`;
    return getBuffer(url, { timeout: 60000 });
}

// ─── Estado gacha por chat: el "rolled" actual pendiente de claim ───
const _pendingRoll = new Map(); // chatJid → { char, rarity, ts }

// ════════════════════════════════════════════════════════════════════
// GACHA BL/Yaoi
// ════════════════════════════════════════════════════════════════════
command({ name: 'rollwaifu', aliases: ['rw', 'roll'], category: 'gacha', description: 'Invoca un personaje BL aleatorio' },
async (conn, m) => {
    if (!needGroup(m)) return;
    if (getChat(m.chat).gacha === false) return m.reply('🎴 El gacha está desactivado en este grupo (.gacha enable).');
    const char = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
    const rarity = rollRarity();
    _pendingRoll.set(m.chat, { char, rarity, ts: Date.now() });
    try {
        const img = await charImage(char.name, char.series);
        const caption = `🎴 *${char.name}* ${rarity.emoji}\n📺 ${char.series}\n${rarity.stars} ${rarity.name}\n💞 Valor: ${rarity.value} Lazos\n\nUsa *.claim ${char.name}* para reclamarlo.`;
        if (img) await conn.sendMessage(m.chat, { image: img, caption }, { quoted: m });
        else await m.reply(caption);
    } catch { await m.reply(`🎴 *${char.name}* ${rarity.emoji} (${rarity.name}) — usa .claim ${char.name}`); }
});

command({ name: 'claim', aliases: ['c', 'reclamar'], category: 'gacha', description: 'Reclama el personaje invocado' },
async (conn, m, args, text) => {
    if (!needGroup(m)) return;
    const pending = _pendingRoll.get(m.chat);
    if (!pending || Date.now() - pending.ts > 60000) return m.reply('No hay personaje para reclamar. Usa .roll primero.');
    const u = getUser(m.sender);
    u.characters = u.characters || [];
    if (u.characters.find(c => c.id === pending.char.id)) return m.reply('Ya tienes a ese personaje en tu harem.');
    u.characters.push({ id: pending.char.id, name: pending.char.name, series: pending.char.series, rarity: pending.rarity.key, value: pending.rarity.value, claimedAt: Date.now() });
    _pendingRoll.delete(m.chat); db.markDirty();
    await conn.sendMessage(m.chat, { text: `💖 @${m.sender.split('@')[0]} reclamó a *${pending.char.name}* ${pending.rarity.emoji} (${pending.rarity.name}).`, mentions: [m.sender] }, { quoted: m });
});

command({ name: 'harem', aliases: ['waifus', 'claims'], category: 'gacha', description: 'Tu colección de personajes' },
async (conn, m, args, text) => {
    const t = target(m, text) || m.sender;
    const u = getUser(t);
    const chars = u.characters || [];
    if (!chars.length) return m.reply(t === m.sender ? 'Tu harem está vacío. Usa .roll y .claim.' : 'Ese usuario no tiene personajes.');
    const byRar = {}; for (const c of chars) (byRar[c.rarity] ||= []).push(c);
    let out = `🎴 *Harem de @${t.split('@')[0]}* (${chars.length})\n`;
    for (const r of RARITIES) { const list = byRar[r.key]; if (!list) continue; out += `\n${r.emoji} *${r.name}*\n` + list.map(c => `• ${c.name} — ${c.series}`).join('\n') + '\n'; }
    await conn.sendMessage(m.chat, { text: out.slice(0, 3800), mentions: [t] }, { quoted: m });
});

command({ name: 'charinfo', aliases: ['winfo', 'waifuinfo'], category: 'gacha', description: 'Info de un personaje' },
async (conn, m, args, text) => {
    const c = findCharacter(text);
    if (!c) return m.reply('No encontré ese personaje. Usa .serielist o .charinfo <nombre>.');
    const owner = Object.entries(db.data.users || {}).find(([, u]) => (u.characters || []).some(x => x.id === c.id));
    await m.reply(`🎴 *${c.name}*\n📺 Serie: ${c.series}\n👤 Dueño: ${owner ? '@' + owner[0].split('@')[0] : 'libre'}`, null, { mentions: owner ? [owner[0]] : [] });
});

command({ name: 'charimage', aliases: ['waifuimage', 'cimage', 'wimage'], category: 'gacha', description: 'Imagen del personaje' },
async (conn, m, args, text) => {
    const c = findCharacter(text);
    if (!c) return m.reply('No encontré ese personaje.');
    try { const img = await charImage(c.name, c.series); if (img) return conn.sendMessage(m.chat, { image: img, caption: `🎴 ${c.name} — ${c.series}` }, { quoted: m }); } catch { /* */ }
    await m.reply('No pude generar la imagen ahora.');
});

command({ name: 'serielist', aliases: ['slist', 'animelist'], category: 'gacha', description: 'Series del gacha' },
async (conn, m) => {
    const series = [...new Set(CHARACTERS.map(c => c.series))];
    await m.reply(`📺 *Series BL disponibles* (${series.length})\n\n` + series.map((s, i) => `${i + 1}. ${s}`).join('\n'));
});

command({ name: 'waifusboard', aliases: ['waifustop', 'topwaifus', 'wtop'], category: 'gacha', description: 'Top de coleccionistas' },
async (conn, m) => {
    const entries = Object.entries(db.data.users || {})
        .map(([jid, u]) => ({ jid, n: (u.characters || []).length, val: (u.characters || []).reduce((s, c) => s + (c.value || 0), 0) }))
        .filter(e => e.n > 0).sort((a, b) => b.val - a.val).slice(0, 10);
    if (!entries.length) return m.reply('Nadie tiene personajes aún.');
    const list = entries.map((e, i) => `${i + 1}. @${e.jid.split('@')[0]} — ${e.n} personajes (${e.val} 💞)`).join('\n');
    await conn.sendMessage(m.chat, { text: `🏆 *TOP COLECCIONISTAS*\n\n${list}`, mentions: entries.map(e => e.jid) }, { quoted: m });
});

command({ name: 'sell', aliases: ['vender'], category: 'gacha', description: 'Vende un personaje por Lazos' },
async (conn, m, args, text) => {
    const u = getUser(m.sender);
    const c = findCharacter(text);
    if (!c) return m.reply('Uso: .sell <nombre del personaje>');
    const idx = (u.characters || []).findIndex(x => x.id === c.id);
    if (idx === -1) return m.reply('No tienes ese personaje.');
    const [rm] = u.characters.splice(idx, 1);
    const gain = Math.floor((rm.value || 100) * 0.7);
    u.money += gain; db.markDirty();
    await m.reply(`💸 Vendiste a *${rm.name}* por ${fmtMoney(gain)}.`);
});

command({ name: 'buycharacter', aliases: ['buychar', 'buyc'], category: 'gacha', description: 'Compra un personaje libre' },
async (conn, m, args, text) => {
    const u = getUser(m.sender);
    const c = findCharacter(text);
    if (!c) return m.reply('Uso: .buyc <nombre>');
    const taken = Object.values(db.data.users || {}).some(x => (x.characters || []).some(y => y.id === c.id));
    if (taken) return m.reply('Ese personaje ya tiene dueño.');
    const rarity = rollRarity(); const price = rarity.value;
    if (u.money < price) return m.reply(`Cuesta ${fmtMoney(price)} y no te alcanza.`);
    u.money -= price; (u.characters ||= []).push({ id: c.id, name: c.name, series: c.series, rarity: rarity.key, value: price, claimedAt: Date.now() }); db.markDirty();
    await m.reply(`🛒 Compraste a *${c.name}* ${rarity.emoji} por ${fmtMoney(price)}.`);
});

command({ name: 'givechar', aliases: ['givewaifu', 'regalar'], category: 'gacha', description: 'Regala un personaje' },
async (conn, m, args, text) => {
    if (!needGroup(m)) return;
    const t = target(m, text);
    if (!t) return m.reply('Uso: .givechar @user <nombre>');
    const name = (text || '').replace(/@?\d{6,}/g, '').trim();
    const c = findCharacter(name);
    if (!c) return m.reply('Indica el personaje a regalar.');
    const u = getUser(m.sender); const idx = (u.characters || []).findIndex(x => x.id === c.id);
    if (idx === -1) return m.reply('No tienes ese personaje.');
    const [moved] = u.characters.splice(idx, 1);
    (getUser(t).characters ||= []).push(moved); db.markDirty();
    await conn.sendMessage(m.chat, { text: `🎁 @${m.sender.split('@')[0]} le regaló a *${moved.name}* a @${t.split('@')[0]}.`, mentions: [m.sender, t] }, { quoted: m });
});

command({ name: 'setfavourite', aliases: ['setfav'], category: 'gacha', description: 'Marca tu personaje favorito' },
async (conn, m, args, text) => {
    const u = getUser(m.sender); const c = findCharacter(text);
    if (!c) return m.reply('Uso: .setfav <nombre>');
    if (!(u.characters || []).some(x => x.id === c.id)) return m.reply('No tienes ese personaje.');
    u.favorite = c.id; db.markDirty();
    await m.reply(`⭐ *${c.name}* es ahora tu personaje favorito.`);
});

command({ name: 'gachainfo', aliases: ['ginfo', 'infogacha'], category: 'gacha', description: 'Cómo funciona el gacha' },
async (conn, m) => {
    const rar = RARITIES.map(r => `${r.emoji} ${r.name} (${r.stars}) — ${r.weight}%`).join('\n');
    await m.reply(`🎴 *GACHA BL/Yaoi*\n\nInvoca con *.roll* y reclama con *.claim <nombre>* en 60s.\nVende con *.sell*, regala con *.givechar*, compra libres con *.buyc*.\n\n*Rarezas:*\n${rar}\n\nPersonajes en el roster: ${CHARACTERS.length}. Sugiere más con *.suggest*.`);
});

// ════════════════════════════════════════════════════════════════════
// INTERACCIONES ANIME SFW (GIFs) — fuente: nekos.best (keyless, SFW)
// ════════════════════════════════════════════════════════════════════
// Mapa comando → categoría del API. Solo categorías SFW. Las románticas
// (hug, kiss, cuddle, handhold…) encajan con la temática BL.
const NEKOS_BEST = new Set(['baka', 'bite', 'blush', 'bored', 'cry', 'cuddle', 'dance', 'facepalm', 'feed', 'happy', 'highfive', 'handhold', 'hug', 'kick', 'kiss', 'laugh', 'lurk', 'nod', 'nom', 'nope', 'pat', 'peck', 'poke', 'pout', 'punch', 'run', 'shoot', 'shrug', 'slap', 'sleep', 'smile', 'smug', 'stare', 'think', 'thumbsup', 'tickle', 'wave', 'wink', 'yawn', 'yeet']);

// (comando[, aliases], categoríaAPI, frase) — frase con {a}=autor {b}=objetivo
const INTERACTIONS = [
    [['hug', 'abrazar'], 'hug', '{a} abraza a {b} 🫂'],
    [['kiss', 'muak'], 'kiss', '{a} besa a {b} 💋'],
    [['kisscheek', 'beso'], 'peck', '{a} besa la mejilla de {b} 😚'],
    [['cuddle'], 'cuddle', '{a} se acurruca con {b} 🥰'],
    [['pat'], 'pat', '{a} acaricia a {b} 🤲'],
    [['poke'], 'poke', '{a} pica a {b} 👉'],
    [['slap'], 'slap', '{a} le da una bofetada a {b} 👋'],
    [['punch'], 'punch', '{a} golpea a {b} 🥊'],
    [['bite'], 'bite', '{a} muerde a {b} 😬'],
    [['tickle'], 'tickle', '{a} le hace cosquillas a {b} 🤭'],
    [['kill'], 'shoot', '{a} "elimina" a {b} 💀'],
    [['kick'], 'kick', '{a} patea a {b} 🦵'],
    [['dance'], 'dance', '{a} baila 💃'],
    [['cry'], 'cry', '{a} llora 😭'],
    [['laugh'], 'laugh', '{a} se ríe 😂'],
    [['happy', 'feliz'], 'happy', '{a} salta de felicidad 😄'],
    [['blush'], 'blush', '{a} se sonroja 😊'],
    [['pout'], 'pout', '{a} hace pucheros 😤'],
    [['shy', 'timido'], 'blush', '{a} se siente tímido 😳'],
    [['sad', 'triste'], 'cry', '{a} está triste 😔'],
    [['bored', 'aburrido'], 'bored', '{a} está aburrido 😪'],
    [['angry', 'enojado'], 'pout', '{a} está enojado 😠'],
    [['scared'], 'cry', '{a} está asustado 😱'],
    [['sleep'], 'sleep', '{a} duerme 😴'],
    [['think'], 'think', '{a} piensa 🤔'],
    [['greet', 'hi'], 'wave', '{a} saluda 👋'],
    [['wink'], 'wink', '{a} guiña el ojo 😉'],
    [['smug'], 'smug', '{a} sonríe con superioridad 😏'],
    [['facepalm'], 'facepalm', '{a} se da una palmada en la cara 🤦'],
    [['clap', 'aplaudir'], 'thumbsup', '{a} aplaude 👏'],
    [['run'], 'run', '{a} corre 🏃'],
    [['eat', 'comer'], 'nom', '{a} come 🍽️'],
    [['love', 'amor'], 'hug', '{a} ama a {b} 💗'],
    [['lick'], 'tickle', '{a} lame a {b} 👅'],
    [['seduce'], 'wink', '{a} intenta seducir a {b} 😏'],
    [['push'], 'kick', '{a} empuja a {b}'],
    [['scream'], 'cry', '{a} grita 😱'],
    [['nope'], 'nope', '{a} se niega 🙅'],
    [['cook'], 'nom', '{a} cocina 🍳'],
    [['draw'], 'think', '{a} dibuja 🎨'],
    [['sing'], 'happy', '{a} canta 🎤'],
    [['walk'], 'run', '{a} camina 🚶'],
    [['jump'], 'happy', '{a} salta'],
    [['gaming'], 'happy', '{a} juega videojuegos 🎮'],
    [['coffee', 'cafe'], 'nom', '{a} toma café ☕'],
    [['bath'], 'blush', '{a} se baña 🛁'],
    [['bleh'], 'pout', '{a} saca la lengua 😛'],
    [['call'], 'wave', '{a} llama a {b} 📞'],
    [['cold'], 'cry', '{a} tiene frío 🥶'],
    [['heat'], 'blush', '{a} tiene calor 🥵'],
    [['drunk'], 'laugh', '{a} está borracho 🍻'],
    [['psycho'], 'smug', '{a} se hace el psicópata 🔪'],
    [['dramatic', 'drama'], 'pout', '{a} actúa dramático 🎭'],
    [['smoke'], 'smug', '{a} fuma 🚬'],
    [['spit', 'escupir'], 'nope', '{a} escupe'],
    [['step', 'pisar'], 'kick', '{a} pisa a {b} 👟'],
];

function makeInteraction(cat, phraseTpl) {
    return async (conn, m, args, text) => {
        const needsTarget = phraseTpl.includes('{b}');
        const t = needsTarget ? target(m, text) : null;
        const a = `@${m.sender.split('@')[0]}`;
        const b = t ? `@${t.split('@')[0]}` : '';
        if (needsTarget && !t) return m.reply('Menciona a alguien para esta interacción.');
        const phrase = phraseTpl.replace('{a}', a).replace('{b}', b);
        const mentions = [m.sender]; if (t) mentions.push(t);
        try {
            const res = await axios.get(`https://nekos.best/api/v2/${cat}`, { timeout: 15000 });
            const url = res.data?.results?.[0]?.url;
            if (url) {
                const buf = await getGifBuffer(cat, url);
                if (buf) return sendGif(conn, m.chat, buf, { caption: phrase, mentions, quoted: m });
            }
            await conn.sendMessage(m.chat, { text: phrase, mentions }, { quoted: m });
        } catch {
            await conn.sendMessage(m.chat, { text: phrase, mentions }, { quoted: m });
        }
    };
}

for (const [names, cat, phrase] of INTERACTIONS) {
    command({ name: names[0], aliases: names.slice(1), category: 'anime', description: phrase.replace('{a}', 'tú').replace('{b}', 'alguien') },
        makeInteraction(cat, phrase));
}

export default true;
