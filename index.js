// index.js — Punto de entrada (ESM, Baileys v7).
//
// Filtro de warnings: silencia SOLO deprecaciones ruidosas de dependencias
// (p.ej. DEP0180 fs.Stats, que viene de un paquete transitivo y no de
// nuestro código), sin ocultar errores reales ni otros warnings útiles.
{
    const _emit = process.emitWarning.bind(process);
    const SILENCED = new Set(['DEP0180', 'DEP0190', 'DEP0040']);
    process.emitWarning = (warning, ...rest) => {
        const code = (rest[0] && typeof rest[0] === 'object' ? rest[0].code : rest[1]) || '';
        if (SILENCED.has(code)) return;
        if (typeof warning === 'string' && /DEP0180|fs\.Stats constructor/.test(warning)) return;
        return _emit(warning, ...rest);
    };
    process.removeAllListeners('warning');
    process.on('warning', (w) => {
        if (SILENCED.has(w?.code) || /fs\.Stats constructor/.test(w?.message || '')) return;
        if (w?.name === 'DeprecationWarning') return;
        console.warn(w?.message || w);
    });
}
//
// Lógica de PAIRING CODE corregida según un bot funcional de referencia:
//
//   • requestPairingCode() se llama FUERA del event handler de
//     connection.update, NO dentro. Esto contradice la doc oficial pero
//     es lo que SÍ funciona en la práctica. Llamarlo dentro del event
//     causaba que WhatsApp rechazara el código porque el WebSocket
//     todavía no había completado el handshake.
//
//   • Un `await delay(2500)` antes del requestPairingCode da tiempo al
//     handshake WS.
//
//   • Browser:
//       - Para PAIRING:  Browsers.ubuntu("Chrome")
//       - Para QR:       Browsers.windows("Chrome")
//     Estos son los identificadores que WhatsApp acepta sin chistar.
//
//   • El código se muestra CON guiones (Q3GS-FE7S), porque visualmente
//     es más legible. WhatsApp ignora el guion al escribirlo en su UI
//     de 8 casillas.

import './settings.js';
import './imagenes.js';

import makeWASocket, {
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion,
    Browsers,
    DisconnectReason,
    proto,
    jidNormalizedUser,
} from 'baileys';
import { Boom } from '@hapi/boom';
import NodeCache from 'node-cache';
import readline from 'readline';
import pino from 'pino';
import fs from 'fs';
import chalk from 'chalk';
import cfonts from 'cfonts';
import util from 'util';
import { createRequire } from 'module';

// FIX: qrcode-terminal no tiene exports ESM. createRequire es la única
// forma de cargarlo limpiamente en un proyecto ESM.
const require = createRequire(import.meta.url);
const qrcode = require('qrcode-terminal');

import { Handler } from './kim/handler.js';
import { serializeConn } from './kim/helpers.js';
import { initDB } from './kim/db.js';
import { attachAnnouncements } from './kim/announcements.js';
import { startAuthCare, stopAuthCare } from './kim/authcare.js';
import { startExpiryService, stopExpiryService } from './kim/subbots/expiry.js';

// ═══════════════════════════════════════════════════════════════════════
// FILTRO DE RUIDO DE LIBSIGNAL
// ═══════════════════════════════════════════════════════════════════════
// El paquete `libsignal` (dependencia de Baileys) registra mensajes internos
// del Signal Protocol con console.warn/error/info DIRECTOS — NO pasan por el
// logger pino de Baileys, así que `level:'silent'` no los silencia. Son
// funcionamiento normal del protocolo (sesiones que se abren/cierran/archivan,
// descifrado de backlog con sesión superada, etc.), no errores. Se filtran por
// defecto y pueden reactivarse con global.logFilter.showSignalMessages=true.
(() => {
    const NOISE = [
        // libsignal/src/session_cipher.js
        /Decrypted message with closed session/i,
        /Failed to decrypt message with any known session/i,
        /Session error:Error/i, /No matching sessions found for message/i,
        /No session record/i, /No sessions available/i,
        // libsignal/src/session_builder.js
        /Closing (open |stale open )?session/i,
        /Closing session in favor of incoming prekey bundle/i,
        // libsignal/src/session_record.js
        /Session already (closed|open)/i, /Opening session:/i,
        /Removing old closed session/i, /Migrating session to:/i,
        /V1 session storage migration/i,
        // libsignal/src/curve.js + queue_job.js
        /WARNING: Expected pubkey of length 33/i, /Unhandled bucket type/i,
        // genéricos de descifrado / stacks de libsignal
        /Bad MAC/i, /SessionEntry\s*\{/, /Failed to decrypt/i,
        /at Object\.verifyMAC/, /at SessionCipher\./,
        /at async _asyncQueueExecutor/, /libsignal[\/\\]src[\/\\]/,
    ];
    const safeInspect = (a) => { try { return util.inspect(a, { depth: 1 }).slice(0, 200); } catch { return ''; } };
    const isNoise = (args) => {
        // Interruptor de depuración: reactiva TODO el ruido de Signal.
        if (global.logFilter?.showSignalMessages === true) return false;
        for (const a of args) {
            const s = typeof a === 'string' ? a
                : (a?.stack || a?.message || (typeof a === 'object' ? safeInspect(a) : String(a)));
            for (const re of NOISE) if (re.test(s)) return true;
        }
        return false;
    };
    const _log = console.log.bind(console);
    const _err = console.error.bind(console);
    const _warn = console.warn.bind(console);
    console.log   = (...args) => { if (!isNoise(args)) _log(...args); };
    console.error = (...args) => { if (!isNoise(args)) _err(...args); };
    console.warn  = (...args) => { if (!isNoise(args)) _warn(...args); };
    console.info  = () => {};
})();

// ───────────────────────────────────────────────────────────────────────
const AUTH_PATH = './authFolder';
const DB_PATH = './database.json';
const MAX_RECONNECT = 10;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const logger = pino({ level: 'silent' });

global._isStarting = false;
global._reconnectAttempts = 0;
global.kim = null;
global.conn = null;

// ───────────────────────────────────────────────────────────────────────
function getOwnerJid() {
    const first = global.owner?.find(o => Array.isArray(o) && o[0]);
    return first ? `${first[0]}@s.whatsapp.net` : null;
}
async function notifyOwner(text) {
    const jid = getOwnerJid();
    if (!jid || !global.kim) return;
    try { await global.kim.sendMessage(jid, { text: String(text).slice(0, 1500) }); }
    catch (e) { console.error('[INDEX] notifyOwner:', e?.message || e); }
}

// ───────────────────────────────────────────────────────────────────────
// destroySocket — desmonta POR COMPLETO un socket anterior antes de crear
// otro. CAUSA RAÍZ de "Decrypted message with closed session" amplificado,
// creds.update duplicados y fugas: en cada reconexión se creaba un socket
// nuevo (con sus listeners, su saveCreds y sus timers) SIN cerrar el
// anterior. Varios sockets compartiendo el MISMO authFolder = múltiples
// escritores de creds/sesiones Signal → más apertura/cierre de sesiones,
// más eventos de "closed session" y carreras de escritura. Aquí se cierra
// el WebSocket, se quitan TODOS los listeners y se sueltan las referencias.
function destroySocket(sock) {
    if (!sock) return;
    try { sock.ev?.removeAllListeners?.(); } catch { /* */ }
    try { sock.ws?.removeAllListeners?.(); } catch { /* */ }
    try { sock.end?.(undefined); } catch { /* */ }
    try { sock.ws?.close?.(); } catch { /* */ }
}

process.on('uncaughtException', (err) => {
    console.error(chalk.redBright('[INDEX] uncaughtException:'), err);
    notifyOwner(`🔥 uncaughtException:\n${util.format(err).slice(0, 1500)}`);
});
process.on('unhandledRejection', (reason) => {
    console.error(chalk.redBright('[INDEX] unhandledRejection:'), reason);
    notifyOwner(`⚠️ unhandledRejection:\n${util.format(reason).slice(0, 1500)}`);
});

// ───────────────────────────────────────────────────────────────────────
// Sanitización de teléfono: solo dígitos. (La validación final la hace
// Baileys cuando llama requestPairingCode.)
function sanitizarTelefono(num) {
    return String(num || '').replace(/\D/g, '');
}

// ───────────────────────────────────────────────────────────────────────
// UI kawaii — selección de método
// ───────────────────────────────────────────────────────────────────────
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

async function obtenerOpcionConexion() {
    const lineM = '★∻∹⋰⋰ ☆∻∹⋰⋰ ★∻∹⋰⋰ ☆∻∹⋰⋰★∻∹⋰⋰ ☆∻∹⋰⋰';
    const linen = '✄ ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈';
    const prompt = `\n\n${lineM}\n
      ${chalk.blue.bgBlue.bold.cyan('🪷  mᥱ́𝗍᥆ძ᥆ ძᥱ ᥎іᥒᥴᥙᥣᥲᥴі᥆ᥒ 🪷 ')}\n
${lineM}\n
  ${chalk.blueBright('🎀 ꒷︶꒥‧˚૮꒰۵•▴•۵꒱ა‧˚꒷︶꒥🎀')}\n
${chalk.blueBright(linen)}\n
${chalk.green.bgMagenta.bold.yellow('🌟  һ᥆ᥣᥲ, һᥱrm᥆s᥊, ¿ᥴ᥆m᥆ 𝗊ᥙіᥱrᥱs ᥴ᥆ᥒᥱᥴ𝗍ᥲr𝗍ᥱ? 🌟 ')}\n
${chalk.bold.redBright('🍓  ▷ ᥱᥣᥱᥴᥴі᥆ᥒ ➊ :')} ${chalk.greenBright('ᥙsᥲ ᥙᥒ ᥴ᥆ძіg᥆ 🆀 🆁 .')}
${chalk.bold.redBright('🧸  ▷ ᥱᥣᥱᥴᥴі᥆ᥒ ➋ :')} ${chalk.greenBright('ᥙsᥲ ᥙᥒ ᥴ᥆ძіg᥆ ძᥱ 8 ძіgі𝗍᥆s.')}\n
${chalk.blueBright(linen)}\n
${chalk.italic.magenta('🍄 ¿𝗊ᥙᥱ́ ᥱᥣᥱᥴᥴі᥆ᥒ ᥱᥣᥱgіs𝗍ᥱ? ⍴᥆r𝖿іs ᥱsᥴrіᑲᥱ')}
${chalk.italic.magenta('s᥆ᥣ᥆ ᥱᥣ ᥒᥙ́mᥱr᥆ ძᥱ ᥣᥲ ᥱᥣᥱᥴᥴі᥆ᥒ. 🍄')}\n
${chalk.bold.magentaBright('---> ')}`;

    for (let i = 0; i < 5; i++) {
        const r = (await ask(prompt)).trim();
        if (/^[1-2]$/.test(r)) return r;
        console.log(chalk.bold.redBright('🌸 solo escribe 1 o 2 🌸'));
    }
    throw new Error('Demasiados intentos.');
}

async function obtenerNumeroTelefono() {
    const prompt = chalk.bgBlack(chalk.bold.greenBright(
        `\n  (≡^∇^≡) Introduce tu número de WhatsApp completo (con código de país).\n\n${chalk.bold.yellowBright('🫐  Por ejemplo (〃∀〃)ゞ🫐\n    ➥ +5211234567890')}\n${chalk.bold.magentaBright('---> ')}`
    ));
    for (let i = 0; i < 5; i++) {
        const raw = (await ask(prompt)).trim();
        const sanitized = sanitizarTelefono(raw);
        if (sanitized.length >= 10 && sanitized.length <= 15) return sanitized;
        console.log(chalk.bold.redBright('  Número inválido. Debe tener 10-15 dígitos con código de país.'));
    }
    throw new Error('Demasiados intentos.');
}

// ───────────────────────────────────────────────────────────────────────
let _bannerShown = false;
function mostrarBanner() {
    if (_bannerShown) return;
    _bannerShown = true;
    try {
        cfonts.say('KimdanBot-MD', { font: 'chrome', align: 'center', gradient: ['red', 'magenta'] });
        cfonts.say('BOT EN DESARROLLO', { font: 'console', align: 'center', gradient: ['red', 'magenta'] });
    } catch { /* hosts sin TTY */ }
}

// ───────────────────────────────────────────────────────────────────────
// crearSocket — crea el socket con los flags de v7.
// ───────────────────────────────────────────────────────────────────────
async function crearSocket({ version, useQR }) {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_PATH);

    // ─── CAUSA RAÍZ del "Cache max keys amount exceeded" ───
    // NodeCache con `maxKeys > 0` LANZA una excepción (ECACHEFULL) al hacer
    // .set() de una clave nueva cuando se alcanza el tope — NO descarta la
    // más vieja. Ese throw subía por el path de envío de Baileys y rompía el
    // procesamiento del comando en ese grupo (el bot "dejaba de responder").
    // Además `stdTTL: 0` hacía que las claves NO expiraran nunca, así que el
    // tope se alcanzaba inevitablemente con el tiempo.
    //
    // FIX REAL (sin subir límites ni ocultar con try/catch): sin `maxKeys`
    // (NodeCache nunca lanza) + TTL que expira entradas viejas + `checkperiod`
    // que las purga activamente. La memoria queda acotada por el TTL, no por
    // un tope rígido que rompe el bot.
    const groupCache         = new NodeCache({ stdTTL: 600,  useClones: false, checkperiod: 120 });
    const userDevicesCache   = new NodeCache({ stdTTL: 3600, useClones: false, checkperiod: 300 });
    const msgRetryCounterCache = new NodeCache({ stdTTL: 60, useClones: false, checkperiod: 30 });

    // LRU manual de mensajes propios para getMessage retries.
    const sentMessages = new Map();
    const SENT_LIMIT = 500;

    // Browser correcto para cada método (lo que SÍ acepta WhatsApp).
    const browser = useQR
        ? Browsers.windows('Chrome')
        : Browsers.ubuntu('Chrome');

    const conn = makeWASocket({
        version,
        logger,
        printQRInTerminal: false, // deprecado en v7 — manejado manualmente
        browser,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        // CAUSA RAÍZ de "myAppStateKey not present": con markOnlineOnConnect:true
        // el bot se marca ONLINE al conectar; cuando un cliente está online, el
        // teléfono NO entrega las notificaciones que tenía en cola (offline),
        // entre ellas el appStateSyncKeyShare con las claves de app-state que
        // chatModify → updateProfileName necesita. Así, creds.myAppStateKeyId
        // queda seteado pero la clave nunca llega al store y setnamebot falla.
        // FIX: false → el bot recibe primero TODO lo pendiente (incluidas las
        // claves) antes de marcarse online. Sigue respondiendo igual.
        markOnlineOnConnect: false,
        syncFullHistory: false,
        // Procesa el history-sync inicial (otra vía por la que pueden venir las
        // claves de app-state). No descarga el historial completo (eso lo
        // controla syncFullHistory, que queda en false).
        shouldSyncHistoryMessage: () => true,
        generateHighQualityLinkPreview: false,
        shouldIgnoreJid: (jid) => jid?.includes?.('@broadcast'),
        msgRetryCounterCache,
        userDevicesCache,
        cachedGroupMetadata: async (jid) => groupCache.get(jid),
        getMessage: async (key) => {
            const id = `${jidNormalizedUser(key.remoteJid)}:${key.id}`;
            return sentMessages.get(id) || proto.Message.create({});
        },
        defaultQueryTimeoutMs: 60_000,
        connectTimeoutMs: 60_000,
        keepAliveIntervalMs: 25_000,
        retryRequestDelayMs: 350,
        transactionOpts: { maxCommitRetries: 5, delayBetweenTriesMs: 1000 },
    });

    conn.public = true;

    // LRU de mensajes propios para getMessage callback
    conn.ev.on('messages.upsert', ({ messages }) => {
        for (const m of messages) {
            if (m.key.fromMe && m.message) {
                const id = `${jidNormalizedUser(m.key.remoteJid)}:${m.key.id}`;
                sentMessages.set(id, m.message);
                if (sentMessages.size > SENT_LIMIT) {
                    sentMessages.delete(sentMessages.keys().next().value);
                }
            }
        }
    });

    // Mantener groupCache fresco
    conn.ev.on('groups.update', async (updates) => {
        for (const u of updates) {
            if (u.id) {
                try { groupCache.set(u.id, await conn.groupMetadata(u.id)); } catch { /* */ }
            }
        }
    });
    conn.ev.on('group-participants.update', async (event) => {
        try { groupCache.set(event.id, await conn.groupMetadata(event.id)); } catch { /* */ }
    });

    return { conn, saveCreds };
}

// ───────────────────────────────────────────────────────────────────────
// start() — el flow correcto del pairing code
// ───────────────────────────────────────────────────────────────────────
async function start() {
    if (global._isStarting) {
        console.log(chalk.yellow('[INDEX] start() ya en curso, ignorado.'));
        return;
    }
    global._isStarting = true;

    // Desmonta cualquier socket previo ANTES de crear uno nuevo. Sin esto,
    // cada reconexión dejaba vivo el socket anterior (listeners + saveCreds +
    // timers duplicados) compartiendo el authFolder → inestabilidad de sesión.
    if (global.kim) { destroySocket(global.kim); global.kim = null; global.conn = null; }

    try {
        mostrarBanner();
        if (!global.db?.data) await initDB(DB_PATH);

        const credsExist = fs.existsSync(`${AUTH_PATH}/creds.json`);
        const argQR   = process.argv.includes('qr');
        const argCode = process.argv.includes('code');

        let useQR;
        let pairingPhone = null;

        if (credsExist) {
            useQR = false; // hay sesión: solo reconectamos
        } else if (argQR) {
            useQR = true;
        } else if (argCode) {
            useQR = false;
            pairingPhone = await obtenerNumeroTelefono();
        } else {
            const opcion = await obtenerOpcionConexion();
            useQR = opcion === '1';
            if (!useQR) pairingPhone = await obtenerNumeroTelefono();
        }

        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(chalk.cyan(`[INDEX] Baileys v${version.join('.')} (latest: ${isLatest})`));

        const { conn, saveCreds } = await crearSocket({ version, useQR });
        global.kim = conn;
        global.conn = conn;

        // ═════════════════════════════════════════════════════════════
        // PAIRING CODE — FUERA del event handler, ANTES de registrar
        // los demás listeners. Esta es la forma que SÍ funciona.
        // ═════════════════════════════════════════════════════════════
        if (!useQR && pairingPhone && !conn.authState.creds.registered) {
            // Delay crítico: da tiempo al handshake WS antes de solicitar
            // el código. Sin esto, WhatsApp lo recibe "demasiado pronto"
            // y lo rechaza.
            await delay(2500);
            try {
                console.log(chalk.yellow('[CONEXIÓN] Solicitando código de emparejamiento...'));
                const code = await conn.requestPairingCode(pairingPhone);
                // Con guiones porque visualmente es más legible. La UI de
                // WhatsApp ignora el guion al escribir.
                const codeFormat = code?.match(/.{1,4}/g)?.join('-') || code;

                console.log('');
                console.log(chalk.bold.bgMagenta(chalk.white(
                    '  (●\'▽ \'●)ゝ 🩷  CÓDIGO DE EMPAREJAMIENTO  🩷  '
                )));
                console.log('');
                console.log(chalk.bold.greenBright(`              ${codeFormat}`));
                console.log('');
                console.log(chalk.bold.yellow('📱 En WhatsApp:'));
                console.log(chalk.yellow('   Ajustes ▸ Dispositivos vinculados ▸ Vincular con número'));
                console.log(chalk.cyan('   Escribe los 8 caracteres (el guion no se escribe).'));
                console.log(chalk.bold.redBright('⏱  Tienes ~2 minutos antes de que expire.'));
                console.log('');
                console.log(chalk.gray('⏳ Esperando que confirmes en WhatsApp...'));
                console.log('');
            } catch (err) {
                console.error(chalk.red('[CONEXIÓN] Error solicitando pairing code:'), err?.message || err);
                console.log(chalk.yellow('💡 Posibles causas:'));
                console.log(chalk.yellow('   • El número no está registrado en WhatsApp'));
                console.log(chalk.yellow('   • Ya hay sesión activa (borra authFolder/ y reintenta)'));
                console.log(chalk.yellow('   • WhatsApp bloqueó temporalmente (espera unos minutos)'));
                console.log('');
            }
        }

        // ─ Helpers en conn (decodeJid, sendText, etc.) ─
        serializeConn(conn);

        // ─ Handler unificado y registro de listeners ─
        const handler = new Handler(conn);
        handler.setRestart(start);

        conn.ev.on('creds.update', saveCreds);
        conn.ev.on('connection.update', handler.onConnectionUpdate);
        conn.ev.on('messages.upsert', handler.onMessageUpsert);
        conn.ev.on('group-participants.update', handler.onGroupParticipantsUpdate);
        conn.ev.on('groups.update', handler.onGroupsUpdate);

        // Conecta los anuncios de grupo (welcome, bye, promote, demote,
        // cambios de subject/desc/icon). Módulo independiente: tocar
        // kim/announcements.js NO afecta al despachador.
        attachAnnouncements(conn);

        // ─ Mantenimiento de integridad del authFolder ─
        // NO poda claves por antigüedad (eso corrompía la sesión: ver la
        // cabecera de kim/authcare.js). Solo sanea archivos corruptos/vacíos
        // (torn writes) cada pocas horas. Baileys ya elimina cada clave cuando
        // deja de necesitarla; una carpeta grande es normal y sana.
        startAuthCare(AUTH_PATH);

        // ─ Servicio de expiración de licencias de sub-bots ─
        // Barrido indexado cada 10 min: cierra sesiones vencidas, libera
        // recursos y avisa al owner. Idempotente y con timer unref().
        startExpiryService({ notify: notifyOwner });

        // ─ Restaurar sub-bots persistidos al conectar el bot principal ─
        // (nueva arquitectura kim/subbots/: reconexión automática tolerante a fallos)
        conn.ev.on('connection.update', async (update) => {
            if (update.connection === 'open' && !conn.__subbotsRestored) {
                conn.__subbotsRestored = true;
                try {
                    const { restoreSubBots } = await import('./kim/jadibot.js');
                    await restoreSubBots(conn);
                } catch (e) { console.error('[index] restoreSubBots:', e?.message || e); }
            }
        });

        // ─ QR (si elegimos QR): se muestra cuando aparece ─
        if (useQR) {
            let qrShown = false;
            conn.ev.on('connection.update', (update) => {
                if (update.qr && !qrShown) {
                    qrShown = true;
                    console.log('');
                    console.log(chalk.bold.greenBright('╔══════════════════════════════════════════╗'));
                    console.log(chalk.bold.greenBright('║   📱  ESCANEA ESTE QR EN WHATSAPP        ║'));
                    console.log(chalk.bold.greenBright('╚══════════════════════════════════════════╝'));
                    qrcode.generate(update.qr, { small: true });
                    console.log(chalk.yellow('👉 Ajustes ▸ Dispositivos vinculados ▸ Vincular dispositivo'));
                    console.log(chalk.bold.yellow('⏱  Tienes ~45 segundos antes de que expire.\n'));
                }
                if (update.connection === 'open') qrShown = true; // permite refresh si la conexión se reabre
            });
        }

        console.log(chalk.cyan('[INDEX] Listeners registrados. Esperando confirmación de WhatsApp...'));
    } catch (err) {
        console.error(chalk.red('[INDEX] Error fatal en start():'), err);
        global._reconnectAttempts++;
        if (global._reconnectAttempts < MAX_RECONNECT) {
            const wait = Math.min(30000, 2000 * global._reconnectAttempts);
            console.log(chalk.yellow(
                `[INDEX] Reintentando en ${wait / 1000}s (${global._reconnectAttempts}/${MAX_RECONNECT})...`
            ));
            setTimeout(() => { global._isStarting = false; start(); }, wait);
        } else {
            console.error(chalk.red('[INDEX] Demasiados reintentos. Saliendo.'));
            if (!rl.closed) rl.close();
            process.exit(1);
        }
        return;
    } finally {
        global._isStarting = false;
    }
}

// ─── Cierre limpio ────────────────────────────────────────────────
function shutdown(signal) {
    console.log(chalk.yellow(`\n[INDEX] Cerrando bot (${signal})...`));
    try { stopAuthCare(); } catch { /* */ }
    try { stopExpiryService(); } catch { /* */ }
    // flushSync: escritura síncrona garantizada ANTES de salir. La versión
    // anterior llamaba flush() (async) y process.exit(0) no la esperaba,
    // así que los cambios de los últimos segundos podían perderse.
    if (global.db) try { global.db.flushSync?.(); } catch { /* */ }
    if (global.kim) try { destroySocket(global.kim); } catch { /* */ }
    if (!rl.closed) rl.close();
    process.exit(0);
}
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start();
