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

// ── Identidad de participantes (LID-aware) ───────────────────────────
// En v7 un participante puede venir como LID (id=@lid) con su phoneNumber,
// o como PN (id=@s.whatsapp.net) con su lid. Para comparar correctamente
// entre el grupo de anuncios y los subgrupos hay que considerar TODAS las
// formas de cada persona, no solo el número del id.

/** Devuelve el conjunto de "números" (parte local) de todas las identidades de p. */
function identityNums(p) {
    const out = new Set();
    for (const j of [p?.id, p?.jid, p?.lid, p?.phoneNumber].filter(Boolean)) {
        const n = String(j).split('@')[0].split(':')[0];
        if (n) out.add(n);
    }
    return out;
}

/** El número de TELÉFONO real de un participante para mostrar (wa.me). */
async function phoneOf(conn, p) {
    // 1) phoneNumber explícito (Baileys lo trae cuando id es LID).
    if (p?.phoneNumber) return String(p.phoneNumber).split('@')[0].split(':')[0];
    const id = p?.id || p?.jid || '';
    // 2) si el id ya es PN, ese es el número.
    if (id.endsWith('@s.whatsapp.net')) return id.split('@')[0].split(':')[0];
    // 3) si el id es LID, intentar resolver a PN vía lidMapping.
    if (id.endsWith('@lid')) {
        try {
            const pn = await conn.signalRepository?.lidMapping?.getPNForLID?.(id);
            if (pn) return String(pn).split('@')[0].split(':')[0];
        } catch { /* */ }
    }
    // 4) último recurso: la parte local del id (puede ser un LID; se marca).
    return null; // null = no se pudo resolver el número real
}

// Resuelve un JID a la forma canónica del participante de un grupo (LID-aware).
function canonInGroup(jid, meta) {
    const parts = meta?.participants;
    if (!Array.isArray(parts) || !jid) return jid;
    const num = String(jid).split('@')[0].split(':')[0];
    const p = parts.find(pp => identityNums(pp).has(num));
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
    // El grupo de anuncios de la comunidad: es donde residen los miembros
    // "solo comunidad" y, MUY IMPORTANTE, es el grupo DESDE EL QUE se expulsa
    // (WhatsApp no permite expulsar desde la comunidad padre directamente).
    let announce = groups.find(g => g.id === communityJid && g.isCommunityAnnounce)
        || groups.find(g => g.linkedParent === communityJid && g.isCommunityAnnounce)
        || groups.find(g => g.id === communityJid);

    // Si no teníamos metadata fresca del anuncio, intentar traerla.
    let announceMeta = announce;
    if (!announceMeta || !announceMeta.participants) {
        try { announceMeta = await conn.groupMetadata(announce?.id || communityJid); } catch { /* */ }
    }
    const announceJid = announceMeta?.id || announce?.id || communityJid;
    const subgroups = linked.filter(g => !g.isCommunityAnnounce && g.id !== announceJid);

    return { communityJid, announceJid, announceMeta, subgroups };
}

/** Conjunto de TODOS los números (todas las identidades) presentes en los subgrupos. */
function numbersInSubgroups(subgroups) {
    const set = new Set();
    for (const g of subgroups) {
        for (const p of (g.participants || [])) {
            for (const n of identityNums(p)) set.add(n);
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
        global.__suppressGroupAnnounce = Date.now() + 60000;
        const comm = await buildCommunity(conn, m.chat);
        if (!comm) { return m.reply('⚠️ Este chat no es parte de una comunidad accesible (¿soy miembro del grupo de anuncios?).'); }
        const announceMembers = comm.announceMeta?.participants || [];
        if (!announceMembers.length) { return m.reply('No pude leer los miembros del grupo de anuncios de la comunidad.'); }
        const inSubs = numbersInSubgroups(comm.subgroups);

        // Usuarios en anuncios pero en ningún subgrupo. "En subgrupos" = si
        // CUALQUIERA de sus identidades (id/lid/phoneNumber) aparece en algún
        // subgrupo. Se excluyen admins y el bot.
        const botNums = identityNums({ id: conn.user?.id, lid: conn.user?.lid });
        const candidates = announceMembers.filter(p => {
            if (p.admin) return false;
            const ids = identityNums(p);
            for (const n of ids) if (inSubs.has(n) || botNums.has(n)) return false;
            return ids.size > 0;
        });

        if (!candidates.length) return m.reply(`✅ Auditoría: todos los miembros del anuncio participan en al menos un subgrupo.\n\n📊 Subgrupos analizados: ${comm.subgroups.length}`);

        const pages = Math.ceil(candidates.length / PAGE);
        if (page > pages) return m.reply(`Solo hay ${pages} página(s). Usa .auditcomunidad ${pages}.`);
        const start = (page - 1) * PAGE;
        const slice = candidates.slice(start, start + PAGE);

        // Resolver el número de teléfono REAL de cada uno para mostrar wa.me.
        const lines = [];
        for (let i = 0; i < slice.length; i++) {
            const p = slice[i];
            const phone = await phoneOf(conn, p);
            const n = start + i + 1;
            if (phone) lines.push(`${n}. https://wa.me/${phone}`);
            else lines.push(`${n}. ${p.id} _(número oculto por privacidad LID)_`);
        }
        await m.reply(
            `📊 *Auditoría de Comunidad* (${page}/${pages})\n\n` +
            `👥 Miembros en anuncios: ${announceMembers.length}\n` +
            `🔗 Subgrupos analizados: ${comm.subgroups.length}\n` +
            `🚷 Solo en anuncios: ${candidates.length}\n` +
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
        global.__suppressGroupAnnounce = Date.now() + 60000;
        const comm = await buildCommunity(conn, m.chat);
        if (!comm) { return m.reply('⚠️ Este chat no es parte de una comunidad accesible.'); }
        const announceMembers = comm.announceMeta?.participants || [];
        const inSubs = numbersInSubgroups(comm.subgroups);

        // Verificar que el BOT sea admin del grupo de anuncios (es de donde se
        // expulsa). Sin esto, todos los removes fallarían con "sin permisos".
        const botNums = identityNums({ id: conn.user?.id, lid: conn.user?.lid });
        const botIsAdmin = announceMembers.some(p => {
            const ids = identityNums(p);
            const isBot = [...ids].some(n => botNums.has(n));
            return isBot && (p.admin === 'admin' || p.admin === 'superadmin');
        });
        if (!botIsAdmin) return m.reply('⚠️ No soy administrador del grupo de anuncios de la comunidad, así que no puedo expulsar a nadie.\n\nℹ️ Hazme admin de la comunidad e inténtalo de nuevo.');

        // Candidatos: solo-anuncios (ninguna identidad en subgrupos), excluyendo
        // admins y el bot. Se expulsa por el JID `id` del participante del anuncio.
        const targets = announceMembers
            .filter(p => {
                if (p.admin) return false;                           // admins
                const ids = identityNums(p);
                if (!ids.size) return false;
                for (const n of ids) if (inSubs.has(n) || botNums.has(n)) return false; // en subgrupos o es el bot
                return true;
            })
            .map(p => p.id || p.jid);

        if (!targets.length) return m.reply('✅ No hay usuarios para limpiar (nadie está solo en anuncios).');

        if (force) {
            // Se expulsa desde el GRUPO DE ANUNCIOS (announceJid), NO desde la
            // comunidad padre — WhatsApp no permite expulsar desde el padre.
            const res = await massRemove(conn, comm.announceJid, targets, comm.announceMeta);
            return m.reply(`🧹 *Limpieza directa completada*\n✅ Expulsados: ${res.ok}\n❌ Fallidos: ${res.fail}${res.reasons.length ? '\n\n' + res.reasons.slice(0, 8).join('\n') : ''}`);
        }

        // Vista previa + confirmación. Guardamos el announceJid para el remove.
        _pendingClean.set(comm.communityJid, { targets, announceJid: comm.announceJid, announceMeta: comm.announceMeta, ts: Date.now(), chat: m.chat });
        const partByJid = new Map(announceMembers.map(p => [p.id || p.jid, p]));
        const previewLines = [];
        for (let i = 0; i < Math.min(targets.length, 10); i++) {
            const phone = await phoneOf(conn, partByJid.get(targets[i]) || { id: targets[i] });
            previewLines.push(`${i + 1}. ${phone ? 'https://wa.me/' + phone : targets[i] + ' _(LID)_'}`);
        }
        await m.reply(
            `⚠️ Se encontraron *${targets.length}* usuarios para eliminar (solo en anuncios).\n\n` +
            previewLines.join('\n') +
            (targets.length > 10 ? `\n…y ${targets.length - 10} más` : '') +
            `\n\nPara proceder responde:\n*.confirmarlimpieza*\n\n_(La confirmación caduca en 5 min)_`
        );
        break;
    }

    case 'confirmarlimpieza': {
        if (!needAdmin(m) || !needBotAdmin(m)) return;
        global.__suppressGroupAnnounce = Date.now() + 60000;
        let meta; try { meta = await conn.groupMetadata(m.chat); } catch { /* */ }
        const communityJid = meta?.isCommunity ? m.chat : (meta?.linkedParent || m.chat);
        const pend = _pendingClean.get(communityJid);
        if (!pend || Date.now() - pend.ts > CLEAN_TTL) {
            _pendingClean.delete(communityJid);
            return m.reply('⌛ No hay una limpieza pendiente (o caducó). Usa .limpiarcomunidad primero.');
        }
        _pendingClean.delete(communityJid);
        // Expulsa desde el grupo de anuncios guardado en la vista previa.
        const res = await massRemove(conn, pend.announceJid || communityJid, pend.targets, pend.announceMeta);
        await m.reply(`🧹 *Limpieza completada*\n✅ Expulsados: ${res.ok}\n❌ Fallidos: ${res.fail}${res.reasons.length ? '\n\n' + res.reasons.slice(0, 8).join('\n') : ''}`);
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

// Expulsa una lista de JIDs desde `groupJid`; devuelve { ok, fail, reasons }.
// Resuelve cada JID a la forma canónica del participante y reporta el motivo
// real de cada fallo (no un genérico).
async function massRemove(conn, groupJid, jids, meta) {
    let ok = 0, fail = 0; const reasons = [];
    // Asegurar metadata del grupo de anuncios para resolución canónica.
    if (!meta?.participants) { try { meta = await conn.groupMetadata(groupJid); } catch { /* */ } }
    // Mapa número→participante considerando TODAS las identidades (LID/PN).
    const numToPart = new Map();
    for (const p of (meta?.participants || [])) for (const n of identityNums(p)) numToPart.set(n, p);

    // Pre-filtra y resuelve canónicos; recoge motivos antes de llamar a la API.
    const canonList = [];
    for (const jid of jids) {
        const num = String(jid).split('@')[0].split(':')[0];
        const p = numToPart.get(num);
        if (!p) { fail++; reasons.push(`(${num}): no pertenece al grupo de anuncios`); continue; }
        if (p.admin) { fail++; reasons.push(`(${num}): es admin`); continue; }
        canonList.push(p.id || jid);   // expulsar por el JID exacto del participante
    }
    const CHUNK = 5;
    for (let i = 0; i < canonList.length; i += CHUNK) {
        const slice = canonList.slice(i, i + CHUNK);
        try {
            const res = await conn.groupParticipantsUpdate(groupJid, slice, 'remove');
            if (Array.isArray(res)) {
                for (const r of res) {
                    const num = String(r?.jid || '').split('@')[0].split(':')[0];
                    if (r?.status === '200' || r?.status === 200) ok++;
                    else { fail++; reasons.push(`(${num}): ${r?.status === '403' ? 'sin permisos (bot no admin)' : 'error ' + (r?.status || '?')}`); }
                }
            } else ok += slice.length;
        } catch (e) {
            fail += slice.length;
            reasons.push(`lote ${i / CHUNK + 1}: ${String(e?.message || e).slice(0, 40)}`);
        }
    }
    return { ok, fail, reasons };
}

for (const meta of COMMAND_META) {
    const canonical = meta.names[0];
    command({ name: canonical, aliases: meta.names.slice(1), category: meta.category, description: meta.description },
        (conn, m, args, text) => execute(conn, m, canonical, args, text));
}

export { COMMAND_META };
export default true;
