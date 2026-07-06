// kim/authcare.js — Mantenimiento automático y SEGURO de la carpeta de
// autenticación de Baileys (authFolder y sesiones de sub-bots).
// ─────────────────────────────────────────────────────────────────────
//
// PROBLEMA QUE RESUELVE
//   useMultiFileAuthState() acumula miles de archivos con el tiempo:
//   pre-keys ya consumidas, sesiones Signal de contactos inactivos y
//   sender-keys de grupos antiguos. Esto degrada el arranque (hay que
//   listar/leer todos), consume disco y ralentiza el key-store.
//
// GARANTÍAS DE SEGURIDAD (lo primero, siempre):
//   • creds.json                      → NUNCA se toca.
//   • app-state-sync-key-*.json       → NUNCA se toca (AppState Keys;
//     perderlas rompe chatModify, setnamebot, archivar, etc.).
//   • app-state-sync-version-*.json   → NUNCA se toca (evita resyncs
//     completos e inconsistencias de app-state).
//   • Cualquier archivo no reconocido → NUNCA se toca (lista blanca
//     estricta: solo se poda lo que sabemos que Baileys REGENERA solo).
//   • Nada se borra por "nombre": solo por antigüedad real (mtime).
//     Un archivo activo se reescribe con frecuencia y su mtime se
//     renueva, así que jamás se poda algo en uso.
//
// QUÉ SÍ SE PODA (todo regenerable por Baileys, solo si es viejo):
//   • pre-key-N.json          → pre-keys antiguas. Baileys mantiene un
//     pool y sube nuevas al servidor cuando escasean. Podar las viejas
//     no cierra la sesión. (Default: > 30 días — el más conservador.)
//   • session-XXXX.json       → sesión Signal 1:1 con un contacto. Si se
//     poda una inactiva y ese contacto vuelve a escribir, Signal
//     restablece la sesión de forma transparente (retry automático).
//     (Default: > 21 días sin actividad.)
//   • sender-key-*.json y sender-key-memory-*.json → claves de grupo.
//     Se regeneran en el siguiente mensaje al grupo. (Default: > 14 días.)
//
// CUÁNDO SE EJECUTA
//   • Al arrancar, SOLO si hay acumulación real (más de `minFiles`
//     archivos podables). Un authFolder sano no se toca.
//   • Periódicamente cada `intervalHours` (timer unref(): no impide que
//     el proceso termine).
//   • Manualmente vía runAuthCare({ force: true }) (p.ej. un comando
//     owner .authclean).
//
// CONFIGURACIÓN — settings.js → global.authCare, o variables de entorno:
//   AUTHCARE_ENABLED=true|false     AUTHCARE_INTERVAL_HOURS=12
//   AUTHCARE_MIN_FILES=300
//   AUTHCARE_PREKEY_DAYS=30  AUTHCARE_SESSION_DAYS=21  AUTHCARE_SENDERKEY_DAYS=14

import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { log } from './logger.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// ─── Configuración efectiva ─────────────────────────────────────────

function envNum(name, def) {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && v > 0 ? v : def;
}
function envBool(name, def) {
    const v = String(process.env[name] ?? '').toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(v)) return true;
    if (['0', 'false', 'no', 'off'].includes(v)) return false;
    return def;
}

export function getAuthCareConfig() {
    const g = global.authCare || {};
    return {
        enabled:       envBool('AUTHCARE_ENABLED', g.enabled ?? true),
        intervalHours: envNum('AUTHCARE_INTERVAL_HOURS', g.intervalHours ?? 12),
        // Umbral de acumulación: por debajo de esto, ni se molesta.
        minFiles:      envNum('AUTHCARE_MIN_FILES', g.minFiles ?? 300),
        maxAgeDays: {
            preKey:    envNum('AUTHCARE_PREKEY_DAYS',    g.maxAgeDays?.preKey    ?? 30),
            session:   envNum('AUTHCARE_SESSION_DAYS',   g.maxAgeDays?.session   ?? 21),
            senderKey: envNum('AUTHCARE_SENDERKEY_DAYS', g.maxAgeDays?.senderKey ?? 14),
        },
    };
}

// ─── Clasificación de archivos (lista blanca estricta) ──────────────

// Protegidos SIEMPRE. Aunque también caerían en "no reconocido", se listan
// explícitamente para que la intención quede clara y auditable.
const PROTECTED = [
    /^creds\.json$/i,
    /^app-state-sync-key-.*\.json$/i,
    /^app-state-sync-version-.*\.json$/i,
];

// Podables (categoría → regla). Solo estos patrones se consideran.
const PRUNABLE = [
    { key: 'preKey',    re: /^pre-key-\d+\.json$/i },
    { key: 'session',   re: /^session-.+\.json$/i },
    { key: 'senderKey', re: /^sender-key(-memory)?-.+\.json$/i },
];

function classify(fileName) {
    for (const re of PROTECTED) if (re.test(fileName)) return { type: 'protected' };
    for (const p of PRUNABLE) if (p.re.test(fileName)) return { type: 'prunable', key: p.key };
    return { type: 'unknown' }; // no reconocido → no se toca jamás
}

// ─── Limpieza de UNA carpeta de auth ────────────────────────────────

/**
 * Analiza (y opcionalmente poda) una carpeta multi-file-auth de Baileys.
 * @param {string} dir carpeta (p.ej. ./authFolder)
 * @param {object} opts { dryRun, force, cfg }
 * @returns resumen { scanned, protected, unknown, prunable, deleted, freedBytes, byType }
 */
export async function cleanAuthDir(dir, { dryRun = false, force = false, cfg = getAuthCareConfig() } = {}) {
    const summary = {
        dir, scanned: 0, protected: 0, unknown: 0,
        prunable: 0, deleted: 0, freedBytes: 0,
        byType: { preKey: 0, session: 0, senderKey: 0 },
    };
    let names;
    try { names = await fs.promises.readdir(dir); }
    catch { return summary; } // carpeta inexistente: nada que hacer

    // Regla de oro: si no hay creds.json, esta carpeta no es una sesión
    // válida/activa gestionada por nosotros → no tocamos nada.
    if (!names.includes('creds.json')) return summary;

    const now = Date.now();
    const candidates = [];

    for (const name of names) {
        summary.scanned++;
        const c = classify(name);
        if (c.type === 'protected') { summary.protected++; continue; }
        if (c.type === 'unknown')   { summary.unknown++;   continue; }

        summary.prunable++;
        const maxAgeMs = (cfg.maxAgeDays[c.key] || 30) * DAY_MS;
        const full = path.join(dir, name);
        let st;
        try { st = await fs.promises.stat(full); } catch { continue; }
        if (!st.isFile()) continue;
        const age = now - st.mtimeMs;
        if (age > maxAgeMs) candidates.push({ full, key: c.key, size: st.size });
    }

    // Umbral anti-paranoia: con poca acumulación no vale la pena podar
    // (salvo ejecución forzada/manual).
    if (!force && summary.prunable < cfg.minFiles) return summary;

    for (const c of candidates) {
        if (dryRun) { summary.deleted++; summary.freedBytes += c.size; summary.byType[c.key]++; continue; }
        try {
            await fs.promises.unlink(c.full);
            summary.deleted++;
            summary.freedBytes += c.size;
            summary.byType[c.key]++;
        } catch { /* archivo en uso o ya borrado: se ignora */ }
    }
    return summary;
}

// ─── Orquestación: carpeta principal + sesiones de sub-bots ─────────

const SUBBOT_SESSIONS_DIR = path.resolve('./subbots/sessions');

async function listAuthDirs(mainDir) {
    const dirs = [path.resolve(mainDir)];
    try {
        const subs = await fs.promises.readdir(SUBBOT_SESSIONS_DIR, { withFileTypes: true });
        for (const d of subs) if (d.isDirectory()) dirs.push(path.join(SUBBOT_SESSIONS_DIR, d.name));
    } catch { /* sin sub-bots */ }
    return dirs;
}

const fmtBytes = (b) => b >= 1024 * 1024 ? (b / 1048576).toFixed(1) + ' MB'
    : b >= 1024 ? (b / 1024).toFixed(1) + ' KB' : b + ' B';

/**
 * Ejecuta una pasada completa de mantenimiento (main + sub-bots).
 * @param {string} mainDir carpeta principal ('./authFolder')
 * @param {object} opts { dryRun, force }
 * @returns lista de resúmenes por carpeta
 */
export async function runAuthCare(mainDir = './authFolder', { dryRun = false, force = false } = {}) {
    const cfg = getAuthCareConfig();
    if (!cfg.enabled && !force) return [];
    const results = [];
    for (const dir of await listAuthDirs(mainDir)) {
        try {
            const r = await cleanAuthDir(dir, { dryRun, force, cfg });
            results.push(r);
            if (r.deleted > 0) {
                log.info(chalk.cyan(
                    `[authcare] ${path.basename(dir)}: ${r.deleted} archivo(s) obsoleto(s) ` +
                    `${dryRun ? 'detectados (dry-run)' : 'eliminados'} ` +
                    `(pre-keys:${r.byType.preKey} sesiones:${r.byType.session} sender-keys:${r.byType.senderKey}) ` +
                    `— ${fmtBytes(r.freedBytes)} liberados. creds.json y AppState Keys intactos.`
                ));
            } else {
                log.debug(`[authcare] ${path.basename(dir)}: sin acumulación (${r.prunable} podables < umbral o todo reciente).`);
            }
        } catch (e) {
            log.warn(chalk.yellow(`[authcare] ${dir}:`), e?.message || e);
        }
    }
    return results;
}

let _timer = null;

/**
 * Arranca el mantenimiento automático: una pasada inicial (solo poda si
 * hay acumulación real) + pasadas periódicas. Idempotente.
 */
export function startAuthCare(mainDir = './authFolder') {
    const cfg = getAuthCareConfig();
    if (!cfg.enabled) { log.debug('[authcare] desactivado por configuración.'); return; }
    if (_timer) return; // ya iniciado

    // Pasada inicial diferida (no compite con el arranque/handshake).
    setTimeout(() => { runAuthCare(mainDir).catch(() => {}); }, 30_000).unref();

    _timer = setInterval(() => { runAuthCare(mainDir).catch(() => {}); },
        cfg.intervalHours * 60 * 60 * 1000);
    _timer.unref();
    log.info(chalk.cyan(`[authcare] Mantenimiento de sesión activo (cada ${cfg.intervalHours}h, umbral ${cfg.minFiles} archivos).`));
}

export function stopAuthCare() {
    if (_timer) { clearInterval(_timer); _timer = null; }
}
