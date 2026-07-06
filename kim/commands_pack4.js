// kim/commands_pack4.js — Perfiles, administración, utilidades, descargas
// (no-porno), sub-bots, BIBLIOTECA (MongoDB) y comandos BL/Yaoi extra.
// Arquitectura nativa KimdanBot: COMMAND_META + switch/case + registro.

import axios from 'axios';
import { command, commandCount, aliasCount, buildCmdMap } from './registry.js';
import { getUser, getChat, getSettings, db } from './db.js';
import { getBuffer } from './helpers.js';
import { fmtMoney, fmtAffinity, CHARACTERS, charsBySeries, BL_QUOTES, BL_RECS, isVip } from './theme.js';
import { box } from './ui.js';
import * as biblioteca from '../libs/biblioteca.js';

const needGroup = (m) => { if (!m.isGroup) { m.reply('⚠️ Solo en grupos.'); return false; } return true; };
const needAdmin = (m) => { if (!needGroup(m)) return false; if (!m.isSenderAdmin && !m.isOwner) { m.reply('⚠️ Solo administradores.'); return false; } return true; };
const needBotAdmin = (m) => { if (!m.isBotAdmin) { m.reply('⚠️ Necesito ser admin.'); return false; } return true; };
const needOwner = (m) => { if (!m.isOwner) { m.reply('⚠️ Solo el propietario.'); return false; } return true; };
const target = (m, text) => {
    if (m.mentionedJid?.[0]) return m.mentionedJid[0];
    if (m.quoted?.sender) return m.quoted.sender;
    if (text) { const n = String(text).replace(/[^0-9]/g, ''); if (n.length >= 8) return n + '@s.whatsapp.net'; }
    return null;
};
const isOn  = (a) => ['on','enable','activar','true','1'].includes(String(a||'').toLowerCase());
const isOff = (a) => ['off','disable','desactivar','false','0'].includes(String(a||'').toLowerCase());

const COMMAND_META = [
    // —— PERFILES ——
    { names: ['profile', 'perfil'], category: 'rpg', description: 'Ver tu perfil' },
    { names: ['level', 'lvl'], category: 'rpg', description: 'Tu nivel actual' },
    { names: ['leaderboard', 'lboard'], category: 'rpg', description: 'Ranking de EXP' },
    { names: ['setdescription', 'setperfil'], category: 'rpg', description: 'Tu descripción de perfil' },
    { names: ['setgenre'], category: 'rpg', description: 'Fija tu género' },
    { names: ['delgenre'], category: 'rpg', description: 'Quita tu género' },
    { names: ['setbirth'], category: 'rpg', description: 'Establece tu cumpleaños (DD/MM)' },
    { names: ['delbirth'], category: 'rpg', description: 'Borra tu cumpleaños' },
    { names: ['birthdays', 'cumpleaños', 'births', 'allbirthdays', 'allbirths'], category: 'rpg', description: 'Cumpleaños registrados' },
    { names: ['marry', 'casarse'], category: 'rpg', description: 'Cásate con alguien' },
    { names: ['divorce'], category: 'rpg', description: 'Divorciarse' },
    // —— BL / Yaoi extra ——
    { names: ['ship', 'shippear'], category: 'fun', description: 'Compatibilidad romántica entre dos personas' },
    { names: ['compatibility', 'compatibilidad', 'match'], category: 'fun', description: 'Compatibilidad BL contigo' },
    { names: ['blquote', 'fraseyaoi', 'frasebl'], category: 'fun', description: 'Frase romántica BL aleatoria' },
    { names: ['blrec', 'recomendacion', 'recomendar', 'blrecommend'], category: 'fun', description: 'Recomendación de obra BL' },
    { names: ['couples', 'parejas', 'ships'], category: 'fun', description: 'Parejas BL del gacha' },
    // —— ADMIN (toggles + acciones) ——
    { names: ['economy', 'economia'], category: 'config', description: 'Activa/desactiva economía' },
    { names: ['gacha'], category: 'config', description: 'Activa/desactiva gacha' },
    { names: ['nsfw'], category: 'config', description: 'NSFW (deshabilitado por política)' },
    { names: ['alerts', 'alertas'], category: 'config', description: 'Alertas promote/demote' },
    { names: ['onlyadmin', 'onlyadmins'], category: 'config', description: 'Solo admins usan el bot' },
    { names: ['bot'], category: 'config', description: 'Activa/desactiva el bot en el grupo' },
    { names: ['open'], category: 'group', description: 'Abrir grupo (todos escriben)' },
    { names: ['close'], category: 'group', description: 'Cerrar grupo (solo admins)' },
    { names: ['setwelcome'], category: 'config', description: 'Mensaje de bienvenida personalizado' },
    { names: ['setgoodbye'], category: 'config', description: 'Mensaje de despedida personalizado' },
    { names: ['warn', 'advertencia'], category: 'group', description: 'Advertir a un usuario' },
    { names: ['delwarn'], category: 'group', description: 'Quitar una advertencia' },
    { names: ['warns'], category: 'group', description: 'Ver advertencias' },
    { names: ['setwarnlimit'], category: 'config', description: 'Límite de advertencias' },
    // —— UTILIDADES ——
    { names: ['getpic', 'pfp'], category: 'tools', description: 'Foto de perfil de un usuario' },
    { names: ['toimage', 'toimg2'], category: 'tools', description: 'Convierte un sticker a imagen' },
    { names: ['testwelcome', 'testgoodbye'], category: 'tools', description: 'Prueba la bienvenida/despedida' },
    { names: ['suggest', 'addanime'], category: 'tools', description: 'Sugiere un anime/personaje' },
    { names: ['gp', 'group'], category: 'group', description: 'Información del grupo' },
    // —— DESCARGAS (no-porno) ——
    { names: ['twitter', 'x'], category: 'download', description: 'Descarga video de Twitter/X' },
    { names: ['reel'], category: 'download', description: 'Descarga un reel de Instagram' },
    // —— SUB-BOTS ——
    { names: ['botinfo', 'infobot'], category: 'info', description: 'Información del bot' },
    { names: ['logout'], category: 'owner', description: 'Cierra la sesión del sub-bot' },
    { names: ['setbotcurrency'], category: 'owner', hidden: true, description: 'La moneda es temática y fija' },
    // —— BIBLIOTECA (MongoDB) ——
    { names: ['libros'], category: 'search', description: 'Lista de libros (biblioteca)' },
    { names: ['libro'], category: 'search', description: 'Busca un libro por título' },
    { names: ['agglibro', 'addbook'], category: 'search', description: 'Agrega un libro (owner)' },
    { names: ['dellibro', 'delbook'], category: 'search', description: 'Elimina un libro por ID (owner)' },
    { names: ['actitulo', 'actitle'], category: 'search', description: 'Actualiza título de un libro (owner)' },
    { names: ['acautor', 'acauthor'], category: 'search', description: 'Actualiza autor de un libro (owner)' },
    { names: ['acgenero', 'acgenre'], category: 'search', description: 'Actualiza género de un libro (owner)' },
    { names: ['acenlace', 'aclink'], category: 'search', description: 'Actualiza enlace de un libro (owner)' },
];

function hashPct(a, b) { let h = 0; const s = [a, b].sort().join('|'); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 101; return h; }

export async function execute(conn, m, cmd, args, text) {
    const from = m.chat; const body = m.text || text;
    switch (cmd) {

    // ═══════════ PERFILES ═══════════
    case 'profile': {
        const t = target(m, text) || m.sender; const u = getUser(t);
        const caption = box(`👤 PERFIL · @${t.split('@')[0]}`, [
            `${isVip(u, m) ? '👑 VIP · ' : ''}⭐ Nivel ${u.level} · EXP ${u.exp} · ${u.role}`,
            `💜 ${u.money} JX  🏦 ${u.bank}`,
            `💎 ${u.corazones} HG  🤝 ${u.affinity} AP`,
            `🎴 Personajes: ${(u.characters||[]).length}`,
            `💍 ${u.married ? '@'+u.married.split('@')[0] : 'soltero/a'}`,
            `🎂 ${u.birthday||'—'}  ⚧ ${u.genre||'—'}`,
            `📝 ${u.description||'Sin descripción'}`,
        ]);
        const ment = [t]; if (u.married) ment.push(u.married);
        try { const pic = await getBuffer(await conn.profilePictureUrl(t, 'image')); if (pic) return conn.sendMessage(from, { image: pic, caption, mentions: ment }, { quoted: m }); } catch { /* */ }
        await conn.sendMessage(from, { text: caption, mentions: ment }, { quoted: m });
        break;
    }
    case 'level': { const t = target(m, text) || m.sender; const u = getUser(t); await conn.sendMessage(from, { text: `⬆️ @${t.split('@')[0]} — Nivel ${u.level} · EXP ${u.exp} · ${u.role}`, mentions: [t] }, { quoted: m }); break; }
    case 'leaderboard': {
        const top = Object.entries(db.data.users||{}).map(([jid,u])=>({jid,exp:u.exp||0})).filter(e=>e.exp>0).sort((a,b)=>b.exp-a.exp).slice(0,10);
        if (!top.length) return m.reply('Sin datos de EXP aún.');
        await conn.sendMessage(from, { text: `🏆 *TOP EXP*\n\n` + top.map((e,i)=>`${i+1}. @${e.jid.split('@')[0]} — ${e.exp} EXP`).join('\n'), mentions: top.map(e=>e.jid) }, { quoted: m });
        break;
    }
    case 'setdescription': { if (!text) return m.reply('Uso: .setdesc <texto>'); getUser(m.sender).description = text.slice(0,200); db.markDirty(); await m.reply('📝 Descripción actualizada.'); break; }
    case 'setgenre': { const g=(text||'').toLowerCase(); if (!['hombre','mujer','otro'].includes(g)) return m.reply('Uso: .setgenre Hombre|Mujer|Otro'); getUser(m.sender).genre=g; db.markDirty(); await m.reply(`⚧ Género: ${g}.`); break; }
    case 'delgenre': { getUser(m.sender).genre=null; db.markDirty(); await m.reply('Género eliminado.'); break; }
    case 'setbirth': { if (!/^\d{1,2}\/\d{1,2}$/.test(text||'')) return m.reply('Uso: .setbirth DD/MM'); getUser(m.sender).birthday=text; db.markDirty(); await m.reply(`🎂 Cumpleaños: ${text}.`); break; }
    case 'delbirth': { getUser(m.sender).birthday=null; db.markDirty(); await m.reply('Cumpleaños borrado.'); break; }
    case 'birthdays': {
        const list = Object.entries(db.data.users||{}).filter(([,u])=>u.birthday).map(([jid,u])=>({jid,b:u.birthday}));
        if (!list.length) return m.reply('Nadie registró su cumpleaños (.setbirth DD/MM).');
        await conn.sendMessage(from, { text: '🎂 *Cumpleaños*\n\n' + list.map(e=>`• @${e.jid.split('@')[0]} — ${e.b}`).join('\n'), mentions: list.map(e=>e.jid) }, { quoted: m });
        break;
    }
    case 'marry': {
        if (!needGroup(m)) return; const t = target(m, text);
        if (!t) return m.reply('Menciona con quién casarte.'); if (t===m.sender) return m.reply('No puedes casarte contigo mismo 😅');
        const u = getUser(m.sender), v = getUser(t);
        if (u.married) return m.reply('Ya estás casado/a. Usa .divorce.'); if (v.married) return m.reply('Esa persona ya está casada.');
        u.married=t; v.married=m.sender; db.markDirty();
        await conn.sendMessage(from, { text: `💍 @${m.sender.split('@')[0]} y @${t.split('@')[0]} ahora están casados 💞`, mentions: [m.sender, t] }, { quoted: m });
        break;
    }
    case 'divorce': { const u=getUser(m.sender); if (!u.married) return m.reply('No estás casado/a.'); const ex=u.married; getUser(ex).married=null; u.married=null; db.markDirty(); await conn.sendMessage(from, { text: `💔 @${m.sender.split('@')[0]} se divorció de @${ex.split('@')[0]}.`, mentions: [m.sender, ex] }, { quoted: m }); break; }

    // ═══════════ BL / YAOI EXTRA ═══════════
    case 'ship': {
        if (!needGroup(m)) return;
        let a = m.mentionedJid?.[0], b = m.mentionedJid?.[1];
        if (!a) { const mem = (m.participants||[]).map(p=>p.id).filter(x=>x!==m.sender); a = m.sender; b = mem[Math.floor(Math.random()*mem.length)]; }
        if (!b) return m.reply('Menciona a dos personas: .ship @uno @dos');
        const pct = hashPct(a, b);
        const bar = '█'.repeat(Math.round(pct/10)) + '░'.repeat(10-Math.round(pct/10));
        await conn.sendMessage(from, { text: `💞 *Shippeo BL*\n@${a.split('@')[0]} ❤️ @${b.split('@')[0]}\n\n${bar} ${pct}%\n\n${pct>75?'¡Pareja canónica! 💍':pct>45?'Hay química 🔥':'Mejor como amigos 🤝'}`, mentions: [a, b] }, { quoted: m });
        break;
    }
    case 'compatibility': {
        if (!needGroup(m)) return; const t = target(m, text); if (!t) return m.reply('Menciona a alguien: .match @user');
        const pct = hashPct(m.sender, t);
        await conn.sendMessage(from, { text: `🤝 Compatibilidad BL entre @${m.sender.split('@')[0]} y @${t.split('@')[0]}: *${pct}%* ${pct>70?'💖':pct>40?'💙':'🤍'}`, mentions: [m.sender, t] }, { quoted: m });
        break;
    }
    case 'blquote': { await m.reply(box('💬 FRASE BL', [`_"${BL_QUOTES[Math.floor(Math.random()*BL_QUOTES.length)]}"_`])); break; }
    case 'blrec': { const r = BL_RECS[Math.floor(Math.random()*BL_RECS.length)]; await m.reply(box('📖 RECOMENDACIÓN BL', [`*${r.t}*`, r.d])); break; }
    case 'couples': {
        const by = charsBySeries(); const lines = [];
        for (const [series, chars] of Object.entries(by)) if (chars.length >= 2) lines.push(`💞 ${chars[0].name} × ${chars[1].name} — _${series}_`);
        await m.reply(`💑 *Parejas BL del gacha*\n\n` + lines.slice(0, 30).join('\n'));
        break;
    }

    // ═══════════ ADMIN TOGGLES ═══════════
    case 'economy': case 'gacha': case 'alerts': case 'onlyadmin': case 'bot': {
        if (!needAdmin(m)) return;
        const fieldMap = { economy:'economy', gacha:'gacha', alerts:'detect', onlyadmin:'onlyadmin', bot:'botEnabled' };
        const labelMap = { economy:'Economía', gacha:'Gacha', alerts:'Alertas', onlyadmin:'Modo solo-admins', bot:'Bot' };
        const a = args[0];
        if (!isOn(a) && !isOff(a)) return m.reply(`Uso: .${cmd} enable | disable`);
        const c = getChat(from); c[fieldMap[cmd]] = isOn(a); db.markDirty();
        await m.reply(`${isOn(a)?'✅':'🍃'} ${labelMap[cmd]} ${isOn(a)?'activado':'desactivado'}.`);
        break;
    }
    case 'nsfw': { if (!needAdmin(m)) return; await m.reply('🔞 El módulo NSFW no está disponible en esta build por política de contenido.'); break; }
    case 'open': case 'close': {
        if (!needAdmin(m) || !needBotAdmin(m)) return;
        try { await conn.groupSettingUpdate(from, cmd==='open'?'not_announcement':'announcement'); await m.reply(cmd==='open'?'🔓 Grupo abierto.':'🔒 Grupo cerrado.'); }
        catch (e) { await m.reply('❌ ' + (e?.message || e)); }
        break;
    }
    case 'setwelcome': { if (!needAdmin(m)) return; if (!text) return m.reply('Uso: .setwelcome <texto> (@user para mencionar)'); getChat(from).sBienvenida=text; db.markDirty(); await m.reply('✅ Bienvenida guardada.'); break; }
    case 'setgoodbye': { if (!needAdmin(m)) return; if (!text) return m.reply('Uso: .setgoodbye <texto>'); getChat(from).sDespedida=text; db.markDirty(); await m.reply('✅ Despedida guardada.'); break; }
    case 'warn': {
        if (!needAdmin(m)) return; const t = target(m, text); if (!t) return m.reply('Uso: .warn @user <razón>');
        const u = getUser(t); u.warn=(u.warn||0)+1; const limit=getChat(from).warnlimit||3; db.markDirty();
        const reason=(text||'').replace(/@?\d{6,}/g,'').trim()||'sin razón';
        if (u.warn>=limit && m.isBotAdmin) { try { await conn.groupParticipantsUpdate(from,[t],'remove'); } catch { /* */ } u.warn=0; db.markDirty(); return conn.sendMessage(from, { text: `🚫 @${t.split('@')[0]} alcanzó ${limit} advertencias y fue expulsado.`, mentions: [t] }, { quoted: m }); }
        await conn.sendMessage(from, { text: `⚠️ @${t.split('@')[0]} advertido (${u.warn}/${limit}). Razón: ${reason}`, mentions: [t] }, { quoted: m });
        break;
    }
    case 'delwarn': { if (!needAdmin(m)) return; const t=target(m,text); if (!t) return m.reply('Menciona al usuario.'); const u=getUser(t); u.warn=Math.max(0,(u.warn||0)-1); db.markDirty(); await conn.sendMessage(from, { text: `✅ @${t.split('@')[0]} ahora tiene ${u.warn} advertencias.`, mentions: [t] }, { quoted: m }); break; }
    case 'warns': { const t=target(m,text)||m.sender; const u=getUser(t); await conn.sendMessage(from, { text: `⚠️ @${t.split('@')[0]} tiene ${u.warn||0} advertencias.`, mentions: [t] }, { quoted: m }); break; }
    case 'setwarnlimit': { if (!needAdmin(m)) return; const n=parseInt(text); if (!n||n<1) return m.reply('Uso: .setwarnlimit <número>'); getChat(from).warnlimit=n; db.markDirty(); await m.reply(`✅ Límite: ${n}.`); break; }

    // ═══════════ UTILIDADES ═══════════
    case 'getpic': { const t=target(m,text)||m.sender; try { const url=await conn.profilePictureUrl(t,'image'); const buf=await getBuffer(url); await conn.sendMessage(from, { image: buf, caption: `🖼️ @${t.split('@')[0]}`, mentions: [t] }, { quoted: m }); } catch { await m.reply('No tiene foto o es privada.'); } break; }
    case 'toimage': {
        const q = m.quoted; if (!q || !/sticker/.test(q.msg?.mimetype||q.mtype||'')) return m.reply('Responde a un sticker con .toimage');
        try { const buf=await q.download(); const sharp=(await import('sharp')).default; const png=await sharp(buf).png().toBuffer(); await conn.sendMessage(from, { image: png, caption: '🖼️ Sticker → imagen' }, { quoted: m }); }
        catch (e) { await m.reply('❌ ' + (e?.message || e)); }
        break;
    }
    case 'testwelcome': {
        if (!needAdmin(m)) return;
        const ev = { id: from, participants: [m.sender], action: m.command==='testgoodbye'?'remove':'add', author: m.sender };
        const mod = await import('./announcements.js').catch(() => ({}));
        if (typeof mod._testAnnounce === 'function') await mod._testAnnounce(conn, ev);
        else await m.reply('🧪 Simulación del evento de ' + (m.command==='testgoodbye'?'despedida':'bienvenida') + '.');
        break;
    }
    case 'suggest': { if (!text) return m.reply('Uso: .suggest <anime o personaje>'); db.data.others ||= {}; (db.data.others.suggestions ||= []).push({ by: m.sender, text, ts: Date.now() }); db.markDirty(); await m.reply('✅ Sugerencia registrada. ¡Gracias!'); break; }
    case 'gp': {
        if (!needGroup(m)) return; const meta = m.groupMetadata || await conn.groupMetadata(from).catch(()=>null);
        if (!meta) return m.reply('No pude leer la info del grupo.');
        const admins=(meta.participants||[]).filter(p=>p.admin).length;
        await m.reply(`👥 *${meta.subject}*\n• Miembros: ${meta.participants?.length||0}\n• Admins: ${admins}\n• ID: ${meta.id}\n• Descripción: ${(meta.desc||'—').slice(0,300)}`);
        break;
    }

    // ═══════════ DESCARGAS ═══════════
    case 'twitter': {
        if (!text || !/twitter\.com|x\.com|t\.co/.test(text)) return m.reply('Uso: .twitter <link>');
        try {
            const { twitterMedia } = await import('./providers.js');
            const r = await twitterMedia(text.trim());
            if (!r?.url) throw new Error('sin media');
            const buf = await getBuffer(r.url, { timeout: 120000 });
            if (!buf) throw new Error('descarga vacía');
            await conn.sendMessage(from, r.type === 'image'
                ? { image: buf, caption: '📥 Twitter/X 💜' }
                : { video: buf, caption: '📥 Twitter/X 💜' }, { quoted: m });
        }
        catch { await m.reply('🥺 No pude descargar ese tweet ahora mismo. Intenta más tarde 💜'); }
        break;
    }
    case 'reel': {
        if (!text || !/instagram\.com/.test(text)) return m.reply('Uso: .reel <link de Instagram>');
        const map = buildCmdMap(); const ig = map.get('instagram'); if (!ig) return m.reply('Descargador IG no disponible.');
        return ig(conn, m, args, text);
    }

    // ═══════════ SUB-BOTS ═══════════
    case 'botinfo': {
        const up=process.uptime(); const h=Math.floor(up/3600), mi=Math.floor((up%3600)/60);
        await m.reply(`🤖 *${global.botname||'KimdanBot-MD'}*\n• Versión: ${global.vs||'3.0'}\n• Activo: ${h}h ${mi}m\n• RAM: ${(process.memoryUsage().rss/1048576).toFixed(0)} MB\n• Comandos: ${commandCount()} (${aliasCount()} nombres)\n• Moneda: 💜 JX · 💎 HG · 🤝 AP\n• Tema: Jinx / BL / Yaoi`);
        break;
    }
    case 'logout': { const { stopJadibot } = await import('./jadibot.js'); await stopJadibot(conn, m).catch(e=>m.reply('❌ ' + (e?.message || e))); break; }
    case 'setbotcurrency': { if (!needOwner(m)) return; await m.reply('💜 La moneda del bot es oficial y fija: Jinx Coins (JX), Heart Gems (HG) y Affinity Points (AP).'); break; }

    // ═══════════ BIBLIOTECA (MongoDB) ═══════════
    case 'libros': await biblioteca.getFormattedBookList(conn, m, from); break;
    case 'libro':  await biblioteca.searchBooks(text, conn, m, from); break;
    case 'agglibro': if (!needOwner(m)) return; await biblioteca.addBook(body, text, conn, m, from); break;
    case 'dellibro': if (!needOwner(m)) return; await biblioteca.deleteBook(conn, m, text); break;
    case 'actitulo': if (!needOwner(m)) return; await biblioteca.updateBookTitle(body, conn, m, from); break;
    case 'acautor':  if (!needOwner(m)) return; await biblioteca.updateBookAuthor(body, conn, m, from); break;
    case 'acgenero': if (!needOwner(m)) return; await biblioteca.updateBookGenre(body, conn, m, from); break;
    case 'acenlace': if (!needOwner(m)) return; await biblioteca.updateBookLink(body, conn, m, from); break;

    }
}

for (const meta of COMMAND_META) {
    const canonical = meta.names[0];
    command({ name: canonical, aliases: meta.names.slice(1), category: meta.category, description: meta.description, hidden: meta.hidden },
        (conn, m, args, text) => execute(conn, m, canonical, args, text));
}
export { COMMAND_META };
export default true;
