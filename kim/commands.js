// kim/commands.js — Todos los comandos del bot (ESM, Baileys v7).
//
// Cada comando se autorregistra con metadata. El menú se construye
// automáticamente a partir de este registro. Para agregar un comando
// nuevo, defínelo aquí con su categoría y aparecerá solo en .menu.
//
// Firma estándar:
//   async function nombre(conn, m, args, text)
//     - conn: socket Baileys (con serializeConn ya aplicado)
//     - m: mensaje serializado (m.chat, m.sender, m.reply, m.isOwner, ...)
//     - args: array de palabras después del comando
//     - text: args.join(' ')

import { execSync } from 'child_process';
import util from 'util';
import os from 'os';
import moment from 'moment-timezone';
import axios from 'axios';

import { command, buildMenu, commandCount, aliasCount } from './registry.js';
import { runtime, getBuffer, isUrl, parseMention } from './helpers.js';
import { getUser, getChat, getSettings, db } from './db.js';

const MAX_REPLY = 4000;
const truncate = (s) => s.length > MAX_REPLY ? s.slice(0, MAX_REPLY) + '\n[…truncado]' : s;

// ─── Helpers de permisos ─────────────────────────────────────────────────

const needGroup = (m) => {
    if (!m.isGroup) { m.reply(global.mess?.group || '⚠️ Solo en grupos.'); return false; }
    return true;
};
const needGroupAdmin = (m) => {
    if (!needGroup(m)) return false;
    if (!m.isSenderAdmin && !m.isOwner) { m.reply(global.mess?.admin || '⚠️ Solo administradores.'); return false; }
    return true;
};
const needBotAdmin = (m) => {
    if (!m.isBotAdmin) { m.reply(global.mess?.botAdmin || '⚠️ Necesito ser admin del grupo.'); return false; }
    return true;
};
const needOwner = (m) => {
    if (!m.isOwner) { m.reply(global.mess?.owner || '⚠️ Solo el propietario.'); return false; }
    return true;
};

// Resuelve un target user (mencionado, citado o por texto/número)
const resolveTarget = (m, text) => {
    if (m.mentionedJid?.[0]) return m.mentionedJid[0];
    if (m.quoted?.sender) return m.quoted.sender;
    if (text) {
        const num = String(text).replace(/[^0-9]/g, '');
        if (num.length >= 10) return num + '@s.whatsapp.net';
    }
    return null;
};

// ═══════════════════════════════════════════════════════════════════════
// CATEGORÍA: INFO
// ═══════════════════════════════════════════════════════════════════════

export const ping = command({
    name: 'ping', aliases: ['test'], category: 'info',
    description: 'Mide la latencia del bot',
}, async (conn, m) => {
    const t0 = Date.now();
    await m.reply('🏓 Pong!');
    return m.reply(`🌸 Latencia: *${Date.now() - t0} ms*`);
});

export const menu = command({
    name: 'menu', aliases: ['help', 'menu1'], category: 'info',
    description: 'Lista de comandos',
}, async (conn, m) => {
    const p = m.prefix || (Array.isArray(global.prefix) ? global.prefix[0] : '.');
    const ownerName = global.owner?.[0]?.[1] || 'kim';
    const totalUsers = Object.keys(db.data.users).length;
    const totalChats = Object.keys(db.data.chats).length;
    const up = runtime(process.uptime());
    const mem = (process.memoryUsage().rss / 1024 / 1024).toFixed(1);

    const header = `*🌸 ${global.botname || 'KimdanBot-MD'} 🌸*
*˚₊·˚₊· ͟͟͞͞➻❥ v${global.vs || '3.0.0'}*

*🍒 INFO BOT*
*┊* Activo: ${up}
*┊* RAM: ${mem} MB
*┊* Usuarios: ${totalUsers}
*┊* Chats: ${totalChats}
*┊* Comandos: ${commandCount()} (${aliasCount()} con aliases)
*┊* Creador: ${ownerName}
`;

    const list = buildMenu(p);
    const text = header + '\n' + list + `\n\n*╰ ${global.botname || 'KimdanBot-MD'} ╯*`;

    try {
        await conn.sendMessage(m.chat, {
            image: { url: global.imagen1 || 'https://telegra.ph/file/6ef00a79a7c90c05e7043.jpg' },
            caption: text,
        }, { quoted: m });
    } catch {
        await m.reply(text);
    }
});

export const info = command({
    name: 'info', aliases: ['infobot', 'infokim'], category: 'info',
    description: 'Información del bot',
}, async (conn, m) => {
    const up = process.uptime();
    const mem = process.memoryUsage();
    const mb = (n) => (n / 1024 / 1024).toFixed(1);
    return m.reply(
        `🍓 *${global.botname || 'KimdanBot-MD'}*\n` +
        `v${global.vs || '3.0.0'} — by ${global.owner?.[0]?.[1] || 'kim'}\n\n` +
        `*📊 Estado:*\n` +
        `• Uptime: ${runtime(up)}\n` +
        `• RAM: ${mb(mem.rss)} MB · Heap: ${mb(mem.heapUsed)}/${mb(mem.heapTotal)} MB\n` +
        `• Plataforma: ${os.platform()} (${os.arch()})\n` +
        `• Node: ${process.version}\n` +
        `• Usuarios DB: ${Object.keys(db.data.users).length}`
    );
});

export const estado = command({
    name: 'estado', aliases: ['status', 'heydan'], category: 'info',
    description: 'Estado del sistema',
}, async (conn, m) => {
    const mem = process.memoryUsage();
    const mb = (n) => (n / 1024 / 1024).toFixed(1);
    return m.reply(
        `*✿ Estado del bot ✿*\n\n` +
        `🌸 Activo: ${runtime(process.uptime())}\n` +
        `🍓 RAM: ${mb(mem.rss)} MB\n` +
        `🫐 Heap: ${mb(mem.heapUsed)}/${mb(mem.heapTotal)} MB\n` +
        `💐 Sistema: ${os.platform()}-${os.arch()}\n` +
        `🍒 CPUs: ${os.cpus().length}\n` +
        `🍇 Carga: ${os.loadavg().map(n => n.toFixed(2)).join(' / ')}`
    );
});

export const uptime = command({
    name: 'runtime', aliases: ['uptime'], category: 'info',
    description: 'Tiempo activo del bot',
}, async (conn, m) => m.reply(`🍓 *Uptime:* ${runtime(process.uptime())}`));

export const creador = command({
    name: 'creador', aliases: ['owner', 'dono'], category: 'info',
    description: 'Datos del creador',
}, async (conn, m) => {
    const ownerName = global.owner?.[0]?.[1] || 'kim';
    const ownerNum = global.owner?.[0]?.[0];
    const text = `🍓 *Creador del bot* 🍓\n\n*Nombre:* ${ownerName}\n*Número:* +${ownerNum}\n*GitHub:* ${global.md || ''}`;
    return conn.sendMessage(m.chat, {
        contacts: {
            displayName: ownerName,
            contacts: [{
                vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${ownerName}\nTEL;type=CELL;type=VOICE;waid=${ownerNum}:+${ownerNum}\nEND:VCARD`,
            }],
        },
    }, { quoted: m }).catch(() => m.reply(text));
});

export const donar = command({
    name: 'donar', aliases: ['donacion', 'donate'], category: 'info',
    description: 'Información de donaciones',
}, async (conn, m) =>
    m.reply(`🍓 *Donaciones* 🍓\n\nApóyanos para mantener el bot activo:\n\n• PayPal: ...\n• Nequi: ...\n\n¡Mil gracias! 💐`)
);

export const canales = command({
    name: 'canales', aliases: ['cuentaskim', 'cuentas'], category: 'info',
    description: 'Canales oficiales',
}, async (conn, m) => {
    const list = (global.ca || []).filter(Boolean).map((u, i) => `*${i + 1}.* ${u}`).join('\n');
    return m.reply(`🌸 *Canales oficiales* 🌸\n\n${list || 'Sin canales configurados.'}`);
});

export const grupos = command({
    name: 'grupos', aliases: ['gruposkim'], category: 'info',
    description: 'Grupos oficiales',
}, async (conn, m) => {
    const list = (global.wa || []).filter(Boolean).slice(0, 5).map((u, i) => `*${i + 1}.* ${u}`).join('\n');
    return m.reply(`🍓 *Grupos oficiales* 🍓\n\n${list || 'Sin grupos configurados.'}`);
});

export const colaboradores = command({
    name: 'colaboradores', category: 'info',
    description: 'Equipo del bot',
}, async (conn, m) => {
    const list = (global.owner || []).filter(o => o[2]).map(o => `❁ ${o[1] || 'sin nombre'} (+${o[0]})`).join('\n');
    return m.reply(`🍓 *Colaboradores* 🍓\n\n${list || 'Sin colaboradores.'}`);
});

// ═══════════════════════════════════════════════════════════════════════
// CATEGORÍA: OWNER
// ═══════════════════════════════════════════════════════════════════════

export const evalSync = command({
    name: 'eval', category: 'owner', description: 'Ejecuta JS (eval sync)',
}, async (conn, m, args, text) => {
    if (!needOwner(m)) return;
    const code = text || args.join(' ');
    if (!code) return m.reply('Uso: .eval <código>  o `>` <código>');
    try {
        const r = eval(code);
        const out = typeof r === 'string' ? r : util.inspect(r, { depth: 2, colors: false });
        return m.reply(truncate(out));
    } catch (e) { return m.reply('❌ ' + (e?.message || e)); }
});

export const evalAsync = command({
    name: 'evala', aliases: ['evalasync'], category: 'owner',
    description: 'Ejecuta JS (eval async)',
}, async (conn, m, args, text) => {
    if (!needOwner(m)) return;
    const code = text || args.join(' ');
    if (!code) return m.reply('Uso: .evala <código>  o `=>` <código>');
    try {
        const r = await eval(`(async () => { ${code} })()`);
        const out = typeof r === 'string' ? r : util.inspect(r, { depth: 2, colors: false });
        return m.reply(truncate(out));
    } catch (e) { return m.reply('❌ ' + (e?.message || e)); }
});

export const shell = command({
    name: 'shell', aliases: ['bash', 'cmd'], category: 'owner',
    description: 'Ejecuta un comando shell',
}, async (conn, m, args, text) => {
    if (!needOwner(m)) return;
    const cmd = text || args.join(' ');
    if (!cmd) return m.reply('Uso: .shell <comando>  o `$` <comando>');
    try {
        const out = execSync(cmd, { encoding: 'utf-8', timeout: 30000 });
        return m.reply(truncate(out || '(sin salida)'));
    } catch (e) { return m.reply('❌ ' + (e?.message || e)); }
});

export const restart = command({
    name: 'restart', aliases: ['reiniciar'], category: 'owner',
    description: 'Reinicia el bot',
}, async (conn, m) => {
    if (!needOwner(m)) return;
    await m.reply('🔄 Reiniciando...').catch(() => {});
    process.exit(1);
});

export const togglePublic = command({
    name: 'public', category: 'owner', description: 'Modo público',
}, async (conn, m) => {
    if (!needOwner(m)) return;
    conn.public = true;
    return m.reply('✅ Bot ahora en *modo público*.');
});

export const togglePrivate = command({
    name: 'private', category: 'owner', description: 'Modo privado (solo owners)',
}, async (conn, m) => {
    if (!needOwner(m)) return;
    conn.public = false;
    return m.reply('🔒 Bot en *modo privado* (solo owners).');
});

export const banUser = command({
    name: 'banuser', aliases: ['baner'], category: 'owner',
    description: 'Banea a un usuario del bot',
}, async (conn, m, args, text) => {
    if (!needOwner(m)) return;
    const t = resolveTarget(m, text);
    if (!t) return m.reply('Menciona, cita o pasa el número del usuario.');
    const u = getUser(t);
    u.banned = true;
    db.markDirty();
    return m.reply(`🔒 @${t.split('@')[0]} baneado del bot.`, null, { mentions: [t] });
});

export const unbanUser = command({
    name: 'unbanuser', category: 'owner', description: 'Desbanea usuario',
}, async (conn, m, args, text) => {
    if (!needOwner(m)) return;
    const t = resolveTarget(m, text);
    if (!t) return m.reply('Menciona, cita o pasa el número.');
    const u = getUser(t);
    u.banned = false;
    db.markDirty();
    return m.reply(`🔓 @${t.split('@')[0]} desbaneado.`, null, { mentions: [t] });
});

export const banChat = command({
    name: 'banchat', category: 'owner', description: 'Banea chat actual',
}, async (conn, m) => {
    if (!needOwner(m)) return;
    if (!m.isGroup) return m.reply('Solo en grupos.');
    const c = getChat(m.chat);
    c.isBanned = true;
    db.markDirty();
    return m.reply('🔒 Chat baneado.');
});

export const unbanChat = command({
    name: 'unbanchat', category: 'owner', description: 'Desbanea chat',
}, async (conn, m) => {
    if (!needOwner(m)) return;
    if (!m.isGroup) return m.reply('Solo en grupos.');
    const c = getChat(m.chat);
    c.isBanned = false;
    db.markDirty();
    return m.reply('🔓 Chat desbaneado.');
});

export const setBio = command({
    name: 'setbio', aliases: ['setstatus', 'setbiobot'], category: 'owner',
    description: 'Cambia la bio del bot',
}, async (conn, m, args, text) => {
    if (!needOwner(m)) return;
    if (!text) return m.reply('Uso: .setbio <nuevo texto>');
    try {
        await conn.updateProfileStatus(text);
        return m.reply('✅ Bio del bot actualizada.');
    } catch (e) { return m.reply('❌ ' + (e?.message || e)); }
});

export const setNameBot = command({
    name: 'setnamebot', aliases: ['setnameb'], category: 'owner',
    description: 'Cambia el nombre del bot',
}, async (conn, m, args, text) => {
    if (!needOwner(m)) return;
    if (!text) return m.reply('Uso: .setnamebot <nuevo nombre>');
    try {
        await conn.updateProfileName(text);
        return m.reply('✅ Nombre del bot actualizado.');
    } catch (e) { return m.reply('❌ ' + (e?.message || e)); }
});

export const block = command({
    name: 'block', category: 'owner', description: 'Bloquea a un usuario',
}, async (conn, m, args, text) => {
    if (!needOwner(m)) return;
    const t = resolveTarget(m, text);
    if (!t) return m.reply('Menciona o cita al usuario a bloquear.');
    try {
        await conn.updateBlockStatus(t, 'block');
        return m.reply(`🔒 Usuario bloqueado.`);
    } catch (e) { return m.reply('❌ ' + (e?.message || e)); }
});

export const unblock = command({
    name: 'unblock', category: 'owner', description: 'Desbloquea usuario',
}, async (conn, m, args, text) => {
    if (!needOwner(m)) return;
    const t = resolveTarget(m, text);
    if (!t) return m.reply('Menciona, cita o pasa el número.');
    try {
        await conn.updateBlockStatus(t, 'unblock');
        return m.reply(`🔓 Usuario desbloqueado.`);
    } catch (e) { return m.reply('❌ ' + (e?.message || e)); }
});

// ═══════════════════════════════════════════════════════════════════════
// CATEGORÍA: CONFIG (toggles per-chat / settings)
// ═══════════════════════════════════════════════════════════════════════

const makeToggle = (key, label, desc) => command({
    name: `anti${key.toLowerCase()}`.replace(/^anti(?:anti)?/, 'anti'),
    category: 'config', description: desc,
}, async (conn, m, args) => {
    if (!needGroupAdmin(m)) return;
    const c = getChat(m.chat);
    const arg = (args[0] || '').toLowerCase();
    if (arg === 'on') c[key] = true;
    else if (arg === 'off') c[key] = false;
    else c[key] = !c[key];
    db.markDirty();
    return m.reply(`${c[key] ? '✅' : '❌'} ${label} *${c[key] ? 'activado' : 'desactivado'}*`);
});

// Toggles construidos dinámicamente; los exporto con nombres únicos.
export const toggleAntilink = command({
    name: 'antilink', category: 'config', description: 'Borra links de grupos WhatsApp',
}, async (conn, m, args) => {
    if (!needGroupAdmin(m)) return;
    const c = getChat(m.chat);
    const arg = (args[0] || '').toLowerCase();
    if (arg === 'on') c.antilink = true;
    else if (arg === 'off') c.antilink = false;
    else c.antilink = !c.antilink;
    db.markDirty();
    return m.reply(`${c.antilink ? '✅' : '❌'} Antilink *${c.antilink ? 'activado' : 'desactivado'}*`);
});

const simpleToggle = (chatKey, name, aliases, desc) => command({
    name, aliases, category: 'config', description: desc,
}, async (conn, m, args) => {
    if (!needGroupAdmin(m)) return;
    const c = getChat(m.chat);
    const arg = (args[0] || '').toLowerCase();
    if (arg === 'on') c[chatKey] = true;
    else if (arg === 'off') c[chatKey] = false;
    else c[chatKey] = !c[chatKey];
    db.markDirty();
    return m.reply(`${c[chatKey] ? '✅' : '❌'} ${desc.split(' (')[0]} *${c[chatKey] ? 'activado' : 'desactivado'}*`);
});

export const toggleAntiYoutube  = simpleToggle('AntiYoutube',  'antilinkyt', ['antiyt'], 'Borra links de YouTube');
export const toggleAntiInstagram= simpleToggle('AntInstagram', 'antilinkig', ['antiig'], 'Borra links de Instagram');
export const toggleAntiFacebook = simpleToggle('AntiFacebook', 'antilinkfb', ['antifb'], 'Borra links de Facebook');
export const toggleAntiTiktok   = simpleToggle('AntiTiktok',   'antilinktt', ['antitt'], 'Borra links de TikTok');
export const toggleAntiTwitter  = simpleToggle('AntiTwitter',  'antilinktw', ['antitw'], 'Borra links de Twitter/X');
export const toggleAntiTelegram = simpleToggle('AntiTelegram', 'antilinktg', ['antitg'], 'Borra links de Telegram');
export const toggleAntitoxic    = simpleToggle('antitoxic',    'antitoxic',  [],         'Borra palabras tóxicas');
export const toggleAntifake     = simpleToggle('antifake',     'antifake',   [],         'Expulsa números fake');
export const toggleAntispam     = simpleToggle('antispam',     'antispam',   [],         'Rate-limit de comandos');
export const toggleWelcome      = simpleToggle('welcome',      'welcome',    [],         'Mensajes de bienvenida');
export const toggleModeAdmin    = simpleToggle('modeadmin',    'modeadmin',  [],         'Solo admins usan comandos');
export const toggleAutosticker  = simpleToggle('autosticker',  'autosticker',['autosic'],'Auto-stickeriza imágenes');

export const toggleAntiprivado = command({
    name: 'antiprivado', aliases: ['antipv'], category: 'config',
    description: 'Bloquea el chat privado a no-owners',
}, async (conn, m, args) => {
    if (!needOwner(m)) return;
    const botJid = conn.user?.jid || conn.decodeJid?.(conn.user?.id);
    if (!botJid) return m.reply('No se pudo detectar el JID del bot.');
    const s = getSettings(botJid);
    const arg = (args[0] || '').toLowerCase();
    if (arg === 'on') s.antiprivado = true;
    else if (arg === 'off') s.antiprivado = false;
    else s.antiprivado = !s.antiprivado;
    db.markDirty();
    return m.reply(`${s.antiprivado ? '✅' : '❌'} Antiprivado *${s.antiprivado ? 'activado' : 'desactivado'}*`);
});

// ═══════════════════════════════════════════════════════════════════════
// CATEGORÍA: GROUP
// ═══════════════════════════════════════════════════════════════════════

export const kick = command({
    name: 'kick', aliases: ['echar', 'sacar'], category: 'group',
    description: 'Expulsa a un usuario',
}, async (conn, m, args, text) => {
    if (!needGroupAdmin(m) || !needBotAdmin(m)) return;
    const t = resolveTarget(m, text);
    if (!t) return m.reply('Menciona o cita al usuario.');
    if (m.groupAdmins?.includes(t)) return m.reply('No puedo expulsar a un admin.');
    try {
        await conn.groupParticipantsUpdate(m.chat, [t], 'remove');
        return m.reply(`👋 @${t.split('@')[0]} expulsado.`, null, { mentions: [t] });
    } catch (e) { return m.reply('❌ ' + (e?.message || e)); }
});

export const add = command({
    name: 'add', aliases: ['agregar', 'invitar'], category: 'group',
    description: 'Agrega un número al grupo',
}, async (conn, m, args) => {
    if (!needGroupAdmin(m) || !needBotAdmin(m)) return;
    const num = (args[0] || '').replace(/[^0-9]/g, '');
    if (!num) return m.reply('Uso: .add <número con código de país>');
    const target = num + '@s.whatsapp.net';
    try {
        const res = await conn.groupParticipantsUpdate(m.chat, [target], 'add');
        const status = res?.[0]?.status;
        if (status === '200') return m.reply(`✅ @${num} agregado.`, null, { mentions: [target] });
        return m.reply(`❌ No se pudo agregar (código ${status}).`);
    } catch (e) { return m.reply('❌ ' + (e?.message || e)); }
});

export const promote = command({
    name: 'promote', aliases: ['daradmin'], category: 'group',
    description: 'Da admin a un usuario',
}, async (conn, m, args, text) => {
    if (!needGroupAdmin(m) || !needBotAdmin(m)) return;
    const t = resolveTarget(m, text);
    if (!t) return m.reply('Menciona o cita al usuario.');
    try {
        await conn.groupParticipantsUpdate(m.chat, [t], 'promote');
        return m.reply(`⭐ @${t.split('@')[0]} ahora es admin.`, null, { mentions: [t] });
    } catch (e) { return m.reply('❌ ' + (e?.message || e)); }
});

export const demote = command({
    name: 'demote', aliases: ['quitaradmin'], category: 'group',
    description: 'Quita admin a un usuario',
}, async (conn, m, args, text) => {
    if (!needGroupAdmin(m) || !needBotAdmin(m)) return;
    const t = resolveTarget(m, text);
    if (!t) return m.reply('Menciona o cita al usuario.');
    try {
        await conn.groupParticipantsUpdate(m.chat, [t], 'demote');
        return m.reply(`🍃 @${t.split('@')[0]} ya no es admin.`, null, { mentions: [t] });
    } catch (e) { return m.reply('❌ ' + (e?.message || e)); }
});

export const getLink = command({
    name: 'link', aliases: ['linkgc', 'linkgroup'], category: 'group',
    description: 'Link de invitación del grupo',
}, async (conn, m) => {
    if (!needGroupAdmin(m) || !needBotAdmin(m)) return;
    try {
        const code = await conn.groupInviteCode(m.chat);
        return m.reply(`🔗 *Link del grupo:*\nhttps://chat.whatsapp.com/${code}`);
    } catch (e) { return m.reply('❌ ' + (e?.message || e)); }
});

export const revokeLink = command({
    name: 'revoke', aliases: ['resetlink', 'anularlink'], category: 'group',
    description: 'Revoca el link de invitación',
}, async (conn, m) => {
    if (!needGroupAdmin(m) || !needBotAdmin(m)) return;
    try {
        await conn.groupRevokeInvite(m.chat);
        return m.reply('🔄 Link revocado. El anterior ya no funciona.');
    } catch (e) { return m.reply('❌ ' + (e?.message || e)); }
});

export const hidetag = command({
    name: 'hidetag', aliases: ['notificar'], category: 'group',
    description: 'Menciona a todos sin mostrarlos',
}, async (conn, m, args, text) => {
    if (!needGroupAdmin(m)) return;
    if (!m.participants) return m.reply('No pude leer los participantes.');
    const mentions = m.participants.map(p => p.id);
    return conn.sendMessage(m.chat, {
        text: text || `📢 ${global.botname || 'KimdanBot-MD'}`,
        mentions,
    });
});

export const tagall = command({
    name: 'tagall', aliases: ['invocar', 'todos'], category: 'group',
    description: 'Etiqueta a todos (lista visible)',
}, async (conn, m, args, text) => {
    if (!needGroupAdmin(m)) return;
    if (!m.participants) return m.reply('No pude leer los participantes.');
    const mentions = m.participants.map(p => p.id);
    const lines = mentions.map(j => `• @${j.split('@')[0]}`).join('\n');
    return conn.sendMessage(m.chat, {
        text: `📢 *${text || 'Convocatoria general'}*\n\n${lines}`,
        mentions,
    });
});

export const deleteMsg = command({
    name: 'del', aliases: ['delete'], category: 'group',
    description: 'Elimina el mensaje citado',
}, async (conn, m) => {
    if (!needGroupAdmin(m) || !needBotAdmin(m)) return;
    if (!m.quoted) return m.reply('Cita el mensaje a eliminar.');
    try {
        await conn.sendMessage(m.chat, {
            delete: {
                remoteJid: m.chat,
                fromMe: m.quoted.fromMe,
                id: m.quoted.id,
                participant: m.quoted.sender,
            },
        });
    } catch (e) { return m.reply('❌ ' + (e?.message || e)); }
});

export const admins = command({
    name: 'admins', aliases: ['administradores'], category: 'group',
    description: 'Lista de administradores',
}, async (conn, m) => {
    if (!needGroup(m)) return;
    if (!m.groupAdmins?.length) return m.reply('No hay admins detectados.');
    const list = m.groupAdmins.map(j => `• @${j.split('@')[0]}`).join('\n');
    return conn.sendMessage(m.chat, {
        text: `⭐ *Administradores* ⭐\n\n${list}`,
        mentions: m.groupAdmins,
    });
});

export const infoGroup = command({
    name: 'infogrupo', aliases: ['groupinfo'], category: 'group',
    description: 'Info del grupo',
}, async (conn, m) => {
    if (!needGroup(m)) return;
    const meta = m.groupMetadata;
    if (!meta) return m.reply('No pude leer la info del grupo.');
    const created = meta.creation ? moment(meta.creation * 1000).tz(global.place || 'UTC').format('DD/MM/YYYY HH:mm') : '-';
    return m.reply(
        `🌸 *Info del grupo* 🌸\n\n` +
        `*Nombre:* ${meta.subject}\n*Creado:* ${created}\n` +
        `*Participantes:* ${meta.participants?.length || 0}\n` +
        `*Admins:* ${m.groupAdmins?.length || 0}\n` +
        `*Descripción:*\n${meta.desc?.toString() || '(sin descripción)'}`
    );
});

export const setname = command({
    name: 'setname', aliases: ['setnameg', 'setnombre'], category: 'group',
    description: 'Cambia el nombre del grupo',
}, async (conn, m, args, text) => {
    if (!needGroupAdmin(m) || !needBotAdmin(m)) return;
    if (!text) return m.reply('Uso: .setname <nombre>');
    try { await conn.groupUpdateSubject(m.chat, text); return m.reply('✅ Nombre actualizado.'); }
    catch (e) { return m.reply('❌ ' + (e?.message || e)); }
});

export const setdesc = command({
    name: 'setdesc', aliases: ['setdescripcion', 'descripcion'], category: 'group',
    description: 'Cambia la descripción del grupo',
}, async (conn, m, args, text) => {
    if (!needGroupAdmin(m) || !needBotAdmin(m)) return;
    if (!text) return m.reply('Uso: .setdesc <descripción>');
    try { await conn.groupUpdateDescription(m.chat, text); return m.reply('✅ Descripción actualizada.'); }
    catch (e) { return m.reply('❌ ' + (e?.message || e)); }
});

export const warn = command({
    name: 'warn', aliases: ['advertencia'], category: 'group',
    description: 'Advierte a un usuario',
}, async (conn, m, args, text) => {
    if (!needGroupAdmin(m)) return;
    const t = resolveTarget(m, text);
    if (!t) return m.reply('Menciona o cita al usuario.');
    const u = getUser(t);
    u.warn = (u.warn || 0) + 1;
    db.markDirty();
    const max = parseInt(global.maxwarn) || 4;
    if (u.warn >= max && m.isBotAdmin) {
        try {
            await conn.sendMessage(m.chat, {
                text: `⚠️ @${t.split('@')[0]} alcanzó ${max} advertencias.`,
                mentions: [t],
            });
            await conn.groupParticipantsUpdate(m.chat, [t], 'remove');
            u.warn = 0;
        } catch { /* */ }
        return;
    }
    return m.reply(`⚠️ @${t.split('@')[0]} advertido (${u.warn}/${max}).`, null, { mentions: [t] });
});

export const unwarn = command({
    name: 'unwarn', aliases: ['quitardvertencia'], category: 'group',
    description: 'Quita una advertencia',
}, async (conn, m, args, text) => {
    if (!needGroupAdmin(m)) return;
    const t = resolveTarget(m, text);
    if (!t) return m.reply('Menciona o cita al usuario.');
    const u = getUser(t);
    u.warn = Math.max(0, (u.warn || 0) - 1);
    db.markDirty();
    return m.reply(`✅ @${t.split('@')[0]} ahora tiene ${u.warn} advertencias.`, null, { mentions: [t] });
});

export const listwarn = command({
    name: 'listwarn', category: 'group',
    description: 'Lista usuarios con advertencias del grupo',
}, async (conn, m) => {
    if (!needGroupAdmin(m)) return;
    const participants = m.participants?.map(p => p.id) || [];
    const warned = participants
        .map(j => ({ jid: j, warn: db.data.users[j]?.warn || 0 }))
        .filter(u => u.warn > 0);
    if (!warned.length) return m.reply('✨ Nadie tiene advertencias.');
    const list = warned.map(u => `• @${u.jid.split('@')[0]}: ${u.warn}`).join('\n');
    return conn.sendMessage(m.chat, {
        text: `*⚠️ Advertencias*\n\n${list}`,
        mentions: warned.map(u => u.jid),
    });
});

export const grupoOpenClose = command({
    name: 'grupo', category: 'group',
    description: 'Abre/cierra el grupo (.grupo abrir|cerrar)',
}, async (conn, m, args) => {
    if (!needGroupAdmin(m) || !needBotAdmin(m)) return;
    const arg = (args[0] || '').toLowerCase();
    if (arg !== 'abrir' && arg !== 'cerrar') {
        return m.reply('Uso: .grupo abrir  |  .grupo cerrar');
    }
    try {
        await conn.groupSettingUpdate(m.chat, arg === 'abrir' ? 'not_announcement' : 'announcement');
        // Importa los textos del módulo de anuncios para mantener
        // consistencia visual con los demás mensajes automáticos.
        const { ANNOUNCEMENT_TEXTS } = await import('./announcements.js');
        return m.reply(arg === 'abrir' ? ANNOUNCEMENT_TEXTS.groupOpen : ANNOUNCEMENT_TEXTS.groupClose);
    } catch (e) { return m.reply('❌ ' + (e?.message || e)); }
});

export const toggleBye = command({
    name: 'bye', aliases: ['despedida'], category: 'config',
    description: 'Activa/desactiva el mensaje de despedida',
}, async (conn, m, args) => {
    if (!needGroupAdmin(m)) return;
    const c = getChat(m.chat);
    const arg = (args[0] || '').toLowerCase();
    if (arg === 'on') c.bye = true;
    else if (arg === 'off') c.bye = false;
    else c.bye = !c.bye;
    db.markDirty();
    return m.reply(`${c.bye ? '✅' : '❌'} Mensaje de despedida *${c.bye ? 'activado' : 'desactivado'}*`);
});

export const toggleDetect = command({
    name: 'detect', aliases: ['anunciarAdmins'], category: 'config',
    description: 'Activa/desactiva avisos de promote/demote',
}, async (conn, m, args) => {
    if (!needGroupAdmin(m)) return;
    const c = getChat(m.chat);
    const arg = (args[0] || '').toLowerCase();
    if (arg === 'on') c.detect = true;
    else if (arg === 'off') c.detect = false;
    else c.detect = !c.detect;
    db.markDirty();
    return m.reply(`${c.detect ? '✅' : '❌'} Avisos promote/demote *${c.detect ? 'activados' : 'desactivados'}*`);
});

// ═══════════════════════════════════════════════════════════════════════
// CATEGORÍA: STICKER / MEDIA
// ═══════════════════════════════════════════════════════════════════════

export const sticker = command({
    name: 's', aliases: ['sticker'], category: 'sticker',
    description: 'Convierte imagen/video en sticker',
}, async (conn, m) => {
    const target = m.quoted || m;
    const mime = target.msg?.mimetype || target.mimetype || '';
    if (!/^(image|video|webp)/.test(mime)) {
        return m.reply('🎀 Responde a una imagen o video corto con el comando.');
    }
    if (mime.startsWith('video') && (target.msg?.seconds || 0) > 10) {
        return m.reply('⏳ El video debe durar máximo 10 segundos.');
    }
    try {
        const buffer = await target.download();
        return conn.sendMessage(m.chat, { sticker: buffer }, { quoted: m });
    } catch (e) { return m.reply('❌ ' + (e?.message || e)); }
});

export const attp = command({
    name: 'attp', category: 'sticker', description: 'Crea un sticker animado con texto',
}, async (conn, m, args, text) => {
    if (!text) return m.reply('Uso: .attp <texto>');
    try {
        const buf = await getBuffer(`https://api.popcat.xyz/attp?text=${encodeURIComponent(text)}`);
        if (!buf) throw new Error('No se pudo generar.');
        return conn.sendMessage(m.chat, { sticker: buf }, { quoted: m });
    } catch (e) { return m.reply('❌ Servicio attp no disponible: ' + (e?.message || e)); }
});

export const toImg = command({
    name: 'toimg', aliases: ['toimagen'], category: 'sticker',
    description: 'Convierte sticker en imagen',
}, async (conn, m) => {
    const target = m.quoted || m;
    const mime = target.msg?.mimetype || '';
    if (!mime.includes('webp')) return m.reply('Responde a un sticker (webp).');
    try {
        const buf = await target.download();
        return conn.sendMessage(m.chat, { image: buf, caption: '' }, { quoted: m });
    } catch (e) { return m.reply('❌ ' + (e?.message || e)); }
});

export const tomp3 = command({
    name: 'tomp3', aliases: ['toaudio'], category: 'sticker',
    description: 'Convierte video en audio',
}, async (conn, m) => {
    const target = m.quoted || m;
    const mime = target.msg?.mimetype || '';
    if (!/video|audio/.test(mime)) return m.reply('Responde a un video o audio.');
    try {
        const buf = await target.download();
        return conn.sendMessage(m.chat, {
            audio: buf, mimetype: 'audio/mp4', ptt: false,
        }, { quoted: m });
    } catch (e) { return m.reply('❌ ' + (e?.message || e)); }
});

export const dado = command({
    name: 'dado', category: 'fun', description: 'Lanza un dado virtual',
}, async (conn, m) => {
    const n = Math.floor(Math.random() * 6) + 1;
    return m.reply(`🎲 Sacaste un *${n}*`);
});

// ═══════════════════════════════════════════════════════════════════════
// CATEGORÍA: SEARCH / TOOLS
// ═══════════════════════════════════════════════════════════════════════

export const ytSearch = command({
    name: 'yts', aliases: ['ytsearch'], category: 'search',
    description: 'Busca en YouTube',
}, async (conn, m, args, text) => {
    if (!text) return m.reply('Uso: .yts <texto>');
    let yts;
    try { ({ default: yts } = await import('yt-search')); }
    catch { return m.reply('⚠️ Instala yt-search:  npm i yt-search'); }
    try {
        const r = await yts(text);
        const top = (r.videos || []).slice(0, 5);
        if (!top.length) return m.reply('Sin resultados.');
        const out = top.map((v, i) =>
            `*${i + 1}.* ${v.title}\n_${v.author?.name || ''}_ — ${v.timestamp || ''}\n${v.url}`
        ).join('\n\n');
        return m.reply(`🍒 *Resultados:*\n\n${out}`);
    } catch (e) { return m.reply('❌ ' + (e?.message || e)); }
});

export const translate = command({
    name: 'traducir', aliases: ['translate'], category: 'tools',
    description: 'Traduce texto (auto → español)',
}, async (conn, m, args, text) => {
    if (!text) return m.reply('Uso: .traducir <texto>');
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=es&dt=t&q=${encodeURIComponent(text)}`;
        const res = await axios.get(url, { timeout: 15000 });
        const translated = res.data?.[0]?.map(s => s[0]).join('') || '';
        return m.reply(`🌐 ${translated || '(sin traducción)'}`);
    } catch (e) { return m.reply('❌ ' + (e?.message || e)); }
});

export const tts = command({
    name: 'tts', category: 'tools', description: 'Texto a voz (es)',
}, async (conn, m, args, text) => {
    if (!text) return m.reply('Uso: .tts <texto>');
    try {
        const buf = await getBuffer(
            `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=es&client=tw-ob`,
            { headers: { 'User-Agent': 'Mozilla/5.0' } }
        );
        if (!buf) throw new Error('No se pudo generar audio.');
        return conn.sendMessage(m.chat, { audio: buf, mimetype: 'audio/mp4', ptt: true }, { quoted: m });
    } catch (e) { return m.reply('❌ ' + (e?.message || e)); }
});

export const shorten = command({
    name: 'acortar', aliases: ['short'], category: 'tools',
    description: 'Acorta una URL',
}, async (conn, m, args, text) => {
    if (!text || !isUrl(text)) return m.reply('Uso: .acortar <URL>');
    try {
        const res = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(text)}`, { timeout: 10000 });
        return m.reply(`🔗 ${res.data}`);
    } catch (e) { return m.reply('❌ ' + (e?.message || e)); }
});

export const ssweb = command({
    name: 'ssweb', aliases: ['ss'], category: 'tools',
    description: 'Captura de un sitio web',
}, async (conn, m, args, text) => {
    if (!text || !isUrl(text)) return m.reply('Uso: .ssweb <URL>');
    try {
        const buf = await getBuffer(`https://api.popcat.xyz/screenshot?url=${encodeURIComponent(text)}`);
        if (!buf) throw new Error('Servicio no disponible.');
        return conn.sendMessage(m.chat, { image: buf, caption: text }, { quoted: m });
    } catch (e) { return m.reply('❌ ' + (e?.message || e)); }
});

export const wikiSearch = command({
    name: 'wiki', aliases: ['wikipedia'], category: 'search',
    description: 'Busca en Wikipedia',
}, async (conn, m, args, text) => {
    if (!text) return m.reply('Uso: .wiki <tema>');
    try {
        const url = `https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(text)}`;
        const res = await axios.get(url, { timeout: 15000 });
        const d = res.data;
        const reply = `📚 *${d.title}*\n\n${d.extract || '(sin resumen)'}\n\n🔗 ${d.content_urls?.desktop?.page || ''}`;
        return m.reply(truncate(reply));
    } catch (e) { return m.reply('❌ No encontrado.'); }
});

export const clima = command({
    name: 'clima', aliases: ['weather'], category: 'tools',
    description: 'Clima de una ciudad',
}, async (conn, m, args, text) => {
    if (!text) return m.reply('Uso: .clima <ciudad>');
    try {
        const url = `https://wttr.in/${encodeURIComponent(text)}?format=j1&lang=es`;
        const res = await axios.get(url, { timeout: 15000 });
        const cur = res.data?.current_condition?.[0];
        if (!cur) throw new Error('Sin datos');
        return m.reply(
            `🌤️ *Clima en ${text}*\n\n` +
            `• Temperatura: ${cur.temp_C}°C (sensación ${cur.FeelsLikeC}°C)\n` +
            `• Estado: ${cur.lang_es?.[0]?.value || cur.weatherDesc?.[0]?.value || '?'}\n` +
            `• Humedad: ${cur.humidity}%\n` +
            `• Viento: ${cur.windspeedKmph} km/h`
        );
    } catch (e) { return m.reply('❌ No se pudo obtener el clima.'); }
});

// ═══════════════════════════════════════════════════════════════════════
// CATEGORÍA: DOWNLOAD
// ═══════════════════════════════════════════════════════════════════════
// Estos comandos dependen de scrapers externos que rompen frecuentemente.
// Si fallan, devuelven mensaje claro.

export const ytmp3 = command({
    name: 'play', aliases: ['ytmp3', 'musica', 'mp3'], category: 'download',
    description: 'Descarga audio de YouTube',
}, async (conn, m, args, text) => {
    if (!text) return m.reply('Uso: .play <canción o link>');
    try {
        let yts; try { ({ default: yts } = await import('yt-search')); } catch { return m.reply('⚠️ Falta yt-search: npm i yt-search'); }
        const r = await yts(text);
        const video = r.videos?.[0];
        if (!video) return m.reply('Sin resultados.');
        // Intento con API pública (puede fallar/cambiar). Caída suave.
        try {
            const apiUrl = `https://api.zahwazein.xyz/downloader/youtubeaudio?url=${encodeURIComponent(video.url)}&apikey=${global.keysxxx}`;
            const res = await axios.get(apiUrl, { timeout: 30000 });
            const audioUrl = res.data?.result?.url || res.data?.result?.audio;
            if (!audioUrl) throw new Error('API sin URL');
            const buf = await getBuffer(audioUrl);
            return conn.sendMessage(m.chat, {
                audio: buf, mimetype: 'audio/mp4',
                fileName: `${video.title}.mp3`,
            }, { quoted: m });
        } catch (err) {
            return m.reply(`🎵 *${video.title}*\n_${video.author?.name}_ — ${video.timestamp}\n${video.url}\n\n⚠️ No pude descargar el audio (API caída). Usa el link.`);
        }
    } catch (e) { return m.reply('❌ ' + (e?.message || e)); }
});

export const ytmp4 = command({
    name: 'ytmp4', aliases: ['video', 'play2', 'ytvideo', 'mp4'], category: 'download',
    description: 'Descarga video de YouTube',
}, async (conn, m, args, text) => {
    if (!text) return m.reply('Uso: .ytmp4 <canción o link>');
    try {
        let yts; try { ({ default: yts } = await import('yt-search')); } catch { return m.reply('⚠️ Falta yt-search: npm i yt-search'); }
        const r = await yts(text);
        const video = r.videos?.[0];
        if (!video) return m.reply('Sin resultados.');
        return m.reply(`🎬 *${video.title}*\n_${video.author?.name}_ — ${video.timestamp}\n${video.url}\n\n⚠️ La descarga directa requiere scrapers externos. Usa el link.`);
    } catch (e) { return m.reply('❌ ' + (e?.message || e)); }
});

export const tiktokDl = command({
    name: 'tiktok', aliases: ['tt'], category: 'download',
    description: 'Descarga video de TikTok',
}, async (conn, m, args, text) => {
    if (!text || !isUrl(text)) return m.reply('Uso: .tiktok <link>');
    try {
        const apiUrl = `https://api.tiklydown.eu.org/api/download?url=${encodeURIComponent(text)}`;
        const res = await axios.get(apiUrl, { timeout: 20000 });
        const videoUrl = res.data?.video?.noWatermark || res.data?.video?.watermark;
        if (!videoUrl) throw new Error('API sin URL');
        const buf = await getBuffer(videoUrl);
        return conn.sendMessage(m.chat, {
            video: buf, mimetype: 'video/mp4',
            caption: res.data?.title || 'TikTok',
        }, { quoted: m });
    } catch (e) { return m.reply('❌ No se pudo descargar (API caída). Intenta con otro link.'); }
});

// ═══════════════════════════════════════════════════════════════════════
// CATEGORÍA: RPG
// ═══════════════════════════════════════════════════════════════════════

export const reg = command({
    name: 'reg', aliases: ['verificar', 'registrar'], category: 'rpg',
    description: 'Regístrate (uso: .reg nombre|edad)',
}, async (conn, m, args, text) => {
    if (!text || !text.includes('|')) return m.reply('Uso: .reg <nombre>|<edad>\nEjemplo: .reg Ana|22');
    const [name, ageStr] = text.split('|').map(s => s.trim());
    const age = parseInt(ageStr);
    if (!name || isNaN(age)) return m.reply('Formato inválido. Uso: .reg <nombre>|<edad>');
    if (age < 5 || age > 120) return m.reply('Edad inválida.');
    const u = getUser(m.sender);
    u.registered = true;
    u.name = name;
    u.age = age;
    u.regTime = Date.now();
    db.markDirty();
    return m.reply(`✅ Registrado/a como *${name}* (${age} años).`);
});

export const unreg = command({
    name: 'unreg', category: 'rpg', description: 'Cancela tu registro',
}, async (conn, m) => {
    const u = getUser(m.sender);
    u.registered = false;
    u.regTime = -1;
    db.markDirty();
    return m.reply('🍃 Registro cancelado.');
});

export const perfil = command({
    name: 'perfil', aliases: ['profile'], category: 'rpg',
    description: 'Tu perfil RPG',
}, async (conn, m) => {
    const u = getUser(m.sender);
    return m.reply(
        `🌸 *Tu perfil* 🌸\n\n` +
        `• Nombre: ${u.name || '(sin registrar)'}\n` +
        `• Edad: ${u.age || '?'}\n` +
        `• Nivel: ${u.level || 0}\n` +
        `• EXP: ${u.exp || 0}\n` +
        `• Rol: ${u.role || 'Novato'}\n` +
        `• 💎 Diamantes: ${u.diamond || 0}\n` +
        `• 💰 Dinero: ${u.money || 0}`
    );
});

export const bal = command({
    name: 'bal', aliases: ['balance', 'diamond'], category: 'rpg',
    description: 'Tu balance',
}, async (conn, m) => {
    const u = getUser(m.sender);
    return m.reply(`💰 Dinero: *${u.money || 0}*\n💎 Diamantes: *${u.diamond || 0}*\n⭐ Nivel: *${u.level || 0}*`);
});

const COOLDOWN = (key, durationMs) => async (conn, m, args, text) => {
    const u = getUser(m.sender);
    const last = u[key] || 0;
    const left = durationMs - (Date.now() - last);
    if (left > 0) {
        const min = Math.ceil(left / 60000);
        return m.reply(`⏱ Espera *${min} min* antes de volver a usar este comando.`);
    }
    return null; // ok, continúa
};

export const claim = command({
    name: 'claim', aliases: ['daily'], category: 'rpg',
    description: 'Reclama recompensa diaria',
}, async (conn, m) => {
    const cd = await COOLDOWN('lastclaim', 24 * 60 * 60 * 1000)(conn, m);
    if (cd) return;
    const u = getUser(m.sender);
    const reward = Math.floor(Math.random() * 500) + 100;
    u.money = (u.money || 0) + reward;
    u.lastclaim = Date.now();
    db.markDirty();
    return m.reply(`💰 +${reward} monedas. Vuelve en 24h.`);
});

export const work = command({
    name: 'work', aliases: ['trabajar', 'w'], category: 'rpg',
    description: 'Trabaja por dinero',
}, async (conn, m) => {
    const cd = await COOLDOWN('lastwork', 10 * 60 * 1000)(conn, m);
    if (cd) return;
    const u = getUser(m.sender);
    const reward = Math.floor(Math.random() * 100) + 20;
    u.money = (u.money || 0) + reward;
    u.exp = (u.exp || 0) + 5;
    u.lastwork = Date.now();
    db.markDirty();
    const jobs = ['programador', 'diseñador', 'taxista', 'cocinero', 'cantante', 'profesor'];
    const job = jobs[Math.floor(Math.random() * jobs.length)];
    return m.reply(`💼 Trabajaste como *${job}* y ganaste *${reward}* monedas (+5 exp).`);
});

export const mine = command({
    name: 'mine', aliases: ['minar'], category: 'rpg',
    description: 'Mina por diamantes',
}, async (conn, m) => {
    const cd = await COOLDOWN('lastmine', 15 * 60 * 1000)(conn, m);
    if (cd) return;
    const u = getUser(m.sender);
    const diamonds = Math.floor(Math.random() * 5) + 1;
    u.diamond = (u.diamond || 0) + diamonds;
    u.exp = (u.exp || 0) + 8;
    u.lastmine = Date.now();
    db.markDirty();
    return m.reply(`⛏ Minaste y encontraste *${diamonds}* diamantes 💎 (+8 exp).`);
});

export const top = command({
    name: 'top', aliases: ['lb', 'leaderboard'], category: 'rpg',
    description: 'Ranking de usuarios',
}, async (conn, m) => {
    const all = Object.entries(db.data.users)
        .map(([jid, u]) => ({ jid, money: u.money || 0, level: u.level || 0, exp: u.exp || 0 }))
        .sort((a, b) => b.money - a.money)
        .slice(0, 10);
    if (!all.length) return m.reply('Sin datos.');
    const list = all.map((u, i) =>
        `*${i + 1}.* @${u.jid.split('@')[0]} — ${u.money} 💰 (nivel ${u.level})`
    ).join('\n');
    return conn.sendMessage(m.chat, {
        text: `🏆 *Top 10 por dinero*\n\n${list}`,
        mentions: all.map(u => u.jid),
    });
});

export const rob = command({
    name: 'rob', aliases: ['robar'], category: 'rpg',
    description: 'Roba dinero a otro usuario',
}, async (conn, m, args, text) => {
    const cd = await COOLDOWN('lastrob', 30 * 60 * 1000)(conn, m);
    if (cd) return;
    const t = resolveTarget(m, text);
    if (!t || t === m.sender) return m.reply('Menciona o cita a la víctima.');
    const me = getUser(m.sender);
    const target = getUser(t);
    if ((target.money || 0) < 100) return m.reply('Esa persona no tiene suficiente dinero.');
    const success = Math.random() > 0.5;
    me.lastrob = Date.now();
    if (success) {
        const amount = Math.floor((target.money || 0) * (Math.random() * 0.3 + 0.1));
        target.money -= amount;
        me.money = (me.money || 0) + amount;
        db.markDirty();
        return m.reply(`🦹 Le robaste *${amount}* monedas a @${t.split('@')[0]}.`, null, { mentions: [t] });
    } else {
        const fine = Math.floor((me.money || 0) * 0.1);
        me.money = Math.max(0, (me.money || 0) - fine);
        db.markDirty();
        return m.reply(`🚓 Te atraparon y pagaste *${fine}* monedas de multa.`);
    }
});

export const slot = command({
    name: 'slot', aliases: ['apuesta'], category: 'game',
    description: 'Tragamonedas (.slot <apuesta>)',
}, async (conn, m, args) => {
    const bet = parseInt(args[0]);
    if (!bet || bet < 10) return m.reply('Uso: .slot <apuesta> (mínimo 10)');
    const u = getUser(m.sender);
    if ((u.money || 0) < bet) return m.reply('No tienes suficiente dinero.');
    const emojis = ['🍒', '🍓', '🍇', '🍉', '🍫', '💎'];
    const r1 = emojis[Math.floor(Math.random() * emojis.length)];
    const r2 = emojis[Math.floor(Math.random() * emojis.length)];
    const r3 = emojis[Math.floor(Math.random() * emojis.length)];
    let multi = 0;
    if (r1 === r2 && r2 === r3) multi = r1 === '💎' ? 10 : 5;
    else if (r1 === r2 || r2 === r3 || r1 === r3) multi = 2;
    const win = bet * multi - (multi === 0 ? bet : 0);
    u.money = (u.money || 0) + (multi > 0 ? bet * multi : -bet);
    db.markDirty();
    const msg = `🎰  ${r1} | ${r2} | ${r3}\n\n` +
        (multi > 0 ? `🎉 ¡Ganaste *${bet * multi}* monedas!` : `💔 Perdiste *${bet}* monedas.`);
    return m.reply(msg);
});

// ═══════════════════════════════════════════════════════════════════════
// CATEGORÍA: FUN / GAMES
// ═══════════════════════════════════════════════════════════════════════

const percentCmd = (name, label, emoji, desc) => command({
    name, category: 'fun', description: desc,
}, async (conn, m, args, text) => {
    const target = m.mentionedJid?.[0]
        ? `@${m.mentionedJid[0].split('@')[0]}`
        : (text || m.pushName || 'tú');
    const pct = Math.floor(Math.random() * 101);
    return conn.sendMessage(m.chat, {
        text: `${emoji} ${target} es ${pct}% ${label}`,
        mentions: m.mentionedJid || [],
    }, { quoted: m });
});

export const gay = percentCmd('gay', 'gay 🌈', '🌈', '% gay');
export const toxic = percentCmd('toxic', 'tóxico ☠️', '☠️', '% tóxico');
export const fake = percentCmd('fake', 'fake 🎭', '🎭', '% fake');
export const racista = percentCmd('racista', 'racista 🙄', '🙄', '% racista');

export const love = command({
    name: 'love', category: 'fun', description: 'Calculadora de amor',
}, async (conn, m, args) => {
    if (m.mentionedJid?.length < 2) return m.reply('Menciona a 2 personas. Ej: .love @a @b');
    const [a, b] = m.mentionedJid;
    const pct = Math.floor(Math.random() * 101);
    let bar = '';
    const blocks = Math.round(pct / 10);
    for (let i = 0; i < 10; i++) bar += i < blocks ? '💖' : '🤍';
    return conn.sendMessage(m.chat, {
        text: `💘 *Compatibilidad amorosa* 💘\n\n@${a.split('@')[0]} ❤️ @${b.split('@')[0]}\n\n${bar}\n*${pct}%*`,
        mentions: [a, b],
    }, { quoted: m });
});

export const pareja = command({
    name: 'pareja', aliases: ['formarpareja'], category: 'fun',
    description: 'Te empareja con alguien al azar del grupo',
}, async (conn, m) => {
    if (!m.isGroup) return m.reply('Solo en grupos.');
    const participants = m.participants?.map(p => p.id).filter(id => id !== m.sender) || [];
    if (!participants.length) return m.reply('No hay candidatos.');
    const pick = participants[Math.floor(Math.random() * participants.length)];
    return conn.sendMessage(m.chat, {
        text: `💘 ${m.pushName || 'Tú'} ♥️ @${pick.split('@')[0]}`,
        mentions: [pick],
    }, { quoted: m });
});

export const ppt = command({
    name: 'ppt', aliases: ['suit'], category: 'game',
    description: 'Piedra, papel, tijera',
}, async (conn, m, args) => {
    const opciones = ['piedra', 'papel', 'tijera'];
    const tuyo = (args[0] || '').toLowerCase();
    if (!opciones.includes(tuyo)) return m.reply('Uso: .ppt piedra | papel | tijera');
    const bot = opciones[Math.floor(Math.random() * 3)];
    const emo = { piedra: '🪨', papel: '📄', tijera: '✂️' };
    let result;
    if (tuyo === bot) result = '🤝 Empate';
    else if ((tuyo === 'piedra' && bot === 'tijera') ||
             (tuyo === 'papel' && bot === 'piedra') ||
             (tuyo === 'tijera' && bot === 'papel')) result = '🎉 ¡Ganaste!';
    else result = '💔 Perdiste';
    return m.reply(`Tú: ${emo[tuyo]} ${tuyo}\nYo: ${emo[bot]} ${bot}\n\n${result}`);
});

export const piropo = command({
    name: 'piropo', category: 'fun', description: 'Un piropo aleatorio',
}, async (conn, m) => {
    const piropos = [
        'Si tu fueras Google, yo te buscaría todos los días 🌹',
        'Si la belleza fuera tiempo, serías la eternidad ✨',
        'Tu nombre debería estar en mi diario, junto a "todos los días" 📖',
        'Eres como mi sándwich favorito: imposible no antojarme 🥪',
        '¿Crees en el amor a primera vista o paso de nuevo? 😏',
    ];
    return m.reply(`💐 ${piropos[Math.floor(Math.random() * piropos.length)]}`);
});

export const reto = command({
    name: 'reto', category: 'game', description: 'Un reto al azar',
}, async (conn, m) => {
    const retos = [
        'Manda un audio cantando tu canción favorita 🎤',
        'Cuenta tu peor anécdota en 3 oraciones 😅',
        'Imita a un animal en mensaje de voz 🐱',
        'Manda un selfie con cara graciosa 🤪',
        'Escribe sin usar la letra "e" durante 5 mensajes',
    ];
    return m.reply(`🎯 *Reto:* ${retos[Math.floor(Math.random() * retos.length)]}`);
});

export const verdad = command({
    name: 'verdad', category: 'game', description: 'Una pregunta de "verdad"',
}, async (conn, m) => {
    const verdades = [
        '¿Cuál es tu mayor miedo?',
        '¿Has mentido a tu mejor amig@? ¿En qué?',
        '¿Qué harías si fueras invisible por un día?',
        '¿Cuál fue tu vergüenza más grande?',
        '¿Quién te gusta en este grupo?',
    ];
    return m.reply(`💎 *Verdad:* ${verdades[Math.floor(Math.random() * verdades.length)]}`);
});

// ═══════════════════════════════════════════════════════════════════════
// CATEGORÍA: MISC
// ═══════════════════════════════════════════════════════════════════════

export const afk = command({
    name: 'afk', category: 'misc',
    description: 'Te marca como AFK (.afk razón)',
}, async (conn, m, args, text) => {
    const u = getUser(m.sender);
    u.afkTime = Date.now();
    u.afkReason = text || 'sin razón';
    db.markDirty();
    return m.reply(`💤 *Modo AFK activado*\n*Razón:* ${u.afkReason}`);
});

export const report = command({
    name: 'report', aliases: ['reportar'], category: 'misc',
    description: 'Reporta un bug al owner',
}, async (conn, m, args, text) => {
    if (!text) return m.reply('Uso: .report <descripción del problema>');
    const ownerJid = global.owner?.[0]?.[0] + '@s.whatsapp.net';
    try {
        await conn.sendMessage(ownerJid, {
            text: `🐞 *Reporte de bug*\n\n*De:* @${m.sender.split('@')[0]}\n*Chat:* ${m.isGroup ? m.groupName : 'privado'}\n*Mensaje:*\n${text}`,
            mentions: [m.sender],
        });
        return m.reply('✅ Reporte enviado al equipo. ¡Gracias!');
    } catch (e) { return m.reply('❌ No se pudo enviar el reporte.'); }
});

export const idioma = command({
    name: 'idioma', aliases: ['language'], category: 'misc',
    description: 'Cambia el idioma (es/en)',
}, async (conn, m, args) => {
    const lang = (args[0] || '').toLowerCase();
    if (lang !== 'es' && lang !== 'en') return m.reply('Uso: .idioma es | en');
    const u = getUser(m.sender);
    u.Language = lang;
    db.markDirty();
    return m.reply(`✅ Idioma: ${lang === 'es' ? 'español 🇪🇸' : 'english 🇬🇧'}`);
});

// ═══════════════════════════════════════════════════════════════════════
// CATEGORÍA: TOOLS — utilidades que usan la API de Baileys
// ═══════════════════════════════════════════════════════════════════════

export const checkWA = command({
    name: 'check', aliases: ['onwa', 'existe'], category: 'tools',
    description: 'Verifica si un número está en WhatsApp',
}, async (conn, m, args, text) => {
    const num = String(text || '').replace(/[^0-9]/g, '');
    if (!num || num.length < 8) return m.reply('Uso: .check <número>');
    try {
        const jid = num + '@s.whatsapp.net';
        const [result] = await conn.onWhatsApp(jid);
        if (result?.exists) {
            return m.reply(`✅ *+${num}* está en WhatsApp.\n*JID:* ${result.jid}`);
        }
        return m.reply(`❌ *+${num}* no está en WhatsApp.`);
    } catch (e) { return m.reply('❌ ' + (e?.message || e)); }
});

export const verBio = command({
    name: 'bio', aliases: ['ver-bio', 'estadocontacto'], category: 'tools',
    description: 'Lee la biografía de un usuario',
}, async (conn, m, args, text) => {
    const t = m.mentionedJid?.[0] || m.quoted?.sender
        || (text ? text.replace(/[^0-9]/g, '') + '@s.whatsapp.net' : m.sender);
    try {
        const status = await conn.fetchStatus(t);
        const bioText = Array.isArray(status) ? status[0]?.status : (status?.status?.toString?.() || JSON.stringify(status));
        const setAt = Array.isArray(status) ? status[0]?.setAt : status?.setAt;
        return m.reply(
            `🍓 *Biografía de @${t.split('@')[0]}*\n\n` +
            `${bioText || '(vacía)'}\n\n` +
            (setAt ? `*Establecida:* ${new Date(setAt).toLocaleString()}` : '')
        , null, { mentions: [t] });
    } catch (e) { return m.reply('❌ No se pudo leer la bio: ' + (e?.message || e)); }
});

export const fotoPerfil = command({
    name: 'fotoperfil', aliases: ['fp', 'pp'], category: 'tools',
    description: 'Envía la foto de perfil HD',
}, async (conn, m, args, text) => {
    const t = m.mentionedJid?.[0] || m.quoted?.sender
        || (text ? text.replace(/[^0-9]/g, '') + '@s.whatsapp.net' : m.sender);
    try {
        const url = await conn.profilePictureUrl(t, 'image');
        const buf = await getBuffer(url);
        return conn.sendMessage(m.chat, {
            image: buf,
            caption: `🌸 Foto de perfil de @${t.split('@')[0]}`,
            mentions: [t],
        }, { quoted: m });
    } catch { return m.reply('❌ No tiene foto de perfil o es privada.'); }
});

export const businessProfile = command({
    name: 'business', aliases: ['bizinfo'], category: 'tools',
    description: 'Info de cuenta business',
}, async (conn, m, args, text) => {
    const t = m.mentionedJid?.[0] || m.quoted?.sender
        || (text ? text.replace(/[^0-9]/g, '') + '@s.whatsapp.net' : m.sender);
    try {
        const p = await conn.getBusinessProfile(t);
        if (!p) return m.reply('❌ No es cuenta business.');
        return m.reply(
            `🌸 *Perfil business de @${t.split('@')[0]}*\n\n` +
            `*Categoría:* ${p.category || '-'}\n` +
            `*Descripción:* ${p.description || '-'}\n` +
            `*Email:* ${p.email || '-'}\n` +
            `*Website:* ${p.website?.join(', ') || '-'}\n` +
            `*Dirección:* ${p.address || '-'}`
        , null, { mentions: [t] });
    } catch (e) { return m.reply('❌ ' + (e?.message || e)); }
});

// ═══════════════════════════════════════════════════════════════════════
// CATEGORÍA: GROUP — cambios de foto del grupo
// ═══════════════════════════════════════════════════════════════════════

export const setppGrupo = command({
    name: 'setppgrupo', aliases: ['setppgroup', 'setppg'], category: 'group',
    description: 'Cambia la foto del grupo (responde a una imagen)',
}, async (conn, m) => {
    if (!needGroupAdmin(m) || !needBotAdmin(m)) return;
    const target = m.quoted || m;
    const mime = target.msg?.mimetype || '';
    if (!mime.startsWith('image/')) return m.reply('Responde a una imagen con el comando.');
    try {
        const buf = await target.download();
        await conn.updateProfilePicture(m.chat, buf);
        // Invalida el cache de foto en announcements.js
        try {
            const { invalidateGroupPic } = await import('./announcements.js');
            invalidateGroupPic(m.chat);
        } catch { /* */ }
        return m.reply('✅ Foto del grupo actualizada.');
    } catch (e) { return m.reply('❌ ' + (e?.message || e)); }
});

export const setppBot = command({
    name: 'setppbot', category: 'owner',
    description: 'Cambia la foto del bot (responde a una imagen)',
}, async (conn, m) => {
    if (!needOwner(m)) return;
    const target = m.quoted || m;
    const mime = target.msg?.mimetype || '';
    if (!mime.startsWith('image/')) return m.reply('Responde a una imagen con el comando.');
    try {
        const buf = await target.download();
        const botJid = conn.user?.jid || conn.decodeJid?.(conn.user?.id);
        await conn.updateProfilePicture(botJid, buf);
        return m.reply('✅ Foto del bot actualizada.');
    } catch (e) { return m.reply('❌ ' + (e?.message || e)); }
});

// ═══════════════════════════════════════════════════════════════════════
// CATEGORÍA: GROUP — encuestas (polls)
// ═══════════════════════════════════════════════════════════════════════

export const encuesta = command({
    name: 'encuesta', aliases: ['poll'], category: 'group',
    description: 'Crea encuesta (.encuesta pregunta | op1 | op2 | ...)',
}, async (conn, m, args, text) => {
    if (!text || !text.includes('|')) {
        return m.reply('Uso: .encuesta <pregunta> | <opción 1> | <opción 2> | ...');
    }
    const parts = text.split('|').map(s => s.trim()).filter(Boolean);
    if (parts.length < 3) return m.reply('Necesitas al menos 1 pregunta y 2 opciones.');
    const [pregunta, ...opciones] = parts;
    if (opciones.length > 12) return m.reply('Máximo 12 opciones.');
    try {
        await conn.sendMessage(m.chat, {
            poll: {
                name: pregunta,
                values: opciones,
                selectableCount: 1,
            },
        }, { quoted: m });
    } catch (e) { return m.reply('❌ ' + (e?.message || e)); }
});

export const crearGrupo = command({
    name: 'creargrupo', aliases: ['groupcreate'], category: 'owner',
    description: 'Crea un grupo nuevo (.creargrupo <nombre>)',
}, async (conn, m, args, text) => {
    if (!needOwner(m)) return;
    if (!text) return m.reply('Uso: .creargrupo <nombre del grupo>');
    try {
        // Crea el grupo con el bot y el owner como miembros
        const ownerJid = global.owner?.[0]?.[0] + '@s.whatsapp.net';
        const result = await conn.groupCreate(text, [ownerJid]);
        return m.reply(`✅ Grupo creado.\n*ID:* ${result.gid || result.id}`);
    } catch (e) { return m.reply('❌ ' + (e?.message || e)); }
});

// ═══════════════════════════════════════════════════════════════════════
// CATEGORÍA: CONFIG — toggles nuevos (anti-llamada, anti-delete, edit-log)
// ═══════════════════════════════════════════════════════════════════════

export const toggleAntiLlamada = command({
    name: 'antillamada', aliases: ['anticall'], category: 'config',
    description: 'Rechaza llamadas automáticas (global del bot)',
}, async (conn, m, args) => {
    if (!needOwner(m)) return;
    const botJid = conn.user?.jid || conn.decodeJid?.(conn.user?.id);
    if (!botJid) return m.reply('No se pudo detectar el JID del bot.');
    const s = getSettings(botJid);
    const arg = (args[0] || '').toLowerCase();
    if (arg === 'on') s.antillamada = true;
    else if (arg === 'off') s.antillamada = false;
    else s.antillamada = !s.antillamada;
    db.markDirty();
    return m.reply(`${s.antillamada ? '✅' : '❌'} Anti-llamada *${s.antillamada ? 'activado' : 'desactivado'}*`);
});

export const toggleBloquearLlamada = command({
    name: 'bloquearllamada', aliases: ['blockcall'], category: 'config',
    description: 'Además de rechazar, bloquea al que llama',
}, async (conn, m, args) => {
    if (!needOwner(m)) return;
    const botJid = conn.user?.jid || conn.decodeJid?.(conn.user?.id);
    if (!botJid) return m.reply('No se pudo detectar el JID del bot.');
    const s = getSettings(botJid);
    const arg = (args[0] || '').toLowerCase();
    if (arg === 'on') s.bloquearLlamada = true;
    else if (arg === 'off') s.bloquearLlamada = false;
    else s.bloquearLlamada = !s.bloquearLlamada;
    db.markDirty();
    return m.reply(`${s.bloquearLlamada ? '✅' : '❌'} Bloquear-al-llamar *${s.bloquearLlamada ? 'activado' : 'desactivado'}*`);
});

export const toggleAntidelete = command({
    name: 'antidelete', aliases: ['antideleted'], category: 'config',
    description: 'Recupera mensajes borrados del grupo',
}, async (conn, m, args) => {
    if (!needGroupAdmin(m)) return;
    const c = getChat(m.chat);
    const arg = (args[0] || '').toLowerCase();
    if (arg === 'on') c.antidelete = true;
    else if (arg === 'off') c.antidelete = false;
    else c.antidelete = !c.antidelete;
    db.markDirty();
    return m.reply(`${c.antidelete ? '✅' : '❌'} Anti-delete *${c.antidelete ? 'activado' : 'desactivado'}*`);
});

export const toggleEditlog = command({
    name: 'editlog', aliases: ['antieedit'], category: 'config',
    description: 'Log de mensajes editados',
}, async (conn, m, args) => {
    if (!needGroupAdmin(m)) return;
    const c = getChat(m.chat);
    const arg = (args[0] || '').toLowerCase();
    if (arg === 'on') c.editlog = true;
    else if (arg === 'off') c.editlog = false;
    else c.editlog = !c.editlog;
    db.markDirty();
    return m.reply(`${c.editlog ? '✅' : '❌'} Edit-log *${c.editlog ? 'activado' : 'desactivado'}*`);
});

export const toggleNotifyChanges = command({
    name: 'notifychanges', aliases: ['avisocambios'], category: 'config',
    description: 'Avisa cuando cambian nombre/desc/foto del grupo',
}, async (conn, m, args) => {
    if (!needGroupAdmin(m)) return;
    const c = getChat(m.chat);
    const arg = (args[0] || '').toLowerCase();
    if (arg === 'on') c.notifyGroupChanges = true;
    else if (arg === 'off') c.notifyGroupChanges = false;
    else c.notifyGroupChanges = !c.notifyGroupChanges;
    db.markDirty();
    return m.reply(`${c.notifyGroupChanges ? '✅' : '❌'} Notificación de cambios *${c.notifyGroupChanges ? 'activada' : 'desactivada'}*`);
});
