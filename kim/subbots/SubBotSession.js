// kim/subbots/SubBotSession.js
// ─────────────────────────────────────────────────────────────────────
// Una SubBotSession encapsula TODO el ciclo de vida de un sub-bot:
// su socket Baileys, su estado de autenticación, su caché privada, su
// política de reconexión (backoff exponencial con jitter) y su handler
// aislado. Cada sesión es independiente: su memoria, su caché y sus
// reconexiones no tocan a ninguna otra sesión ni al bot principal.
//
// Diseño nuevo (no hereda de la implementación anterior):
//   • Máquina de estados explícita: idle → pairing → open → closing →
//     closed / dead.  Las transiciones son la única forma de mutar estado.
//   • EventEmitter: el gestor se suscribe a 'qr', 'code', 'open', 'close',
//     'state' sin acoplarse a los detalles internos.
//   • Reconexión con backoff (1s, 2s, 4s … máx 60s) + jitter, tope de
//     intentos configurable; loggedOut/badSession ⇒ no reconecta y purga.
//   • Caché privada acotada (LRU) por sesión para getMessage; sin fugas.
//   • Cierre limpio: remueve TODOS los listeners y libera timers.

import EventEmitter from 'events';
import fs from 'fs';
import path from 'path';
import makeWASocket, {
    useMultiFileAuthState, makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion, Browsers, DisconnectReason,
    jidNormalizedUser, proto,
} from 'baileys';
import { Boom } from '@hapi/boom';
import NodeCache from 'node-cache';
import pino from 'pino';

import { Handler } from '../handler.js';
import { serializeConn } from '../helpers.js';
import { attachAnnouncements } from '../announcements.js';

const logger = pino({ level: 'silent' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export const STATE = Object.freeze({
    IDLE: 'idle', PAIRING: 'pairing', OPEN: 'open',
    CLOSING: 'closing', CLOSED: 'closed', DEAD: 'dead',
});

// LRU mínima y acotada para getMessage (evita Map sin tope → fuga de RAM).
class LRU {
    constructor(max = 200) { this.max = max; this.map = new Map(); }
    get(k) { if (!this.map.has(k)) return undefined; const v = this.map.get(k); this.map.delete(k); this.map.set(k, v); return v; }
    set(k, v) { if (this.map.has(k)) this.map.delete(k); this.map.set(k, v); if (this.map.size > this.max) this.map.delete(this.map.keys().next().value); }
    clear() { this.map.clear(); }
}

export class SubBotSession extends EventEmitter {
    /**
     * @param {object} opts
     * @param {string} opts.id        identificador estable (número del dueño)
     * @param {string} opts.authDir   carpeta de credenciales multi-file
     * @param {string} opts.ownerJid  jid del dueño del sub-bot
     * @param {boolean} opts.useQR     true=QR, false=código de emparejamiento
     * @param {number} opts.maxRetries tope de reconexiones (def. 8)
     */
    constructor({ id, authDir, ownerJid, useQR = true, maxRetries = 8 }) {
        super();
        this.id = id;
        this.authDir = authDir;
        this.ownerJid = ownerJid;
        this.useQR = useQR;
        this.maxRetries = maxRetries;

        this.sock = null;
        this.state = STATE.IDLE;
        this.retries = 0;
        this.createdAt = Date.now();
        this.lastOpenAt = 0;
        this._msgCache = new LRU(200);
        this._groupCache = new NodeCache({ stdTTL: 300, useClones: false, maxKeys: 500 });
        this._listeners = [];     // [ [emitter, event, fn] ] para limpieza total
        this._reconnectTimer = null;
        this._destroyed = false;
    }

    _setState(s) { if (this.state !== s) { this.state = s; this.emit('state', s); } }

    // Registra un listener y lo recuerda para poder removerlo en el cierre.
    _on(emitter, event, fn) { emitter.on(event, fn); this._listeners.push([emitter, event, fn]); }
    _clearListeners() {
        for (const [emitter, event, fn] of this._listeners) {
            try { emitter.off ? emitter.off(event, fn) : emitter.removeListener(event, fn); } catch { /* */ }
        }
        this._listeners = [];
    }

    isAlive() { return this.state === STATE.OPEN && this.sock?.ws?.socket?.readyState !== 3; }

    async start() {
        if (this._destroyed) throw new Error('Sesión destruida; crea una nueva.');
        if (!fs.existsSync(this.authDir)) fs.mkdirSync(this.authDir, { recursive: true });

        const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
        const { version } = await fetchLatestBaileysVersion();
        this._saveCreds = saveCreds;

        const sock = makeWASocket({
            version, logger, printQRInTerminal: false,
            browser: this.useQR ? Browsers.macOS('Safari') : Browsers.ubuntu('Chrome'),
            auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
            markOnlineOnConnect: false,
            syncFullHistory: false,
            msgRetryCounterCache: new NodeCache({ stdTTL: 60, maxKeys: 1000 }),
            cachedGroupMetadata: async (jid) => this._groupCache.get(jid),
            getMessage: async (key) => {
                const k = `${jidNormalizedUser(key.remoteJid)}:${key.id}`;
                return this._msgCache.get(k) || proto.Message.create({});
            },
        });
        sock.public = true;
        sock.__subbot = this;          // referencia inversa, sin globals
        sock.__jadiId = this.id;        // compat con código que lo lee
        sock.__isJadiBot = true;
        serializeConn(sock);
        this.sock = sock;

        // Handler aislado: un throw aquí jamás escala fuera de esta sesión.
        const handler = new Handler(sock);
        handler.setRestart(() => {});
        const isolate = (fn, label) => async (...a) => {
            try { return await fn(...a); }
            catch (e) { console.error(`[subbot:${this.id}] ${label}:`, e?.message || e); }
        };
        this._on(sock.ev, 'creds.update', saveCreds);
        this._on(sock.ev, 'messages.upsert', isolate(handler.onMessageUpsert, 'upsert'));
        this._on(sock.ev, 'group-participants.update', isolate(handler.onGroupParticipantsUpdate, 'gp'));
        this._on(sock.ev, 'groups.update', isolate(handler.onGroupsUpdate, 'groups'));
        attachAnnouncements(sock);

        // Cache de mensajes propios (para reenvíos / getMessage).
        this._on(sock.ev, 'messages.upsert', ({ messages }) => {
            for (const mm of messages) {
                if (mm.key?.fromMe && mm.message) {
                    this._msgCache.set(`${jidNormalizedUser(mm.key.remoteJid)}:${mm.key.id}`, mm.message);
                }
            }
        });

        this._wireConnection();

        // Emparejamiento por código si corresponde.
        if (!this.useQR && !sock.authState.creds.registered) {
            await sleep(2500);
            try {
                const code = await sock.requestPairingCode(String(this.id).replace(/[^0-9]/g, ''));
                this.emit('code', code?.match(/.{1,4}/g)?.join('-') || code);
            } catch (e) { this.emit('error', e); }
        }
        this._setState(STATE.PAIRING);
        return this;
    }

    _wireConnection() {
        let qrEmitted = false;
        this._on(this.sock.ev, 'connection.update', async (u) => {
            const { connection, lastDisconnect, qr } = u;
            if (qr && this.useQR && !qrEmitted) { qrEmitted = true; this.emit('qr', qr); }

            if (connection === 'open') {
                this.retries = 0;
                this.lastOpenAt = Date.now();
                this._setState(STATE.OPEN);
                this.emit('open');
            }
            if (connection === 'close') {
                const err = lastDisconnect?.error;
                const code = (err instanceof Boom ? err.output?.statusCode : undefined)
                    ?? err?.output?.statusCode
                    ?? err?.output?.payload?.statusCode
                    ?? err?.statusCode;
                const fatal = code === DisconnectReason.loggedOut || code === DisconnectReason.badSession;
                this._setState(STATE.CLOSED);
                this.emit('close', { code, fatal });

                if (this._destroyed || fatal) {
                    if (fatal) this._purgeAuth();
                    this._setState(STATE.DEAD);
                    return;
                }
                if (code === DisconnectReason.connectionReplaced) { this._setState(STATE.DEAD); return; }
                this._scheduleReconnect();
            }
        });
    }

    _scheduleReconnect() {
        if (this._destroyed) return;
        if (this.retries >= this.maxRetries) { this._setState(STATE.DEAD); this.emit('giveup'); return; }
        const base = Math.min(60000, 1000 * 2 ** this.retries);
        const jitter = Math.floor(Math.random() * 1000);
        const wait = base + jitter;
        this.retries++;
        this._reconnectTimer = setTimeout(() => {
            this._clearListeners();
            this.start().catch((e) => { console.error(`[subbot:${this.id}] reconnect:`, e?.message || e); this._scheduleReconnect(); });
        }, wait);
    }

    _purgeAuth() { try { fs.rmSync(this.authDir, { recursive: true, force: true }); } catch { /* */ } }

    async stop({ purge = true } = {}) {
        this._destroyed = true;
        this._setState(STATE.CLOSING);
        if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
        try { await this.sock?.logout?.().catch(() => {}); } catch { /* */ }
        try { this.sock?.ws?.close?.(); } catch { /* */ }
        this._clearListeners();
        this._msgCache.clear();
        this._groupCache.flushAll();
        if (purge) this._purgeAuth();
        this._setState(STATE.DEAD);
    }

    info() {
        return {
            id: this.id,
            state: this.state,
            user: this.sock?.user ? { id: this.sock.user.id, name: this.sock.user.name } : null,
            retries: this.retries,
            uptime: this.lastOpenAt ? Date.now() - this.lastOpenAt : 0,
        };
    }
}
