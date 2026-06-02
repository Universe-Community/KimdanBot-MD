// kim/commands_pack6.js — Sistema completo de STICKERS y PACKS.
// Packs persistidos en db.data.stickerpacks. Arquitectura nativa:
// COMMAND_META + switch/case. Convierte imagen/video↔sticker y gestiona
// colecciones de stickers con metadata, visibilidad y favoritos.

import { command } from './registry.js';
import { getUser, db } from './db.js';
import { box } from './ui.js';

function packsRoot() { db.data.stickerpacks ||= {}; return db.data.stickerpacks; }
function userPacks(jid) { const r = packsRoot(); r[jid] ||= {}; return r[jid]; }
const stickerMime = (q) => /webp|sticker/.test(q?.msg?.mimetype || q?.mtype || '');
const imgVidMime = (q) => /image|video|gif|webp/.test(q?.msg?.mimetype || q?.mtype || '');

const COMMAND_META = [
    { names: ['sticker', 's', 'stickers'], category: 'sticker', description: 'Convierte imagen/video a sticker' },
    { names: ['newpack', 'newstickerpack'], category: 'sticker', description: 'Crea un pack de stickers' },
    { names: ['delpack'], category: 'sticker', description: 'Elimina un pack' },
    { names: ['stickeradd', 'addsticker'], category: 'sticker', description: 'Agrega el sticker citado a un pack' },
    { names: ['stickerdel', 'delsticker'], category: 'sticker', description: 'Quita un sticker de un pack (por índice)' },
    { names: ['getpack', 'stickerpack', 'pack'], category: 'sticker', description: 'Envía los stickers de un pack' },
    { names: ['stickerpacks', 'packlist'], category: 'sticker', description: 'Lista tus packs' },
    { names: ['setpackprivate', 'setpackpriv', 'packprivate'], category: 'sticker', description: 'Hace un pack privado' },
    { names: ['setpackpublic', 'setpackpub', 'packpublic'], category: 'sticker', description: 'Hace un pack público' },
    { names: ['packfavourite', 'setpackfav', 'packfav'], category: 'sticker', description: 'Marca un pack como favorito' },
    { names: ['packunfavourite', 'unsetpackfav', 'packunfav'], category: 'sticker', description: 'Quita un pack de favoritos' },
    { names: ['setstickermeta', 'setmeta'], category: 'sticker', description: 'Fija autor|pack por defecto de tus stickers' },
    { names: ['setstickerpackdesc', 'setpackdesc', 'packdesc'], category: 'sticker', description: 'Cambia la descripción de un pack' },
    { names: ['delstickermeta', 'delmeta'], category: 'sticker', description: 'Restaura autor/pack por defecto' },
];

export async function execute(conn, m, cmd, args, text) {
    const jid = m.sender;
    switch (cmd) {

    case 'sticker': {
        const q = m.quoted || m;
        if (!q.download || !imgVidMime(q)) return m.reply('🌺 Responde a una *imagen* o *video* (≤20s) con .sticker');
        const u = getUser(jid);
        const packname = u.stickerPack || global.packname || 'KimdanBot';
        const author = u.stickerAuthor || global.author || '💜 BL/Yaoi';
        try {
            const mime = q.msg?.mimetype || q.mtype || '';
            await m.reply('🤚 Creando sticker...');
            const media = await q.download();
            if (/video|gif/.test(mime)) await conn.sendVideoAsSticker(m.chat, media, m, { packname, author });
            else await conn.sendImageAsSticker(m.chat, media, m, { packname, author });
        } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
        break;
    }

    case 'newpack': {
        const name = (text || '').trim();
        if (!name) return m.reply('Uso: .newpack <nombre>');
        const packs = userPacks(jid);
        if (packs[name]) return m.reply('Ya tienes un pack con ese nombre.');
        packs[name] = { stickers: [], desc: '', private: false, fav: false, created: Date.now() };
        db.markDirty();
        await m.reply(box('🎁 PACK CREADO', [`Nombre: *${name}*`, 'Agrega stickers con .stickeradd ' + name + ' (citando un sticker)']));
        break;
    }
    case 'delpack': {
        const name = (text || '').trim(); const packs = userPacks(jid);
        if (!packs[name]) return m.reply('No tienes ese pack.');
        delete packs[name]; db.markDirty();
        await m.reply(`🗑️ Pack *${name}* eliminado.`);
        break;
    }
    case 'stickeradd': {
        const name = (text || '').trim(); const packs = userPacks(jid);
        if (!packs[name]) return m.reply('No tienes ese pack. Créalo con .newpack ' + (name || '<nombre>'));
        const q = m.quoted;
        if (!q || !stickerMime(q)) return m.reply('Responde a un *sticker* con .stickeradd ' + name);
        try {
            const buf = await q.download();
            packs[name].stickers.push(buf.toString('base64'));
            db.markDirty();
            await m.reply(`✅ Sticker agregado a *${name}* (${packs[name].stickers.length} en total).`);
        } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
        break;
    }
    case 'stickerdel': {
        const parts = (text || '').trim().split(/\s+/); const name = parts[0]; const idx = parseInt(parts[1]);
        const packs = userPacks(jid);
        if (!packs[name]) return m.reply('Uso: .stickerdel <pack> <número>');
        if (!idx || idx < 1 || idx > packs[name].stickers.length) return m.reply(`Índice fuera de rango (1–${packs[name].stickers.length}).`);
        packs[name].stickers.splice(idx - 1, 1); db.markDirty();
        await m.reply(`🗑️ Sticker #${idx} quitado de *${name}*.`);
        break;
    }
    case 'getpack': {
        const name = (text || '').trim();
        // Buscar en mis packs o en packs públicos de otros
        let pack = userPacks(jid)[name];
        let owner = jid;
        if (!pack) {
            for (const [oj, ps] of Object.entries(packsRoot())) {
                if (ps[name] && !ps[name].private) { pack = ps[name]; owner = oj; break; }
            }
        }
        if (!pack) return m.reply('No encontré ese pack (o es privado).');
        if (!pack.stickers.length) return m.reply('Ese pack no tiene stickers.');
        const u = getUser(owner);
        await m.reply(`📦 Enviando *${name}* (${pack.stickers.length} stickers)...`);
        for (const b64 of pack.stickers.slice(0, 30)) {
            try { await conn.sendMessage(m.chat, { sticker: Buffer.from(b64, 'base64') }); } catch { /* */ }
        }
        break;
    }
    case 'stickerpacks': {
        const packs = userPacks(jid);
        const names = Object.keys(packs);
        if (!names.length) return m.reply('No tienes packs. Crea uno con .newpack <nombre>');
        const lines = names.map(n => {
            const p = packs[n];
            return `${p.fav ? '⭐' : '•'} *${n}* — ${p.stickers.length} stickers ${p.private ? '🔒' : '🌐'}${p.desc ? `\n   _${p.desc}_` : ''}`;
        });
        await conn.sendMessage(m.chat, { text: box('📚 TUS PACKS', lines) }, { quoted: m });
        break;
    }
    case 'setpackprivate': case 'setpackpublic': {
        const name = (text || '').trim(); const packs = userPacks(jid);
        if (!packs[name]) return m.reply('No tienes ese pack.');
        packs[name].private = (cmd === 'setpackprivate'); db.markDirty();
        await m.reply(`${packs[name].private ? '🔒' : '🌐'} Pack *${name}* ahora es ${packs[name].private ? 'privado' : 'público'}.`);
        break;
    }
    case 'packfavourite': case 'packunfavourite': {
        const name = (text || '').trim(); const packs = userPacks(jid);
        if (!packs[name]) return m.reply('No tienes ese pack.');
        packs[name].fav = (cmd === 'packfavourite'); db.markDirty();
        await m.reply(`${packs[name].fav ? '⭐' : '☆'} Pack *${name}* ${packs[name].fav ? 'marcado como favorito' : 'quitado de favoritos'}.`);
        break;
    }
    case 'setstickermeta': {
        // formato: autor | pack
        const [author, pack] = (text || '').split('|').map(s => s.trim());
        if (!author && !pack) return m.reply('Uso: .setmeta <autor> | <pack>');
        const u = getUser(jid);
        if (author) u.stickerAuthor = author;
        if (pack) u.stickerPack = pack;
        db.markDirty();
        await m.reply(box('🏷️ METADATA DE STICKERS', [`Autor: ${u.stickerAuthor || '(por defecto)'}`, `Pack: ${u.stickerPack || '(por defecto)'}`]));
        break;
    }
    case 'setstickerpackdesc': {
        const [name, ...rest] = (text || '').split('|').map(s => s.trim());
        const desc = rest.join(' | ');
        const packs = userPacks(jid);
        if (!packs[name]) return m.reply('Uso: .setpackdesc <pack> | <descripción>');
        packs[name].desc = desc.slice(0, 200); db.markDirty();
        await m.reply(`📝 Descripción de *${name}* actualizada.`);
        break;
    }
    case 'delstickermeta': {
        const u = getUser(jid); u.stickerAuthor = null; u.stickerPack = null; db.markDirty();
        await m.reply('♻️ Autor y pack de stickers restaurados a los valores por defecto.');
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
