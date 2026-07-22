// kim/subbots/SubBotManager.js
// ─────────────────────────────────────────────────────────────────────
// Registro central de sub-bots. Responsabilidades:
//   • Crear / detener / consultar sesiones (una por dueño).
//   • Mantener un índice persistente en disco (subbots/registry.json) para
//     poder RECONECTAR los sub-bots automáticamente al reiniciar el bot.
//   • Exponer la lista activa (compat con global.conns para código viejo).
//   • Garantizar aislamiento: el manager nunca deja que el fallo de una
//     sesión afecte a otra (cada operación va envuelta).
//
// Es un singleton (export `manager`).

import fs from 'fs';
import path from 'path';
import { SubBotSession, STATE } from './SubBotSession.js';
import { getLicense, upsertLicense } from './store.js';

const ROOT = path.resolve('./subbots');
const REGISTRY = path.join(ROOT, 'registry.json');

class SubBotManager {
    constructor() {
        this.sessions = new Map();     // id → SubBotSession
        if (!fs.existsSync(ROOT)) fs.mkdirSync(ROOT, { recursive: true });
        // Compat: algunos comandos antiguos leen global.conns.
        global.conns = global.conns || [];
        this._syncGlobalConns();
    }

    _syncGlobalConns() {
        global.conns = [...this.sessions.values()].map(s => s.sock).filter(Boolean);
    }

    _loadRegistry() {
        try { return JSON.parse(fs.readFileSync(REGISTRY, 'utf8')); } catch { return {}; }
    }
    _saveRegistry() {
        const data = {};
        for (const [id, s] of this.sessions) data[id] = { ownerJid: s.ownerJid, useQR: s.useQR };
        try { fs.writeFileSync(REGISTRY, JSON.stringify(data, null, 2)); } catch { /* */ }
    }

    sanitizeId(jid) { return String(jid || '').replace(/[^0-9]/g, '') || 'anon'; }

    has(id) { const s = this.sessions.get(id); return !!(s && s.state !== STATE.DEAD); }

    /**
     * Crea (o reutiliza) la sesión de un dueño y la arranca.
     * @returns {SubBotSession}
     */
    async create({ ownerJid, useQR = true, hooks = {} }) {
        const id = this.sanitizeId(ownerJid);
        const existing = this.sessions.get(id);
        if (existing && existing.isAlive()) { hooks.onAlready?.(existing); return existing; }
        if (existing) { await existing.stop({ purge: false }).catch(() => {}); this.sessions.delete(id); }

        const session = new SubBotSession({
            id, ownerJid, useQR,
            authDir: path.join(ROOT, 'sessions', id),
        });

        // Cableado de hooks (el llamador decide qué hacer con qr/code/open…).
        if (hooks.onQR)    session.on('qr', hooks.onQR);
        if (hooks.onCode)  session.on('code', hooks.onCode);
        if (hooks.onOpen)  session.on('open', () => hooks.onOpen(session));
        if (hooks.onClose) session.on('close', hooks.onClose);
        if (hooks.onGiveup) session.on('giveup', hooks.onGiveup);
        session.on('error', (e) => console.error(`[subbot:${id}]`, e?.message || e));
        session.on('state', () => this._syncGlobalConns());
        session.on('open', () => { this._saveRegistry(); this._syncGlobalConns(); });
        session.on('close', ({ fatal }) => { if (fatal) { this.sessions.delete(id); this._saveRegistry(); } this._syncGlobalConns(); });

        this.sessions.set(id, session);
        await session.start();
        this._saveRegistry();
        this._syncGlobalConns();

        // Bootstrap de licencia: si el sub-bot no tiene licencia previa (p.ej.
        // se conectó con .serbot sin que un owner fijara duración), se crea
        // una PERMANENTE por defecto. Si ya existía (temporal fijada por el
        // owner con #subbot @user <dur>), se respeta y NO se sobrescribe.
        try {
            const existingLic = await getLicense(id);
            if (!existingLic) await upsertLicense({ id, ownerJid, number: id, duration: null });
        } catch { /* store opcional */ }

        return session;
    }

    /**
     * Detiene y elimina un sub-bot por su id saneado, exista o no una sesión
     * viva (p.ej. tras un reinicio en el que no se restauró). Purga la carpeta
     * de auth si purge=true. Lo usa el servicio de expiración.
     */
    async removeById(id, { purge = true } = {}) {
        const session = this.sessions.get(id);
        if (session) {
            await session.stop({ purge }).catch(() => {});
            this.sessions.delete(id);
        } else if (purge) {
            // Sin sesión viva: purga la carpeta de auth directamente.
            try { fs.rmSync(path.join(ROOT, 'sessions', id), { recursive: true, force: true }); } catch { /* */ }
        }
        this._saveRegistry();
        this._syncGlobalConns();
        return true;
    }

    async stop(ownerJid) {
        const id = this.sanitizeId(ownerJid);
        const session = this.sessions.get(id);
        if (!session) return false;
        await session.stop({ purge: true }).catch(() => {});
        this.sessions.delete(id);
        this._saveRegistry();
        this._syncGlobalConns();
        return true;
    }

    get(ownerJid) { return this.sessions.get(this.sanitizeId(ownerJid)) || null; }

    list() {
        return [...this.sessions.values()].filter(s => s.isAlive()).map(s => s.info());
    }
    count() { return this.list().length; }

    /**
     * Reconecta al arranque todos los sub-bots cuyas credenciales existan.
     * Tolerante a fallos: si una sesión no levanta, no detiene a las demás.
     */
    async restoreAll(onOpenNotify) {
        const reg = this._loadRegistry();
        const sessDir = path.join(ROOT, 'sessions');
        let restored = 0;
        if (!fs.existsSync(sessDir)) return 0;
        for (const id of fs.readdirSync(sessDir)) {
            const authDir = path.join(sessDir, id);
            try {
                if (!fs.existsSync(path.join(authDir, 'creds.json'))) continue;
                const meta = reg[id] || {};
                const session = new SubBotSession({ id, ownerJid: meta.ownerJid || id, useQR: meta.useQR ?? true, authDir });
                session.on('error', (e) => console.error(`[subbot:${id}]`, e?.message || e));
                session.on('state', () => this._syncGlobalConns());
                session.on('open', () => { this._syncGlobalConns(); if (onOpenNotify) onOpenNotify(session); });
                session.on('close', ({ fatal }) => { if (fatal) { this.sessions.delete(id); this._saveRegistry(); } this._syncGlobalConns(); });
                this.sessions.set(id, session);
                await session.start();
                restored++;
            } catch (e) { console.error(`[subbot:${id}] restore:`, e?.message || e); }
        }
        this._syncGlobalConns();
        return restored;
    }
}

export const manager = new SubBotManager();
export default manager;
