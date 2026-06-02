// kim/commands_pack3.js — Gacha BL/Yaoi + interacciones anime SFW (GIFs).
// Arquitectura nativa KimdanBot: COMMAND_META + switch/case + registro.

import axios from 'axios';
import { command } from './registry.js';
import { getUser, getChat, db } from './db.js';
import { getBuffer } from './helpers.js';
import { fmtMoney, fmtAffinity, RARITIES, rollRarity, CHARACTERS, findCharacter, charsBySeries } from './theme.js';
import { getGifBuffer, sendGif } from './media.js';

const needGroup = (m) => { if (!m.isGroup) { m.reply('⚠️ Solo en grupos.'); return false; } return true; };
const target = (m, text) => {
    if (m.mentionedJid?.[0]) return m.mentionedJid[0];
    if (m.quoted?.sender) return m.quoted.sender;
    if (text) { const n = String(text).replace(/[^0-9]/g, ''); if (n.length >= 8) return n + '@s.whatsapp.net'; }
    return null;
};
async function charImage(name, series) {
    const prompt = `anime portrait of ${name} from ${series}, boys love manhwa style, handsome male character, soft lighting, safe for work, fully clothed`;
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=768&nologo=true&seed=${(name.length*7)%1000}`;
    return getBuffer(url, { timeout: 60000 });
}
const _pendingRoll = new Map(); // chat → { char, rarity, ts }

// Interacciones (comando[, alias], categoríaNekos, frase con {a}/{b})
const NEKOS_BEST = new Set(['baka','bite','blush','bored','cry','cuddle','dance','facepalm','feed','happy','highfive','handhold','hug','kick','kiss','laugh','lurk','nod','nom','nope','pat','peck','poke','pout','punch','run','shoot','shrug','slap','sleep','smile','smug','stare','think','thumbsup','tickle','wave','wink','yawn','yeet']);
const INTERACTIONS = [
    [['hug','abrazar'],'hug','{a} abraza a {b} 🫂'], [['kiss','muak'],'kiss','{a} besa a {b} 💋'],
    [['kisscheek','beso'],'peck','{a} besa la mejilla de {b} 😚'], [['cuddle'],'cuddle','{a} se acurruca con {b} 🥰'],
    [['handhold','tomarmano'],'handhold','{a} toma la mano de {b} 🤝'], [['pat'],'pat','{a} acaricia a {b} 🤲'],
    [['poke'],'poke','{a} pica a {b} 👉'], [['slap'],'slap','{a} le da una bofetada a {b} 👋'],
    [['punch'],'punch','{a} golpea a {b} 🥊'], [['bite'],'bite','{a} muerde a {b} 😬'],
    [['tickle'],'tickle','{a} le hace cosquillas a {b} 🤭'], [['kill'],'shoot','{a} "elimina" a {b} 💀'],
    [['kick'],'kick','{a} patea a {b} 🦵'], [['dance'],'dance','{a} baila 💃'], [['cry'],'cry','{a} llora 😭'],
    [['laugh'],'laugh','{a} se ríe 😂'], [['happy','feliz'],'happy','{a} salta de felicidad 😄'],
    [['blush'],'blush','{a} se sonroja 😊'], [['pout'],'pout','{a} hace pucheros 😤'],
    [['shy','timido'],'blush','{a} se siente tímido 😳'], [['sad','triste'],'cry','{a} está triste 😔'],
    [['bored','aburrido'],'bored','{a} está aburrido 😪'], [['angry','enojado'],'pout','{a} está enojado 😠'],
    [['scared'],'cry','{a} está asustado 😱'], [['sleep'],'sleep','{a} duerme 😴'], [['think'],'think','{a} piensa 🤔'],
    [['greet','hi'],'wave','{a} saluda 👋'], [['wink'],'wink','{a} guiña el ojo 😉'], [['smug'],'smug','{a} sonríe con superioridad 😏'],
    [['facepalm'],'facepalm','{a} se da una palmada 🤦'], [['clap','aplaudir'],'thumbsup','{a} aplaude 👏'],
    [['run'],'run','{a} corre 🏃'], [['eat','comer'],'nom','{a} come 🍽️'], [['love','amor'],'hug','{a} ama a {b} 💗'],
    [['lick'],'tickle','{a} lame a {b} 👅'], [['seduce'],'wink','{a} intenta seducir a {b} 😏'],
    [['push'],'kick','{a} empuja a {b}'], [['scream'],'cry','{a} grita 😱'], [['nope'],'nope','{a} se niega 🙅'],
    [['cook'],'nom','{a} cocina 🍳'], [['draw'],'think','{a} dibuja 🎨'], [['sing'],'happy','{a} canta 🎤'],
    [['walk'],'run','{a} camina 🚶'], [['jump'],'happy','{a} salta'], [['gaming'],'happy','{a} juega videojuegos 🎮'],
    [['coffee','cafe'],'nom','{a} toma café ☕'], [['bath'],'blush','{a} se baña 🛁'], [['bleh'],'pout','{a} saca la lengua 😛'],
    [['call'],'wave','{a} llama a {b} 📞'], [['cold'],'cry','{a} tiene frío 🥶'], [['heat'],'blush','{a} tiene calor 🥵'],
    [['drunk'],'laugh','{a} está borracho 🍻'], [['psycho'],'smug','{a} se hace el psicópata 🔪'],
    [['dramatic','drama'],'pout','{a} actúa dramático 🎭'], [['smoke'],'smug','{a} fuma 🚬'],
    [['spit','escupir'],'nope','{a} escupe'], [['step','pisar'],'kick','{a} pisa a {b} 👟'],
];
const INTER_MAP = new Map();
for (const [names, cat, phrase] of INTERACTIONS) INTER_MAP.set(names[0], { cat, phrase });

const COMMAND_META = [
    { names: ['rollwaifu', 'rw', 'roll'], category: 'gacha', description: 'Invoca un personaje BL aleatorio' },
    { names: ['claim', 'c', 'reclamar'], category: 'gacha', description: 'Reclama el personaje invocado' },
    { names: ['harem', 'waifus', 'claims'], category: 'gacha', description: 'Tu colección de personajes' },
    { names: ['charinfo', 'winfo', 'waifuinfo'], category: 'gacha', description: 'Info de un personaje' },
    { names: ['charimage', 'waifuimage', 'cimage', 'wimage'], category: 'gacha', description: 'Imagen del personaje' },
    { names: ['serielist', 'slist', 'animelist'], category: 'gacha', description: 'Series del gacha' },
    { names: ['waifusboard', 'waifustop', 'topwaifus', 'wtop'], category: 'gacha', description: 'Top de coleccionistas' },
    { names: ['sell', 'vender'], category: 'gacha', description: 'Vende un personaje por JX' },
    { names: ['buycharacter', 'buychar', 'buyc'], category: 'gacha', description: 'Compra un personaje libre' },
    { names: ['givechar', 'givewaifu', 'regalar'], category: 'gacha', description: 'Regala un personaje' },
    { names: ['setfavourite', 'setfav'], category: 'gacha', description: 'Marca tu personaje favorito' },
    { names: ['gachainfo', 'ginfo', 'infogacha'], category: 'gacha', description: 'Cómo funciona el gacha' },
    ...INTERACTIONS.map(([names, , phrase]) => ({ names, category: 'anime', description: phrase.replace('{a}','tú').replace('{b}','alguien') })),
];

export async function execute(conn, m, cmd, args, text) {
    // Interacciones anime
    if (INTER_MAP.has(cmd)) {
        const { cat, phrase } = INTER_MAP.get(cmd);
        const needsTarget = phrase.includes('{b}');
        const t = needsTarget ? target(m, text) : null;
        if (needsTarget && !t) return m.reply('Menciona a alguien para esta interacción.');
        const out = phrase.replace('{a}', `@${m.sender.split('@')[0]}`).replace('{b}', t ? `@${t.split('@')[0]}` : '');
        const mentions = [m.sender]; if (t) mentions.push(t);
        // Interacciones románticas BL suman afinidad mutua
        if (t && ['hug','kiss','kisscheek','cuddle','handhold','love'].includes(cmd)) {
            try { getUser(m.sender).affinity = (getUser(m.sender).affinity||0)+1; getUser(t).affinity = (getUser(t).affinity||0)+1; db.markDirty(); } catch { /* */ }
        }
        try {
            const res = await axios.get(`https://nekos.best/api/v2/${cat}`, { timeout: 15000 });
            const url = res.data?.results?.[0]?.url;
            if (url) { const buf = await getGifBuffer(cat, url); if (buf) return sendGif(conn, m.chat, buf, { caption: out, mentions, quoted: m }); }
            await conn.sendMessage(m.chat, { text: out, mentions }, { quoted: m });
        } catch { await conn.sendMessage(m.chat, { text: out, mentions }, { quoted: m }); }
        return;
    }

    switch (cmd) {
    case 'rollwaifu': {
        if (!needGroup(m)) return;
        if (getChat(m.chat).gacha === false) return m.reply('🎴 El gacha está desactivado (.gacha enable).');
        const char = CHARACTERS[Math.floor(Math.random()*CHARACTERS.length)];
        const rarity = rollRarity(); _pendingRoll.set(m.chat, { char, rarity, ts: Date.now() });
        const caption = `🎴 *${char.name}* ${rarity.emoji}\n📺 ${char.series}\n${rarity.stars} ${rarity.name}\n💜 Valor: ${rarity.value} JX\n\nUsa *.claim ${char.name}* en 60s.`;
        try { const img = await charImage(char.name, char.series); if (img) return conn.sendMessage(m.chat, { image: img, caption }, { quoted: m }); } catch { /* */ }
        await m.reply(caption);
        break;
    }
    case 'claim': {
        if (!needGroup(m)) return;
        const p = _pendingRoll.get(m.chat);
        if (!p || Date.now()-p.ts > 60000) return m.reply('No hay personaje para reclamar. Usa .roll primero.');
        const u = getUser(m.sender); u.characters ||= [];
        if (u.characters.find(c=>c.id===p.char.id)) return m.reply('Ya tienes a ese personaje.');
        u.characters.push({ id: p.char.id, name: p.char.name, series: p.char.series, rarity: p.rarity.key, value: p.rarity.value, claimedAt: Date.now() });
        _pendingRoll.delete(m.chat); db.markDirty();
        await conn.sendMessage(m.chat, { text: `💖 @${m.sender.split('@')[0]} reclamó a *${p.char.name}* ${p.rarity.emoji} (${p.rarity.name}).`, mentions: [m.sender] }, { quoted: m });
        break;
    }
    case 'harem': {
        const t = target(m, text) || m.sender; const u = getUser(t); const chars = u.characters || [];
        if (!chars.length) return m.reply(t===m.sender ? 'Tu harem está vacío. Usa .roll y .claim.' : 'Ese usuario no tiene personajes.');
        const byRar = {}; for (const c of chars) (byRar[c.rarity] ||= []).push(c);
        let out = `🎴 *Harem de @${t.split('@')[0]}* (${chars.length})\n`;
        for (const r of RARITIES) { const l = byRar[r.key]; if (!l) continue; out += `\n${r.emoji} *${r.name}*\n` + l.map(c=>`• ${c.name} — ${c.series}`).join('\n') + '\n'; }
        await conn.sendMessage(m.chat, { text: out.slice(0,3800), mentions: [t] }, { quoted: m });
        break;
    }
    case 'charinfo': {
        const c = findCharacter(text); if (!c) return m.reply('No encontré ese personaje. Usa .serielist.');
        const owner = Object.entries(db.data.users||{}).find(([,u])=>(u.characters||[]).some(x=>x.id===c.id));
        await conn.sendMessage(m.chat, { text: `🎴 *${c.name}*\n📺 Serie: ${c.series}\n👤 Dueño: ${owner ? '@'+owner[0].split('@')[0] : 'libre'}`, mentions: owner?[owner[0]]:[] }, { quoted: m });
        break;
    }
    case 'charimage': {
        const c = findCharacter(text); if (!c) return m.reply('No encontré ese personaje.');
        try { const img = await charImage(c.name, c.series); if (img) return conn.sendMessage(m.chat, { image: img, caption: `🎴 ${c.name} — ${c.series}` }, { quoted: m }); } catch { /* */ }
        await m.reply('No pude generar la imagen ahora.');
        break;
    }
    case 'serielist': {
        const series = [...new Set(CHARACTERS.map(c=>c.series))];
        await m.reply(`📺 *Series BL del gacha* (${series.length})\n\n` + series.map((s,i)=>`${i+1}. ${s}`).join('\n'));
        break;
    }
    case 'waifusboard': {
        const e = Object.entries(db.data.users||{}).map(([jid,u])=>({ jid, n:(u.characters||[]).length, val:(u.characters||[]).reduce((s,c)=>s+(c.value||0),0) })).filter(x=>x.n>0).sort((a,b)=>b.val-a.val).slice(0,10);
        if (!e.length) return m.reply('Nadie tiene personajes aún.');
        await conn.sendMessage(m.chat, { text: `🏆 *TOP COLECCIONISTAS*\n\n` + e.map((x,i)=>`${i+1}. @${x.jid.split('@')[0]} — ${x.n} personajes (${x.val} 💜)`).join('\n'), mentions: e.map(x=>x.jid) }, { quoted: m });
        break;
    }
    case 'sell': {
        const u = getUser(m.sender); const c = findCharacter(text); if (!c) return m.reply('Uso: .sell <nombre>');
        const idx = (u.characters||[]).findIndex(x=>x.id===c.id); if (idx===-1) return m.reply('No tienes ese personaje.');
        const [rm] = u.characters.splice(idx,1); const gain = Math.floor((rm.value||100)*0.7); u.money += gain; db.markDirty();
        await m.reply(`💸 Vendiste a *${rm.name}* por ${fmtMoney(gain)}.`);
        break;
    }
    case 'buycharacter': {
        const u = getUser(m.sender); const c = findCharacter(text); if (!c) return m.reply('Uso: .buyc <nombre>');
        const taken = Object.values(db.data.users||{}).some(x=>(x.characters||[]).some(y=>y.id===c.id));
        if (taken) return m.reply('Ese personaje ya tiene dueño.');
        const rarity = rollRarity(); const price = rarity.value;
        if (u.money < price) return m.reply(`Cuesta ${fmtMoney(price)} y no te alcanza.`);
        u.money -= price; (u.characters ||= []).push({ id:c.id, name:c.name, series:c.series, rarity:rarity.key, value:price, claimedAt:Date.now() }); db.markDirty();
        await m.reply(`🛒 Compraste a *${c.name}* ${rarity.emoji} por ${fmtMoney(price)}.`);
        break;
    }
    case 'givechar': {
        if (!needGroup(m)) return; const t = target(m, text); if (!t) return m.reply('Uso: .givechar @user <nombre>');
        const name = (text||'').replace(/@?\d{6,}/g,'').trim(); const c = findCharacter(name); if (!c) return m.reply('Indica el personaje.');
        const u = getUser(m.sender); const idx = (u.characters||[]).findIndex(x=>x.id===c.id); if (idx===-1) return m.reply('No tienes ese personaje.');
        const [moved] = u.characters.splice(idx,1); (getUser(t).characters ||= []).push(moved); db.markDirty();
        await conn.sendMessage(m.chat, { text: `🎁 @${m.sender.split('@')[0]} le regaló a *${moved.name}* a @${t.split('@')[0]}.`, mentions: [m.sender, t] }, { quoted: m });
        break;
    }
    case 'setfavourite': {
        const u = getUser(m.sender); const c = findCharacter(text); if (!c) return m.reply('Uso: .setfav <nombre>');
        if (!(u.characters||[]).some(x=>x.id===c.id)) return m.reply('No tienes ese personaje.');
        u.favorite = c.id; db.markDirty(); await m.reply(`⭐ *${c.name}* es ahora tu favorito.`);
        break;
    }
    case 'gachainfo': {
        const rar = RARITIES.map(r=>`${r.emoji} ${r.name} (${r.stars}) — ${r.weight}%`).join('\n');
        await m.reply(`🎴 *GACHA BL/Yaoi*\n\nInvoca con *.roll* y reclama con *.claim <nombre>* (60s).\nVende *.sell*, regala *.givechar*, compra libres *.buyc*.\n\n*Rarezas:*\n${rar}\n\nRoster: ${CHARACTERS.length} personajes. Sugiere más con *.suggest*.`);
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
