// kim/subbots/store.js — Persistencia de LICENCIAS de sub-bots.
// ─────────────────────────────────────────────────────────────────────
// Fuente de verdad del ciclo de vida (permanente/temporal) de cada sub-bot.
// La SESIÓN Baileys la gestiona SubBotManager; aquí solo vive la licencia:
// quién es el dueño, cuándo se creó, cuándo expira y en qué estado está.
//
// Backend:
//   • MongoDB (mongoose) si process.env.MONGODB_URI está definido — con
//     ÍNDICES para que el servicio de expiración consulte solo lo necesario.
//   • Fallback a JSON local (subbots/licenses.json) si no hay Mongo, igual
//     que el resto del bot (degradación elegante, nunca rompe el arranque).
//
// La API es asíncrona y uniforme para ambos backends.

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve('./subbots');
const JSON_PATH = path.join(ROOT, 'licenses.json');

export const STATES = Object.freeze({
    ACTIVE:    'active',
    PERMANENT: 'permanent',
    SUSPENDED: 'suspended',
    EXPIRED:   'expired',
});

// ─── Parser de duración ─────────────────────────────────────────────
// Acepta: 12h 24h 48h · 7d 15d 30d 90d · 2w 3w · 1m 3m 6m 12m · 1a 2a
//         y "permanente" (perm / p / permanent / infinito / ∞).
// Devuelve { permanent:boolean, ms:number|null, label:string } o null si
// el formato es inválido.
const UNIT_MS = {
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    m: 30 * 24 * 60 * 60 * 1000,   // mes = 30 días
    a: 365 * 24 * 60 * 60 * 1000,  // año = 365 días
};
const UNIT_LABEL = { h: 'hora(s)', d: 'día(s)', w: 'semana(s)', m: 'mes(es)', a: 'año(s)' };

export function parseDuration(input) {
    const raw = String(input || '').trim().toLowerCase();
    if (!raw) return null;
    if (['permanente', 'permanent', 'perm', 'p', 'infinito', '∞'].includes(raw)) {
        return { permanent: true, ms: null, label: 'permanente' };
    }
    // año también como 'y'; mes también acepta 'mes'; normalizamos.
    const m = raw.match(/^(\d+)\s*(h|d|w|m|a|y)$/);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    let unit = m[2];
    if (unit === 'y') unit = 'a';
    const ms = n * UNIT_MS[unit];
    return { permanent: false, ms, label: `${n} ${UNIT_LABEL[unit]}` };
}

// Formatea un tiempo restante (ms) en texto legible corto.
export function formatRemaining(ms) {
    if (ms == null) return 'permanente';
    if (ms <= 0) return 'expirado';
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const min = Math.floor((s % 3600) / 60);
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (min && !d) parts.push(`${min}m`);
    return parts.join(' ') || '<1m';
}

// ─── Backend Mongo (perezoso) ───────────────────────────────────────
let _mongoModel = null;
let _mongoTried = false;

async function getMongoModel() {
    if (_mongoModel) return _mongoModel;
    if (_mongoTried) return null;
    _mongoTried = true;
    const URI = process.env.MONGODB_URI || '';
    if (!URI) return null;
    try {
        const mongoose = (await import('mongoose')).default;
        if (mongoose.connection.readyState !== 1) {
            await mongoose.connect(URI);
        }
        const schema = new mongoose.Schema({
            _id:        { type: String },        // id saneado (solo dígitos)
            ownerJid:   { type: String, index: true },
            number:     { type: String },
            createdAt:  { type: Number, default: () => Date.now() },
            expiresAt:  { type: Number, default: null, index: true }, // null = permanente
            durationMs: { type: Number, default: null },
            durationLabel: { type: String, default: 'permanente' },
            state:      { type: String, default: STATES.PERMANENT, index: true },
            deletedAt:  { type: Number, default: null },
            notifyUser: { type: Boolean, default: false },
        }, { versionKey: false, collection: 'Kim.SubBots' });
        // Índice compuesto: el barrido de expiración filtra por estado + fecha.
        schema.index({ state: 1, expiresAt: 1 });
        try { _mongoModel = mongoose.model('Kim.SubBots'); }
        catch { _mongoModel = mongoose.model('Kim.SubBots', schema); }
        // Garantiza que los índices existan en el servidor.
        _mongoModel.createIndexes().catch(() => {});
        return _mongoModel;
    } catch (e) {
        console.error('[subbot-store] Mongo no disponible, usando JSON local:', e?.message || e);
        return null;
    }
}

// ─── Backend JSON local ─────────────────────────────────────────────
function readJson() {
    try { return JSON.parse(fs.readFileSync(JSON_PATH, 'utf8')); } catch { return {}; }
}
function writeJson(obj) {
    try {
        if (!fs.existsSync(ROOT)) fs.mkdirSync(ROOT, { recursive: true });
        const tmp = JSON_PATH + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
        fs.renameSync(tmp, JSON_PATH);
    } catch (e) { console.error('[subbot-store] JSON write:', e?.message || e); }
}

// ─── API pública (uniforme Mongo/JSON) ──────────────────────────────

function normalize(doc) {
    if (!doc) return null;
    const o = doc.toObject ? doc.toObject() : { ...doc };
    o.id = o._id ?? o.id;
    return o;
}

/**
 * Crea o renueva una licencia. `duration` es la salida de parseDuration().
 * Si `duration` es permanente → expiresAt=null, state='permanent'.
 */
export async function upsertLicense({ id, ownerJid, number, duration, notifyUser = false }) {
    const now = Date.now();
    const permanent = !duration || duration.permanent;
    const expiresAt = permanent ? null : now + duration.ms;
    const state = permanent ? STATES.PERMANENT : STATES.ACTIVE;
    const record = {
        _id: id, ownerJid, number: number || id,
        createdAt: now, expiresAt,
        durationMs: permanent ? null : duration.ms,
        durationLabel: permanent ? 'permanente' : duration.label,
        state, deletedAt: null, notifyUser: !!notifyUser,
    };

    const Model = await getMongoModel();
    if (Model) {
        const doc = await Model.findByIdAndUpdate(id, record, { upsert: true, new: true, setDefaultsOnInsert: true });
        return normalize(doc);
    }
    const all = readJson();
    all[id] = { ...record, id };
    writeJson(all);
    return all[id];
}

export async function getLicense(id) {
    const Model = await getMongoModel();
    if (Model) return normalize(await Model.findById(id));
    return readJson()[id] || null;
}

export async function listLicenses(filter = {}) {
    const Model = await getMongoModel();
    if (Model) return (await Model.find(filter).lean()).map(d => ({ ...d, id: d._id }));
    let arr = Object.values(readJson());
    for (const [k, v] of Object.entries(filter)) {
        if (v && typeof v === 'object' && '$in' in v) arr = arr.filter(x => v.$in.includes(x[k]));
        else arr = arr.filter(x => x[k] === v);
    }
    return arr;
}

/**
 * Devuelve las licencias temporales YA vencidas y aún activas.
 * Consulta indexada: state='active' AND expiresAt<=now. No recorre todo.
 */
export async function findExpired(now = Date.now()) {
    const Model = await getMongoModel();
    if (Model) {
        return (await Model.find({
            state: STATES.ACTIVE,
            expiresAt: { $ne: null, $lte: now },
        }).lean()).map(d => ({ ...d, id: d._id }));
    }
    return Object.values(readJson()).filter(x =>
        x.state === STATES.ACTIVE && x.expiresAt != null && x.expiresAt <= now);
}

export async function setState(id, state, extra = {}) {
    const Model = await getMongoModel();
    if (Model) return normalize(await Model.findByIdAndUpdate(id, { state, ...extra }, { new: true }));
    const all = readJson();
    if (!all[id]) return null;
    all[id] = { ...all[id], state, ...extra };
    writeJson(all);
    return all[id];
}

/** Suma (o resta, con ms negativo) tiempo a una licencia temporal. Nunca deja
 *  expiresAt por debajo de "ahora" (no permite tiempos negativos). */
export async function adjustTime(id, deltaMs) {
    const lic = await getLicense(id);
    if (!lic) return { ok: false, reason: 'not_found' };
    if (lic.expiresAt == null) return { ok: false, reason: 'permanent' };
    const now = Date.now();
    const base = Math.max(lic.expiresAt, now);
    let next = base + deltaMs;
    if (next < now) next = now; // nunca negativo
    const durationMs = Math.max(0, next - lic.createdAt);
    const updated = await setState(id, STATES.ACTIVE, { expiresAt: next, durationMs, deletedAt: null });
    return { ok: true, license: updated, expiresAt: next };
}

export async function removeLicense(id) {
    const Model = await getMongoModel();
    if (Model) { await Model.findByIdAndDelete(id); return true; }
    const all = readJson();
    if (all[id]) { delete all[id]; writeJson(all); return true; }
    return false;
}

export function sanitizeId(jid) { return String(jid || '').replace(/[^0-9]/g, '') || 'anon'; }
