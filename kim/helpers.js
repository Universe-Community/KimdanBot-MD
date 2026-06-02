// kim/helpers.js — Utilidades centrales (ESM, Baileys v7).
//
// Cambios respecto a la versión anterior (v6.7):
//   • ESM (`import` en vez de `require`).
//   • smsg() ya NO usa `proto.WebMessageInfo.fromObject()` porque v7
//     redujo el bundle de proto y solo expone `.create()`. Esto es un
//     breaking change documentado en https://baileys.wiki/docs/migration/to-v7.0.0
//   • Manejo de LIDs: en v7 los participantes de grupos pueden venir como
//     `xxx@lid` (Local ID, anónimo) en vez de `xxx@s.whatsapp.net`. El
//     mensaje trae también `participantAlt` con el JID alternativo (PN
//     si participant es LID, viceversa). Adjuntamos AMBOS al mensaje
//     serializado para que el handler pueda hacer owner-check con
//     cualquiera de los dos.

import {
    downloadContentFromMessage,
    jidDecode,
    areJidsSameUser,
    proto,
} from 'baileys';
import axios from 'axios';
import moment from 'moment-timezone';

// ─── Utilidades pequeñas ────────────────────────────────────────────────

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export const delay = sleep;

export const isUrl = (s) => {
    if (typeof s !== 'string') return false;
    try { new URL(s); return /^https?:\/\//i.test(s); } catch { return false; }
};

export const getRandom = (ext = '') => `${Math.floor(Math.random() * 1e8)}${ext}`;
export const pickRandom = (list) => list?.length ? list[Math.floor(Math.random() * list.length)] : undefined;

export const bytesToSize = (bytes, decimals = 2) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
};
export const formatp = bytesToSize;

export const runtime = (seconds) => {
    const n = Number(seconds);
    if (!isFinite(n) || n < 0) return '00:00:00';
    const h = Math.floor(n / 3600);
    const m = Math.floor((n % 3600) / 60);
    const s = Math.floor(n % 60);
    return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
};

export const clockString = (ms) => {
    if (isNaN(ms)) return '--:--:--';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
};

export const msToTime = (duration) => {
    const s = Math.floor((duration / 1000) % 60);
    const m = Math.floor((duration / 60000) % 60);
    const h = Math.floor((duration / 3600000) % 24);
    return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
};

export const getTime = (format = 'HH:mm:ss', date) => {
    const tz = global.place || 'America/Bogota';
    return (date ? moment(date) : moment()).tz(tz).format(format);
};

export const formatDate = (timestamp) => {
    const tz = global.place || 'America/Bogota';
    return moment(timestamp).tz(tz).format('DD/MM/YYYY HH:mm:ss');
};

export const tanggal = (timestamp) => {
    const tz = global.place || 'America/Bogota';
    const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const days = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
    const d = moment(timestamp || Date.now()).tz(tz).toDate();
    return `${days[d.getDay()]}, ${d.getDate()} de ${months[d.getMonth()]} de ${d.getFullYear()}`;
};

export const jsonformat = (obj) => JSON.stringify(obj, null, 2);
export const format = jsonformat;
export const logic = (a, b, c) => Boolean(a && b && c);

// ─── HTTP ────────────────────────────────────────────────────────────────

export const fetchJson = async (url, options = {}) => {
    try {
        const res = await axios({
            method: 'GET', url,
            timeout: options.timeout || 15000,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KimdanBot)', ...(options.headers || {}) },
            ...options,
        });
        return res.data;
    } catch (e) { console.error(`[fetchJson] ${url}: ${e.message}`); return null; }
};

export const getBuffer = async (url, options = {}) => {
    try {
        const res = await axios({
            method: 'GET', url, responseType: 'arraybuffer',
            timeout: options.timeout || 30000,
            headers: { 'User-Agent': 'Mozilla/5.0', ...(options.headers || {}) },
            ...options,
        });
        return Buffer.from(res.data);
    } catch (e) { console.error(`[getBuffer] ${url}: ${e.message}`); return null; }
};
export const fetchBuffer = getBuffer;

// ─── Mensajes WhatsApp ──────────────────────────────────────────────────

export const downloadMediaMessage = async (msgContent, type) => {
    const stream = await downloadContentFromMessage(msgContent, type);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
};

export const parseMention = (text = '') =>
    [...String(text).matchAll(/@([0-9]{5,16}|0)/g)].map(v => v[1] + '@s.whatsapp.net');

// IMPORTANTE: getGroupAdmins debe funcionar con LIDs Y con phone-numbers.
// En v7, `participants[i].id` puede ser LID o PN. Algunos participantes
// también traen `.lid` o `.phoneNumber` como forma alternativa. Recogemos
// TODAS las formas para que la comparación contra m.sender / m.senderAlt
// funcione sin importar en qué formato venga cada lado.
export const getGroupAdmins = (participants = []) => {
    const out = [];
    for (const p of participants) {
        if (p?.admin !== 'admin' && p?.admin !== 'superadmin') continue;
        if (p.id)          out.push(p.id);
        if (p.lid && p.lid !== p.id)                   out.push(p.lid);
        if (p.phoneNumber && p.phoneNumber !== p.id)   out.push(p.phoneNumber);
        if (p.jid && p.jid !== p.id)                   out.push(p.jid);
    }
    return out;
};

// ─── smsg: serializa un mensaje crudo (LID-aware, v7) ──────────────────

export function smsg(conn, raw, store) {
    if (!raw) return null;
    // En v7 usamos proto.WebMessageInfo.create() — fromObject() ya no existe.
    let m = raw.key ? proto.WebMessageInfo.create(raw) : raw;
    if (!m.key) return null;

    // ── Identidad ──
    m.id = m.key.id;
    m.chat = (conn.decodeJid || (j => j))(m.key.remoteJid);
    m.fromMe = !!m.key.fromMe;
    m.isGroup = m.chat?.endsWith('@g.us');

    // m.sender es el participant del grupo (LID o PN). Para DMs sigue siendo
    // el remoteJid. Para mensajes propios, es la cuenta del bot.
    m.sender = (conn.decodeJid || (j => j))(
        m.fromMe ? conn.user?.id : (m.key.participant || m.chat)
    );

    // ── LID/PN: en v7 viene `participantAlt` como el JID alternativo.
    // Si participant es LID, participantAlt es PN, y viceversa. Si no
    // viene, lo dejamos como m.sender.
    m.senderAlt = (conn.decodeJid || (j => j))(
        m.key.participantAlt || m.key.participantPn || m.sender
    );
    m.isLid = m.sender?.endsWith?.('@lid') || false;

    m.isBaileys = m.id?.startsWith('BAE5') || m.id?.startsWith('3EB0');

    if (!m.message) return m;

    // ── Desenvuelve ephemeral / view-once ──
    let message = m.message;
    if (message.ephemeralMessage?.message) message = message.ephemeralMessage.message;
    if (message.viewOnceMessageV2?.message) message = message.viewOnceMessageV2.message;
    if (message.viewOnceMessage?.message) message = message.viewOnceMessage.message;
    if (message.documentWithCaptionMessage?.message) message = message.documentWithCaptionMessage.message;
    m.message = message;

    // ── Pick mtype correctamente ──
    // FIX: si message tiene `{ senderKeyDistributionMessage, conversation }`,
    // queremos que mtype sea 'conversation' (el contenido real), no la key
    // de cripto. Filtramos las keys meta antes de elegir.
    const META_KEYS = new Set([
        'senderKeyDistributionMessage',
        'messageContextInfo',
    ]);
    const allKeys = Object.keys(message);
    const realKeys = allKeys.filter(k => !META_KEYS.has(k));
    m.mtype = realKeys[0] || allKeys[0];
    m.msg = message[m.mtype];

    // ── Texto ──
    let text = '';
    if (m.mtype === 'conversation') text = message.conversation;
    else if (m.mtype === 'extendedTextMessage') text = m.msg?.text;
    else if (m.msg?.caption) text = m.msg.caption;
    else if (m.mtype === 'buttonsResponseMessage') text = m.msg?.selectedButtonId;
    else if (m.mtype === 'listResponseMessage') text = m.msg?.singleSelectReply?.selectedRowId;
    else if (m.mtype === 'templateButtonReplyMessage') text = m.msg?.selectedId;
    m.body = text || '';
    m.text = text || '';

    // ── Mensaje citado ──
    const ctx = m.msg?.contextInfo;
    if (ctx?.quotedMessage) {
        // En v7 usamos proto.WebMessageInfo.create()
        const qProto = proto.WebMessageInfo.create({
            key: {
                remoteJid: m.chat,
                fromMe: areJidsSameUser(ctx.participant, conn.user?.id),
                id: ctx.stanzaId,
                participant: m.isGroup ? ctx.participant : undefined,
            },
            message: ctx.quotedMessage,
        });
        m.quoted = smsg(conn, qProto, store);
    } else {
        m.quoted = null;
    }
    m.mentionedJid = ctx?.mentionedJid || [];

    // ── Download helper ──
    if (m.msg?.url && /imageMessage|videoMessage|audioMessage|stickerMessage|documentMessage/.test(m.mtype)) {
        m.download = () => downloadMediaMessage(m.msg, m.mtype.replace('Message', ''));
    }

    // ── Helpers de respuesta ──
    m.reply = (text, jid, opts = {}) => conn.sendMessage(
        jid || m.chat,
        { text: String(text), mentions: parseMention(String(text)), ...opts },
        { quoted: m, ...opts }
    );

    m.react = (emoji) => conn.sendMessage(m.chat, { react: { text: emoji, key: m.key } });

    return m;
}

// ─── serializeConn: enriquece la instancia con métodos ────────────────

export function serializeConn(conn) {
    if (!conn || conn.__serialized) return;
    conn.__serialized = true;

    conn.decodeJid = (jid) => {
        if (!jid || typeof jid !== 'string') return jid || '';
        if (/:\d+@/.test(jid)) {
            const d = jidDecode(jid) || {};
            return (d.user && d.server) ? `${d.user}@${d.server}` : jid;
        }
        return jid;
    };

    conn.parseMention = parseMention;

    conn.getName = async (jid) => {
        const id = conn.decodeJid(jid);
        if (!id) return '';
        if (id.endsWith('@g.us')) {
            try {
                const meta = await conn.groupMetadata(id);
                return meta?.subject || id;
            } catch { return id; }
        }
        if (id === '0@s.whatsapp.net') return 'WhatsApp';
        if (conn.user?.id && id === conn.decodeJid(conn.user.id)) return conn.user.name || conn.user.verifiedName || '';
        return '+' + id.replace(/@(s\.whatsapp\.net|lid)/, '').replace(/[^0-9]/g, '');
    };

    conn.sendText = (jid, text, quoted = null, opts = {}) => conn.sendMessage(
        jid,
        { text: String(text), mentions: parseMention(String(text)), ...opts },
        quoted ? { quoted, ...opts } : opts
    );

    conn.sendImage = async (jid, src, caption = '', quoted = null, opts = {}) => {
        const buffer = Buffer.isBuffer(src) ? src : (isUrl(src) ? await getBuffer(src) : null);
        if (!buffer) throw new Error('sendImage: no se pudo obtener el buffer.');
        return conn.sendMessage(
            jid,
            { image: buffer, caption: String(caption || ''), mimetype: 'image/jpeg', ...opts },
            quoted ? { quoted, ...opts } : opts
        );
    };

    conn.sendVideo = async (jid, src, caption = '', quoted = null, opts = {}) => {
        const buffer = Buffer.isBuffer(src) ? src : (isUrl(src) ? await getBuffer(src) : null);
        if (!buffer) throw new Error('sendVideo: no se pudo obtener el buffer.');
        return conn.sendMessage(
            jid,
            { video: buffer, caption: String(caption || ''), mimetype: 'video/mp4', ...opts },
            quoted ? { quoted, ...opts } : opts
        );
    };

    conn.sendFile = async (jid, src, fileName = 'file', caption = '', quoted = null, asDoc = true, opts = {}) => {
        const buffer = Buffer.isBuffer(src) ? src : (isUrl(src) ? await getBuffer(src) : null);
        if (!buffer) throw new Error('sendFile: no se pudo obtener el buffer.');
        return conn.sendMessage(
            jid,
            { document: buffer, fileName, caption: String(caption || ''), mimetype: 'application/octet-stream', ...opts },
            quoted ? { quoted, ...opts } : opts
        );
    };

    // ── Stickers (adaptado a v7) ──────────────────────────────────
    // Reemplaza los métodos legacy `sendImageAsSticker`/`sendVideoAsSticker`
    // del bot de referencia, que dependían de `node-webpmux` + jimp. Aquí:
    //   • Imagen → webp 512×512 con `sharp` (import dinámico, opcional).
    //   • Video/gif → webp animado con `ffmpeg` (binario del sistema).
    // Si la herramienta no está instalada, lanzan un Error claro que el
    // comando captura y muestra al usuario (sin tumbar el bot).
    conn.sendImageAsSticker = async (jid, src, quoted = null, opts = {}) => {
        const input = Buffer.isBuffer(src) ? src : (isUrl(src) ? await getBuffer(src) : null);
        if (!input) throw new Error('sendImageAsSticker: no se pudo obtener el buffer.');
        let webp;
        try {
            const sharp = (await import('sharp')).default;
            webp = await sharp(input)
                .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .webp({ quality: 90 })
                .toBuffer();
        } catch (e) {
            if (/Cannot find package|ERR_MODULE_NOT_FOUND/i.test(String(e?.message || e))) {
                throw new Error('Falta la dependencia "sharp". Instálala con:  npm i sharp');
            }
            throw e;
        }
        return conn.sendMessage(jid, { sticker: webp, ...opts }, quoted ? { quoted } : {});
    };

    conn.sendVideoAsSticker = async (jid, src, quoted = null, opts = {}) => {
        const input = Buffer.isBuffer(src) ? src : (isUrl(src) ? await getBuffer(src) : null);
        if (!input) throw new Error('sendVideoAsSticker: no se pudo obtener el buffer.');
        const { spawn } = await import('child_process');
        const fsp = await import('fs');
        const os = (await import('os')).default;
        const path = (await import('path')).default;
        const tmpIn  = path.join(os.tmpdir(), `kim_${Date.now()}.mp4`);
        const tmpOut = path.join(os.tmpdir(), `kim_${Date.now()}.webp`);
        await fsp.promises.writeFile(tmpIn, input);
        const webp = await new Promise((resolve, reject) => {
            const ff = spawn('ffmpeg', [
                '-y', '-i', tmpIn,
                '-vcodec', 'libwebp', '-vf',
                "scale='min(512,iw)':min'(512,ih)':force_original_aspect_ratio=decrease,fps=15,pad=512:512:'(512-iw)/2':'(512-ih)/2':color=#00000000,split[a][b];[a]palettegen=reserve_transparent=on:transparency_color=ffffff[p];[b][p]paletteuse",
                '-loop', '0', '-preset', 'default', '-an', '-vsync', '0', '-t', '10',
                tmpOut,
            ]);
            ff.on('error', (err) =>
                reject(/ENOENT/.test(String(err?.message || err))
                    ? new Error('Falta "ffmpeg" en el sistema para stickers de video.')
                    : err));
            ff.on('close', async (code) => {
                try {
                    if (code !== 0) return reject(new Error('ffmpeg falló (código ' + code + ').'));
                    resolve(await fsp.promises.readFile(tmpOut));
                } catch (e) { reject(e); }
                finally {
                    fsp.promises.unlink(tmpIn).catch(() => {});
                    fsp.promises.unlink(tmpOut).catch(() => {});
                }
            });
        });
        return conn.sendMessage(jid, { sticker: webp, ...opts }, quoted ? { quoted } : {});
    };

    if (conn.user) conn.user.jid = conn.decodeJid(conn.user.id);
}

// ─────────────────────────────────────────────────────────────────────
// Resiliencia ante APIs frágiles: cadenas de proveedores.
// En vez de depender de UN solo endpoint, se prueban varios en orden y
// se usa el primero que responda con datos válidos. Reduce caídas por
// dependencia de terceros (un proveedor muerto ya no rompe el comando).

/**
 * Prueba endpoints en secuencia hasta que `extract(data)` devuelva algo.
 * @param {Array<{url:string, extract:(d:any)=>any}>} providers
 * @param {object} opts { timeout }
 * @returns el primer valor no nulo extraído, o null si todos fallan.
 */
export async function tryProviders(providers, { timeout = 30000 } = {}) {
    for (const p of providers) {
        try {
            const ctrl = new AbortController();
            const to = setTimeout(() => ctrl.abort(), timeout);
            const res = await fetch(p.url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
            clearTimeout(to);
            if (!res.ok) continue;
            const ct = res.headers.get('content-type') || '';
            const data = ct.includes('json') ? await res.json() : await res.text();
            const out = p.extract ? p.extract(data) : data;
            if (out) return out;
        } catch { /* probar siguiente proveedor */ }
    }
    return null;
}

/** Descarga de audio de YouTube probando varios proveedores. */
export async function ytAudioUrl(videoUrl) {
    const u = encodeURIComponent(videoUrl);
    return tryProviders([
        { url: `https://api.vreden.my.id/api/ytmp3?url=${u}`, extract: d => d?.result?.download?.url || d?.result?.url },
        { url: `https://api.zm.io.vn/api/ytmp3?url=${u}`,     extract: d => d?.result?.url || d?.url },
        { url: `https://youtube-dl.kr/api/ytmp3?url=${u}`,    extract: d => d?.url || d?.result },
    ], { timeout: 45000 });
}
/** Descarga de video de YouTube probando varios proveedores. */
export async function ytVideoUrl(videoUrl) {
    const u = encodeURIComponent(videoUrl);
    return tryProviders([
        { url: `https://api.vreden.my.id/api/ytmp4?url=${u}`, extract: d => d?.result?.download?.url || d?.result?.url },
        { url: `https://api.zm.io.vn/api/ytmp4?url=${u}`,     extract: d => d?.result?.url || d?.url },
    ], { timeout: 60000 });
}
