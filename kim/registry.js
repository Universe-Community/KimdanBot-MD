// kim/registry.js — Registro central de comandos.
//
// Cada comando se define con su metadata (name, aliases, category,
// description). El handler construye el cmdMap a partir de este registro,
// y el comando .menu construye su lista a partir del mismo registro.
//
// Resultado: agregar un comando nuevo lo añade AUTOMÁTICAMENTE al menú,
// en su categoría correspondiente, sin tocar el código del menú.
//
// Uso:
//
//   import { command } from './registry.js';
//
//   export const ping = command({
//       name: 'ping',
//       aliases: ['test'],
//       category: 'info',
//       description: 'Mide la latencia del bot',
//   }, async (conn, m, args, text) => {
//       // implementación
//   });

const _entries = [];

/**
 * Registra un comando. `meta` debe tener al menos `name`.
 * `aliases` es opcional. `category` agrupa en el menú. `description`
 * se muestra al lado del nombre. `hidden: true` lo excluye del menú
 * pero sigue siendo invocable.
 */
export function command(meta, handler) {
    if (typeof meta === 'string') meta = { name: meta };
    if (!meta?.name) throw new Error('command(): falta `name` en metadata');
    if (typeof handler !== 'function') throw new Error('command(): handler debe ser función');
    _entries.push({ ...meta, handler });
    return handler;
}

/** Lista cruda del registry (orden de registro). */
export function getEntries() { return _entries; }

/** Construye el Map<nombre, función> usado por el handler para dispatch. */
export function buildCmdMap() {
    const map = new Map();
    for (const e of _entries) {
        const names = [e.name, ...(e.aliases || [])];
        for (const n of names) map.set(String(n).toLowerCase(), e.handler);
    }
    return map;
}

// Orden de categorías en el menú. Categorías no listadas van al final.
const CATEGORY_ORDER = [
    'info', 'owner', 'admin', 'group', 'config',
    'media', 'sticker', 'search', 'download',
    'rpg', 'game', 'fun', 'tools', 'misc',
];

// Emojis decorativos por categoría
const CATEGORY_EMOJI = {
    info:     '🍒',
    owner:    '👑',
    admin:    '⚡',
    group:    '🌸',
    config:   '⚙️',
    media:    '🎀',
    sticker:  '🎨',
    search:   '🔍',
    download: '📥',
    rpg:      '🎮',
    game:     '🎲',
    fun:      '🍓',
    tools:    '🛠️',
    misc:     '🍩',
};

// Nombre amigable de cada categoría
const CATEGORY_LABEL = {
    info:     'INFO',
    owner:    'OWNER',
    admin:    'ADMIN',
    group:    'GRUPOS',
    config:   'CONFIG',
    media:    'MEDIA',
    sticker:  'STICKERS',
    search:   'BÚSQUEDAS',
    download: 'DESCARGAS',
    rpg:      'RPG',
    game:     'JUEGOS',
    fun:      'DIVERSIÓN',
    tools:    'HERRAMIENTAS',
    misc:     'OTROS',
};

/**
 * Construye el texto del menú agrupado por categoría.
 * Ordena las categorías según CATEGORY_ORDER y los comandos dentro de
 * cada categoría alfabéticamente.
 */
export function buildMenu(prefix = '.') {
    const byCat = new Map();
    for (const e of _entries) {
        if (e.hidden) continue;
        const cat = e.category || 'misc';
        if (!byCat.has(cat)) byCat.set(cat, []);
        byCat.get(cat).push(e);
    }

    const sorted = [...byCat.entries()].sort((a, b) => {
        const ia = CATEGORY_ORDER.indexOf(a[0]);
        const ib = CATEGORY_ORDER.indexOf(b[0]);
        const aIdx = ia === -1 ? 99 : ia;
        const bIdx = ib === -1 ? 99 : ib;
        if (aIdx !== bIdx) return aIdx - bIdx;
        return a[0].localeCompare(b[0]);
    });

    let out = '';
    for (const [cat, cmds] of sorted) {
        const emoji = CATEGORY_EMOJI[cat] || '✿';
        const label = CATEGORY_LABEL[cat] || cat.toUpperCase();
        out += `\n*╭─⊰ ${emoji} ${label} ⊱─╮*\n`;
        const cmdsSorted = cmds.slice().sort((a, b) => a.name.localeCompare(b.name));
        for (const c of cmdsSorted) {
            out += `*│* ${prefix}${c.name}`;
            if (c.description) out += ` _— ${c.description}_`;
            out += '\n';
        }
        out += `*╰────────────────╯*\n`;
    }
    return out.trim();
}

/** Cantidad total de comandos registrados (sin contar aliases). */
export function commandCount() { return _entries.length; }

/** Cantidad total de comandos contando aliases. */
export function aliasCount() {
    return _entries.reduce((n, e) => n + 1 + (e.aliases?.length || 0), 0);
}
