// kim/authcare.js — Mantenimiento de la carpeta de autenticación de Baileys
// (authFolder principal + sesiones de sub-bots). Diseño INTEGRITY-FIRST.
// ─────────────────────────────────────────────────────────────────────
//
// PORQUÉ ESTE MÓDULO SE REDISEÑÓ POR COMPLETO
//   La versión anterior podaba archivos de Signal por ANTIGÜEDAD (mtime):
//   pre-key-* > 30d, session-* > 21d, sender-key-* > 14d. Eso corrompía la
//   sesión. Motivo exacto (verificado contra el código de Baileys v7):
//
//   • Baileys genera pre-keys en LOTES grandes (INITIAL_PREKEY_COUNT = 812
//     al vincular) y solo repone cuando el servidor baja de MIN_PREKEY_COUNT
//     (=5). Cada pre-key se sube al servidor de WhatsApp y queda ANUNCIADA
//     ahí hasta que alguien la consume.
//   • Cuando un contacto quiere hablarte, el servidor le entrega UNA de tus
//     pre-keys por ID; su primer mensaje (PreKeyWhisperMessage) la referencia.
//     Baileys llama loadPreKey(id) → lee pre-key-<id>.json del disco para
//     completar el handshake X3DH.
//   • Baileys BORRA la pre-key él mismo en cuanto la usa (removePreKey → set
//     pre-key:{id:null} → unlink). Por tanto: un archivo pre-key-<id>.json que
//     TODAVÍA EXISTE es, por definición, una pre-key NO consumida y aún
//     anunciada en el servidor. Su mtime = cuándo se generó; NUNCA se reescribe.
//   • Como las 812 se generan en el mismo instante (al vincular), TODAS cruzan
//     el umbral de 30 días a la vez → la poda por antigüedad borraba cientos de
//     pre-keys válidas de golpe (~30 días tras vincular). A partir de ahí,
//     cualquiera que reciba del servidor una de esas pre-keys ya no puede
//     abrir sesión con el bot → fallos de descifrado ("Bad MAC", "No session",
//     "failed to decrypt"), tormenta de retries y, finalmente, badSession (500)
//     → el mensaje "Sesión corrupta. Borra authFolder/".
//   • session-* y sender-key-* por inactividad tenían el mismo defecto de raíz:
//     el disco no revela el estado del lado servidor, así que "viejo" ≠ "seguro
//     de borrar". Borrarlos rompe el ratchet / la sender-key de grupo y provoca
//     fallos de descifrado por contacto.
//
// CONCLUSIÓN DE INGENIERÍA
//   El formato useMultiFileAuthState se AUTOGESTIONA: Baileys elimina cada
//   clave cuando deja de necesitarla. NO existe una "recolección de basura"
//   segura por antigüedad desde fuera del proceso. Que la carpeta sea GRANDE
//   es normal y sano (un archivo por clave). Grande ≠ roto. Baileys no recorre
//   toda la carpeta al arrancar (lee creds.json + claves bajo demanda, con
//   caché vía makeCacheableSignalKeyStore), así que el tamaño NO degrada el
//   arranque. La degradación que se observaba era la tormenta de descifrado
//   causada por los borrados previos, no el número de archivos.
//
// QUÉ HACE AHORA (seguro por diseño):
//   1. INTEGRIDAD (auto cada `intervalHours`, y al arrancar): elimina solo
//      basura genuina — archivos de clave TORN/vacíos (0 bytes o JSON ilegible)
//      que NO son creds.json y cuyo mtime supera un breve periodo de gracia
//      (para no competir con una escritura en curso de Baileys). Baileys ya
//      trata esos archivos como inexistentes (su readData devuelve null ante un
//      JSON inválido), así que quitarlos es inocuo y evita ruido/relecturas.
//   2. REPORTE: cuenta por categoría para visibilidad del owner.
//   3. MODO HARD (solo manual y explícito, .authclean --hard): poda opcional de
//      session-* y sender-key-* MUY antiguos (por defecto 90/60 días) como
//      válvula de escape ante presión real de disco. NUNCA toca pre-keys,
//      identity-keys, app-state, lid-mapping, device-list, tctoken ni creds.
//
// LO QUE NUNCA SE BORRA (en ningún modo):
//   creds.json · app-state-sync-key-* · app-state-sync-version-* · pre-key-* ·
//   identity-key-* · lid-mapping-* · device-list-* · tctoken-* · desconocidos.
//
// CONFIG — settings.js → global.authCare, o variables de entorno:
//   AUTHCARE_ENABLED=true|false        AUTHCARE_INTERVAL_HOURS=3
//   AUTHCARE_GRACE_MINUTES=5           AUTHCARE_DEEP_STARTUP=true
//   AUTHCARE_HARD_SESSION_DAYS=90      AUTHCARE_HARD_SENDERKEY_DAYS=60

import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { log } from './logger.js';

const MIN_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MIN_MS;

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
        // Integridad cada 3h: barato y seguro (no borra claves válidas).
        intervalHours: envNum('AUTHCARE_INTERVAL_HOURS', g.intervalHours ?? 3),
        // No tocar archivos más nuevos que esto (evita carreras con escrituras
        // en curso de Baileys). Solo aplica a la detección de basura.
        graceMinutes:  envNum('AUTHCARE_GRACE_MINUTES', g.graceMinutes ?? 5),
        // Al arrancar, validar JSON a fondo (recupera de crashes a media
        // escritura). En las pasadas periódicas basta el chequeo de 0 bytes.
        deepStartup:   envBool('AUTHCARE_DEEP_STARTUP', g.deepStartup ?? true),
        // Solo para modo HARD manual (.authclean --hard). Nunca en automático.
        hard: {
            sessionDays:   envNum('AUTHCARE_HARD_SESSION_DAYS',   g.hard?.sessionDays   ?? 90),
            senderKeyDays: envNum('AUTHCARE_HARD_SENDERKEY_DAYS', g.hard?.senderKeyDays ?? 60),
        },
    };
}

// ─── Clasificación de archivos por categoría de Baileys v7 ──────────
//
// SignalDataTypeMap (v7): pre-key, session, sender-key, sender-key-memory,
// app-state-sync-key, app-state-sync-version, lid-mapping, device-list,
// tctoken, identity-key. El archivo es `${type}-${id}.json`.
// El orden importa: 'sender-key-memory' antes que 'sender-key'.

const CATEGORY_RULES = [
    { cat: 'creds',               re: /^creds\.json$/i },
    { cat: 'appStateSyncKey',     re: /^app-state-sync-key-.+\.json$/i },
    { cat: 'appStateSyncVersion', re: /^app-state-sync-version-.+\.json$/i },
    { cat: 'preKey',              re: /^pre-key-.+\.json$/i },
    { cat: 'senderKeyMemory',     re: /^sender-key-memory-.+\.json$/i },
    { cat: 'senderKey',           re: /^sender-key-.+\.json$/i },
    { cat: 'session',             re: /^session-.+\.json$/i },
    { cat: 'identityKey',         re: /^identity-key-.+\.json$/i },
    { cat: 'lidMapping',          re: /^lid-mapping-.+\.json$/i },
    { cat: 'deviceList',          re: /^device-list-.+\.json$/i },
    { cat: 'tcToken',             re: /^tctoken-.+\.json$/i },
];

// Categorías que el modo HARD manual puede podar (muy antiguas). Nada más.
const HARD_PRUNABLE = { session: 'sessionDays', senderKey: 'senderKeyDays' };

export function categorize(fileName) {
    for (const r of CATEGORY_RULES) if (r.re.test(fileName)) return r.cat;
    return 'unknown';
}

function emptyCounts() {
    return {
        creds: 0, appStateSyncKey: 0, appStateSyncVersion: 0, preKey: 0,
        senderKey: 0, senderKeyMemory: 0, session: 0, identityKey: 0,
        lidMapping: 0, deviceList: 0, tcToken: 0, unknown: 0,
    };
}

// ¿El contenido del archivo es un JSON válido y no vacío? (chequeo de torn write)
async function isReadableJson(full) {
    try {
        const raw = await fs.promises.readFile(full, 'utf-8');
        if (!raw || !raw.trim()) return false;
        JSON.parse(raw);
        return true;
    } catch { return false; }
}

// ─── Limpieza de UNA carpeta de auth ────────────────────────────────
/**
 * @param {string} dir  carpeta multi-file-auth (p.ej. ./authFolder)
 * @param {object} opts { dryRun, deep, hard, cfg }
 *   - deep: además de 0 bytes, valida JSON (más costoso; se usa al arrancar
 *     y en la limpieza manual forzada).
 *   - hard: habilita poda de session- y sender-key- MUY antiguos (manual).
 * @returns resumen detallado
 */
export async function cleanAuthDir(dir, { dryRun = false, deep = false, hard = false, cfg = getAuthCareConfig() } = {}) {
    const summary = {
        dir, scanned: 0, counts: emptyCounts(),
        corruptDeleted: 0, hardPruned: 0, freedBytes: 0,
        credsCorrupt: false, hardByType: { session: 0, senderKey: 0 },
    };

    let names;
    try { names = await fs.promises.readdir(dir); }
    catch { return summary; } // carpeta inexistente: nada que hacer

    // Regla de oro: sin creds.json esta carpeta no es una sesión gestionada
    // por nosotros → no tocamos absolutamente nada.
    if (!names.includes('creds.json')) return summary;

    const now = Date.now();
    const graceMs = cfg.graceMinutes * MIN_MS;

    for (const name of names) {
        summary.scanned++;
        const cat = categorize(name);
        if (summary.counts[cat] !== undefined) summary.counts[cat]++;

        const full = path.join(dir, name);
        let st;
        try { st = await fs.promises.stat(full); } catch { continue; }
        if (!st.isFile()) continue;

        const ageMs = now - st.mtimeMs;
        const pastGrace = ageMs > graceMs; // no competir con escrituras vivas

        // ── 1) INTEGRIDAD: basura genuina (0 bytes o JSON ilegible) ──
        // Nunca borra creds.json (si está corrupto se AVISA, no se elimina:
        // borrarlo forzaría re-vincular; mejor que el humano lo restaure).
        const looksEmpty = st.size === 0;
        let broken = false;
        if (pastGrace) {
            if (looksEmpty) broken = true;
            else if (deep && name.toLowerCase().endsWith('.json') && !(await isReadableJson(full))) broken = true;
        }

        if (broken) {
            if (cat === 'creds') { summary.credsCorrupt = true; continue; }
            if (dryRun) { summary.corruptDeleted++; summary.freedBytes += st.size; continue; }
            try {
                await fs.promises.unlink(full);
                summary.corruptDeleted++; summary.freedBytes += st.size;
            } catch { /* en uso o ya borrado */ }
            continue;
        }

        // ── 2) HARD (solo manual y explícito): session- y sender-key- muy viejos ──
        if (hard && HARD_PRUNABLE[cat]) {
            const maxAgeMs = (cfg.hard[HARD_PRUNABLE[cat]] || 90) * DAY_MS;
            if (ageMs > maxAgeMs) {
                if (dryRun) { summary.hardPruned++; summary.freedBytes += st.size; summary.hardByType[cat]++; continue; }
                try {
                    await fs.promises.unlink(full);
                    summary.hardPruned++; summary.freedBytes += st.size; summary.hardByType[cat]++;
                } catch { /* */ }
            }
        }
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
 * Ejecuta una pasada de mantenimiento (main + sub-bots).
 * @param {string} mainDir './authFolder'
 * @param {object} opts { dryRun, force, deep, hard }
 *   - force: ejecuta aunque enabled=false (para el comando manual).
 *   - deep : validación JSON completa (además de 0 bytes).
 *   - hard : habilita poda manual de sesiones/sender-keys muy antiguos.
 * @returns lista de resúmenes por carpeta
 */
export async function runAuthCare(mainDir = './authFolder', { dryRun = false, force = false, deep = false, hard = false } = {}) {
    const cfg = getAuthCareConfig();
    if (!cfg.enabled && !force) return [];
    const results = [];
    for (const dir of await listAuthDirs(mainDir)) {
        try {
            const r = await cleanAuthDir(dir, { dryRun, deep, hard, cfg });
            results.push(r);

            if (r.credsCorrupt) {
                log.warn(chalk.red(
                    `[authcare] ⚠️ ${path.basename(dir)}/creds.json parece CORRUPTO o vacío. ` +
                    `NO se elimina automáticamente. Restaura una copia de seguridad o re-vincula manualmente.`
                ));
            }

            const acted = r.corruptDeleted + r.hardPruned;
            if (acted > 0) {
                log.info(chalk.cyan(
                    `[authcare] ${path.basename(dir)}: ` +
                    `${r.corruptDeleted} archivo(s) corrupto(s)/vacío(s) ` +
                    `${dryRun ? 'detectados (dry-run)' : 'saneados'}` +
                    (r.hardPruned ? `, ${r.hardPruned} obsoleto(s) podados [HARD] ` +
                        `(sesiones:${r.hardByType.session} sender-keys:${r.hardByType.senderKey})` : '') +
                    ` — ${fmtBytes(r.freedBytes)}. creds/pre-keys/app-state/identity intactos.`
                ));
            } else {
                log.debug(
                    `[authcare] ${path.basename(dir)}: sesión sana ` +
                    `(pre-keys:${r.counts.preKey} sesiones:${r.counts.session} ` +
                    `sender-keys:${r.counts.senderKey} — nada que sanear).`
                );
            }
        } catch (e) {
            log.warn(chalk.yellow(`[authcare] ${dir}:`), e?.message || e);
        }
    }
    return results;
}

let _timer = null;

/**
 * Arranca el mantenimiento automático: una pasada inicial de INTEGRIDAD
 * (deep si deepStartup) + pasadas periódicas de integridad. Idempotente.
 * NUNCA poda claves válidas por antigüedad en el camino automático.
 */
export function startAuthCare(mainDir = './authFolder') {
    const cfg = getAuthCareConfig();
    if (!cfg.enabled) { log.debug('[authcare] desactivado por configuración.'); return; }
    if (_timer) return; // ya iniciado

    // Pasada inicial diferida (no compite con el handshake). deep=true para
    // recuperar de posibles archivos a medio escribir tras un crash.
    setTimeout(() => {
        runAuthCare(mainDir, { deep: cfg.deepStartup }).catch(() => {});
    }, 30_000).unref();

    _timer = setInterval(() => {
        // Periódico: chequeo barato (0 bytes). Sin poda por antigüedad.
        runAuthCare(mainDir, { deep: false }).catch(() => {});
    }, cfg.intervalHours * 60 * 60 * 1000);
    _timer.unref();

    log.info(chalk.cyan(
        `[authcare] Integridad de sesión activa (cada ${cfg.intervalHours}h). ` +
        `Solo sanea archivos corruptos/vacíos; nunca borra claves válidas por antigüedad.`
    ));
}

export function stopAuthCare() {
    if (_timer) { clearInterval(_timer); _timer = null; }
}
