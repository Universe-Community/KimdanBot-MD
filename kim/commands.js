// kim/commands.js — Despachador switch/case/break con permisos centralizados.
//
// TODA la lógica de comandos vive en una sola función execute().
// Cada comando es un `case` con su check de permiso y su body.
// Las aliases se normalizan al nombre canónico (primer nombre del array
// `names` en COMMAND_META) ANTES del switch.
//
// Compatibilidad con handler.js sin tocarlo:
//   - Al final del archivo, un loop registra cada comando en el registry
//     con un wrapper que llama execute(). Así el cmdMap del handler
//     sigue funcionando sin cambios.
//   - Owner shortcuts (>, =>, $) se exportan como evalSync/evalAsync/shell.

import { execSync } from 'child_process';
import util from 'util';
import os from 'os';
import moment from 'moment-timezone';
import axios from 'axios';

import { command, buildMenu, commandCount, aliasCount } from './registry.js';
import { fmtMoney, fmtPremium, fmtAffinity, vipMult, isVip, VIP } from './theme.js';
import { runtime, getBuffer, isUrl } from './helpers.js';
import { getUser, getChat, getSettings, db } from './db.js';

const MAX_REPLY = 4000;
const truncate = (s) => s.length > MAX_REPLY ? s.slice(0, MAX_REPLY) + '\n[…truncado]' : s;

// ═══════════════════════════════════════════════════════════════════════
// HELPERS DE PERMISOS
// ═══════════════════════════════════════════════════════════════════════
//
// Chequean los flags que el handler setea ANTES de despachar:
//   - m.isGroup       — según el JID del chat (smsg)
//   - m.isSenderAdmin — handler con expansión LID↔PN
//   - m.isBotAdmin    — handler con expansión LID↔PN
//   - m.isOwner       — handler con resolución LID→PN
//
// Si el helper devuelve false, envía mensaje de error y el case `return`.

const needGroup = (m) => {
    if (!m.isGroup) {
        m.reply(global.mess?.group || '⚠️ Solo en grupos.');
        return false;
    }
    return true;
};

const needGroupAdmin = (m) => {
    if (!needGroup(m)) return false;
    if (!m.isSenderAdmin && !m.isOwner) {
        m.reply(global.mess?.admin || '⚠️ Solo administradores.');
        return false;
    }
    return true;
};

const needBotAdmin = (m) => {
    if (!m.isBotAdmin) {
        m.reply(global.mess?.botAdmin || '⚠️ Necesito ser admin del grupo.');
        return false;
    }
    return true;
};

const needOwner = (m) => {
    if (!m.isOwner) {
        m.reply(global.mess?.owner || '⚠️ Solo el propietario.');
        return false;
    }
    return true;
};

// Doble validación: owner Y chat privado. Para comandos sensibles
// (config global del bot, mantenimiento) que no deben usarse en grupos.
const needOwnerPrivate = (m) => {
    if (!m.isOwner) { m.reply(global.mess?.owner || '⚠️ Solo el propietario.'); return false; }
    if (m.isGroup) { m.reply('🔒 Este comando solo puede usarse en el *chat privado* con el bot, por seguridad.'); return false; }
    return true;
};

const resolveTarget = (m, text) => {
    if (m.mentionedJid?.[0]) return m.mentionedJid[0];
    if (m.quoted?.sender) return m.quoted.sender;
    if (text) {
        const num = String(text).replace(/[^0-9]/g, '');
        if (num.length >= 10) return num + '@s.whatsapp.net';
    }
    return null;
};

// Si retorna true, el case llamador debe hacer `return`.
const cooldown = (m, key, durationMs) => {
    const u = getUser(m.sender);
    const last = u[key] || 0;
    const left = durationMs - (Date.now() - last);
    if (left > 0) {
        const min = Math.ceil(left / 60000);
        m.reply(`⏱ Espera *${min} min* antes de volver a usar este comando.`);
        return true;
    }
    return false;
};

// ═══════════════════════════════════════════════════════════════════════
// COMMAND_META — fuente única para menú, aliases y dispatch
// ═══════════════════════════════════════════════════════════════════════
// names[0] = nombre canónico (case en el switch); names[1..N] = aliases

const COMMAND_META = [
    // ─── INFO ───
    { names: ['ping', 'test', 'velocidad'], category: 'info', description: 'Mide la latencia del bot' },
    { names: ['menu', 'help', 'menu1'], category: 'info', description: 'Lista de comandos' },
    { names: ['info', 'infokim'], category: 'info', description: 'Información del bot' },
    { names: ['estado', 'status', 'heydan'], category: 'info', description: 'Estado del sistema' },
    { names: ['runtime', 'uptime'], category: 'info', description: 'Tiempo activo del bot' },
    { names: ['creador', 'owner', 'dono'], category: 'info', description: 'Datos del creador' },
    { names: ['donar', 'donacion', 'donate'], category: 'info', description: 'Información de donaciones' },
    { names: ['canales', 'cuentaskim', 'cuentas', 'cuentaskimbot'], category: 'info', description: 'Canales oficiales' },
    { names: ['gruposoficiales', 'gruposkim', 'oficial'], category: 'info', description: 'Grupos oficiales' },
    { names: ['colaboradores'], category: 'info', description: 'Equipo del bot' },

    // ─── OWNER ───
    { names: ['eval'], category: 'owner', description: 'Ejecuta JS (eval sync)' },
    { names: ['evala', 'evalasync'], category: 'owner', description: 'Ejecuta JS (eval async)' },
    { names: ['shell', 'bash', 'cmd'], category: 'owner', description: 'Ejecuta un comando shell' },
    { names: ['restart', 'reiniciar'], category: 'owner', description: 'Reinicia el bot' },
    { names: ['public'], category: 'owner', description: 'Modo público' },
    { names: ['private'], category: 'owner', description: 'Modo privado (solo owners)' },
    { names: ['banuser', 'baner'], category: 'owner', description: 'Banea a un usuario del bot' },
    { names: ['unbanuser'], category: 'owner', description: 'Desbanea usuario' },
    { names: ['banchat'], category: 'owner', description: 'Banea chat actual' },
    { names: ['unbanchat'], category: 'owner', description: 'Desbanea chat' },
    { names: ['setbio', 'setstatus', 'setbiobot'], category: 'owner', description: 'Cambia la bio del bot' },
    { names: ['setnamebot', 'setnameb'], category: 'owner', description: 'Cambia el nombre del bot' },
    { names: ['block'], category: 'owner', description: 'Bloquea a un usuario' },
    { names: ['unblock'], category: 'owner', description: 'Desbloquea usuario' },
    { names: ['setppbot'], category: 'owner', description: 'Cambia la foto del bot' },
    { names: ['creargrupo', 'groupcreate'], category: 'owner', description: 'Crea un grupo nuevo' },

    // ─── CONFIG: toggles per-chat (admin del grupo) ───
    { names: ['antilink'], category: 'config', description: 'Borra links de grupos WhatsApp' },
    { names: ['antilinkyt', 'antiyt'], category: 'config', description: 'Borra links de YouTube' },
    { names: ['antilinkig', 'antiig'], category: 'config', description: 'Borra links de Instagram' },
    { names: ['antilinkfb', 'antifb'], category: 'config', description: 'Borra links de Facebook' },
    { names: ['antilinktt', 'antitt'], category: 'config', description: 'Borra links de TikTok' },
    { names: ['antilinktw', 'antitw'], category: 'config', description: 'Borra links de Twitter/X' },
    { names: ['antilinktg', 'antitg'], category: 'config', description: 'Borra links de Telegram' },
    { names: ['antitoxic'], category: 'config', description: 'Borra palabras tóxicas' },
    { names: ['antifake'], category: 'config', description: 'Expulsa números fake' },
    { names: ['antispam'], category: 'config', description: 'Rate-limit de comandos' },
    { names: ['welcome'], category: 'config', description: 'Mensajes de bienvenida' },
    { names: ['modeadmin'], category: 'config', description: 'Solo admins usan comandos' },
    { names: ['autosticker', 'autosic'], category: 'config', description: 'Auto-stickeriza imágenes' },
    { names: ['bye', 'despedida'], category: 'config', description: 'Mensaje de despedida' },
    { names: ['detect', 'anunciaradmins'], category: 'config', description: 'Avisos promote/demote' },
    { names: ['antidelete', 'antideleted'], category: 'config', description: 'Recupera mensajes borrados' },
    { names: ['editlog', 'antieedit'], category: 'config', description: 'Log de mensajes editados' },
    { names: ['notifychanges', 'avisocambios'], category: 'config', description: 'Avisos de cambios del grupo' },
    // ─── CONFIG: settings globales / owner ───
    { names: ['antiprivado', 'antipv', 'priv'], category: 'config', description: 'Bloquea el chat privado a no-owners' },
    { names: ['antillamada', 'anticall'], category: 'config', description: 'Rechaza llamadas automáticas' },
    { names: ['bloquearllamada', 'blockcall'], category: 'config', description: 'Además rechaza, bloquea al que llama' },
    { names: ['anuncios', 'announces', 'avisos'], category: 'config', description: 'Configura anuncios automáticos' },

    // ─── GROUP ───
    { names: ['kick', 'echar', 'sacar', 'ban', 'remove'], category: 'group', description: 'Expulsa a un usuario (responde o etiqueta)' },
    { names: ['add', 'agregar', 'invitar', 'añadir'], category: 'group', description: 'Agrega un número al grupo' },
    { names: ['promote', 'daradmin'], category: 'group', description: 'Da admin a un usuario' },
    { names: ['demote', 'quitaradmin', 'quitar'], category: 'group', description: 'Quita admin a un usuario' },
    { names: ['link', 'linkgc', 'linkgroup'], category: 'group', description: 'Link de invitación del grupo' },
    { names: ['revoke', 'resetlink', 'anularlink'], category: 'group', description: 'Revoca el link' },
    { names: ['hidetag', 'notificar'], category: 'group', description: 'Menciona a todos sin mostrarlos' },
    { names: ['tagall', 'invocar', 'todos'], category: 'group', description: 'Etiqueta a todos' },
    { names: ['del', 'delete'], category: 'group', description: 'Elimina el mensaje citado' },
    { names: ['admins', 'administradores'], category: 'group', description: 'Lista de administradores' },
    { names: ['infogrupo', 'groupinfo'], category: 'group', description: 'Info del grupo' },
    { names: ['setname', 'setnameg', 'setnombre', 'setppname', 'nuevonombre', 'newnombre'], category: 'group', description: 'Cambia el nombre del grupo' },
    { names: ['setdesc', 'setdescripcion', 'descripcion', 'descripción'], category: 'group', description: 'Cambia la descripción' },
    { names: ['unwarn', 'quitardvertencia'], category: 'group', description: 'Quita una advertencia' },
    { names: ['listwarn'], category: 'group', description: 'Lista usuarios con advertencias' },
    { names: ['grupo', 'grup'], category: 'group', description: 'Abre/cierra el grupo' },
    { names: ['setppgrupo', 'setppgroup', 'setppg', 'setpp', 'setppgrup'], category: 'group', description: 'Cambia la foto del grupo' },
    { names: ['encuesta', 'poll'], category: 'group', description: 'Crea una encuesta' },

    // ─── STICKER / MEDIA ───
    { names: ['attp'], category: 'sticker', description: 'Sticker animado con texto' },
    { names: ['toimg', 'toimagen'], category: 'sticker', description: 'Convierte sticker en imagen' },
    { names: ['tomp3', 'toaudio'], category: 'sticker', description: 'Convierte video en audio' },

    // ─── SEARCH ───
    { names: ['yts', 'ytsearch'], category: 'search', description: 'Busca en YouTube' },
    { names: ['wiki', 'wikipedia'], category: 'search', description: 'Busca en Wikipedia' },

    // ─── TOOLS ───
    { names: ['traducir', 'translate'], category: 'tools', description: 'Traduce a español' },
    { names: ['tts'], category: 'tools', description: 'Texto a voz (es)' },
    { names: ['acortar', 'short'], category: 'tools', description: 'Acorta una URL' },
    { names: ['ssweb', 'ss'], category: 'tools', description: 'Captura de un sitio web' },
    { names: ['clima', 'weather'], category: 'tools', description: 'Clima de una ciudad' },
    { names: ['check', 'onwa', 'existe'], category: 'tools', description: 'Verifica si un número está en WhatsApp' },
    { names: ['bio', 'ver-bio', 'estadocontacto'], category: 'tools', description: 'Lee la biografía de un usuario' },
    { names: ['fotoperfil', 'fp', 'pp'], category: 'tools', description: 'Envía la foto de perfil HD' },
    { names: ['business', 'bizinfo'], category: 'tools', description: 'Info de cuenta business' },

    // ─── DOWNLOAD ───
    { names: ['play', 'ytmp3', 'musica', 'mp3'], category: 'download', description: 'Descarga audio de YouTube' },
    { names: ['ytmp4', 'video', 'play2', 'ytvideo', 'mp4'], category: 'download', description: 'Descarga video de YouTube' },
    { names: ['tiktok', 'tt'], category: 'download', description: 'Descarga video de TikTok' },

    // ─── RPG ───
    { names: ['reg', 'verificar', 'registrar'], category: 'rpg', description: 'Regístrate (.reg nombre|edad)' },
    { names: ['unreg'], category: 'rpg', description: 'Cancela tu registro' },
    { names: ['mine', 'minar'], category: 'rpg', description: 'Mina por diamantes' },
    { names: ['top', 'lb'], category: 'rpg', description: 'Ranking de usuarios' },

    // ─── GAME ───
    { names: ['ppt', 'suit'], category: 'game', description: 'Piedra, papel, tijera' },
    { names: ['slot', 'apuesta'], category: 'game', description: 'Tragamonedas en Jinx Coins (.slot <apuesta>)' },
    { names: ['reto'], category: 'game', description: 'Un reto al azar' },
    { names: ['verdad'], category: 'game', description: 'Una pregunta de "verdad"' },

    // ─── FUN ───
    { names: ['dado'], category: 'fun', description: 'Lanza un dado virtual' },
    { names: ['gay'], category: 'fun', description: '% gay' },
    { names: ['toxic'], category: 'fun', description: '% tóxico' },
    { names: ['fake'], category: 'fun', description: '% fake' },
    { names: ['racista'], category: 'fun', description: '% racista' },
    { names: ['love'], category: 'fun', description: 'Calculadora de amor' },
    { names: ['emparejar', 'formarpareja', 'shipme'], category: 'fun', description: 'Te empareja al azar con alguien del grupo' },
    { names: ['piropo'], category: 'fun', description: 'Un piropo aleatorio' },

    // ─── MISC ───
    { names: ['afk'], category: 'misc', description: 'Te marca como AFK' },
    { names: ['report', 'reportar'], category: 'misc', description: 'Reporta un bug al owner' },
    { names: ['idioma', 'language', 'idiomas'], category: 'misc', description: 'Cambia el idioma (es/en)' },
];

// ─── Map: alias.toLowerCase() → nombre canónico (names[0]) ─────────────
const ALIAS_MAP = (() => {
    const map = new Map();
    for (const entry of COMMAND_META) {
        const canonical = entry.names[0];
        for (const n of entry.names) map.set(String(n).toLowerCase(), canonical);
    }
    return map;
})();

// ═══════════════════════════════════════════════════════════════════════
// EXECUTE — despachador principal con switch/case/break
// ═══════════════════════════════════════════════════════════════════════

export async function execute(conn, m, rawCommand, args, text) {
    if (!rawCommand) return;
    const cmd = ALIAS_MAP.get(String(rawCommand).toLowerCase());
    if (!cmd) return; // comando desconocido — silencio

    try {
        switch (cmd) {

            // ═════════════════ INFO ═════════════════

            case 'ping': {
                const t0 = Date.now();
                await m.reply('🏓 Pong!');
                await m.reply(`🌸 Latencia: *${Date.now() - t0} ms*`);
                break;
            }

            case 'menu': {
                const p = m.prefix || (Array.isArray(global.prefix) ? global.prefix[0] : '.');
                const ownerName = global.owner?.[0]?.[1] || 'kim';
                const totalUsers = Object.keys(db.data.users).length;
                const up = runtime(process.uptime());
                const mem = (process.memoryUsage().rss / 1024 / 1024).toFixed(0);
                const ping = Date.now() - (m.messageTimestamp ? m.messageTimestamp * 1000 : Date.now());
                const pingTxt = Math.abs(ping) < 100000 ? `${Math.abs(ping)} ms` : '\u2014 ms';
                const now = new Date();
                const fecha = now.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
                const hora = now.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
                const u = getUser(m.sender);
                const userName = m.pushName || ownerName;
                const vip = (isVip(u) || m.isVip) ? ' \ud83d\udc51' : '';
                const header =
`\u256d\u2501\u2501\u2501\u2740\u273f\u2740\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u29e3
\u2503   \ud83d\udc9c *${(global.botname || 'KimdanBot-MD').toUpperCase()}* \ud83d\udc9c
\u2503   \u02da\u208a\u00b7 \u035f\u035f\u035e\u035e\u27b3 _BL \u00b7 Yaoi \u00b7 Jinx_
\u2503\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u29e3
\u2503 \u273f Hola, *${userName}*${vip}
\u2503 \ud83e\udde1 ${fecha} \u00b7 ${hora}
\u2503 \u26a1 Ping: ${pingTxt}
\u2503 \u23f1 Uptime: ${up}
\u2503 \ud83e\udde0 RAM: ${mem} MB
\u2503\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u29e3
\u2503 \ud83d\udcb0 ${fmtMoney(u.money)}
\u2503 \ud83d\udc8e ${fmtPremium(u.corazones)}  \ud83e\udd1d ${fmtAffinity(u.affinity)}
\u2503\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u29e3
\u2503 \ud83c\udfb4 Comandos: ${commandCount()}
\u2503 \ud83d\udc65 Usuarios: ${totalUsers}
\u2503 \ud83c\udf10 v${global.vs || '3.0.0'} \u00b7 by ${ownerName}
\u2570\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u29e3`;
                const list = buildMenu(p);
                const fullText = header + '\n' + list + `\n\n╭❀ _Usa ${p}<comando>_ ❀╮\n╰━ 💜 ${global.botname || 'KimdanBot'} ━╯`;
                try {
                    await conn.sendMessage(m.chat, {
                        image: { url: global.imagen1 || 'https://telegra.ph/file/6ef00a79a7c90c05e7043.jpg' },
                        caption: fullText,
                    }, { quoted: m });
                } catch {
                    await m.reply(fullText);
                }
                break;
            }

            case 'info': {
                const up = process.uptime();
                const mem = process.memoryUsage();
                const mb = (n) => (n / 1024 / 1024).toFixed(1);
                await m.reply(
                    `🍓 *${global.botname || 'KimdanBot-MD'}*\n` +
                    `v${global.vs || '3.0.0'} — by ${global.owner?.[0]?.[1] || 'kim'}\n\n` +
                    `*📊 Estado:*\n` +
                    `• Uptime: ${runtime(up)}\n` +
                    `• RAM: ${mb(mem.rss)} MB · Heap: ${mb(mem.heapUsed)}/${mb(mem.heapTotal)} MB\n` +
                    `• Plataforma: ${os.platform()} (${os.arch()})\n` +
                    `• Node: ${process.version}\n` +
                    `• Usuarios DB: ${Object.keys(db.data.users).length}`
                );
                break;
            }

            case 'estado': {
                const mem = process.memoryUsage();
                const mb = (n) => (n / 1024 / 1024).toFixed(1);
                await m.reply(
                    `*✿ Estado del bot ✿*\n\n` +
                    `🌸 Activo: ${runtime(process.uptime())}\n` +
                    `🍓 RAM: ${mb(mem.rss)} MB\n` +
                    `🫐 Heap: ${mb(mem.heapUsed)}/${mb(mem.heapTotal)} MB\n` +
                    `💐 Sistema: ${os.platform()}-${os.arch()}\n` +
                    `🍒 CPUs: ${os.cpus().length}\n` +
                    `🍇 Carga: ${os.loadavg().map(n => n.toFixed(2)).join(' / ')}`
                );
                break;
            }

            case 'runtime': {
                await m.reply(`🍓 *Uptime:* ${runtime(process.uptime())}`);
                break;
            }

            case 'creador': {
                const ownerName = global.owner?.[0]?.[1] || 'kim';
                const ownerNum = global.owner?.[0]?.[0];
                const txt = `🍓 *Creador del bot* 🍓\n\n*Nombre:* ${ownerName}\n*Número:* +${ownerNum}\n*GitHub:* ${global.md || ''}`;
                try {
                    await conn.sendMessage(m.chat, {
                        contacts: {
                            displayName: ownerName,
                            contacts: [{
                                vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${ownerName}\nTEL;type=CELL;type=VOICE;waid=${ownerNum}:+${ownerNum}\nEND:VCARD`,
                            }],
                        },
                    }, { quoted: m });
                } catch { await m.reply(txt); }
                break;
            }

            case 'donar': {
                await m.reply(`🍓 *Donaciones* 🍓\n\nApóyanos para mantener el bot activo:\n\n• PayPal: ...\n• Nequi: ...\n\n¡Mil gracias! 💐`);
                break;
            }

            case 'canales': {
                const list = (global.ca || []).filter(Boolean).map((u, i) => `*${i + 1}.* ${u}`).join('\n');
                await m.reply(`🌸 *Canales oficiales* 🌸\n\n${list || 'Sin canales configurados.'}`);
                break;
            }

            case 'gruposoficiales': {
                const list = (global.wa || []).filter(Boolean).slice(0, 5).map((u, i) => `*${i + 1}.* ${u}`).join('\n');
                await m.reply(`🍓 *Grupos oficiales* 🍓\n\n${list || 'Sin grupos configurados.'}`);
                break;
            }

            case 'colaboradores': {
                const list = (global.owner || []).filter(o => o[2]).map(o => `❁ ${o[1] || 'sin nombre'} (+${o[0]})`).join('\n');
                await m.reply(`🍓 *Colaboradores* 🍓\n\n${list || 'Sin colaboradores.'}`);
                break;
            }

            // ═════════════════ OWNER ═════════════════

            case 'eval': {
                if (!needOwner(m)) return;
                const code = text || args.join(' ');
                if (!code) return m.reply('Uso: .eval <código>  o `>` <código>');
                try {
                    const r = eval(code);
                    const out = typeof r === 'string' ? r : util.inspect(r, { depth: 2, colors: false });
                    await m.reply(truncate(out));
                } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
                break;
            }

            case 'evala': {
                if (!needOwner(m)) return;
                const code = text || args.join(' ');
                if (!code) return m.reply('Uso: .evala <código>  o `=>` <código>');
                try {
                    const r = await eval(`(async () => { ${code} })()`);
                    const out = typeof r === 'string' ? r : util.inspect(r, { depth: 2, colors: false });
                    await m.reply(truncate(out));
                } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
                break;
            }

            case 'shell': {
                if (!needOwner(m)) return;
                const cmdStr = text || args.join(' ');
                if (!cmdStr) return m.reply('Uso: .shell <comando>  o `$` <comando>');
                try {
                    const out = execSync(cmdStr, { encoding: 'utf-8', timeout: 30000 });
                    await m.reply(truncate(out || '(sin salida)'));
                } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
                break;
            }

            case 'restart': {
                if (!needOwner(m)) return;
                await m.reply('🔄 *Reiniciando bot...*\nLa sesión y los datos de MongoDB se conservan.').catch(() => {});
                // Persistir DB antes de salir (no perder datos).
                try { await db.flush?.(); } catch { /* */ }
                // Re-spawn: si hay gestor (pm2/systemd) él reinicia; si no,
                // lanzamos un proceso hijo independiente que arranca de nuevo.
                try {
                    const cp = await import('child_process');
                    const proc = cp.spawn(process.argv[0], process.argv.slice(1), {
                        cwd: process.cwd(), detached: true, stdio: 'inherit',
                    });
                    proc.unref();
                } catch (e) { console.error('[restart] spawn:', e?.message || e); }
                setTimeout(() => process.exit(0), 1500);
                break;
            }

            case 'public': {
                if (!needOwner(m)) return;
                conn.public = true;
                await m.reply('✅ Bot ahora en *modo público*.');
                break;
            }

            case 'private': {
                if (!needOwner(m)) return;
                conn.public = false;
                await m.reply('🔒 Bot en *modo privado* (solo owners).');
                break;
            }

            case 'banuser': {
                if (!needOwner(m)) return;
                const t = resolveTarget(m, text);
                if (!t) return m.reply('Menciona, cita o pasa el número del usuario.');
                const u = getUser(t);
                u.banned = true;
                db.markDirty();
                await m.reply(`🔒 @${t.split('@')[0]} baneado del bot.`, null, { mentions: [t] });
                break;
            }

            case 'unbanuser': {
                if (!needOwner(m)) return;
                const t = resolveTarget(m, text);
                if (!t) return m.reply('Menciona, cita o pasa el número.');
                const u = getUser(t);
                u.banned = false;
                db.markDirty();
                await m.reply(`🔓 @${t.split('@')[0]} desbaneado.`, null, { mentions: [t] });
                break;
            }

            case 'banchat': {
                if (!needOwner(m)) return;
                if (!m.isGroup) return m.reply('Solo en grupos.');
                const c = getChat(m.chat);
                c.isBanned = true;
                db.markDirty();
                await m.reply('🔒 Chat baneado.');
                break;
            }

            case 'unbanchat': {
                if (!needOwner(m)) return;
                if (!m.isGroup) return m.reply('Solo en grupos.');
                const c = getChat(m.chat);
                c.isBanned = false;
                db.markDirty();
                await m.reply('🔓 Chat desbaneado.');
                break;
            }

            case 'setbio': {
                if (!needOwnerPrivate(m)) return;
                if (!text) return m.reply('Uso: .setbio <nuevo texto>');
                try {
                    await conn.updateProfileStatus(text);
                    await m.reply('✅ Bio del bot actualizada.');
                } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
                break;
            }

            case 'setnamebot': {
                if (!needOwnerPrivate(m)) return;
                if (!text) return m.reply('Uso: .setnamebot <nuevo nombre>');
                try {
                    await conn.updateProfileName(text);
                    await m.reply('✅ Nombre del bot actualizado.');
                } catch (e) {
                    const msg = String(e?.message || e);
                    // "myAppStateKey not present": faltan las app-state sync keys
                    // en la sesión actual. Recuperación real: pedirlas al teléfono
                    // con resyncAppState y reintentar UNA vez (no se oculta el error;
                    // si el reintento también falla, se informa con la causa).
                    if (/myAppStateKey|not present|isMissingKey/i.test(msg) && conn.resyncAppState) {
                        try {
                            await m.reply('🔄 Sincronizando claves de la sesión, un momento…');
                            await conn.resyncAppState(['regular_high', 'regular_low', 'regular', 'critical_block', 'critical_unblock_low'], false);
                            await conn.updateProfileName(text);
                            await m.reply('✅ Nombre del bot actualizado (tras sincronizar claves).');
                        } catch (e2) {
                            await m.reply(
                                '❌ No se pudo cambiar el nombre: tu sesión nunca recibió las *claves de app-state* del teléfono.\n\n' +
                                'ℹ️ *Causa*: la sesión se vinculó cuando el bot se marcaba en línea de inmediato, y WhatsApp no llegó a enviar esas claves.\n\n' +
                                '✅ *Solución* (ya viene corregida en esta versión):\n' +
                                '1. Detén el bot.\n' +
                                '2. Cierra la sesión vinculada desde tu teléfono (WhatsApp → Dispositivos vinculados).\n' +
                                '3. Vuelve a iniciar el bot y *re-vincula* (QR o código).\n\n' +
                                'Al re-vincular, el teléfono enviará las claves y .setnamebot funcionará.'
                            );
                        }
                    } else {
                        await m.reply('❌ ' + msg);
                    }
                }
                break;
            }

            case 'block': {
                if (!needOwner(m)) return;
                const t = resolveTarget(m, text);
                if (!t) return m.reply('Menciona o cita al usuario a bloquear.');
                try {
                    await conn.updateBlockStatus(t, 'block');
                    await m.reply(`🔒 Usuario bloqueado.`);
                } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
                break;
            }

            case 'unblock': {
                if (!needOwner(m)) return;
                const t = resolveTarget(m, text);
                if (!t) return m.reply('Menciona, cita o pasa el número.');
                try {
                    await conn.updateBlockStatus(t, 'unblock');
                    await m.reply(`🔓 Usuario desbloqueado.`);
                } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
                break;
            }

            case 'setppbot': {
                if (!needOwnerPrivate(m)) return;
                const target = m.quoted || m;
                const mime = target.msg?.mimetype || '';
                if (!mime.startsWith('image/')) return m.reply('Responde a una imagen con el comando.');
                try {
                    const buf = await target.download();
                    const botJid = conn.user?.jid || conn.decodeJid?.(conn.user?.id);
                    await conn.updateProfilePicture(botJid, buf);
                    await m.reply('✅ Foto del bot actualizada.');
                } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
                break;
            }

            case 'creargrupo': {
                if (!needOwner(m)) return;
                if (!text) return m.reply('Uso: .creargrupo <nombre del grupo>');
                try {
                    const ownerJid = global.owner?.[0]?.[0] + '@s.whatsapp.net';
                    const result = await conn.groupCreate(text, [ownerJid]);
                    await m.reply(`✅ Grupo creado.\n*ID:* ${result.gid || result.id}`);
                } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
                break;
            }

            // ═════════════════ CONFIG: per-chat toggles ═════════════════
            // 18 cases — uno por toggle, con su lógica explícita.
            // Cada uno: chequea admin → lee/escribe su flag → confirma.

            case 'antilink': {
                if (!needGroupAdmin(m)) return;
                const c = getChat(m.chat);
                const arg = (args[0] || '').toLowerCase();
                if (arg === 'on') c.antilink = true;
                else if (arg === 'off') c.antilink = false;
                else c.antilink = !c.antilink;
                db.markDirty();
                await m.reply(`${c.antilink ? '✅' : '❌'} Antilink *${c.antilink ? 'activado' : 'desactivado'}*`);
                break;
            }

            case 'antilinkyt': {
                if (!needGroupAdmin(m)) return;
                const c = getChat(m.chat);
                const arg = (args[0] || '').toLowerCase();
                if (arg === 'on') c.AntiYoutube = true;
                else if (arg === 'off') c.AntiYoutube = false;
                else c.AntiYoutube = !c.AntiYoutube;
                db.markDirty();
                await m.reply(`${c.AntiYoutube ? '✅' : '❌'} Anti YouTube *${c.AntiYoutube ? 'activado' : 'desactivado'}*`);
                break;
            }

            case 'antilinkig': {
                if (!needGroupAdmin(m)) return;
                const c = getChat(m.chat);
                const arg = (args[0] || '').toLowerCase();
                if (arg === 'on') c.AntInstagram = true;
                else if (arg === 'off') c.AntInstagram = false;
                else c.AntInstagram = !c.AntInstagram;
                db.markDirty();
                await m.reply(`${c.AntInstagram ? '✅' : '❌'} Anti Instagram *${c.AntInstagram ? 'activado' : 'desactivado'}*`);
                break;
            }

            case 'antilinkfb': {
                if (!needGroupAdmin(m)) return;
                const c = getChat(m.chat);
                const arg = (args[0] || '').toLowerCase();
                if (arg === 'on') c.AntiFacebook = true;
                else if (arg === 'off') c.AntiFacebook = false;
                else c.AntiFacebook = !c.AntiFacebook;
                db.markDirty();
                await m.reply(`${c.AntiFacebook ? '✅' : '❌'} Anti Facebook *${c.AntiFacebook ? 'activado' : 'desactivado'}*`);
                break;
            }

            case 'antilinktt': {
                if (!needGroupAdmin(m)) return;
                const c = getChat(m.chat);
                const arg = (args[0] || '').toLowerCase();
                if (arg === 'on') c.AntiTiktok = true;
                else if (arg === 'off') c.AntiTiktok = false;
                else c.AntiTiktok = !c.AntiTiktok;
                db.markDirty();
                await m.reply(`${c.AntiTiktok ? '✅' : '❌'} Anti TikTok *${c.AntiTiktok ? 'activado' : 'desactivado'}*`);
                break;
            }

            case 'antilinktw': {
                if (!needGroupAdmin(m)) return;
                const c = getChat(m.chat);
                const arg = (args[0] || '').toLowerCase();
                if (arg === 'on') c.AntiTwitter = true;
                else if (arg === 'off') c.AntiTwitter = false;
                else c.AntiTwitter = !c.AntiTwitter;
                db.markDirty();
                await m.reply(`${c.AntiTwitter ? '✅' : '❌'} Anti Twitter/X *${c.AntiTwitter ? 'activado' : 'desactivado'}*`);
                break;
            }

            case 'antilinktg': {
                if (!needGroupAdmin(m)) return;
                const c = getChat(m.chat);
                const arg = (args[0] || '').toLowerCase();
                if (arg === 'on') c.AntiTelegram = true;
                else if (arg === 'off') c.AntiTelegram = false;
                else c.AntiTelegram = !c.AntiTelegram;
                db.markDirty();
                await m.reply(`${c.AntiTelegram ? '✅' : '❌'} Anti Telegram *${c.AntiTelegram ? 'activado' : 'desactivado'}*`);
                break;
            }

            case 'antitoxic': {
                if (!needGroupAdmin(m)) return;
                const c = getChat(m.chat);
                const arg = (args[0] || '').toLowerCase();
                if (arg === 'on') c.antitoxic = true;
                else if (arg === 'off') c.antitoxic = false;
                else c.antitoxic = !c.antitoxic;
                db.markDirty();
                await m.reply(`${c.antitoxic ? '✅' : '❌'} Antitoxic *${c.antitoxic ? 'activado' : 'desactivado'}*`);
                break;
            }

            case 'antifake': {
                if (!needGroupAdmin(m)) return;
                const c = getChat(m.chat);
                const arg = (args[0] || '').toLowerCase();
                if (arg === 'on') c.antifake = true;
                else if (arg === 'off') c.antifake = false;
                else c.antifake = !c.antifake;
                db.markDirty();
                await m.reply(`${c.antifake ? '✅' : '❌'} Antifake *${c.antifake ? 'activado' : 'desactivado'}*`);
                break;
            }

            case 'antispam': {
                if (!needGroupAdmin(m)) return;
                const c = getChat(m.chat);
                const arg = (args[0] || '').toLowerCase();
                if (arg === 'on') c.antispam = true;
                else if (arg === 'off') c.antispam = false;
                else c.antispam = !c.antispam;
                db.markDirty();
                await m.reply(`${c.antispam ? '✅' : '❌'} Antispam *${c.antispam ? 'activado' : 'desactivado'}*`);
                break;
            }

            case 'welcome': {
                if (!needGroupAdmin(m)) return;
                const c = getChat(m.chat);
                const arg = (args[0] || '').toLowerCase();
                if (arg === 'on') c.welcome = true;
                else if (arg === 'off') c.welcome = false;
                else c.welcome = !c.welcome;
                db.markDirty();
                await m.reply(`${c.welcome ? '✅' : '❌'} Bienvenida *${c.welcome ? 'activado' : 'desactivado'}*`);
                break;
            }

            case 'modeadmin': {
                if (!needGroupAdmin(m)) return;
                const c = getChat(m.chat);
                const arg = (args[0] || '').toLowerCase();
                if (arg === 'on') c.modeadmin = true;
                else if (arg === 'off') c.modeadmin = false;
                else c.modeadmin = !c.modeadmin;
                db.markDirty();
                await m.reply(`${c.modeadmin ? '✅' : '❌'} Modo solo-admins *${c.modeadmin ? 'activado' : 'desactivado'}*`);
                break;
            }

            case 'autosticker': {
                if (!needGroupAdmin(m)) return;
                const c = getChat(m.chat);
                const arg = (args[0] || '').toLowerCase();
                if (arg === 'on') c.autosticker = true;
                else if (arg === 'off') c.autosticker = false;
                else c.autosticker = !c.autosticker;
                db.markDirty();
                await m.reply(`${c.autosticker ? '✅' : '❌'} Autosticker *${c.autosticker ? 'activado' : 'desactivado'}*`);
                break;
            }

            case 'bye': {
                if (!needGroupAdmin(m)) return;
                const c = getChat(m.chat);
                const arg = (args[0] || '').toLowerCase();
                if (arg === 'on') c.bye = true;
                else if (arg === 'off') c.bye = false;
                else c.bye = !c.bye;
                db.markDirty();
                await m.reply(`${c.bye ? '✅' : '❌'} Mensaje de despedida *${c.bye ? 'activado' : 'desactivado'}*`);
                break;
            }

            case 'detect': {
                if (!needGroupAdmin(m)) return;
                const c = getChat(m.chat);
                const arg = (args[0] || '').toLowerCase();
                if (arg === 'on') c.detect = true;
                else if (arg === 'off') c.detect = false;
                else c.detect = !c.detect;
                db.markDirty();
                await m.reply(`${c.detect ? '✅' : '❌'} Avisos promote/demote *${c.detect ? 'activado' : 'desactivado'}*`);
                break;
            }

            case 'antidelete': {
                if (!needGroupAdmin(m)) return;
                const c = getChat(m.chat);
                const arg = (args[0] || '').toLowerCase();
                if (arg === 'on') c.antidelete = true;
                else if (arg === 'off') c.antidelete = false;
                else c.antidelete = !c.antidelete;
                db.markDirty();
                await m.reply(`${c.antidelete ? '✅' : '❌'} Anti-delete *${c.antidelete ? 'activado' : 'desactivado'}*`);
                break;
            }

            case 'editlog': {
                if (!needGroupAdmin(m)) return;
                const c = getChat(m.chat);
                const arg = (args[0] || '').toLowerCase();
                if (arg === 'on') c.editlog = true;
                else if (arg === 'off') c.editlog = false;
                else c.editlog = !c.editlog;
                db.markDirty();
                await m.reply(`${c.editlog ? '✅' : '❌'} Edit-log *${c.editlog ? 'activado' : 'desactivado'}*`);
                break;
            }

            case 'notifychanges': {
                if (!needGroupAdmin(m)) return;
                const c = getChat(m.chat);
                const arg = (args[0] || '').toLowerCase();
                if (arg === 'on') c.notifyGroupChanges = true;
                else if (arg === 'off') c.notifyGroupChanges = false;
                else c.notifyGroupChanges = !c.notifyGroupChanges;
                db.markDirty();
                await m.reply(`${c.notifyGroupChanges ? '✅' : '❌'} Notificación de cambios *${c.notifyGroupChanges ? 'activado' : 'desactivado'}*`);
                break;
            }

            // ═════════════════ CONFIG: settings globales (owner) ═════════════════

            case 'antiprivado': {
                if (!needOwner(m)) return;
                const botJid = conn.user?.jid || conn.decodeJid?.(conn.user?.id);
                if (!botJid) return m.reply('No se pudo detectar el JID del bot.');
                const s = getSettings(botJid);
                const arg = (args[0] || '').toLowerCase();
                if (arg === 'on') s.antiprivado = true;
                else if (arg === 'off') s.antiprivado = false;
                else s.antiprivado = !s.antiprivado;
                db.markDirty();
                await m.reply(`${s.antiprivado ? '✅' : '❌'} Antiprivado *${s.antiprivado ? 'activado' : 'desactivado'}*`);
                break;
            }

            case 'antillamada': {
                if (!needOwner(m)) return;
                const botJid = conn.user?.jid || conn.decodeJid?.(conn.user?.id);
                if (!botJid) return m.reply('No se pudo detectar el JID del bot.');
                const s = getSettings(botJid);
                const arg = (args[0] || '').toLowerCase();
                if (arg === 'on') s.antillamada = true;
                else if (arg === 'off') s.antillamada = false;
                else s.antillamada = !s.antillamada;
                db.markDirty();
                await m.reply(`${s.antillamada ? '✅' : '❌'} Anti-llamada *${s.antillamada ? 'activado' : 'desactivado'}*`);
                break;
            }

            case 'bloquearllamada': {
                if (!needOwner(m)) return;
                const botJid = conn.user?.jid || conn.decodeJid?.(conn.user?.id);
                if (!botJid) return m.reply('No se pudo detectar el JID del bot.');
                const s = getSettings(botJid);
                const arg = (args[0] || '').toLowerCase();
                if (arg === 'on') s.bloquearLlamada = true;
                else if (arg === 'off') s.bloquearLlamada = false;
                else s.bloquearLlamada = !s.bloquearLlamada;
                db.markDirty();
                await m.reply(`${s.bloquearLlamada ? '✅' : '❌'} Bloquear-al-llamar *${s.bloquearLlamada ? 'activado' : 'desactivado'}*`);
                break;
            }

            case 'anuncios': {
                if (!needGroupAdmin(m)) return;
                const c = getChat(m.chat);
                const FLAGS = {
                    todo:        { key: 'allowAnnouncements', label: 'Todos los anuncios', tier: 'master' },
                    todos:       { key: 'allowAnnouncements', label: 'Todos los anuncios', tier: 'master' },
                    master:      { key: 'allowAnnouncements', label: 'Todos los anuncios', tier: 'master' },
                    all:         { key: 'allowAnnouncements', label: 'Todos los anuncios', tier: 'master' },
                    miembros:    { key: 'notifyMembers',      label: 'Anuncios de miembros', tier: 'category' },
                    members:     { key: 'notifyMembers',      label: 'Anuncios de miembros', tier: 'category' },
                    grupo:       { key: 'notifyGroupChanges', label: 'Cambios del grupo',    tier: 'category' },
                    cambios:     { key: 'notifyGroupChanges', label: 'Cambios del grupo',    tier: 'category' },
                    bienvenida:  { key: 'welcome',            label: 'Bienvenida',           tier: 'individual' },
                    welcome:     { key: 'welcome',            label: 'Bienvenida',           tier: 'individual' },
                    despedida:   { key: 'bye',                label: 'Despedida',            tier: 'individual' },
                    bye:         { key: 'bye',                label: 'Despedida',            tier: 'individual' },
                    admins:      { key: 'detect',             label: 'Promote/demote',       tier: 'individual' },
                    admin:       { key: 'detect',             label: 'Promote/demote',       tier: 'individual' },
                    detect:      { key: 'detect',             label: 'Promote/demote',       tier: 'individual' },
                    nombre:      { key: 'notifySubject',      label: 'Cambio de nombre',     tier: 'individual' },
                    subject:     { key: 'notifySubject',      label: 'Cambio de nombre',     tier: 'individual' },
                    descripcion: { key: 'notifyDesc',         label: 'Cambio de descripción', tier: 'individual' },
                    desc:        { key: 'notifyDesc',         label: 'Cambio de descripción', tier: 'individual' },
                    foto:        { key: 'notifyIcon',         label: 'Cambio de foto',       tier: 'individual' },
                    icon:        { key: 'notifyIcon',         label: 'Cambio de foto',       tier: 'individual' },
                    abrircerrar: { key: 'notifyAnnounce',     label: 'Abrir/cerrar grupo',   tier: 'individual' },
                    announce:    { key: 'notifyAnnounce',     label: 'Abrir/cerrar grupo',   tier: 'individual' },
                    cerrar:      { key: 'notifyAnnounce',     label: 'Abrir/cerrar grupo',   tier: 'individual' },
                    abrir:       { key: 'notifyAnnounce',     label: 'Abrir/cerrar grupo',   tier: 'individual' },
                    restriccion: { key: 'notifyRestrict',     label: 'Restricción de info',  tier: 'individual' },
                    restrict:    { key: 'notifyRestrict',     label: 'Restricción de info',  tier: 'individual' },
                };
                const sub = (args[0] || '').toLowerCase();
                if (!sub || sub === 'estado' || sub === 'status' || sub === 'ver' || sub === 'list') {
                    const yn = (key) => c[key] !== false ? '✅' : '❌';
                    return m.reply(
`*🌸 Estado de anuncios del grupo 🌸*

*◌ MASTER ◌*
• Todos los anuncios ${yn('allowAnnouncements')}

*◌ CATEGORÍAS ◌*
• Miembros ${yn('notifyMembers')}
• Cambios del grupo ${yn('notifyGroupChanges')}

*◌ MIEMBROS (individual) ◌*
• Bienvenida ${yn('welcome')}
• Despedida ${yn('bye')}
• Admins (promote/demote) ${yn('detect')}

*◌ CAMBIOS DEL GRUPO (individual) ◌*
• Nombre ${yn('notifySubject')}
• Descripción ${yn('notifyDesc')}
• Foto ${yn('notifyIcon')}
• Abrir/cerrar grupo ${yn('notifyAnnounce')}
• Restricción de info ${yn('notifyRestrict')}

━━━━━━━━━━━━━━━━━━

*Uso:*
\`.anuncios <opción> <on|off>\`

*Opciones:*
\`todo\` · \`miembros\` · \`grupo\`
\`bienvenida\` · \`despedida\` · \`admins\`
\`nombre\` · \`descripcion\` · \`foto\`
\`abrircerrar\` · \`restriccion\`

*Ejemplos:*
• \`.anuncios todo off\` — apaga TODOS los anuncios
• \`.anuncios miembros off\` — apaga welcome/bye/admins
• \`.anuncios grupo off\` — apaga cambios del grupo
• \`.anuncios bienvenida off\` — solo apaga la bienvenida
• \`.anuncios foto on\` — solo prende avisos de foto`
                    );
                }
                const flag = FLAGS[sub];
                if (!flag) return m.reply(`❌ Opción no válida: *${sub}*\n\nEscribe *.anuncios* para ver las opciones disponibles.`);
                const val = (args[1] || '').toLowerCase();
                let newValue;
                if (val === 'on' || val === 'activar' || val === '1' || val === 'true' || val === 'si') newValue = true;
                else if (val === 'off' || val === 'desactivar' || val === '0' || val === 'false' || val === 'no') newValue = false;
                else newValue = c[flag.key] === false;
                c[flag.key] = newValue;
                db.markDirty();
                let extra = '';
                if (flag.tier === 'master' && newValue === false) {
                    extra = '\n\n⚠️ *Ningún anuncio del bot se enviará en este grupo hasta que lo vuelvas a activar.*';
                } else if (flag.tier === 'category' && newValue === false) {
                    extra = `\n\n_Todos los anuncios de esta categoría quedan apagados._`;
                } else if (newValue === false && c.allowAnnouncements === false) {
                    extra = '\n\n⚠️ Recuerda que el *master* está apagado — ningún anuncio se envía hasta que actives \`.anuncios todo on\`.';
                }
                await m.reply(`${newValue ? '✅' : '❌'} *${flag.label}* ${newValue ? 'activado' : 'desactivado'}${extra}`);
                break;
            }

            // ═════════════════ GROUP ═════════════════

            case 'kick': {
                if (!needGroupAdmin(m) || !needBotAdmin(m)) return;
                let t = resolveTarget(m, text);
                if (!t) return m.reply('👉 Responde al mensaje del usuario o etiquétalo: .kick @usuario');
                // Resolver el target a la forma EXACTA del participante en la
                // metadata (en v7 el grupo puede operar en LID). Sin esto,
                // groupParticipantsUpdate puede fallar silenciosamente.
                let canon = t;
                try { const { canonicalGroupJid } = await import('./announcements.js'); canon = canonicalGroupJid(t, m.groupMetadata) || t; } catch { /* */ }
                // No expulsar a admins (comparación LID-aware contra el adminSet).
                const adminNums = new Set((m.groupAdmins || []).map(a => String(a).split('@')[0]));
                if (adminNums.has(String(canon).split('@')[0]) || adminNums.has(String(t).split('@')[0])) {
                    return m.reply('🛡️ No puedo expulsar a un administrador.');
                }
                // No expulsarse a sí mismo (el bot).
                const botNum = String(this?.user?.id || conn.user?.id || '').split('@')[0];
                if (String(canon).split('@')[0] === botNum) return m.reply('😅 No puedo expulsarme a mí mismo.');
                try {
                    const res = await conn.groupParticipantsUpdate(m.chat, [canon], 'remove');
                    const ok = Array.isArray(res) ? (res[0]?.status === '200' || res[0]?.status === 200) : true;
                    if (ok) {
                        // Invalida la metadata para que el siguiente comando vea la lista actualizada.
                        this?._invalidateGroup?.(m.chat);
                        await m.reply(`👋 @${String(canon).split('@')[0]} fue expulsado del grupo.`, null, { mentions: [canon] });
                    } else {
                        const code = res?.[0]?.status;
                        await m.reply(code === '404'
                            ? '⚠️ Ese usuario ya no está en el grupo.'
                            : `❌ No se pudo expulsar (código ${code || 'desconocido'}). Verifica que sea admin del grupo.`);
                    }
                } catch (e) { await m.reply('❌ Error al expulsar: ' + (e?.message || e)); }
                break;
            }

            case 'add': {
                if (!needGroupAdmin(m) || !needBotAdmin(m)) return;
                const num = (args[0] || '').replace(/[^0-9]/g, '');
                if (!num) return m.reply('Uso: .add <número con código de país>');
                const target = num + '@s.whatsapp.net';
                try {
                    const res = await conn.groupParticipantsUpdate(m.chat, [target], 'add');
                    const status = res?.[0]?.status;
                    if (status === '200') await m.reply(`✅ @${num} agregado.`, null, { mentions: [target] });
                    else await m.reply(`❌ No se pudo agregar (código ${status}).`);
                } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
                break;
            }

            case 'promote': {
                if (!needGroupAdmin(m) || !needBotAdmin(m)) return;
                const t = resolveTarget(m, text);
                if (!t) return m.reply('Menciona o cita al usuario.');
                try {
                    await conn.groupParticipantsUpdate(m.chat, [t], 'promote');
                    await m.reply(`⭐ @${t.split('@')[0]} ahora es admin.`, null, { mentions: [t] });
                } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
                break;
            }

            case 'demote': {
                if (!needGroupAdmin(m) || !needBotAdmin(m)) return;
                const t = resolveTarget(m, text);
                if (!t) return m.reply('Menciona o cita al usuario.');
                try {
                    await conn.groupParticipantsUpdate(m.chat, [t], 'demote');
                    await m.reply(`🍃 @${t.split('@')[0]} ya no es admin.`, null, { mentions: [t] });
                } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
                break;
            }

            case 'link': {
                if (!needGroupAdmin(m) || !needBotAdmin(m)) return;
                try {
                    const code = await conn.groupInviteCode(m.chat);
                    await m.reply(`🔗 *Link del grupo:*\nhttps://chat.whatsapp.com/${code}`);
                } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
                break;
            }

            case 'revoke': {
                if (!needGroupAdmin(m) || !needBotAdmin(m)) return;
                try {
                    await conn.groupRevokeInvite(m.chat);
                    await m.reply('🔄 Link revocado. El anterior ya no funciona.');
                } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
                break;
            }

            case 'hidetag': {
                if (!needGroupAdmin(m)) return;
                if (!m.participants) return m.reply('No pude leer los participantes.');
                const mentions = m.participants.map(p => p.id);
                await conn.sendMessage(m.chat, {
                    text: text || `📢 ${global.botname || 'KimdanBot-MD'}`,
                    mentions,
                });
                break;
            }

            case 'tagall': {
                if (!needGroupAdmin(m)) return;
                if (!m.participants) return m.reply('No pude leer los participantes.');
                const mentions = m.participants.map(p => p.id);
                const lines = mentions.map(j => `• @${j.split('@')[0]}`).join('\n');
                await conn.sendMessage(m.chat, {
                    text: `📢 *${text || 'Convocatoria general'}*\n\n${lines}`,
                    mentions,
                });
                break;
            }

            case 'del': {
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
                } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
                break;
            }

            case 'admins': {
                if (!needGroup(m)) return;
                if (!m.groupAdmins?.length) return m.reply('No hay admins detectados.');
                const list = m.groupAdmins.map(j => `• @${j.split('@')[0]}`).join('\n');
                await conn.sendMessage(m.chat, {
                    text: `⭐ *Administradores* ⭐\n\n${list}`,
                    mentions: m.groupAdmins,
                });
                break;
            }

            case 'infogrupo': {
                if (!needGroup(m)) return;
                const meta = m.groupMetadata;
                if (!meta) return m.reply('No pude leer la info del grupo.');
                const created = meta.creation ? moment(meta.creation * 1000).tz(global.place || 'UTC').format('DD/MM/YYYY HH:mm') : '-';
                await m.reply(
                    `🌸 *Info del grupo* 🌸\n\n` +
                    `*Nombre:* ${meta.subject}\n*Creado:* ${created}\n` +
                    `*Participantes:* ${meta.participants?.length || 0}\n` +
                    `*Admins:* ${m.groupAdmins?.length || 0}\n` +
                    `*Descripción:*\n${meta.desc?.toString() || '(sin descripción)'}`
                );
                break;
            }

            case 'setname': {
                if (!needGroupAdmin(m) || !needBotAdmin(m)) return;
                if (!text) return m.reply('Uso: .setname <nombre>');
                try { await conn.groupUpdateSubject(m.chat, text); await m.reply('✅ Nombre actualizado.'); }
                catch (e) { await m.reply('❌ ' + (e?.message || e)); }
                break;
            }

            case 'setdesc': {
                if (!needGroupAdmin(m) || !needBotAdmin(m)) return;
                if (!text) return m.reply('Uso: .setdesc <descripción>');
                try { await conn.groupUpdateDescription(m.chat, text); await m.reply('✅ Descripción actualizada.'); }
                catch (e) { await m.reply('❌ ' + (e?.message || e)); }
                break;
            }

            case 'unwarn': {
                if (!needGroupAdmin(m)) return;
                const t = resolveTarget(m, text);
                if (!t) return m.reply('Menciona o cita al usuario.');
                const u = getUser(t);
                u.warn = Math.max(0, (u.warn || 0) - 1);
                db.markDirty();
                await m.reply(`✅ @${t.split('@')[0]} ahora tiene ${u.warn} advertencias.`, null, { mentions: [t] });
                break;
            }

            case 'listwarn': {
                if (!needGroupAdmin(m)) return;
                const participants = m.participants?.map(p => p.id) || [];
                const warned = participants
                    .map(j => ({ jid: j, warn: db.data.users[j]?.warn || 0 }))
                    .filter(u => u.warn > 0);
                if (!warned.length) return m.reply('✨ Nadie tiene advertencias.');
                const list = warned.map(u => `• @${u.jid.split('@')[0]}: ${u.warn}`).join('\n');
                await conn.sendMessage(m.chat, {
                    text: `*⚠️ Advertencias*\n\n${list}`,
                    mentions: warned.map(u => u.jid),
                });
                break;
            }

            case 'grupo': {
                if (!needGroupAdmin(m) || !needBotAdmin(m)) return;
                let arg = (args[0] || '').toLowerCase();
                if (arg === 'open') arg = 'abrir';
                if (arg === 'close') arg = 'cerrar';
                if (arg !== 'abrir' && arg !== 'cerrar') {
                    return m.reply('Uso: .grupo abrir | cerrar  (también open/close)');
                }
                try {
                    await conn.groupSettingUpdate(m.chat, arg === 'abrir' ? 'not_announcement' : 'announcement');
                    await m.react?.(arg === 'abrir' ? '🌸' : '🔒');
                } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
                break;
            }

            case 'setppgrupo': {
                if (!needGroupAdmin(m) || !needBotAdmin(m)) return;
                const target = m.quoted || m;
                const mime = target.msg?.mimetype || '';
                if (!mime.startsWith('image/')) return m.reply('Responde a una imagen con el comando.');
                try {
                    const buf = await target.download();
                    await conn.updateProfilePicture(m.chat, buf);
                    try {
                        const { invalidateGroupPic } = await import('./announcements.js');
                        invalidateGroupPic(m.chat);
                    } catch { /* */ }
                    await m.reply('✅ Foto del grupo actualizada.');
                } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
                break;
            }

            case 'encuesta': {
                if (!text || !text.includes('|')) {
                    return m.reply('Uso: .encuesta <pregunta> | <opción 1> | <opción 2> | ...');
                }
                const parts = text.split('|').map(s => s.trim()).filter(Boolean);
                if (parts.length < 3) return m.reply('Necesitas al menos 1 pregunta y 2 opciones.');
                const [pregunta, ...opciones] = parts;
                if (opciones.length > 12) return m.reply('Máximo 12 opciones.');
                try {
                    await conn.sendMessage(m.chat, {
                        poll: { name: pregunta, values: opciones, selectableCount: 1 },
                    }, { quoted: m });
                } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
                break;
            }

            // ═════════════════ STICKER / MEDIA ═════════════════

            case 'attp': {
                if (!text) return m.reply('Uso: .attp <texto>');
                try {
                    const buf = await getBuffer(`https://api.popcat.xyz/attp?text=${encodeURIComponent(text)}`);
                    if (!buf) throw new Error('No se pudo generar.');
                    await conn.sendMessage(m.chat, { sticker: buf }, { quoted: m });
                } catch (e) { await m.reply('❌ Servicio attp no disponible: ' + (e?.message || e)); }
                break;
            }

            case 'toimg': {
                const target = m.quoted || m;
                const mime = target.msg?.mimetype || '';
                if (!mime.includes('webp')) return m.reply('Responde a un sticker (webp).');
                try {
                    const buf = await target.download();
                    await conn.sendMessage(m.chat, { image: buf, caption: '' }, { quoted: m });
                } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
                break;
            }

            case 'tomp3': {
                const target = m.quoted || m;
                const mime = target.msg?.mimetype || '';
                if (!/video|audio/.test(mime)) return m.reply('Responde a un video o audio.');
                try {
                    const buf = await target.download();
                    await conn.sendMessage(m.chat, {
                        audio: buf, mimetype: 'audio/mp4', ptt: false,
                    }, { quoted: m });
                } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
                break;
            }

            // ═════════════════ SEARCH ═════════════════

            case 'yts': {
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
                    await m.reply(`🍒 *Resultados:*\n\n${out}`);
                } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
                break;
            }

            case 'wiki': {
                if (!text) return m.reply('Uso: .wiki <tema>');
                try {
                    const url = `https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(text)}`;
                    const res = await axios.get(url, { timeout: 15000 });
                    const d = res.data;
                    const reply = `📚 *${d.title}*\n\n${d.extract || '(sin resumen)'}\n\n🔗 ${d.content_urls?.desktop?.page || ''}`;
                    await m.reply(truncate(reply));
                } catch (e) { await m.reply('❌ No encontrado.'); }
                break;
            }

            // ═════════════════ TOOLS ═════════════════

            case 'traducir': {
                if (!text) return m.reply('Uso: .traducir <texto>');
                try {
                    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=es&dt=t&q=${encodeURIComponent(text)}`;
                    const res = await axios.get(url, { timeout: 15000 });
                    const translated = res.data?.[0]?.map(s => s[0]).join('') || '';
                    await m.reply(`🌐 ${translated || '(sin traducción)'}`);
                } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
                break;
            }

            case 'tts': {
                if (!text) return m.reply('Uso: .tts <texto>');
                try {
                    const buf = await getBuffer(
                        `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=es&client=tw-ob`,
                        { headers: { 'User-Agent': 'Mozilla/5.0' } }
                    );
                    if (!buf) throw new Error('No se pudo generar audio.');
                    await conn.sendMessage(m.chat, { audio: buf, mimetype: 'audio/mp4', ptt: true }, { quoted: m });
                } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
                break;
            }

            case 'acortar': {
                if (!text || !isUrl(text)) return m.reply('Uso: .acortar <URL>');
                try {
                    const res = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(text)}`, { timeout: 10000 });
                    await m.reply(`🔗 ${res.data}`);
                } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
                break;
            }

            case 'ssweb': {
                if (!text || !isUrl(text)) return m.reply('Uso: .ssweb <URL>');
                try {
                    const buf = await getBuffer(`https://api.popcat.xyz/screenshot?url=${encodeURIComponent(text)}`);
                    if (!buf) throw new Error('Servicio no disponible.');
                    await conn.sendMessage(m.chat, { image: buf, caption: text }, { quoted: m });
                } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
                break;
            }

            case 'clima': {
                if (!text) return m.reply('Uso: .clima <ciudad>');
                try {
                    const url = `https://wttr.in/${encodeURIComponent(text)}?format=j1&lang=es`;
                    const res = await axios.get(url, { timeout: 15000 });
                    const cur = res.data?.current_condition?.[0];
                    if (!cur) throw new Error('Sin datos');
                    await m.reply(
                        `🌤️ *Clima en ${text}*\n\n` +
                        `• Temperatura: ${cur.temp_C}°C (sensación ${cur.FeelsLikeC}°C)\n` +
                        `• Estado: ${cur.lang_es?.[0]?.value || cur.weatherDesc?.[0]?.value || '?'}\n` +
                        `• Humedad: ${cur.humidity}%\n` +
                        `• Viento: ${cur.windspeedKmph} km/h`
                    );
                } catch (e) { await m.reply('❌ No se pudo obtener el clima.'); }
                break;
            }

            case 'check': {
                const num = String(text || '').replace(/[^0-9]/g, '');
                if (!num || num.length < 8) return m.reply('Uso: .check <número>');
                try {
                    const jid = num + '@s.whatsapp.net';
                    const [result] = await conn.onWhatsApp(jid);
                    if (result?.exists) await m.reply(`✅ *+${num}* está en WhatsApp.\n*JID:* ${result.jid}`);
                    else await m.reply(`❌ *+${num}* no está en WhatsApp.`);
                } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
                break;
            }

            case 'bio': {
                const t = m.mentionedJid?.[0] || m.quoted?.sender
                    || (text ? text.replace(/[^0-9]/g, '') + '@s.whatsapp.net' : m.sender);
                try {
                    const status = await conn.fetchStatus(t);
                    const bioText = Array.isArray(status) ? status[0]?.status : (status?.status?.toString?.() || JSON.stringify(status));
                    const setAt = Array.isArray(status) ? status[0]?.setAt : status?.setAt;
                    await m.reply(
                        `🍓 *Biografía de @${t.split('@')[0]}*\n\n` +
                        `${bioText || '(vacía)'}\n\n` +
                        (setAt ? `*Establecida:* ${new Date(setAt).toLocaleString()}` : '')
                    , null, { mentions: [t] });
                } catch (e) { await m.reply('❌ No se pudo leer la bio: ' + (e?.message || e)); }
                break;
            }

            case 'fotoperfil': {
                const t = m.mentionedJid?.[0] || m.quoted?.sender
                    || (text ? text.replace(/[^0-9]/g, '') + '@s.whatsapp.net' : m.sender);
                try {
                    const url = await conn.profilePictureUrl(t, 'image');
                    const buf = await getBuffer(url);
                    await conn.sendMessage(m.chat, {
                        image: buf,
                        caption: `🌸 Foto de perfil de @${t.split('@')[0]}`,
                        mentions: [t],
                    }, { quoted: m });
                } catch { await m.reply('❌ No tiene foto de perfil o es privada.'); }
                break;
            }

            case 'business': {
                const t = m.mentionedJid?.[0] || m.quoted?.sender
                    || (text ? text.replace(/[^0-9]/g, '') + '@s.whatsapp.net' : m.sender);
                try {
                    const p = await conn.getBusinessProfile(t);
                    if (!p) return m.reply('❌ No es cuenta business.');
                    await m.reply(
                        `🌸 *Perfil business de @${t.split('@')[0]}*\n\n` +
                        `*Categoría:* ${p.category || '-'}\n` +
                        `*Descripción:* ${p.description || '-'}\n` +
                        `*Email:* ${p.email || '-'}\n` +
                        `*Website:* ${p.website?.join(', ') || '-'}\n` +
                        `*Dirección:* ${p.address || '-'}`
                    , null, { mentions: [t] });
                } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
                break;
            }

            // ═════════════════ DOWNLOAD ═════════════════
            // Scrapers externos que pueden caer; degradan a link YouTube.

            case 'play': {
                if (!text) return m.reply('Uso: .play <canción o link>');
                try {
                    let yts;
                    try { ({ default: yts } = await import('yt-search')); }
                    catch { return m.reply('⚠️ Falta yt-search: npm i yt-search'); }
                    const r = await yts(text);
                    const video = r.videos?.[0];
                    if (!video) return m.reply('Sin resultados.');
                    try {
                        await m.react?.('🎵').catch(() => {});
                        // Cadena de proveedores (helpers.ytAudioUrl): si uno cae,
                        // se prueba el siguiente automáticamente.
                        const { ytAudioUrl } = await import('./helpers.js');
                        const audioUrl = await ytAudioUrl(video.url);
                        if (!audioUrl) throw new Error('Ningún proveedor respondió');
                        const buf = await getBuffer(audioUrl, { timeout: 120000 });
                        if (!buf) throw new Error('Descarga vacía');
                        await conn.sendMessage(m.chat, {
                            audio: buf, mimetype: 'audio/mpeg',
                            fileName: `${video.title}.mp3`,
                        }, { quoted: m });
                    } catch {
                        await m.reply(`🎵 *${video.title}*\n_${video.author?.name}_ — ${video.timestamp}\n${video.url}\n\n🥺 No pude descargar el audio ahora mismo. Usa el link mientras tanto 💜`);
                    }
                } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
                break;
            }

            case 'ytmp4': {
                if (!text) return m.reply('Uso: .ytmp4 <canción o link>');
                try {
                    let yts;
                    try { ({ default: yts } = await import('yt-search')); }
                    catch { return m.reply('⚠️ Falta yt-search: npm i yt-search'); }
                    const r = await yts(text);
                    const video = r.videos?.[0];
                    if (!video) return m.reply('Sin resultados.');
                    if ((video.seconds || 0) > 1200) return m.reply(`🎬 *${video.title}* dura ${video.timestamp} — demasiado largo para enviar por WhatsApp.\n${video.url}`);
                    await m.react?.('🎬').catch(() => {});
                    try {
                        const { ytVideoUrl } = await import('./helpers.js');
                        const dl = await ytVideoUrl(video.url);
                        if (!dl) throw new Error('Ningún proveedor respondió');
                        const buf = await getBuffer(dl, { timeout: 180000 });
                        if (!buf) throw new Error('Descarga vacía');
                        await conn.sendMessage(m.chat, {
                            video: buf, mimetype: 'video/mp4',
                            caption: `🎬 *${video.title}*\n🫐 ${video.author?.name || ''} — ${video.timestamp}`,
                        }, { quoted: m });
                    } catch {
                        await m.reply(`🎬 *${video.title}*\n_${video.author?.name}_ — ${video.timestamp}\n${video.url}\n\n🥺 No pude descargar el video ahora mismo. Usa el link mientras tanto 💜`);
                    }
                } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
                break;
            }

            case 'tiktok': {
                if (!text || !isUrl(text)) return m.reply('Uso: .tiktok <link>');
                try {
                    const { tiktokVideo } = await import('./providers.js');
                    const r = await tiktokVideo(text.trim());
                    if (!r?.url) throw new Error('sin url');
                    const buf = await getBuffer(r.url, { timeout: 120000 });
                    if (!buf) throw new Error('descarga vacía');
                    await conn.sendMessage(m.chat, {
                        video: buf, mimetype: 'video/mp4',
                        caption: `🎀 ${r.title || 'TikTok'}`,
                    }, { quoted: m });
                } catch (e) { await m.reply('🥺 No pude descargar ese TikTok ahora. Si es un carrusel de fotos, prueba *.ttimg <link>* 💜'); }
                break;
            }

            // ═════════════════ RPG ═════════════════

            case 'reg': {
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
                await m.reply(`✅ Registrado/a como *${name}* (${age} años).`);
                break;
            }

            case 'unreg': {
                const u = getUser(m.sender);
                u.registered = false;
                u.regTime = -1;
                db.markDirty();
                await m.reply('🍃 Registro cancelado.');
                break;
            }

            case 'perfil': {
                const u = getUser(m.sender);
                await m.reply(
                    `🌸 *Tu perfil* 🌸\n\n` +
                    `• Nombre: ${u.name || '(sin registrar)'}\n` +
                    `• Edad: ${u.age || '?'}\n` +
                    `• Nivel: ${u.level || 0}\n` +
                    `• EXP: ${u.exp || 0}\n` +
                    `• Rol: ${u.role || 'Novato'}\n` +
                    `• 💎 Heart Gems: ${u.corazones || 0}\n` +
                    `• 💜 Jinx Coins: ${u.money || 0}\n` +
                    `• 🤝 Affinity: ${u.affinity || 0}`
                );
                break;
            }

            case 'bal': {
                const u = getUser(m.sender);
                await m.reply(`💜 Jinx Coins: *${u.money || 0}*\n💎 Heart Gems: *${u.corazones || 0}*\n🤝 Affinity: *${u.affinity || 0}*\n⭐ Nivel: *${u.level || 0}*`);
                break;
            }

            case 'claim': {
                if (cooldown(m, 'lastclaim', 24 * 60 * 60 * 1000)) return;
                const u = getUser(m.sender);
                const reward = Math.floor(Math.random() * 500) + 100;
                u.money = (u.money || 0) + reward;
                u.lastclaim = Date.now();
                db.markDirty();
                await m.reply(`💜 +${reward} Jinx Coins. Vuelve en 24h.`);
                break;
            }

            case 'work': {
                if (cooldown(m, 'lastwork', 10 * 60 * 1000)) return;
                const u = getUser(m.sender);
                const reward = Math.floor(Math.random() * 100) + 20;
                u.money = (u.money || 0) + reward;
                u.exp = (u.exp || 0) + 5;
                u.lastwork = Date.now();
                db.markDirty();
                const jobs = ['programador', 'diseñador', 'taxista', 'cocinero', 'cantante', 'profesor'];
                const job = jobs[Math.floor(Math.random() * jobs.length)];
                await m.reply(`💼 Trabajaste como *${job}* y ganaste *${reward}* 💜 JX (+5 exp).`);
                break;
            }

            case 'mine': {
                if (cooldown(m, 'lastmine', 15 * 60 * 1000)) return;
                const u = getUser(m.sender);
                const mult = vipMult(u, m);
                const jx = (Math.floor(Math.random() * 400) + 100) * mult;   // 100–500 JX (x2 VIP)
                u.money = (u.money || 0) + jx;
                let gem = Math.random() < 0.08 ? 1 : 0;                       // rara veta de HG
                gem *= mult;                                                  // VIP duplica también la veta
                u.corazones = (u.corazones || 0) + gem;
                u.diamond = (u.diamond || 0) + gem;
                u.exp = (u.exp || 0) + 8 * mult;
                u.lastmine = Date.now();
                db.markDirty();
                await m.reply(`⛏ Minaste y extrajiste ${fmtMoney(jx)}${gem ? ` y ${fmtPremium(gem)} 💎 (¡veta rara!)` : ''} (+${8 * mult} exp).${mult > 1 ? ' 👑 _Bono VIP x2_' : ''}`);
                break;
            }

            case 'top': {
                const all = Object.entries(db.data.users)
                    .map(([jid, u]) => ({ jid, money: u.money || 0, level: u.level || 0 }))
                    .sort((a, b) => b.money - a.money)
                    .slice(0, 10);
                if (!all.length) return m.reply('Sin datos.');
                const list = all.map((u, i) =>
                    `*${i + 1}.* @${u.jid.split('@')[0]} — ${fmtMoney(u.money)} (nivel ${u.level})`
                ).join('\n');
                await conn.sendMessage(m.chat, {
                    text: `🏆 *Top 10 — Jinx Coins*\n\n${list}`,
                    mentions: all.map(u => u.jid),
                });
                break;
            }

            case 'rob': {
                if (cooldown(m, 'lastrob', 30 * 60 * 1000)) return;
                const t = resolveTarget(m, text);
                if (!t || t === m.sender) return m.reply('Menciona o cita a la víctima.');
                const me = getUser(m.sender);
                const tgt = getUser(t);
                if ((tgt.money || 0) < 100) return m.reply('Esa persona no tiene suficientes Jinx Coins.');
                const success = Math.random() > 0.5;
                me.lastrob = Date.now();
                if (success) {
                    const amount = Math.floor((tgt.money || 0) * (Math.random() * 0.3 + 0.1));
                    tgt.money -= amount;
                    me.money = (me.money || 0) + amount;
                    db.markDirty();
                    await m.reply(`🦹 Le robaste ${fmtMoney(amount)} a @${t.split('@')[0]}.`, null, { mentions: [t] });
                } else {
                    const fine = Math.floor((me.money || 0) * 0.1);
                    me.money = Math.max(0, (me.money || 0) - fine);
                    db.markDirty();
                    await m.reply(`🚓 Te atraparon y pagaste ${fmtMoney(fine)} de multa.`);
                }
                break;
            }

            // ═════════════════ GAME ═════════════════

            case 'ppt': {
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
                await m.reply(`Tú: ${emo[tuyo]} ${tuyo}\nYo: ${emo[bot]} ${bot}\n\n${result}`);
                break;
            }

            case 'slot': {
                const bet = parseInt(args[0]);
                if (!bet || bet < 10) return m.reply('Uso: .slot <apuesta> (mínimo 10 JX)');
                const u = getUser(m.sender);
                if ((u.money || 0) < bet) return m.reply('No tienes suficientes Jinx Coins.');
                const emojis = ['🍒', '🍓', '🍇', '🍉', '🍫', '💎'];
                const r1 = emojis[Math.floor(Math.random() * emojis.length)];
                const r2 = emojis[Math.floor(Math.random() * emojis.length)];
                const r3 = emojis[Math.floor(Math.random() * emojis.length)];
                let multi = 0;
                if (r1 === r2 && r2 === r3) multi = r1 === '💎' ? 10 : 5;
                else if (r1 === r2 || r2 === r3 || r1 === r3) multi = 2;
                u.money = (u.money || 0) + (multi > 0 ? bet * multi : -bet);
                db.markDirty();
                const msg = `🎰  ${r1} | ${r2} | ${r3}\n\n` +
                    (multi > 0 ? `🎉 ¡Ganaste ${fmtMoney(bet * multi)}!` : `💔 Perdiste ${fmtMoney(bet)}.`);
                await m.reply(msg);
                break;
            }

            case 'reto': {
                const retos = [
                    'Manda un audio cantando tu canción favorita 🎤',
                    'Cuenta tu peor anécdota en 3 oraciones 😅',
                    'Imita a un animal en mensaje de voz 🐱',
                    'Manda un selfie con cara graciosa 🤪',
                    'Escribe sin usar la letra "e" durante 5 mensajes',
                ];
                await m.reply(`🎯 *Reto:* ${retos[Math.floor(Math.random() * retos.length)]}`);
                break;
            }

            case 'verdad': {
                const verdades = [
                    '¿Cuál es tu mayor miedo?',
                    '¿Has mentido a tu mejor amig@? ¿En qué?',
                    '¿Qué harías si fueras invisible por un día?',
                    '¿Cuál fue tu vergüenza más grande?',
                    '¿Quién te gusta en este grupo?',
                ];
                await m.reply(`💎 *Verdad:* ${verdades[Math.floor(Math.random() * verdades.length)]}`);
                break;
            }

            // ═════════════════ FUN ═════════════════

            case 'dado': {
                const n = Math.floor(Math.random() * 6) + 1;
                await m.reply(`🎲 Sacaste un *${n}*`);
                break;
            }

            case 'gay': {
                const tgt = m.mentionedJid?.[0]
                    ? `@${m.mentionedJid[0].split('@')[0]}`
                    : (text || m.pushName || 'tú');
                const pct = Math.floor(Math.random() * 101);
                await conn.sendMessage(m.chat, {
                    text: `🌈 ${tgt} es ${pct}% gay 🌈`,
                    mentions: m.mentionedJid || [],
                }, { quoted: m });
                break;
            }

            case 'toxic': {
                const tgt = m.mentionedJid?.[0]
                    ? `@${m.mentionedJid[0].split('@')[0]}`
                    : (text || m.pushName || 'tú');
                const pct = Math.floor(Math.random() * 101);
                await conn.sendMessage(m.chat, {
                    text: `☠️ ${tgt} es ${pct}% tóxico ☠️`,
                    mentions: m.mentionedJid || [],
                }, { quoted: m });
                break;
            }

            case 'fake': {
                const tgt = m.mentionedJid?.[0]
                    ? `@${m.mentionedJid[0].split('@')[0]}`
                    : (text || m.pushName || 'tú');
                const pct = Math.floor(Math.random() * 101);
                await conn.sendMessage(m.chat, {
                    text: `🎭 ${tgt} es ${pct}% fake 🎭`,
                    mentions: m.mentionedJid || [],
                }, { quoted: m });
                break;
            }

            case 'racista': {
                const tgt = m.mentionedJid?.[0]
                    ? `@${m.mentionedJid[0].split('@')[0]}`
                    : (text || m.pushName || 'tú');
                const pct = Math.floor(Math.random() * 101);
                await conn.sendMessage(m.chat, {
                    text: `🙄 ${tgt} es ${pct}% racista 🙄`,
                    mentions: m.mentionedJid || [],
                }, { quoted: m });
                break;
            }

            case 'love': {
                if ((m.mentionedJid?.length || 0) < 2) return m.reply('Menciona a 2 personas. Ej: .love @a @b');
                const [a, b] = m.mentionedJid;
                const pct = Math.floor(Math.random() * 101);
                let bar = '';
                const blocks = Math.round(pct / 10);
                for (let i = 0; i < 10; i++) bar += i < blocks ? '💖' : '🤍';
                await conn.sendMessage(m.chat, {
                    text: `💘 *Compatibilidad amorosa* 💘\n\n@${a.split('@')[0]} ❤️ @${b.split('@')[0]}\n\n${bar}\n*${pct}%*`,
                    mentions: [a, b],
                }, { quoted: m });
                break;
            }

            case 'emparejar': {
                if (!m.isGroup) return m.reply('Solo en grupos.');
                const participants = m.participants?.map(p => p.id).filter(id => id !== m.sender) || [];
                if (!participants.length) return m.reply('No hay candidatos.');
                const pick = participants[Math.floor(Math.random() * participants.length)];
                await conn.sendMessage(m.chat, {
                    text: `💘 ${m.pushName || 'Tú'} ♥️ @${pick.split('@')[0]}`,
                    mentions: [pick],
                }, { quoted: m });
                break;
            }

            case 'piropo': {
                const piropos = [
                    'Si tu fueras Google, yo te buscaría todos los días 🌹',
                    'Si la belleza fuera tiempo, serías la eternidad ✨',
                    'Tu nombre debería estar en mi diario, junto a "todos los días" 📖',
                    'Eres como mi sándwich favorito: imposible no antojarme 🥪',
                    '¿Crees en el amor a primera vista o paso de nuevo? 😏',
                ];
                await m.reply(`💐 ${piropos[Math.floor(Math.random() * piropos.length)]}`);
                break;
            }

            // ═════════════════ MISC ═════════════════

            case 'afk': {
                const u = getUser(m.sender);
                u.afkTime = Date.now();
                u.afkReason = text || 'sin razón';
                db.markDirty();
                await m.reply(`💤 *Modo AFK activado*\n*Razón:* ${u.afkReason}`);
                break;
            }

            case 'report': {
                if (!text) return m.reply('Uso: .report <descripción del problema>');
                const ownerJid = global.owner?.[0]?.[0] + '@s.whatsapp.net';
                try {
                    await conn.sendMessage(ownerJid, {
                        text: `🐞 *Reporte de bug*\n\n*De:* @${m.sender.split('@')[0]}\n*Chat:* ${m.isGroup ? m.groupName : 'privado'}\n*Mensaje:*\n${text}`,
                        mentions: [m.sender],
                    });
                    await m.reply('✅ Reporte enviado al equipo. ¡Gracias!');
                } catch (e) { await m.reply('❌ No se pudo enviar el reporte.'); }
                break;
            }

            case 'idioma': {
                const lang = (args[0] || '').toLowerCase();
                const scope = (args[1] || 'user').toLowerCase(); // user|group|global
                const SUPPORTED = ['es','en','pt','fr','de','it','ja','ko','zh'];
                if (!SUPPORTED.includes(lang)) return m.reply(`Uso: .idioma <${SUPPORTED.join('|')}> [user|group|global]`);
                if (scope === 'global') {
                    if (!m.isOwner) return m.reply('⚠️ Solo el owner cambia el idioma global.');
                    const { setGlobalLang } = await import('./idiomas/translate.js');
                    setGlobalLang(lang); await m.reply(`🌐 Idioma global: ${lang}`);
                } else if (scope === 'group') {
                    if (!m.isGroup) return m.reply('Solo en grupos.');
                    if (!m.isSenderAdmin && !m.isOwner) return m.reply('⚠️ Solo admins.');
                    getChat(m.chat).lang = lang; db.markDirty(); await m.reply(`👥 Idioma del grupo: ${lang}`);
                } else {
                    const u = getUser(m.sender); u.lang = lang; u.Language = (lang === 'en' ? 'en' : 'es'); db.markDirty();
                    await m.reply(`✅ Tu idioma: ${lang}`);
                }
                break;
            }

            default: {
                // Comando en COMMAND_META pero sin case implementado.
                // No debería pasar nunca; si pasa, lo logueamos.
                console.warn('[commands] case sin implementar:', cmd);
                break;
            }

            // (sin más cases)
        }
    } catch (err) {
        console.error('[commands.execute]', cmd, err?.message || err);
        try { await m.reply('❌ ' + (err?.message || 'Error desconocido')); } catch { /* */ }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// REGISTRO EN EL REGISTRY
// ═══════════════════════════════════════════════════════════════════════
// Para mantener compatibilidad con handler.js sin tocarlo: cada entrada
// de COMMAND_META se registra en el registry con su metadata + un wrapper
// que llama execute(). El handler sigue usando this.cmdMap.get(cmd).

for (const meta of COMMAND_META) {
    const canonical = meta.names[0];
    const aliases = meta.names.slice(1);
    command(
        { name: canonical, aliases, category: meta.category, description: meta.description },
        (conn, m, args, text) => execute(conn, m, canonical, args, text)
    );
}

// ─── Owner shortcuts ─────────────────────────────────────────────────
// handler.js importa estos por nombre para los atajos `>`, `=>`, `$`.
export const evalSync  = (conn, m, args, text) => execute(conn, m, 'eval',  args, text);
export const evalAsync = (conn, m, args, text) => execute(conn, m, 'evala', args, text);
export const shell     = (conn, m, args, text) => execute(conn, m, 'shell', args, text);

// Exporta COMMAND_META por si algún otro módulo lo quiere usar.
export { COMMAND_META, ALIAS_MAP };
