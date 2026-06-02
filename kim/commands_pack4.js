// kim/commands_pack4.js — Perfiles, administración, utilidades, descargas
// (no-porno) y sub-bots de la lista del PDF.

import axios from 'axios';
import { command } from './registry.js';
import { getUser, getChat, getSettings, db } from './db.js';
import { getBuffer } from './helpers.js';
import { fmtMoney } from './theme.js';

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
// Toggle on/off genérico para flags de chat. enable/disable/on/off.
function toggleChat(field, label) {
    return async (conn, m, args) => {
        if (!needAdmin(m)) return;
        const a = (args[0] || '').toLowerCase();
        const on = ['on', 'enable', 'activar', 'true'].includes(a);
        const off = ['off', 'disable', 'desactivar', 'false'].includes(a);
        if (!on && !off) return m.reply(`Uso: .${m.command} enable | disable`);
        const c = getChat(m.chat); c[field] = on; db.markDirty();
        await m.reply(`${on ? '✅' : '🍃'} ${label} ${on ? 'activado' : 'desactivado'}.`);
    };
}

// ─── PERFILES ───────────────────────────────────────────────────────
command({ name: 'profile', aliases: ['perfil'], category: 'rpg', description: 'Ver tu perfil' },
async (conn, m, args, text) => {
    const t = target(m, text) || m.sender;
    const u = getUser(t);
    const caption = `╭─ 👤 *PERFIL* ─╮\n│ @${t.split('@')[0]}\n│ Nivel: ${u.level} (EXP ${u.exp})\n│ Rango: ${u.role}\n│ 💞 Lazos: ${u.money}  🏦 ${u.bank}\n│ 🎴 Personajes: ${(u.characters || []).length}\n│ 💍 Pareja: ${u.married ? '@' + u.married.split('@')[0] : 'soltero/a'}\n│ 🎂 Cumple: ${u.birthday || '—'}\n│ ⚧ Género: ${u.genre || '—'}\n│ 📝 ${u.description || 'Sin descripción'}\n╰────────────╯`;
    const ment = [t]; if (u.married) ment.push(u.married);
    try { const pic = await getBuffer(await conn.profilePictureUrl(t, 'image')); if (pic) return conn.sendMessage(m.chat, { image: pic, caption, mentions: ment }, { quoted: m }); } catch { /* */ }
    await conn.sendMessage(m.chat, { text: caption, mentions: ment }, { quoted: m });
});

command({ name: 'level', aliases: ['lvl'], category: 'rpg', description: 'Tu nivel actual' },
async (conn, m, args, text) => {
    const t = target(m, text) || m.sender; const u = getUser(t);
    await conn.sendMessage(m.chat, { text: `⬆️ @${t.split('@')[0]} — Nivel ${u.level} · EXP ${u.exp} · Rango ${u.role}`, mentions: [t] }, { quoted: m });
});

command({ name: 'leaderboard', aliases: ['lboard'], category: 'rpg', description: 'Ranking de EXP' },
async (conn, m) => {
    const top = Object.entries(db.data.users || {}).map(([jid, u]) => ({ jid, exp: u.exp || 0 }))
        .filter(e => e.exp > 0).sort((a, b) => b.exp - a.exp).slice(0, 10);
    if (!top.length) return m.reply('Sin datos de EXP aún.');
    await conn.sendMessage(m.chat, { text: `🏆 *TOP EXP*\n\n` + top.map((e, i) => `${i + 1}. @${e.jid.split('@')[0]} — ${e.exp} EXP`).join('\n'), mentions: top.map(e => e.jid) }, { quoted: m });
});

command({ name: 'setdescription', aliases: ['setperfil'], category: 'rpg', description: 'Tu descripción de perfil' },
async (conn, m, args, text) => { if (!text) return m.reply('Uso: .setdesc <texto>'); const u = getUser(m.sender); u.description = text.slice(0, 200); db.markDirty(); await m.reply('📝 Descripción actualizada.'); });

command({ name: 'setgenre', category: 'rpg', description: 'Fija tu género' },
async (conn, m, args, text) => { const g = (text || '').toLowerCase(); if (!['hombre', 'mujer', 'otro'].includes(g)) return m.reply('Uso: .setgenre Hombre|Mujer|Otro'); const u = getUser(m.sender); u.genre = g; db.markDirty(); await m.reply(`⚧ Género fijado: ${g}.`); });
command({ name: 'delgenre', category: 'rpg', description: 'Quita tu género' },
async (conn, m) => { const u = getUser(m.sender); u.genre = null; db.markDirty(); await m.reply('Género eliminado.'); });

command({ name: 'setbirth', category: 'rpg', description: 'Establece tu cumpleaños (DD/MM)' },
async (conn, m, args, text) => { if (!/^\d{1,2}\/\d{1,2}$/.test(text || '')) return m.reply('Uso: .setbirth DD/MM'); const u = getUser(m.sender); u.birthday = text; db.markDirty(); await m.reply(`🎂 Cumpleaños guardado: ${text}.`); });
command({ name: 'delbirth', category: 'rpg', description: 'Borra tu cumpleaños' },
async (conn, m) => { const u = getUser(m.sender); u.birthday = null; db.markDirty(); await m.reply('Cumpleaños borrado.'); });
command({ name: 'birthdays', aliases: ['cumpleaños', 'births'], category: 'rpg', description: 'Cumpleaños registrados' },
async (conn, m) => {
    const list = Object.entries(db.data.users || {}).filter(([, u]) => u.birthday).map(([jid, u]) => ({ jid, b: u.birthday }));
    if (!list.length) return m.reply('Nadie ha registrado su cumpleaños (.setbirth DD/MM).');
    await conn.sendMessage(m.chat, { text: '🎂 *Cumpleaños*\n\n' + list.map(e => `• @${e.jid.split('@')[0]} — ${e.b}`).join('\n'), mentions: list.map(e => e.jid) }, { quoted: m });
});
command({ name: 'allbirthdays', aliases: ['allbirths'], category: 'rpg', description: 'Todos los cumpleaños' }, async (conn, m, a, t) => (db.data._x, (await import('./registry.js')).buildCmdMap().get('birthdays')(conn, m, a, t)));

command({ name: 'marry', aliases: ['casarse'], category: 'rpg', description: 'Cásate con alguien' },
async (conn, m, args, text) => {
    if (!needGroup(m)) return; const t = target(m, text);
    if (!t) return m.reply('Menciona con quién casarte.');
    if (t === m.sender) return m.reply('No puedes casarte contigo mismo 😅');
    const u = getUser(m.sender), v = getUser(t);
    if (u.married) return m.reply('Ya estás casado/a. Usa .divorce primero.');
    if (v.married) return m.reply('Esa persona ya está casada.');
    u.married = t; v.married = m.sender; db.markDirty();
    await conn.sendMessage(m.chat, { text: `💍 @${m.sender.split('@')[0]} y @${t.split('@')[0]} ahora están casados 💞`, mentions: [m.sender, t] }, { quoted: m });
});
command({ name: 'divorce', category: 'rpg', description: 'Divorciarse' },
async (conn, m) => { const u = getUser(m.sender); if (!u.married) return m.reply('No estás casado/a.'); const ex = u.married; const v = getUser(ex); v.married = null; u.married = null; db.markDirty(); await conn.sendMessage(m.chat, { text: `💔 @${m.sender.split('@')[0]} se divorció de @${ex.split('@')[0]}.`, mentions: [m.sender, ex] }, { quoted: m }); });

// ─── ADMINISTRACIÓN (toggles + acciones) ────────────────────────────
command({ name: 'economy', aliases: ['economia'], category: 'config', description: 'Activa/desactiva economía' }, toggleChat('economy', 'Economía'));
command({ name: 'gacha', category: 'config', description: 'Activa/desactiva gacha' }, toggleChat('gacha', 'Gacha'));
command({ name: 'nsfw', category: 'config', description: 'Activa/desactiva NSFW (sin efecto: deshabilitado)' },
async (conn, m, args) => { if (!needAdmin(m)) return; await m.reply('🔞 El módulo NSFW no está disponible en esta build por política de contenido.'); });
command({ name: 'alerts', aliases: ['alertas'], category: 'config', description: 'Alertas promote/demote' }, toggleChat('detect', 'Alertas'));
command({ name: 'onlyadmin', aliases: ['onlyadmins'], category: 'config', description: 'Solo admins usan el bot' }, toggleChat('onlyadmin', 'Modo solo-admins'));
command({ name: 'bot', category: 'config', description: 'Activa/desactiva el bot en el grupo' }, toggleChat('botEnabled', 'Bot'));

command({ name: 'open', category: 'group', description: 'Abrir grupo (todos escriben)' },
async (conn, m) => { if (!needAdmin(m) || !needBotAdmin(m)) return; try { await conn.groupSettingUpdate(m.chat, 'not_announcement'); await m.reply('🔓 Grupo abierto.'); } catch (e) { await m.reply('❌ ' + (e?.message || e)); } });
command({ name: 'close', category: 'group', description: 'Cerrar grupo (solo admins)' },
async (conn, m) => { if (!needAdmin(m) || !needBotAdmin(m)) return; try { await conn.groupSettingUpdate(m.chat, 'announcement'); await m.reply('🔒 Grupo cerrado.'); } catch (e) { await m.reply('❌ ' + (e?.message || e)); } });

command({ name: 'setwelcome', category: 'config', description: 'Mensaje de bienvenida personalizado' },
async (conn, m, args, text) => { if (!needAdmin(m)) return; if (!text) return m.reply('Uso: .setwelcome <texto> (usa @user para mencionar)'); getChat(m.chat).sBienvenida = text; db.markDirty(); await m.reply('✅ Bienvenida personalizada guardada.'); });
command({ name: 'setgoodbye', category: 'config', description: 'Mensaje de despedida personalizado' },
async (conn, m, args, text) => { if (!needAdmin(m)) return; if (!text) return m.reply('Uso: .setgoodbye <texto>'); getChat(m.chat).sDespedida = text; db.markDirty(); await m.reply('✅ Despedida personalizada guardada.'); });

// Advertencias
command({ name: 'warn', category: 'group', description: 'Advertir a un usuario' },
async (conn, m, args, text) => {
    if (!needAdmin(m)) return; const t = target(m, text);
    if (!t) return m.reply('Menciona al usuario. Uso: .warn @user <razón>');
    const u = getUser(t); u.warn = (u.warn || 0) + 1;
    const limit = getChat(m.chat).warnlimit || 3; db.markDirty();
    const reason = (text || '').replace(/@?\d{6,}/g, '').trim() || 'sin razón';
    if (u.warn >= limit && m.isBotAdmin) { try { await conn.groupParticipantsUpdate(m.chat, [t], 'remove'); } catch { /* */ } u.warn = 0; db.markDirty(); return conn.sendMessage(m.chat, { text: `🚫 @${t.split('@')[0]} alcanzó ${limit} advertencias y fue expulsado.`, mentions: [t] }, { quoted: m }); }
    await conn.sendMessage(m.chat, { text: `⚠️ @${t.split('@')[0]} advertido (${u.warn}/${limit}). Razón: ${reason}`, mentions: [t] }, { quoted: m });
});
command({ name: 'delwarn', category: 'group', description: 'Quitar una advertencia' },
async (conn, m, args, text) => { if (!needAdmin(m)) return; const t = target(m, text); if (!t) return m.reply('Menciona al usuario.'); const u = getUser(t); u.warn = Math.max(0, (u.warn || 0) - 1); db.markDirty(); await conn.sendMessage(m.chat, { text: `✅ @${t.split('@')[0]} ahora tiene ${u.warn} advertencias.`, mentions: [t] }, { quoted: m }); });
command({ name: 'warns', category: 'group', description: 'Ver advertencias' },
async (conn, m, args, text) => { const t = target(m, text) || m.sender; const u = getUser(t); await conn.sendMessage(m.chat, { text: `⚠️ @${t.split('@')[0]} tiene ${u.warn || 0} advertencias.`, mentions: [t] }, { quoted: m }); });
command({ name: 'setwarnlimit', category: 'config', description: 'Límite de advertencias' },
async (conn, m, args, text) => { if (!needAdmin(m)) return; const n = parseInt(text); if (!n || n < 1) return m.reply('Uso: .setwarnlimit <número>'); getChat(m.chat).warnlimit = n; db.markDirty(); await m.reply(`✅ Límite de advertencias: ${n}.`); });

// ─── UTILIDADES ─────────────────────────────────────────────────────
command({ name: 'getpic', aliases: ['pfp'], category: 'tools', description: 'Foto de perfil de un usuario' },
async (conn, m, args, text) => { const t = target(m, text) || m.sender; try { const url = await conn.profilePictureUrl(t, 'image'); const buf = await getBuffer(url); await conn.sendMessage(m.chat, { image: buf, caption: `🖼️ @${t.split('@')[0]}`, mentions: [t] }, { quoted: m }); } catch { await m.reply('No tiene foto o es privada.'); } });

command({ name: 'toimage', category: 'tools', description: 'Convierte un sticker a imagen' },
async (conn, m) => {
    const q = m.quoted; if (!q || !/sticker/.test(q.msg?.mimetype || q.mtype || '')) return m.reply('Responde a un sticker con .toimage');
    try {
        const buf = await q.download();
        const sharp = (await import('sharp')).default;
        const png = await sharp(buf).png().toBuffer();
        await conn.sendMessage(m.chat, { image: png, caption: '🖼️ Sticker → imagen' }, { quoted: m });
    } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
});

command({ name: 'testwelcome', aliases: ['testgoodbye'], category: 'tools', description: 'Prueba la bienvenida/despedida' },
async (conn, m) => {
    if (!needAdmin(m)) return;
    const ev = { id: m.chat, participants: [m.sender], action: m.command === 'testgoodbye' ? 'remove' : 'add', author: m.sender };
    const { _testAnnounce } = await import('./announcements.js').catch(() => ({}));
    if (typeof _testAnnounce === 'function') await _testAnnounce(conn, ev);
    else await m.reply('🧪 Simulación: el evento de ' + (m.command === 'testgoodbye' ? 'despedida' : 'bienvenida') + ' se dispararía aquí.');
});

command({ name: 'suggest', aliases: ['addanime'], category: 'tools', description: 'Sugiere un anime/personaje' },
async (conn, m, args, text) => {
    if (!text) return m.reply('Uso: .suggest <nombre del anime o personaje>');
    db.data.others ||= {}; (db.data.others.suggestions ||= []).push({ by: m.sender, text, ts: Date.now() }); db.markDirty();
    await m.reply('✅ Sugerencia registrada. ¡Gracias!');
});

command({ name: 'gp', aliases: ['group'], category: 'group', description: 'Información del grupo' },
async (conn, m) => {
    if (!needGroup(m)) return; const meta = m.groupMetadata || await conn.groupMetadata(m.chat).catch(() => null);
    if (!meta) return m.reply('No pude leer la info del grupo.');
    const admins = (meta.participants || []).filter(p => p.admin).length;
    await m.reply(`👥 *${meta.subject}*\n• Miembros: ${meta.participants?.length || 0}\n• Admins: ${admins}\n• ID: ${meta.id}\n• Descripción: ${(meta.desc || '—').slice(0, 300)}`);
});

// ─── DESCARGAS no-porno ─────────────────────────────────────────────
command({ name: 'twitter', aliases: ['x'], category: 'download', description: 'Descarga video de Twitter/X' },
async (conn, m, args, text) => {
    if (!text || !/twitter\.com|x\.com|t\.co/.test(text)) return m.reply('Uso: .twitter <link>');
    try {
        const res = await axios.get(`https://api.vreden.my.id/api/twitter?url=${encodeURIComponent(text.trim())}`, { timeout: 30000 });
        const dl = res.data?.result?.media?.find(x => x.type === 'video')?.url || res.data?.result?.url;
        if (!dl) throw new Error('sin video');
        const buf = await getBuffer(dl, { timeout: 120000 });
        await conn.sendMessage(m.chat, { video: buf, caption: '📥 Twitter/X' }, { quoted: m });
    } catch { await m.reply('❌ No se pudo descargar (servicio externo no disponible).'); }
});
command({ name: 'reel', category: 'download', description: 'Descarga un reel de Instagram' },
async (conn, m, args, text) => {
    if (!text || !/instagram\.com/.test(text)) return m.reply('Uso: .reel <link de Instagram>');
    const map = (await import('./registry.js')).buildCmdMap();
    return map.get('instagram')(conn, m, args, text); // reutiliza el descargador IG ya existente
});

// ─── SUB-BOTS (extras del PDF) ──────────────────────────────────────
command({ name: 'botinfo', aliases: ['infobot'], category: 'info', description: 'Información del bot' },
async (conn, m) => {
    const up = process.uptime(); const h = Math.floor(up / 3600), mi = Math.floor((up % 3600) / 60);
    const { commandCount, aliasCount } = await import('./registry.js');
    await m.reply(`🤖 *${global.botname || 'KimdanBot-MD'}*\n• Versión: ${global.vs || '3.0'}\n• Activo: ${h}h ${mi}m\n• RAM: ${(process.memoryUsage().rss / 1048576).toFixed(0)} MB\n• Comandos: ${commandCount()} (${aliasCount()} con aliases)\n• Moneda: 💞 Lazos\n• Tema: BL/Yaoi`);
});
command({ name: 'logout', category: 'owner', description: 'Cierra la sesión del sub-bot' },
async (conn, m) => { const { stopJadibot } = await import('./jadibot.js'); await stopJadibot(conn, m).catch(e => m.reply('❌ ' + (e?.message || e))); });
command({ name: 'setbotcurrency', category: 'owner', hidden: true, description: 'La moneda es temática y fija (Lazos)' },
async (conn, m) => { if (!needOwner(m)) return; await m.reply('💞 La moneda del bot es temática (Lazos) y forma parte del universo BL/Yaoi.'); });

export default true;
