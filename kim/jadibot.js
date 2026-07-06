// kim/jadibot.js — Fachada pública del sistema de sub-bots.
// ─────────────────────────────────────────────────────────────────────
// Arquitectura modular (kim/subbots/):
//   • SubBotSession  → ciclo de vida + backoff + aislamiento por sesión.
//   • SubBotManager  → registro central, persistencia y restore-on-boot.
// Esta fachada expone las firmas que usan los comandos
// (startJadibot / stopJadibot / listJadibots) y delega en el manager.

import { createRequire } from 'module';
import { manager } from './subbots/index.js';
import { box } from './ui.js';

const require = createRequire(import.meta.url);

async function sendQR(mainConn, m, qr) {
    try {
        const qrImg = await import('qrcode').then(x => x.default).catch(() => null);
        if (qrImg) {
            const buf = await qrImg.toBuffer(qr, { scale: 8, margin: 2 });
            await mainConn.sendMessage(m.chat, {
                image: buf,
                caption: box('🔗 VINCULAR SUB-BOT', [
                    '📲 Escanea este código QR',
                    'WhatsApp ▸ Dispositivos vinculados',
                    '▸ Vincular un dispositivo',
                    '⏳ Expira en ~45 segundos',
                ]),
            }, { quoted: m });
        } else {
            const qrcode = require('qrcode-terminal');
            qrcode.generate(qr, { small: true });
            await m.reply('📱 QR generado en la consola del bot.');
        }
    } catch (e) { console.error('[jadibot] qr:', e?.message || e); }
}

/** Conecta un sub-bot para quien ejecuta el comando (QR o código). */
export async function startJadibot(mainConn, m, useQR = true) {
    const ownerJid = mainConn.decodeJid ? mainConn.decodeJid(m.sender) : m.sender;
    return manager.create({
        ownerJid: m.senderAlt || ownerJid,
        useQR,
        hooks: {
            onAlready: () => m.reply('🌸 Ya tienes un sub-bot activo. Usa *.stop* para desconectarlo.'),
            onQR: (qr) => sendQR(mainConn, m, qr),
            onCode: (pretty) => m.reply(box('🔐 CÓDIGO DE VINCULACIÓN', [
                `🔢 Código: *${pretty}*`,
                'WhatsApp ▸ Dispositivos vinculados',
                '▸ Vincular con número de teléfono',
                '✍️ Escribe los 8 caracteres (sin guion)',
            ])),
            onOpen: () => mainConn.sendMessage(m.chat, {
                text: box('✅ SUB-BOT CONECTADO', ['Tu sub-bot ya responde comandos 🎉', 'Gestiónalo con *.bots* y *.stop*']),
            }, { quoted: m }).catch(() => {}),
            onGiveup: () => m.reply('⚠️ No se pudo reconectar el sub-bot tras varios intentos.').catch(() => {}),
        },
    });
}

/** Desconecta el sub-bot del usuario. */
export async function stopJadibot(mainConn, m) {
    const ownerJid = mainConn.decodeJid ? mainConn.decodeJid(m.sender) : m.sender;
    const ok = await manager.stop(m.senderAlt || ownerJid);
    return m.reply(ok ? '✅ Tu sub-bot fue desconectado.' : '🍃 No tienes ningún sub-bot conectado.');
}

/** Texto con la lista de sub-bots activos (UI moderna). */
export function listJadibots() {
    const items = manager.list();
    if (!items.length) return box('🤖 SUB-BOTS ACTIVOS', ['No hay sub-bots conectados ahora mismo.']);
    const lines = items.map((it, i) => `${i + 1}. ${it.user?.name || '•'} — wa.me/${(it.user?.id || '').replace(/[^0-9]/g, '')}`);
    return box(`🤖 SUB-BOTS ACTIVOS · ${items.length}`, lines);
}

/** Reconecta los sub-bots persistidos al arrancar (lo llama index.js). */
export async function restoreSubBots(mainConn) {
    try {
        const n = await manager.restoreAll();
        if (n) console.log(`🤖 Sub-bots restaurados: ${n}`);
        return n;
    } catch (e) { console.error('[jadibot] restore:', e?.message || e); return 0; }
}

export { manager };
