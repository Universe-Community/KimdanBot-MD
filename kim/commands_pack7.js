// kim/commands_pack7.js — Comandos de OWNER para economía y rango VIP.
// Permite al owner: otorgar/quitar VIP (permanente o temporal), y
// dar/quitar/fijar dinero (JX), EXP y diamantes (HG) a cualquier usuario.
// Arquitectura nativa: COMMAND_META + switch/case.

import { command } from './registry.js';
import { getUser, db } from './db.js';
import { box } from './ui.js';
import { fmtMoney, fmtPremium, isVip, VIP } from './theme.js';

const needOwner = (m) => { if (!m.isOwner) { m.reply('⚠️ Solo el propietario puede usar este comando.'); return false; } return true; };

// Resuelve objetivo por mención, cita o número suelto.
function target(m, text) {
    if (m.mentionedJid?.[0]) return m.mentionedJid[0];
    if (m.quoted?.sender) return m.quoted.sender;
    const n = String(text || '').replace(/[^0-9]/g, '');
    if (n.length >= 8) return n + '@s.whatsapp.net';
    return null;
}
// Extrae la primera cantidad numérica del texto/args.
function amountOf(args, text) {
    const fromArgs = (args || []).map(a => parseInt(a)).find(x => Number.isFinite(x));
    if (Number.isFinite(fromArgs)) return fromArgs;
    const mt = String(text || '').match(/-?\d+/);
    return mt ? parseInt(mt[0]) : NaN;
}
// Duración VIP opcional: 7d, 12h, 30m → ms (0 = permanente).
function parseDuration(text) {
    const mt = String(text || '').match(/(\d+)\s*(d|h|m)/i);
    if (!mt) return 0;
    const n = parseInt(mt[1]); const unit = mt[2].toLowerCase();
    return n * (unit === 'd' ? 86400000 : unit === 'h' ? 3600000 : 60000);
}
const fmtUntil = (ms) => ms ? new Date(ms).toLocaleString('es') : 'permanente';

const COMMAND_META = [
    // —— Rango VIP ——
    { names: ['setvip', 'addvip', 'darvip'], category: 'owner', description: 'Otorga rango VIP a un usuario (owner). Opcional: duración 7d/12h' },
    { names: ['delvip', 'removevip', 'quitarvip'], category: 'owner', description: 'Quita el rango VIP (owner)' },
    { names: ['vipinfo', 'vipstatus'], category: 'owner', description: 'Muestra el estado VIP de un usuario' },
    { names: ['viplist', 'vips'], category: 'owner', description: 'Lista los usuarios VIP (owner)' },
    // —— Dar/quitar/fijar dinero (JX) ——
    { names: ['addmoney', 'darmoney', 'addcoins'], category: 'owner', description: 'Da Jinx Coins a un usuario (owner)' },
    { names: ['delmoney', 'quitarmoney', 'removecoins'], category: 'owner', description: 'Quita Jinx Coins a un usuario (owner)' },
    { names: ['setmoney', 'fijarmoney'], category: 'owner', description: 'Fija los Jinx Coins de un usuario (owner)' },
    // —— Dar/quitar EXP ——
    { names: ['addexp', 'darexp'], category: 'owner', description: 'Da EXP a un usuario (owner)' },
    { names: ['delexp', 'quitarexp'], category: 'owner', description: 'Quita EXP a un usuario (owner)' },
    // —— Dar/quitar diamantes (HG) ——
    { names: ['adddiamond', 'dardiamante', 'adddiamante', 'addhg'], category: 'owner', description: 'Da diamantes (HG) a un usuario (owner)' },
    { names: ['deldiamond', 'quitardiamante', 'delhg'], category: 'owner', description: 'Quita diamantes (HG) a un usuario (owner)' },
    // —— Panel de grupos ——
    { names: ['grupos', 'groups'], category: 'owner', description: 'Lista todos los grupos del bot con stats y enlaces (owner, paginado)' },
    { names: ['salirgrupo', 'leavegroup', 'salir'], category: 'owner', description: 'El bot abandona un grupo por ID o nombre (owner)' },
];

export async function execute(conn, m, cmd, args, text) {
    if (!needOwner(m)) return;
    const t = target(m, text);

    switch (cmd) {

    // ═══════════ RANGO VIP ═══════════
    case 'setvip': {
        if (!t) return m.reply('Uso: .setvip @usuario [duración: 7d/12h/30m]\n(sin duración = permanente)');
        const u = getUser(t);
        const dur = parseDuration(text);
        u.vip = true; u.premium = true; u.vipSince = Date.now();
        u.vipUntil = dur ? Date.now() + dur : 0;
        db.markDirty();
        await conn.sendMessage(m.chat, { text: box('👑 VIP OTORGADO', [
            `Usuario: @${t.split('@')[0]}`,
            `Estado: VIP activo`,
            `Expira: ${fmtUntil(u.vipUntil)}`,
            `Beneficio: x${VIP.mult} en 💼 trabajar y ⛏ minar`,
        ]), mentions: [t] }, { quoted: m });
        break;
    }
    case 'delvip': {
        if (!t) return m.reply('Uso: .delvip @usuario');
        const u = getUser(t);
        if (!u.vip) return m.reply('Ese usuario no es VIP.');
        u.vip = false; u.premium = false; u.vipUntil = 0; db.markDirty();
        await conn.sendMessage(m.chat, { text: `🚫 Rango VIP retirado a @${t.split('@')[0]}.`, mentions: [t] }, { quoted: m });
        break;
    }
    case 'vipinfo': {
        const who = t || m.sender; const u = getUser(who);
        const num = who.split('@')[0];
        const staticVip = (Array.isArray(global.vip) ? global.vip : [])
            .some(o => (Array.isArray(o) ? o[0] : String(o).split('@')[0]) === num);
        const active = staticVip || isVip(u);
        await conn.sendMessage(m.chat, { text: box('👑 ESTADO VIP', [
            `Usuario: @${num}`,
            `VIP: ${active ? 'sí ✅' : 'no'}`,
            staticVip ? 'Origen: lista fija (settings.js)' : (isVip(u) ? 'Origen: otorgado con .setvip' : '—'),
            (isVip(u) && !staticVip) ? `Expira: ${fmtUntil(u.vipUntil)}` : '—',
        ]), mentions: [who] }, { quoted: m });
        break;
    }
    case 'viplist': {
        const lines = [];
        // 1) VIP estáticos de settings.js (global.vip)
        const staticVips = (Array.isArray(global.vip) ? global.vip : [])
            .map(o => Array.isArray(o) ? o[0] : (typeof o === 'string' ? o.split('@')[0] : null))
            .filter(Boolean);
        const ment = [];
        for (const num of staticVips) {
            const jid = num + '@s.whatsapp.net';
            lines.push(`• @${num} — fijo (settings.js)`); ment.push(jid);
        }
        // 2) VIP otorgados por .setvip (flag en la DB), sin duplicar
        for (const [jid, u] of Object.entries(db.data.users || {})) {
            if (!isVip(u)) continue;
            const num = jid.split('@')[0];
            if (staticVips.includes(num)) continue;
            lines.push(`• @${num} — ${u.vipUntil ? 'hasta ' + fmtUntil(u.vipUntil) : 'permanente'}`); ment.push(jid);
        }
        if (!lines.length) return m.reply('No hay usuarios VIP actualmente.');
        await conn.sendMessage(m.chat, { text: box(`👑 USUARIOS VIP · ${lines.length}`, lines), mentions: ment }, { quoted: m });
        break;
    }

    // ═══════════ DINERO (JX) ═══════════
    case 'addmoney': case 'delmoney': case 'setmoney': {
        if (!t) return m.reply(`Uso: .${cmd} @usuario <cantidad>`);
        const amt = amountOf(args, text.replace(/@?\d{6,}/g, ''));
        if (!Number.isFinite(amt) || amt < 0) return m.reply('Indica una cantidad válida (entero ≥ 0).');
        const u = getUser(t);
        if (cmd === 'addmoney') u.money = (u.money || 0) + amt;
        else if (cmd === 'delmoney') u.money = Math.max(0, (u.money || 0) - amt);
        else u.money = amt;
        db.markDirty();
        const verbo = cmd === 'addmoney' ? 'Diste' : cmd === 'delmoney' ? 'Quitaste' : 'Fijaste en';
        await conn.sendMessage(m.chat, { text: `💜 ${verbo} ${fmtMoney(amt)} a @${t.split('@')[0]}.\nSaldo actual: ${fmtMoney(u.money)}.`, mentions: [t] }, { quoted: m });
        break;
    }

    // ═══════════ EXP ═══════════
    case 'addexp': case 'delexp': {
        if (!t) return m.reply(`Uso: .${cmd} @usuario <cantidad>`);
        const amt = amountOf(args, text.replace(/@?\d{6,}/g, ''));
        if (!Number.isFinite(amt) || amt < 0) return m.reply('Indica una cantidad válida.');
        const u = getUser(t);
        u.exp = cmd === 'addexp' ? (u.exp || 0) + amt : Math.max(0, (u.exp || 0) - amt);
        db.markDirty();
        await conn.sendMessage(m.chat, { text: `⬆️ ${cmd === 'addexp' ? 'Diste' : 'Quitaste'} ${amt} EXP a @${t.split('@')[0]}.\nEXP actual: ${u.exp} (nivel ${u.level}).`, mentions: [t] }, { quoted: m });
        break;
    }

    // ═══════════ DIAMANTES (HG) ═══════════
    case 'adddiamond': case 'deldiamond': {
        if (!t) return m.reply(`Uso: .${cmd} @usuario <cantidad>`);
        const amt = amountOf(args, text.replace(/@?\d{6,}/g, ''));
        if (!Number.isFinite(amt) || amt < 0) return m.reply('Indica una cantidad válida.');
        const u = getUser(t);
        const add = cmd === 'adddiamond';
        u.diamond = add ? (u.diamond || 0) + amt : Math.max(0, (u.diamond || 0) - amt);
        u.corazones = add ? (u.corazones || 0) + amt : Math.max(0, (u.corazones || 0) - amt);
        db.markDirty();
        await conn.sendMessage(m.chat, { text: `💎 ${add ? 'Diste' : 'Quitaste'} ${fmtPremium(amt)} a @${t.split('@')[0]}.\nDiamantes actuales: ${u.diamond}.`, mentions: [t] }, { quoted: m });
        break;
    }

    // ═══════════ PANEL DE GRUPOS (owner) ═══════════
    case 'grupos': {
        const PAGE = 30;
        const page = Math.max(1, parseInt((args || [])[0]) || 1);
        let all;
        // Suprime anuncios de groups.update mientras consultamos (las consultas
        // masivas pueden hacer que WhatsApp reenvíe metadata y dispare anuncios).
        global.__suppressGroupAnnounce = Date.now() + 30000;
        try { all = await conn.groupFetchAllParticipating(); }
        catch (e) { global.__suppressGroupAnnounce = 0; return m.reply('❌ No pude obtener la lista de grupos: ' + (e?.message || e)); }
        const groups = Object.values(all || {});
        if (!groups.length) { global.__suppressGroupAnnounce = 0; return m.reply('El bot no está en ningún grupo.'); }

        const botNum = String(conn.user?.id || '').split('@')[0].split(':')[0];
        const isBotAdminOf = (g) => (g.participants || []).some(p => {
            const n = String(p.id || '').split('@')[0].split(':')[0];
            return n === botNum && (p.admin === 'admin' || p.admin === 'superadmin');
        });

        // ORDEN: primero los grupos donde el bot es admin (puede dar enlace),
        // luego el resto. Dentro de cada sección, por número de miembros (desc).
        const withAccess = groups.filter(isBotAdminOf).sort((a, b) => (b.participants?.length || 0) - (a.participants?.length || 0));
        const noAccess   = groups.filter(g => !isBotAdminOf(g)).sort((a, b) => (b.participants?.length || 0) - (a.participants?.length || 0));
        const ordered = [...withAccess, ...noAccess];

        const totalGroups = groups.length;
        const totalMembers = groups.reduce((s, g) => s + (g.participants?.length || 0), 0);
        const totalUsers = Object.keys(db.data.users || {}).length;

        const pages = Math.ceil(totalGroups / PAGE);
        if (page > pages) { global.__suppressGroupAnnounce = 0; return m.reply(`Solo hay ${pages} página(s). Usa .grupos ${pages}.`); }
        const start = (page - 1) * PAGE;
        const slice = ordered.slice(start, start + PAGE);

        const lines = [];
        for (let i = 0; i < slice.length; i++) {
            const g = slice[i];
            const n = start + i + 1;
            const members = g.participants?.length || 0;
            const admin = isBotAdminOf(g);
            let block = `${n}. *${g.subject || 'Sin nombre'}*\n   👥 ${members} miembros\n   🆔 ${g.id}\n   ${admin ? '👑 Admin: Sí' : '❌ Admin: No'}`;
            if (admin) {
                // Solo LECTURA del código existente (get, no revoca/cambia nada).
                try { const code = await conn.groupInviteCode(g.id); if (code) block += `\n   🔗 https://chat.whatsapp.com/${code}`; }
                catch { block += `\n   🔒 No se pudo leer el enlace`; }
            } else {
                block += `\n   🔒 Sin acceso al enlace`;
            }
            lines.push(block);
        }
        global.__suppressGroupAnnounce = 0; // fin de la ventana de supresión

        const header =
`📊 *KimdanBot está en ${totalGroups} grupos*

🏠 Grupos: ${totalGroups}
👥 Usuarios totales: ${totalUsers.toLocaleString('es')}
👑 Soy admin en: ${withAccess.length}
🔒 No soy admin en: ${noAccess.length}
👤 Miembros sumados: ${totalMembers.toLocaleString('es')}

📄 Página ${page}/${pages}${pages > 1 ? ` · _.grupos ${page < pages ? page + 1 : 1}_` : ''}
🔓 Con enlace primero · 🔒 Sin acceso después
━━━━━━━━━━━━━━`;
        await m.reply(header + '\n\n' + lines.join('\n\n'));
        break;
    }

    case 'salirgrupo': {
        const arg = (text || '').trim();
        if (!arg) return m.reply('Uso: .salirgrupo <ID@g.us>  o  .salirgrupo <nombre del grupo>');
        let targetId = null;
        if (/@g\.us$/.test(arg)) {
            targetId = arg;
        } else {
            // Buscar por nombre (confirma mostrando el match).
            global.__suppressGroupAnnounce = Date.now() + 15000;
            let all = {};
            try { all = await conn.groupFetchAllParticipating(); } catch { /* */ }
            global.__suppressGroupAnnounce = 0;
            const matches = Object.values(all).filter(g => (g.subject || '').toLowerCase().includes(arg.toLowerCase()));
            if (!matches.length) return m.reply(`No encontré ningún grupo que contenga "${arg}".`);
            if (matches.length > 1) {
                return m.reply(`Hay ${matches.length} grupos que coinciden. Usa el ID exacto:\n\n` +
                    matches.slice(0, 10).map(g => `• *${g.subject}*\n  🆔 ${g.id}`).join('\n'));
            }
            targetId = matches[0].id;
        }
        try {
            await conn.sendMessage(targetId, { text: '💜 Gracias por usar *KimdanBot*.\n\nHasta pronto~ (´｡• ᵕ •｡`)' }).catch(() => {});
            await conn.groupLeave(targetId);
            await m.reply(`✅ Salí del grupo:\n🆔 ${targetId}`);
        } catch (e) { await m.reply('❌ No pude salir del grupo: ' + (e?.message || e)); }
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
