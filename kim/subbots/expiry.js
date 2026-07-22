// kim/subbots/expiry.js — Servicio de expiración de licencias de sub-bots.
// ─────────────────────────────────────────────────────────────────────
// Barrido ligero cada ~10 min. Usa una consulta INDEXADA (state='active'
// AND expiresAt<=now) para tocar solo los registros vencidos; nunca recorre
// la colección completa ni carga sesiones innecesarias.
//
// Al expirar una licencia:
//   1. Detiene y purga la sesión Baileys (cierra socket, libera listeners,
//      timers y memoria vía SubBotManager.removeById).
//   2. Marca la licencia como 'expired' con deletedAt.
//   3. Notifica al owner principal (y opcionalmente al usuario).
//
// Idempotente: si el bot se reinicia, el contador continúa porque expiresAt
// es absoluto (timestamp) y vive en Mongo/JSON, no en memoria.

import { manager } from './SubBotManager.js';
import { findExpired, setState, STATES } from './store.js';

const DEFAULT_INTERVAL_MS = (() => {
    const n = Number(process.env.SUBBOT_EXPIRY_INTERVAL_MIN);
    return Number.isFinite(n) && n > 0 ? n * 60 * 1000 : 10 * 60 * 1000; // 10 min
})();

let _timer = null;
let _running = false;
let _notify = null; // async (text) => {}  (inyectado por index.js)

/** Expira UNA licencia concreta (reutilizable por comandos y por el barrido). */
export async function expireOne(lic) {
    const id = lic.id || lic._id;
    try {
        await manager.removeById(id, { purge: true });
    } catch (e) { console.error(`[subbot-expiry] stop ${id}:`, e?.message || e); }

    await setState(id, STATES.EXPIRED, { deletedAt: Date.now() }).catch(() => {});

    const num = lic.number || id;
    if (_notify) {
        _notify(
            `⌛ *Sub-bot expirado*\n` +
            `• Usuario: wa.me/${num}\n` +
            `• Duración: ${lic.durationLabel || '—'}\n` +
            `• La sesión se cerró y los recursos se liberaron automáticamente.`
        ).catch(() => {});
    }
    return id;
}

/** Ejecuta una pasada de barrido. Devuelve cuántas licencias expiraron. */
export async function sweepExpired() {
    if (_running) return 0; // evita solapamientos
    _running = true;
    let n = 0;
    try {
        const due = await findExpired(Date.now());
        for (const lic of due) { await expireOne(lic); n++; }
    } catch (e) {
        console.error('[subbot-expiry] sweep:', e?.message || e);
    } finally {
        _running = false;
    }
    return n;
}

/**
 * Arranca el servicio. `notify` es un callback async para avisar al owner.
 * Idempotente. El timer usa unref() para no impedir el cierre del proceso.
 */
export function startExpiryService({ notify, intervalMs = DEFAULT_INTERVAL_MS } = {}) {
    _notify = notify || null;
    if (_timer) return;
    // Primera pasada diferida (no compite con el arranque/handshake).
    setTimeout(() => { sweepExpired().catch(() => {}); }, 45_000).unref();
    _timer = setInterval(() => { sweepExpired().catch(() => {}); }, intervalMs);
    _timer.unref();
}

export function stopExpiryService() {
    if (_timer) { clearInterval(_timer); _timer = null; }
}
