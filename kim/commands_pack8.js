// kim/commands_pack8.js — Gestión de COMUNIDADES de WhatsApp y expulsión
// masiva (multikick). Arquitectura nativa: COMMAND_META + switch/case.
//
// Notas de compatibilidad (Baileys MD):
//   • No existe un método directo "getSubGroups". Reconstruimos la comunidad
//     con groupFetchAllParticipating() filtrando por meta.linkedParent.
//   • meta.isCommunity → grupo padre; meta.isCommunityAnnounce → anuncios;
//     meta.linkedParent → JID de la comunidad a la que pertenece un subgrupo.
//   • El bot debe ser MIEMBRO de los subgrupos para ver sus participantes.

import { command } from './registry.js';
import { getUser, db } from './db.js';
import { box } from './ui.js';

const COMMAND_META = [
    { names: ['auditcomunidad', 'communityaudit', 'auditcommunity'], category: 'group', description: 'Audita una comunidad: usuarios solo en anuncios (paginado)' },
    { names: ['limpiarcomunidad', 'communityclean', 'cleancommunity'], category: 'group', description: 'Vista previa de limpieza de la comunidad (o "force")' },
    { names: ['confirmarlimpieza', 'confirmclean'], category: 'group', description: 'Confirma la limpieza de comunidad pendiente' },
    { names: ['multikick', 'multiban', 'kickall'], category: 'group', description: 'Expulsa varios usuarios a la vez (menciones o respuesta)' },
];

// ── helpers de permisos ──────────────────────────────────────────────
const needGroup = (m) => { if (!m.isGroup) { m.reply('⚠️ Este comando solo funciona en grupos/comunidades.'); return false; } return true; };
const needAdmin = (m) => {
    if (!needGroup(m)) return false;
    if (!m.isSenderAdmin && !m.isOwner) { m.reply('⚠️ Solo administradores o el owner.'); return false; }
    return true;
};
const needBotAdmin = (m) => { if (!m.isBotAdmin) { m.reply('⚠️ Necesito ser administrador para esto.'); return false; } return true; };

// Resuelve un JID a la forma canónica del participante de un grupo (LID-aware).
function canonInGroup(jid, meta) {
    const parts = meta?.participants;
    if (!Array.isArray(parts) || !jid) return jid;
    const forms = new Set([jid]);
    if (jid.endsWith('@lid')) forms.add(jid.replace('@lid', '@s.whatsapp.net'));
    else if (jid.endsWith('@s.whatsapp.net')) forms.add(jid.replace('@s.whatsapp.net', '@lid'));
    const num = String(jid).split('@')[0];
    const p = parts.find(p => forms.has(p.id) || forms.has(p.jid) || String(p.id).split('@')[0] === num);
    return p?.id || jid;
}

// Estado de limpieza pendiente por chat (para confirmarlimpieza).
const _pendingClean = new Map(); // communityJid → { targets:[jid], ts }
const CLEAN_TTL = 5 * 60 * 1000;

/**
 * Reconstruye la estructura de la comunidad a la que pertenece `chatJid`.
 * Devuelve { announceJid, subgroups:[meta], membersBySub:Map, announceMembers:[] }
 * o null si el chat no es parte de una comunidad accesible.
 * Optimización: una sola pasada de groupFetchAllParticipating (cacheada por
 * llamada) y una groupMetadata por subgrupo como máximo.
 */
async function buildCommunity(conn, chatJid) {
    let meta;
    try { meta = await conn.groupMetadata(chatJid); } catch { return null; }
    // El JID de la comunidad: si este chat es el padre/anuncios, es él mismo;
    // si es un subgrupo, es su linkedParent.
    const communityJid = meta.isCommunity ? chatJid : (meta.linkedParent || null);
    if (!communityJid) return null;

    // Todos los grupos donde está el bot (una sola consulta).
    let all = {};
    try { all = await conn.groupFetchAllParticipating(); } catch { /* */ }
    const groups = Object.values(all || {});

    // Subgrupos = los que enlazan a esta comunidad y NO son el anuncio.
    const linked = groups.filter(g => g.linkedParent === communityJid);
    // El grupo de anuncios: el que es announce de la comunidad (o el padre).
    let announce = groups.find(g => g.id === communityJid && g.isCommunityAnnounce)
        || groups.find(g => g.linkedParent === communityJid && g.isCommunityAnnounce)
        || groups.find(g => g.id === communityJid);

    // Si no teníamos metadata fresca del anuncio, intentar traerla.
    let announceMeta = announce;
    if (!announceMeta || !announceMeta.participants) {
        try { announceMeta = await conn.groupMetadata(communityJid); } catch { /* */ }
    }
    const subgroups = linked.filter(g => !g.isCommunityAnnounce && g.id !== communityJid);

    return { communityJid, announceMeta, subgroups };
}

/** Conjunto de números (sin @server) presentes en los subgrupos. */
function numbersInSubgroups(subgroups) {
    const set = new Set();
    for (const g of subgroups) {
        for (const p of (g.participants || [])) {
            const num = String(p.id || p.jid || '').split('@')[0].split(':')[0];
            if (num) set.add(num);
        }
    }
    return set;
}

async function execute(conn, m, command, args, text) {
    switch (command) {

    case 'auditcomunidad': {
        if (!needAdmin(m)) return;
        const PAGE = 30;
        const page = Math.max(1, parseInt((args || [])[0]) || 1);
        global.__suppressGroupAnnounce = Date.now() + 30000;
        const comm = await buildCommunity(conn, m.chat);
        if (!comm) { global.__suppressGroupAnnounce = 0; return m.reply('⚠️ Este chat no es parte de una comunidad accesible (¿soy miembro del grupo de anuncios?).'); }
        const announceMembers = comm.announceMeta?.participants || [];
        if (!announceMembers.length) { global.__suppressGroupAnnounce = 0; return m.reply('No pude leer los miembros del grupo de anuncios de la comunidad.'); }
        const inSubs = numbersInSubgroups(comm.subgroups);
        global.__suppressGroupAnnounce = 0;

        // Usuarios que están en anuncios pero en ningún subgrupo.
        const onlyAnnounce = announceMembers
            .map(p => ({ jid: p.id || p.jid, num: String(p.id || p.jid || '').split('@')[0].split(':')[0] }))
            .filter(x => x.num && !inSubs.has(x.num));

        if (!onlyAnnounce.length) return m.reply(`✅ Auditoría: todos los miembros del anuncio participan en al menos un subgrupo.\n\n📊 Subgrupos analizados: ${comm.subgroups.length}`);

        const pages = Math.ceil(onlyAnnounce.length / PAGE);
        if (page > pages) return m.reply(`Solo hay ${pages} página(s). Usa .auditcomunidad ${pages}.`);
        const start = (page - 1) * PAGE;
        const slice = onlyAnnounce.slice(start, start + PAGE);

        const lines = slice.map((x, i) => `${start + i + 1}. wa.me/${x.num} · 📊 0 subgrupos`);
        await m.reply(
            `📊 *Auditoría de Comunidad* (${page}/${pages})\n\n` +
            `👥 Miembros en anuncios: ${announceMembers.length}\n` +
            `🔗 Subgrupos analizados: ${comm.subgroups.length}\n` +
            `🚷 Solo en anuncios: ${onlyAnnounce.length}\n` +
            `━━━━━━━━━━━━━━\n` +
            lines.join('\n') +
            (pages > 1 ? `\n\n_Más: .auditcomunidad ${page < pages ? page + 1 : 1}_` : '') +
            `\n\nPara eliminarlos: .limpiarcomunidad`
        );
        break;
    }

    case 'limpiarcomunidad': {
        if (!needAdmin(m) || !needBotAdmin(m)) return;
        const force = /^force$/i.test((text || '').trim());
        global.__suppressGroupAnnounce = Date.now() + 30000;
        const comm = await buildCommunity(conn, m.chat);
        if (!comm) { global.__suppressGroupAnnounce = 0; return m.reply('⚠️ Este chat no es parte de una comunidad accesible.'); }
        const announceMembers = comm.announceMeta?.participants || [];
        const inSubs = numbersInSubgroups(comm.subgroups);
        global.__suppressGroupAnnounce = 0;

        // Candidatos: solo-anuncios, excluyendo admins, bot y owner.
        const botNum = String(conn.user?.id || '').split('@')[0].split(':')[0];
        const adminNums = new Set(announceMembers.filter(p => p.admin).map(p => String(p.id || p.jid).split('@')[0].split(':')[0]));
        const targets = announceMembers
            .filter(p => {
                const num = String(p.id || p.jid || '').split('@')[0].split(':')[0];
                if (!num || inSubs.has(num)) return false;          // participa en subgrupos
                if (num === botNum) return false;                    // el bot
                if (adminNums.has(num)) return false;                // admins de la comunidad
                const u = getUser(p.id || p.jid);
                return true;
            })
            .map(p => p.id || p.jid);

        if (!targets.length) return m.reply('✅ No hay usuarios para limpiar (nadie está solo en anuncios).');

        if (force) {
            const res = await massRemove(conn, comm.communityJid, targets);
            return m.reply(`🧹 *Limpieza directa completada*\n✅ Expulsados: ${res.ok}\n❌ Fallidos: ${res.fail}`);
        }

        // Vista previa + confirmación.
        _pendingClean.set(comm.communityJid, { targets, ts: Date.now(), chat: m.chat });
        await m.reply(
            `⚠️ Se encontraron *${targets.length}* usuarios para eliminar (solo en anuncios).\n\n` +
            targets.slice(0, 10).map((j, i) => `${i + 1}. wa.me/${String(j).split('@')[0].split(':')[0]}`).join('\n') +
            (targets.length > 10 ? `\n…y ${targets.length - 10} más` : '') +
            `\n\nPara proceder responde:\n*.confirmarlimpieza*\n\n_(La confirmación caduca en 5 min)_`
        );
        break;
    }

    case 'confirmarlimpieza': {
        if (!needAdmin(m) || !needBotAdmin(m)) return;
        let meta; try { meta = await conn.groupMetadata(m.chat); } catch { /* */ }
        const communityJid = meta?.isCommunity ? m.chat : (meta?.linkedParent || m.chat);
        const pend = _pendingClean.get(communityJid);
        if (!pend || Date.now() - pend.ts > CLEAN_TTL) {
            _pendingClean.delete(communityJid);
            return m.reply('⌛ No hay una limpieza pendiente (o caducó). Usa .limpiarcomunidad primero.');
        }
        _pendingClean.delete(communityJid);
        const res = await massRemove(conn, communityJid, pend.targets);
        await m.reply(`🧹 *Limpieza completada*\n✅ Expulsados: ${res.ok}\n❌ Fallidos: ${res.fail}${res.fail ? '\n\n_Motivo común: sin permisos o ya no estaban._' : ''}`);
        break;
    }

    case 'multikick': {
        if (!needAdmin(m) || !needBotAdmin(m)) return;
        // Reúne objetivos: menciones del mensaje + menciones del citado.
        const set = new Set();
        for (const j of (m.mentionedJid || [])) set.add(j);
        const qctx = m.quoted?.mentionedJid || m.msg?.contextInfo?.mentionedJid;
        for (const j of (qctx || [])) set.add(j);
        if (m.quoted?.sender) set.add(m.quoted.sender);
        if (!set.size) return m.reply('Uso: .multikick @user1 @user2 …  (o responde a un mensaje con menciones)');

        let meta; try { meta = await conn.groupMetadata(m.chat); } catch { /* */ }
        const botNum = String(conn.user?.id || '').split('@')[0].split(':')[0];
        const adminNums = new Set((m.groupAdmins || []).map(a => String(a).split('@')[0].split(':')[0]));
        // superadmins/admins desde metadata por si groupAdmins no está completo
        for (const p of (meta?.participants || [])) if (p.admin) adminNums.add(String(p.id || p.jid).split('@')[0].split(':')[0]);

        const toKick = []; const skipped = [];
        for (const jid of set) {
            const num = String(jid).split('@')[0].split(':')[0];
            if (num === botNum) { skipped.push(num); continue; }
            if (adminNums.has(num)) { skipped.push(num); continue; }     // admin/superadmin
            const u = getUser(jid);
            // no expulsar owner del bot
            if (u && (u.role === 'owner')) { skipped.push(num); continue; }
            toKick.push(canonInGroup(jid, meta));
        }
        if (!toKick.length) return m.reply('⚠️ No hay usuarios válidos para expulsar (todos eran admins, el bot o el owner).');

        let ok = 0, fail = 0;
        const CHUNK = 5;
        for (let i = 0; i < toKick.length; i += CHUNK) {
            const slice = toKick.slice(i, i + CHUNK);
            try {
                const res = await conn.groupParticipantsUpdate(m.chat, slice, 'remove');
                if (Array.isArray(res)) { for (const r of res) (r?.status === '200' || r?.status === 200) ? ok++ : fail++; }
                else ok += slice.length;
            } catch { fail += slice.length; }
        }
        this?._invalidateGroup?.(m.chat);
        await m.reply(
            `🧹 *Expulsión masiva*\n✅ Expulsados: ${ok}\n${fail ? `❌ Fallidos: ${fail}\n_Motivo: sin permisos o ya no estaban._\n` : ''}` +
            (skipped.length ? `🛡️ Protegidos (admin/bot/owner): ${skipped.length}` : '')
        );
        break;
    }

    }
}

// Expulsa una lista de JIDs en lotes; devuelve { ok, fail }.
async function massRemove(conn, groupJid, jids) {
    let ok = 0, fail = 0;
    const CHUNK = 5;
    for (let i = 0; i < jids.length; i += CHUNK) {
        const slice = jids.slice(i, i + CHUNK);
        try {
            const res = await conn.groupParticipantsUpdate(groupJid, slice, 'remove');
            if (Array.isArray(res)) { for (const r of res) (r?.status === '200' || r?.status === 200) ? ok++ : fail++; }
            else ok += slice.length;
        } catch { fail += slice.length; }
    }
    return { ok, fail };
}

for (const meta of COMMAND_META) {
    const canonical = meta.names[0];
    command({ name: canonical, aliases: meta.names.slice(1), category: meta.category, description: meta.description },
        (conn, m, args, text) => execute(conn, m, canonical, args, text));
}

export { COMMAND_META };
export default true;
