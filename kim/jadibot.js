// kim/jadibot.js — Sistema de sub-bots (jadibot/serbot) adaptado a v7/ESM.
//
// Migración del sistema serbot/qr/sercode/stop/bots del proyecto de
// referencia (que usaba @whiskeysockets/baileys legacy en CommonJS).
// Aquí se reescribe para baileys v7 + ESM, reutilizando el MISMO Handler
// y los MISMOS anuncios del bot principal, de modo que cada sub-bot
// responde TODOS los comandos igual que el bot principal.
//
// Comandos asociados (registrados en commands_extra.js):
//   serbot / qr            → conecta un sub-bot por código QR
//   jadibot / sercode      → conecta un sub-bot por código de 8 dígitos
//   deljadibot / stop      → desconecta TU sub-bot
//   bots / listbots        → lista los sub-bots conectados

import makeWASocket, {
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion,
    Browsers,
    DisconnectReason,
    jidNormalizedUser,
    proto,
} from 'baileys';
import { Boom } from '@hapi/boom';
import NodeCache from 'node-cache';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

import { Handler } from './handler.js';
import { serializeConn } from './helpers.js';
import { attachAnnouncements } from './announcements.js';

const require = createRequire(import.meta.url);
const qrcode = require('qrcode-terminal');

const logger = pino({ level: 'silent' });
const JADI_ROOT = './jadibot';
const delay = (ms) => new Promise(r => setTimeout(r, ms));

// Lista global de sub-bots activos (también accesible vía global.conns).
global.conns = global.conns || [];

function sanitizeId(jid) {
    return String(jid || '').replace(/[^0-9]/g, '') || 'anon';
}

/**
 * Conecta un nuevo sub-bot para el usuario que ejecutó el comando.
 * @param {object} mainConn  conexión del bot principal (para enviar el QR/código al usuario)
 * @param {object} m         mensaje que disparó el comando
 * @param {boolean} useQR    true = QR ; false = código de 8 dígitos
 */
export async function startJadibot(mainConn, m, useQR = true) {
    const userJid = mainConn.decodeJid ? mainConn.decodeJid(m.sender) : m.sender;
    const id = sanitizeId(m.senderAlt || userJid);
    const authDir = path.join(JADI_ROOT, id);

    if (!fs.existsSync(JADI_ROOT)) fs.mkdirSync(JADI_ROOT, { recursive: true });
    if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

    // ¿Ya está conectado?
    if (global.conns.find(c => c.__jadiId === id && c.user)) {
        return m.reply('🌸 Ya tienes un sub-bot conectado. Usa *.stop* para desconectarlo.');
    }

    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();

    const groupCache = new NodeCache({ stdTTL: 0, useClones: false, maxKeys: 500 });
    const msgRetryCounterCache = new NodeCache({ stdTTL: 60, maxKeys: 1000 });
    const sentMessages = new Map();

    const sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: false,
        browser: useQR ? Browsers.windows('Chrome') : Browsers.ubuntu('Chrome'),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        markOnlineOnConnect: false,
        syncFullHistory: false,
        msgRetryCounterCache,
        cachedGroupMetadata: async (jid) => groupCache.get(jid),
        getMessage: async (key) => {
            const k = `${jidNormalizedUser(key.remoteJid)}:${key.id}`;
            return sentMessages.get(k) || proto.Message.create({});
        },
    });

    sock.public = true;
    sock.__jadiId = id;
    sock.__isJadiBot = true;
    serializeConn(sock);

    // Pairing por código de 8 dígitos.
    if (!useQR && !sock.authState.creds.registered) {
        await delay(2500);
        try {
            const phone = sanitizeId(m.senderAlt || userJid);
            const code = await sock.requestPairingCode(phone);
            const pretty = code?.match(/.{1,4}/g)?.join('-') || code;
            await m.reply(
                `🔐 *Código de vinculación de sub-bot*\n\n` +
                `Tu código: *${pretty}*\n\n` +
                `📱 WhatsApp ▸ Dispositivos vinculados ▸ Vincular con número.\n` +
                `Escribe los 8 caracteres (el guion no se escribe).`
            );
        } catch (e) {
            await m.reply('❌ No se pudo generar el código: ' + (e?.message || e));
        }
    }

    // Handler + anuncios: el sub-bot se comporta como el bot principal.
    const handler = new Handler(sock);
    handler.setRestart(() => {}); // los sub-bots no auto-reinician el proceso

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('messages.upsert', handler.onMessageUpsert);
    sock.ev.on('group-participants.update', handler.onGroupParticipantsUpdate);
    sock.ev.on('groups.update', handler.onGroupsUpdate);
    attachAnnouncements(sock);

    sock.ev.on('messages.upsert', ({ messages }) => {
        for (const mm of messages) {
            if (mm.key?.fromMe && mm.message) {
                const k = `${jidNormalizedUser(mm.key.remoteJid)}:${mm.key.id}`;
                sentMessages.set(k, mm.message);
                if (sentMessages.size > 300) sentMessages.delete(sentMessages.keys().next().value);
            }
        }
    });

    let qrSent = false;
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && useQR && !qrSent) {
            qrSent = true;
            try {
                // Enviar el QR como imagen al chat del usuario.
                const qrImg = await import('qrcode').then(m2 => m2.default).catch(() => null);
                if (qrImg) {
                    const buf = await qrImg.toBuffer(qr, { scale: 8, margin: 2 });
                    await mainConn.sendMessage(m.chat, {
                        image: buf,
                        caption: '📱 *Escanea este QR* para conectar tu sub-bot.\nWhatsApp ▸ Dispositivos vinculados ▸ Vincular dispositivo.\n⏱ ~45s antes de que expire.',
                    }, { quoted: m });
                } else {
                    qrcode.generate(qr, { small: true });
                    await m.reply('📱 QR generado en la consola del bot (instala "qrcode" para recibirlo por chat: npm i qrcode).');
                }
            } catch (e) {
                console.error('[jadibot] qr:', e?.message || e);
            }
        }

        if (connection === 'open') {
            if (!global.conns.includes(sock)) global.conns.push(sock);
            try { await mainConn.sendMessage(m.chat, { text: '✅ *Sub-bot conectado correctamente.* Ya responde comandos.' }, { quoted: m }); } catch { /* */ }
        }

        if (connection === 'close') {
            const code = (lastDisconnect?.error instanceof Boom
                ? lastDisconnect.error
                : new Boom(lastDisconnect?.error))?.output?.statusCode;
            global.conns = global.conns.filter(c => c !== sock);
            if (code === DisconnectReason.loggedOut || code === DisconnectReason.badSession) {
                try { fs.rmSync(authDir, { recursive: true, force: true }); } catch { /* */ }
            } else if (code !== DisconnectReason.connectionReplaced) {
                // Reintento simple
                await delay(3000);
                startJadibot(mainConn, m, useQR).catch(() => {});
            }
        }
    });

    return sock;
}

/** Desconecta el sub-bot del usuario que ejecuta el comando. */
export async function stopJadibot(mainConn, m) {
    const id = sanitizeId(m.senderAlt || (mainConn.decodeJid ? mainConn.decodeJid(m.sender) : m.sender));
    const sock = global.conns.find(c => c.__jadiId === id);
    if (!sock) return m.reply('🍃 No tienes ningún sub-bot conectado.');
    try {
        await sock.logout?.().catch(() => {});
        sock.ws?.close?.();
    } catch { /* */ }
    global.conns = global.conns.filter(c => c !== sock);
    try { fs.rmSync(path.join(JADI_ROOT, id), { recursive: true, force: true }); } catch { /* */ }
    return m.reply('✅ Tu sub-bot fue desconectado.');
}

/** Lista los sub-bots activos. */
export function listJadibots() {
    const active = global.conns.filter(c => c?.user && c?.ws?.socket?.readyState !== 3);
    if (!active.length) return '🤖 *Sub-bots conectados:* 0';
    const lines = active.map((c, i) =>
        `${i + 1}. ${c.user?.name || '•'} — wa.me/${(c.user?.id || '').replace(/[^0-9]/g, '')}`
    );
    return `🤖 *Sub-bots conectados:* ${active.length}\n\n${lines.join('\n')}`;
}
