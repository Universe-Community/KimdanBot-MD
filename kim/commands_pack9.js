// kim/commands_pack9.js — Mantenimiento y diagnóstico (owner).
// ─────────────────────────────────────────────────────────────────────
//   .authclean [--dry]  → poda manual del authFolder (segura, forzada)
//   .authstatus         → estado de acumulación de la sesión (solo lectura)
//   .loglevel <nivel>   → cambia el nivel de logs en caliente

import fs from 'fs';
import path from 'path';
import { command } from './registry.js';
import { log } from './logger.js';
import { runAuthCare, getAuthCareConfig } from './authcare.js';
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
    description: 'Poda archivos de sesión obsoletos (seguro; usa --dry para simular)',
}, async (conn, m, args) => {
    if (!needOwner(m)) return;
    const dryRun = args.includes('--dry') || args.includes('-n');
    await m.react?.('🧹').catch(() => {});
    const results = await runAuthCare(AUTH_DIR, { force: true, dryRun });
    if (!results.length) return m.reply('🍃 El mantenimiento de sesión está desactivado o no hay carpetas de auth.');
    const lines = [];
    let totalDel = 0, totalBytes = 0;
    for (const r of results) {
        totalDel += r.deleted; totalBytes += r.freedBytes;
        lines.push(`📁 ${path.basename(r.dir)}: ${r.deleted}/${r.prunable} podados (${fmtBytes(r.freedBytes)})`);
    }
    lines.push('');
    lines.push(dryRun ? '🔍 Modo simulación (--dry): no se borró nada.' : '✅ creds.json y AppState Keys intactos.');
    lines.push(`🧮 Total: ${totalDel} archivo(s), ${fmtBytes(totalBytes)}.`);
    await m.reply(box('🧹 LIMPIEZA DE SESIÓN', lines));
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
    const count = (re) => names.filter(n => re.test(n)).length;
    const lines = [
        `📦 Archivos totales: *${names.length}*`,
        `🔑 pre-keys: ${count(/^pre-key-/i)}`,
        `👤 sesiones: ${count(/^session-/i)}`,
        `👥 sender-keys: ${count(/^sender-key/i)}`,
        `🛡️ app-state (protegidos): ${count(/^app-state-sync-/i)}`,
        '',
        `⚙️ Auto-limpieza: ${cfg.enabled ? `activa cada ${cfg.intervalHours}h` : 'desactivada'}`,
        `📏 Umbral: ${cfg.minFiles} podables · edades: pre-key ${cfg.maxAgeDays.preKey}d / sesión ${cfg.maxAgeDays.session}d / sender-key ${cfg.maxAgeDays.senderKey}d`,
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
