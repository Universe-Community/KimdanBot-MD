// kim/ui.js — Helpers de presentación visual (UI de mensajes).
// ─────────────────────────────────────────────────────────────────────
// Funciones puras de string: cero costo de red, costo de CPU despreciable.
// Centralizan el "look & feel" para que TODO el bot tenga un estilo
// coherente (cajas, encabezados, separadores, barras de progreso).
//
// Estilo de caja:
//   ╭───〔 TÍTULO 〕───⬣
//   │ línea 1
//   │ línea 2
//   ╰─────────────⬣

const LINE = '─';

/** Caja con título y líneas de contenido. */
export function box(title, lines = []) {
    const body = (Array.isArray(lines) ? lines : [lines]).map(l => `│ ${l}`).join('\n');
    return `╭───〔 ${title} 〕───⬣\n${body}\n╰────────────⬣`;
}

/** Encabezado simple con regla inferior. */
export function header(title, width = 18) {
    return `❒ *${title}*\n${LINE.repeat(width)}`;
}

/** Separador horizontal. */
export function rule(width = 18) { return LINE.repeat(width); }

/** Lista con viñetas temáticas. */
export function bullets(items, bullet = '•') {
    return items.map(i => `${bullet} ${i}`).join('\n');
}

/** Barra de progreso tipo [████░░░░] 50%. */
export function bar(pct, slots = 10) {
    const p = Math.max(0, Math.min(100, Math.round(pct)));
    const filled = Math.round((p / 100) * slots);
    return `${'█'.repeat(filled)}${'░'.repeat(slots - filled)} ${p}%`;
}

/** Par etiqueta/valor alineado para tarjetas. */
export function kv(label, value) { return `${label}: *${value}*`; }

/** Pie decorativo de marca. */
export function brand(name = 'KimdanBot') { return `⬣ ${name} · 💜 BL/Yaoi`; }
