// kim/anonchat.js — Chat anónimo 1:1 por privado (ESM).
// ─────────────────────────────────────────────────────────────────────
// Dos personas que escriben al bot en privado se emparejan al azar y
// conversan de forma anónima: el bot reenvía los mensajes de una a la
// otra sin revelar números ni nombres.
//
//   .anonimo    → entra a la cola / se empareja
//   .siguiente  → corta la charla actual y busca otra pareja
//   .salirchat  → sale del chat anónimo
//
// El reenvío lo hace relayAnonMessage(), invocado desde el middleware
// para mensajes PRIVADOS sin prefijo. Devuelve true si consumió el
// mensaje (para cortar el pipeline).

const rooms = new Map();          // id → { id, a, b, state }
const IDLE_TTL = 60 * 60 * 1000;  // salas zombis > 1h se purgan

function findRoomOf(jid) {
    for (const r of rooms.values()) if (r.a === jid || r.b === jid) return r;
    return null;
}
function otherOf(room, jid) { return jid === room.a ? room.b : room.a; }

setInterval(() => {
    const cutoff = Date.now() - IDLE_TTL;
    for (const [id, r] of rooms) if ((r.lastAt || r.id) < cutoff) rooms.delete(id);
}, 30 * 60 * 1000).unref();

/** ¿Este JID está en un chat anónimo activo o en cola? */
export function inAnonChat(jid) { return !!findRoomOf(jid); }

/** Entra a la cola / se empareja. Devuelve el texto de respuesta. */
export async function anonStart(conn, jid) {
    if (findRoomOf(jid)) {
        return '🎭 Ya estás en el chat anónimo.\n₊˚ *.siguiente* → cambiar de pareja\n₊˚ *.salirchat* → salir';
    }
    const waiting = [...rooms.values()].find(r => r.state === 'WAITING' && r.a !== jid);
    if (waiting) {
        waiting.b = jid;
        waiting.state = 'CHATTING';
        waiting.lastAt = Date.now();
        const msg = '🎭 *¡Pareja encontrada!* 💜\n\n🍓 Todo lo que escribas aquí se reenvía de forma anónima.\n₊˚ *.siguiente* → otra pareja · *.salirchat* → salir';
        await conn.sendMessage(waiting.a, { text: msg }).catch(() => {});
        return msg;
    }
    const id = Date.now();
    rooms.set(id, { id, a: jid, b: '', state: 'WAITING', lastAt: Date.now() });
    return '🎭 *Chat anónimo* 💜\n\n⏳ Buscando pareja… te aviso en cuanto alguien más entre.\n₊˚ *.salirchat* para cancelar.';
}

/** Sale del chat (o de la cola). Devuelve el texto de respuesta. */
export async function anonLeave(conn, jid) {
    const room = findRoomOf(jid);
    if (!room) return '🍃 No estás en el chat anónimo. Usa *.anonimo* para entrar.';
    rooms.delete(room.id);
    const other = otherOf(room, jid);
    if (other) {
        await conn.sendMessage(other, {
            text: '💔 Tu pareja anónima se fue del chat.\n₊˚ *.anonimo* para buscar otra 💜',
        }).catch(() => {});
    }
    return '👋 Saliste del chat anónimo. ¡Vuelve cuando quieras! 💜';
}

/** Corta la charla actual y busca otra pareja. */
export async function anonNext(conn, jid) {
    const room = findRoomOf(jid);
    if (room) {
        rooms.delete(room.id);
        const other = otherOf(room, jid);
        if (other) {
            await conn.sendMessage(other, {
                text: '💔 Tu pareja anónima pasó a la siguiente.\n₊˚ *.anonimo* para buscar otra 💜',
            }).catch(() => {});
        }
    }
    return anonStart(conn, jid);
}

/**
 * Reenvía un mensaje privado sin prefijo a la pareja anónima.
 * true → consumido (cortar pipeline) · false → seguir normal.
 */
export async function relayAnonMessage(conn, m) {
    if (m.isGroup || m.fromMe) return false;
    const room = findRoomOf(m.sender);
    if (!room || room.state !== 'CHATTING') return false;
    const other = otherOf(room, m.sender);
    if (!other) return false;
    room.lastAt = Date.now();
    try {
        const mime = m.msg?.mimetype || '';
        if (m.download && /image|video|audio|sticker/.test(m.mtype || '')) {
            const buf = await m.download().catch(() => null);
            if (buf) {
                const caption = m.msg?.caption ? `🎭 ${m.msg.caption}` : '🎭';
                if (m.mtype === 'imageMessage')   await conn.sendMessage(other, { image: buf, caption });
                else if (m.mtype === 'videoMessage') await conn.sendMessage(other, { video: buf, caption, mimetype: 'video/mp4' });
                else if (m.mtype === 'stickerMessage') await conn.sendMessage(other, { sticker: buf });
                else if (m.mtype === 'audioMessage') await conn.sendMessage(other, { audio: buf, mimetype: mime || 'audio/mpeg', ptt: !!m.msg?.ptt });
                return true;
            }
        }
        if (m.text) { await conn.sendMessage(other, { text: `🎭 ${m.text}` }); return true; }
    } catch { /* no romper el pipeline */ }
    return true; // estaba en sala: el mensaje no debe seguir al resto del bot
}
