// kim/logger.js — Logger central con niveles (ESM).
// ─────────────────────────────────────────────────────────────────────
// Objetivo: reducir el ruido en consola sin perder información útil.
//
// Niveles (de menos a más verboso):
//   silent < error < warn < info < debug
//
// Configuración (en orden de prioridad):
//   1. Variable de entorno LOG_LEVEL  (p.ej. LOG_LEVEL=debug npm start)
//   2. global.logLevel (settings.js)
//   3. Default: 'info'
//
// Uso:
//   import { log } from './logger.js';
//   log.info('[Handler]', 'comandos cargados');
//   log.debug('[perm]', detalles);     // solo se ve con LOG_LEVEL=debug
//
// El nivel puede cambiarse en caliente con log.setLevel('debug')
// (lo usa el comando .debug del owner, si existe).

import chalk from 'chalk';

const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

function resolveInitialLevel() {
    const env = String(process.env.LOG_LEVEL || '').toLowerCase();
    if (env in LEVELS) return env;
    const cfg = String(global.logLevel || '').toLowerCase();
    if (cfg in LEVELS) return cfg;
    return 'info';
}

let _level = resolveInitialLevel();

export const log = {
    /** Nivel actual ('silent'|'error'|'warn'|'info'|'debug'). */
    get level() { return _level; },

    /** Cambia el nivel en caliente. Devuelve true si el nivel es válido. */
    setLevel(l) {
        const v = String(l || '').toLowerCase();
        if (!(v in LEVELS)) return false;
        _level = v;
        return true;
    },

    /** ¿El nivel actual permite `l`? Útil para evitar construir strings caros. */
    enabled(l) { return LEVELS[_level] >= (LEVELS[l] ?? 99); },

    error(...a) { if (LEVELS[_level] >= LEVELS.error) console.error(...a); },
    warn(...a)  { if (LEVELS[_level] >= LEVELS.warn)  console.warn(...a); },
    info(...a)  { if (LEVELS[_level] >= LEVELS.info)  console.log(...a); },
    debug(...a) { if (LEVELS[_level] >= LEVELS.debug) console.log(chalk.gray('[debug]'), ...a); },
};

export default log;
