// kim/commands_subbots.js — Gestión profesional de sub-bots temporales.
// ─────────────────────────────────────────────────────────────────────
// Comandos (owner salvo que se indique):
//   #subbot @user <duración|permanente>   → crea/actualiza la licencia
//   #subbotinfo [@user]                   → detalle de una licencia
//   #subbotlist                           → todas las licencias y su estado
//   #extendsubbot @user <duración>        → amplía el tiempo restante
//   #reducesubbot @user <duración>        → reduce el tiempo (nunca negativo)
//   #subbotrenew @user <duración|perm>    → renueva un sub-bot vencido
//   #subbotremove @user                   → elimina la licencia + purga sesión
//
// La persistencia vive en kim/subbots/store.js (Mongo con fallback JSON) y la
// expiración automática en kim/subbots/expiry.js. Los sub-bots PERMANENTES
// siguen funcionando igual que antes: aquí solo se les añade una licencia
// permanente (expiresAt=null).

import { command } from './registry.js';
import { box } from './ui.js';
import { manager } from './subbots/index.js';
import { expireOne } from './subbots/expiry.js';
import {
    parseDuration, formatRemaining, sanitizeId,
    upsertLicense, getLicense, listLicenses, adjustTime, removeLicense, setState, STATES,
} from './subbots/store.js';

const COMMAND_META = [
    { name: 'subbot', aliases: ['addsubbot', 'licencia'], category: 'owner', description: 'Crea/actualiza licencia de sub-bot: #subbot @user 30d|permanente' },
    { name: 'subbotinfo', aliases: ['infosubbot'], category: 'owner', description: 'Detalle de la licencia de un sub-bot' },
    { name: 'subbotlist', aliases: ['licencias', 'subbotslist'], category: 'owner', description: 'Lista todas las licencias de sub-bots' },
    { name: 'extendsubbot', aliases: ['extendbot'], category: 'owner', description: 'Amplía el tiempo de un sub-bot: #extendsubbot @user 30d' },
    { name: 'reducesubbot', aliases: ['reducebot'], category: 'owner', description: 'Reduce el tiempo de un sub-bot: #reducesubbot @user 15d' },
    { name: 'subbotrenew', aliases: ['renewbot'], category: 'owner', description: 'Renueva un sub-bot vencido: #subbotrenew @user 30d' },
    { name: 'subbotremove', aliases: ['delsubbot', 'removebot'], category: 'owner', description: 'Elimina la licencia y purga la sesión del sub-bot' },
];

const needOwner = (m) => {
    if (!m.isOwner) { m.reply('⚠️ Solo el propietario del bot.'); return false; }
    return true;
};

// Resuelve el JID objetivo (mención > citado > número en texto > uno mismo).
function resolveTarget(m, args) {
    if (m.mentionedJid?.[0]) return m.mentionedJid[0];
    if (m.quoted?.sender) return m.quoted.sender;
    for (const a of args) {
        const num = String(a).replace(/[^0-9]/g, '');
        if (num.length >= 8) return `${num}@s.whatsapp.net`;
    }
    return m.sender;
}

// Encuentra el primer argumento que sea una duración válida (o permanente).
function findDuration(args) {
    for (const a of args) {
        const d = parseDuration(a);
        if (d) return d;
    }
    return null;
}

const stateEmoji = (s) => ({
    active: '🟢', permanent: '♾️', suspended: '⏸️', expired: '⌛',
}[s] || '❔');

function remainingOf(lic) {
    if (!lic) return '—';
    if (lic.expiresAt == null) return 'permanente';
    if (lic.state === STATES.EXPIRED) return 'expirado';
    return formatRemaining(lic.expiresAt - Date.now());
}

const fdate = (ts) => ts ? new Date(ts).toLocaleString('es', { hour12: false }) : '—';

export async function execute(conn, m, cmd, args) {
    switch (cmd) {

    case 'subbot': {
        if (!needOwner(m)) return;
        const target = resolveTarget(m, args);
        const id = sanitizeId(target);
        const number = id;
        const duration = findDuration(args); // null → permanente
        const lic = await upsertLicense({ id, ownerJid: m.sender, number, duration });
        const isPerm = lic.expiresAt == null;
        await m.reply(box('🤖 LICENCIA DE SUB-BOT', [
            `👤 Usuario: wa.me/${number}`,
            `🎫 Estado: ${stateEmoji(lic.state)} ${lic.state}`,
            `⏱️ Duración: ${lic.durationLabel}`,
            isPerm ? '♾️ No expira.' : `📆 Expira: ${fdate(lic.expiresAt)}`,
            '',
            manager.has(id)
                ? '✅ El sub-bot ya está conectado; la licencia ya aplica.'
                : 'ℹ️ El usuario debe vincularse con *.serbot* (QR) o *.sercode* (código).',
        ]));
        break;
    }

    case 'subbotinfo': {
        if (!needOwner(m)) return;
        const target = resolveTarget(m, args);
        const id = sanitizeId(target);
        const lic = await getLicense(id);
        if (!lic) return m.reply('🍃 Ese usuario no tiene ninguna licencia de sub-bot.');
        await m.reply(box('🔎 INFO DE SUB-BOT', [
            `👑 Owner licencia: wa.me/${sanitizeId(lic.ownerJid)}`,
            `👤 Usuario: wa.me/${lic.number || id}`,
            `📅 Creado: ${fdate(lic.createdAt)}`,
            `⏱️ Duración: ${lic.durationLabel}`,
            `📆 Expira: ${lic.expiresAt == null ? 'nunca (permanente)' : fdate(lic.expiresAt)}`,
            `⏳ Restante: ${remainingOf(lic)}`,
            `🎫 Estado: ${stateEmoji(lic.state)} ${lic.state}`,
            `🔌 Conectado ahora: ${manager.has(id) ? 'sí' : 'no'}`,
            `🏷️ Tipo: ${lic.expiresAt == null ? 'permanente' : 'temporal'}`,
        ]));
        break;
    }

    case 'subbotlist': {
        if (!needOwner(m)) return;
        const all = await listLicenses();
        if (!all.length) return m.reply(box('🤖 SUB-BOTS', ['No hay licencias registradas.']));
        all.sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity));
        const lines = all.map((lic) => {
            const live = manager.has(lic.id) ? '🔌' : '·';
            return `${stateEmoji(lic.state)}${live} wa.me/${lic.number || lic.id} — ${remainingOf(lic)}`;
        });
        const counts = all.reduce((o, l) => { o[l.state] = (o[l.state] || 0) + 1; return o; }, {});
        lines.push('');
        lines.push(`♾️ perm:${counts.permanent || 0} · 🟢 act:${counts.active || 0} · ⏸️ susp:${counts.suspended || 0} · ⌛ venc:${counts.expired || 0}`);
        await m.reply(box(`🤖 SUB-BOTS · ${all.length}`, lines));
        break;
    }

    case 'extendsubbot':
    case 'reducesubbot': {
        if (!needOwner(m)) return;
        const target = resolveTarget(m, args);
        const id = sanitizeId(target);
        const duration = findDuration(args);
        if (!duration || duration.permanent) return m.reply(`Uso: .${cmd} @usuario <12h|7d|2w|1m|1a>`);
        const sign = cmd === 'reducesubbot' ? -1 : 1;
        const res = await adjustTime(id, sign * duration.ms);
        if (!res.ok) {
            if (res.reason === 'permanent') return m.reply('♾️ Ese sub-bot es permanente; no tiene tiempo que ajustar.');
            return m.reply('🍃 Ese usuario no tiene una licencia temporal activa.');
        }
        await m.reply(box(cmd === 'reducesubbot' ? '➖ TIEMPO REDUCIDO' : '➕ TIEMPO AMPLIADO', [
            `👤 Usuario: wa.me/${id}`,
            `⏱️ Ajuste: ${sign > 0 ? '+' : '−'}${duration.label}`,
            `📆 Nueva expiración: ${fdate(res.expiresAt)}`,
            `⏳ Restante: ${formatRemaining(res.expiresAt - Date.now())}`,
        ]));
        break;
    }

    case 'subbotrenew': {
        if (!needOwner(m)) return;
        const target = resolveTarget(m, args);
        const id = sanitizeId(target);
        const lic = await getLicense(id);
        if (!lic) return m.reply('🍃 Ese usuario no tiene ninguna licencia para renovar.');
        const duration = findDuration(args); // null → permanente
        const updated = await upsertLicense({ id, ownerJid: m.sender, number: lic.number || id, duration });
        await m.reply(box('🔄 SUB-BOT RENOVADO', [
            `👤 Usuario: wa.me/${id}`,
            `🎫 Estado: ${stateEmoji(updated.state)} ${updated.state}`,
            `⏱️ Duración: ${updated.durationLabel}`,
            updated.expiresAt == null ? '♾️ No expira.' : `📆 Expira: ${fdate(updated.expiresAt)}`,
            manager.has(id) ? '✅ Sesión activa.' : 'ℹ️ Debe reconectarse con *.serbot* si su sesión fue purgada.',
        ]));
        break;
    }

    case 'subbotremove': {
        if (!needOwner(m)) return;
        const target = resolveTarget(m, args);
        const id = sanitizeId(target);
        const lic = await getLicense(id);
        if (!lic && !manager.has(id)) return m.reply('🍃 No hay ningún sub-bot con ese usuario.');
        await manager.removeById(id, { purge: true }).catch(() => {});
        await removeLicense(id).catch(() => {});
        await m.reply(box('🗑️ SUB-BOT ELIMINADO', [
            `👤 Usuario: wa.me/${id}`,
            '✅ Sesión cerrada, recursos liberados y licencia eliminada.',
        ]));
        break;
    }

    }
}

for (const meta of COMMAND_META) {
    command({ name: meta.name, aliases: meta.aliases || [], category: meta.category, description: meta.description, hidden: meta.hidden },
        (conn, m, args, text) => execute(conn, m, meta.name, args, text));
}

export { COMMAND_META };
export default true;
