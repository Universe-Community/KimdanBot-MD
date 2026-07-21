// kim/commands_pack9.js — Mantenimiento y diagnóstico (owner).
// ─────────────────────────────────────────────────────────────────────
//   .authclean [--dry] [--hard]
//        Sanea la sesión: elimina archivos de clave CORRUPTOS/vacíos (torn
//        writes). NUNCA borra claves válidas por antigüedad.
//        --dry   simula (no borra nada).
//        --hard  además poda session-*/sender-key-* MUY antiguos (90/60 días
//                por defecto). Válvula de escape ante presión real de disco;
//                jamás toca pre-keys, identity, app-state, lid-mapping,
//                device-list, tctoken ni creds.
//   .authstatus  → estado de acumulación de la sesión (solo lectura).
//   .loglevel <nivel> → cambia el nivel de logs en caliente.

import fs from 'fs';
import path from 'path';
import { command } from './registry.js';
import { log } from './logger.js';
import { runAuthCare, getAuthCareConfig, categorize } from './authcare.js';
import { box } from './ui.js';

const AUTH_DIR = './authFolder';

const needOwner = (m) => {
    if (!m.isOwner) { m.reply(global.mess?.owner || '⚠️ Solo el propietario.'); return false; }
    return true;
};

const fmtBytes = (b) => b >= 1024 * 1024 ? (b / 1048576).toFixed(1) + ' MB'
    : b >= 1024 ? (b / 1024).toFixed(1) + ' KB' : b + ' B';

export const authclean = command({
    name: 'authclean',
    aliases: ['cleansession', 'limpiarsesion'],
    category: 'owner',
    description: 'Sanea la sesión (corruptos/vacíos). --dry simula · --hard poda sesiones muy antiguas',
}, async (conn, m, args) => {
    if (!needOwner(m)) return;
    const dryRun = args.includes('--dry') || args.includes('-n');
    const hard   = args.includes('--hard');
    await m.react?.('🧹').catch(() => {});

    // Manual: deep=true (valida JSON), force=true (aunque esté deshabilitado).
    const results = await runAuthCare(AUTH_DIR, { force: true, dryRun, deep: true, hard });
    if (!results.length) return m.reply('🍃 No hay carpetas de auth que revisar.');

    const lines = [];
    let totalCorrupt = 0, totalHard = 0, totalBytes = 0, credsCorrupt = false;
    for (const r of results) {
        totalCorrupt += r.corruptDeleted; totalHard += r.hardPruned; totalBytes += r.freedBytes;
        if (r.credsCorrupt) credsCorrupt = true;
        lines.push(
            `📁 ${path.basename(r.dir)}: ${r.corruptDeleted} saneado(s)` +
            (hard ? ` · ${r.hardPruned} podado(s) [hard]` : '')
        );
    }
    lines.push('');
    if (credsCorrupt) lines.push('⚠️ *creds.json corrupto detectado* — NO se eliminó. Restaura backup o re-vincula.');
    lines.push(dryRun ? '🔍 Modo simulación (--dry): no se borró nada.'
                      : '✅ pre-keys, app-state, identity y creds intactos.');
    if (!hard) lines.push('ℹ️ Usa *--hard* solo si necesitas liberar disco (poda sesiones/sender-keys > 90/60 días).');
    lines.push(`🧮 Total: ${totalCorrupt} saneado(s)` + (hard ? ` + ${totalHard} podado(s)` : '') + `, ${fmtBytes(totalBytes)}.`);
    await m.reply(box('🧹 SANEO DE SESIÓN', lines));
});

export const authstatus = command({
    name: 'authstatus',
    aliases: ['sessioninfo'],
    category: 'owner',
    description: 'Estado de acumulación del authFolder (solo lectura)',
}, async (conn, m) => {
    if (!needOwner(m)) return;
    const cfg = getAuthCareConfig();
    let names = [];
    try { names = await fs.promises.readdir(AUTH_DIR); } catch { /* */ }

    const c = { preKey: 0, session: 0, senderKey: 0, senderKeyMemory: 0,
                identityKey: 0, appState: 0, lidMapping: 0, deviceList: 0,
                tcToken: 0, unknown: 0 };
    for (const n of names) {
        const cat = categorize(n);
        if (cat === 'appStateSyncKey' || cat === 'appStateSyncVersion') c.appState++;
        else if (c[cat] !== undefined) c[cat]++;
        else if (cat !== 'creds') c.unknown++;
    }

    const lines = [
        `📦 Archivos totales: *${names.length}*`,
        `🔑 pre-keys (no consumidas): ${c.preKey}`,
        `👤 sesiones Signal: ${c.session}`,
        `👥 sender-keys: ${c.senderKey}  ·  memory: ${c.senderKeyMemory}`,
        `🪪 identity-keys: ${c.identityKey}  ·  lid-map: ${c.lidMapping}`,
        `🛡️ app-state (protegido): ${c.appState}  ·  device-list: ${c.deviceList}  ·  tctoken: ${c.tcToken}`,
        '',
        'ℹ️ Una carpeta grande es *normal y sana* (un archivo por clave).',
        'Baileys elimina cada clave cuando deja de necesitarla; no se poda por antigüedad.',
        '',
        `⚙️ Integridad automática: ${cfg.enabled ? `activa cada ${cfg.intervalHours}h` : 'desactivada'}`,
        `🩹 Solo sanea corruptos/vacíos (gracia ${cfg.graceMinutes} min). Nunca borra claves válidas.`,
        `🧯 Modo hard manual: sesiones > ${cfg.hard.sessionDays}d · sender-keys > ${cfg.hard.senderKeyDays}d`,
    ];
    await m.reply(box('🗂️ ESTADO DE LA SESIÓN', lines));
});

export const loglevel = command({
    name: 'loglevel',
    aliases: ['setlog', 'debugmode'],
    category: 'owner',
    description: 'Cambia el nivel de logs (silent/error/warn/info/debug)',
}, async (conn, m, args) => {
    if (!needOwner(m)) return;
    const lvl = (args[0] || '').toLowerCase();
    if (!lvl) return m.reply(`🪵 Nivel actual: *${log.level}*\n\nUso: .loglevel <silent|error|warn|info|debug>`);
    if (!log.setLevel(lvl)) return m.reply('⚠️ Nivel inválido. Opciones: silent, error, warn, info, debug.');
    await m.reply(`🪵 Nivel de logs cambiado a *${lvl}*.`);
});

export default true;
