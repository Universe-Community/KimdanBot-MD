// kim/handler.js — Despachador (ESM, Baileys v7).
//
// CAMBIOS CLAVE de esta versión:
//
// 1) cmdMap se construye AUTOMÁTICAMENTE desde el registry, así que
//    cualquier comando nuevo definido en commands.js se inscribe solo
//    en el dispatch sin tocar este archivo.
//
// 2) BUG FIX del admin check: el bot en v7 tiene DOS identidades:
//      • conn.user.id   → PN format (xxx@s.whatsapp.net)
//      • conn.user.lid  → LID format (xxx@lid)
//    La lista de admins de un grupo puede contener cualquiera de las
//    dos formas dependiendo de si el grupo migró a LIDs. Mi código
//    anterior solo comparaba contra UNA. Ahora compara contra AMBAS,
//    así que .promote/.del/.kick ya no fallan con "Necesito ser admin"
//    cuando el bot SÍ es admin.
//
// 3) Flujo lineal transparente: cada mensaje pasa por los mismos pasos.
//    Sin tiers, sin Promise.race con timeout artificial.

import { Boom } from '@hapi/boom';
import { DisconnectReason } from 'baileys';
import util from 'util';
import chalk from 'chalk';
import { smsg, getGroupAdmins } from './helpers.js';
import { getUser, getChat, getSettings, db } from './db.js';
import { runMiddleware } from './middleware.js';
import './commands.js'; // ← side-effect import: registra TODOS los comandos
import './commands_extra.js'; // ← comandos migrados desde el bot de referencia
import './commands_pack2.js'; // ← #tag + economía oficial JX/HG/AP + actividad + afinidad
import './commands_pack3.js'; // ← gacha BL/Yaoi + interacciones anime SFW (GIFs)
import './commands_pack4.js'; // ← perfiles, admin, utilidades, descargas, subbots
import './commands_pack5.js'; // ← sistema BL: búsqueda manga/manhwa/novelas + colección
import './commands_pack6.js'; // ← sistema completo de stickers y packs
import './commands_pack7.js'; // ← VIP + comandos owner de economía (dar/quitar dinero, exp, diamantes)
import * as commands from './commands.js'; // para los atajos del owner
import { buildCmdMap, commandCount, aliasCount } from './registry.js';

const GROUP_META_TTL_MS = 10 * 60 * 1000;
const ERROR_THROTTLE_MS = 60 * 1000;

export class Handler {
    constructor(conn) {
        this.conn = conn;

        this.ownerSet = new Set(
            (Array.isArray(global.owner) ? global.owner : [])
                .map(o => Array.isArray(o) ? o[0] : null)
                .filter(Boolean)
        );

        // VIP estáticos declarados en settings.js (global.vip = [...global.owner]).
        // Mismo formato que owner: ['numero', 'nombre', bool].
        this.vipSet = new Set(
            (Array.isArray(global.vip) ? global.vip : [])
                .map(o => Array.isArray(o) ? o[0] : (typeof o === 'string' ? o.split('@')[0] : null))
                .filter(Boolean)
        );

        this.groupMetaCache = new Map();
        this._adminSetCache = new Map();   // jid → { set, sig, ts } (variantes LID de admins)
        this.errorCooldown = new Map();
        this._botJid = null;
        this._botLid = null;

        // Construye el cmdMap desde el registry — todos los comandos
        // declarados en commands.js entran aquí automáticamente.
        this.cmdMap = buildCmdMap();
        console.log(chalk.cyan(`[Handler] ${commandCount()} comandos cargados (${aliasCount()} con aliases).`));

        this.onMessageUpsert = this.onMessageUpsert.bind(this);
        this.onGroupParticipantsUpdate = this.onGroupParticipantsUpdate.bind(this);
        this.onGroupsUpdate = this.onGroupsUpdate.bind(this);
        this.onConnectionUpdate = this.onConnectionUpdate.bind(this);
    }

    setRestart(fn) { this._restart = fn; }

    /** PN del bot (xxx@s.whatsapp.net). Cacheado. */
    _getBotJid() {
        if (this._botJid) return this._botJid;
        const id = this.conn.user?.id;
        if (!id) return null;
        this._botJid = this.conn.decodeJid?.(id) || id;
        return this._botJid;
    }

    /** LID del bot (xxx@lid). Cacheado. Puede ser null si v7 no lo expone. */
    _getBotLid() {
        if (this._botLid !== null) return this._botLid || null;
        const lid = this.conn.user?.lid;
        if (!lid) { this._botLid = false; return null; }
        this._botLid = this.conn.decodeJid?.(lid) || lid;
        return this._botLid;
    }

    /**
     * Owner check tolerante a LID y PN.
     *
     * El ownerSet contiene los NÚMEROS DE TELÉFONO del propietario
     * (de global.owner). El sender puede venir como:
     *   • PN (xxx@s.whatsapp.net) → numero == teléfono, match directo ✓
     *   • LID (xxx@lid)           → numero ≠ teléfono, NO match directo
     *
     * Para el caso LID, intentamos resolverlo a PN usando lidMapping.
     */
    async _isOwnerAsync(jid, jidAlt) {
        if (this.ownerSet.size === 0) return false;
        const candidates = new Set();
        const lm = this.conn?.signalRepository?.lidMapping;
        for (const j of [jid, jidAlt].filter(Boolean)) {
            candidates.add(String(j).split('@')[0]);
            // LID → PN
            if (j.endsWith('@lid')) {
                try { const pn = await lm?.getPNForLID?.(j); if (pn) candidates.add(String(pn).split('@')[0]); } catch { /* */ }
            }
            // PN → LID (por si el owner está listado por su LID, caso raro pero posible)
            if (j.endsWith('@s.whatsapp.net')) {
                try { const lid = await lm?.getLIDForPN?.(j); if (lid) candidates.add(String(lid).split('@')[0]); } catch { /* */ }
            }
        }
        for (const num of candidates) {
            if (num && this.ownerSet.has(num)) return true;
        }
        // Última red de seguridad: si llegó un LID y nada coincidió (lidMapping
        // vacío y sin remoteJidAlt), intenta resolver el PN real vía onWhatsApp.
        // Solo se ejecuta cuando todo lo demás falló, así que no añade latencia
        // al caso normal.
        try {
            const lid = [jid, jidAlt].find(j => j && j.endsWith('@lid'));
            if (lid && this.conn?.onWhatsApp) {
                const res = await this.conn.onWhatsApp(lid);
                for (const r of (Array.isArray(res) ? res : [])) {
                    const num = String(r?.jid || r?.id || '').split('@')[0];
                    if (num && this.ownerSet.has(num)) return true;
                }
            }
        } catch { /* */ }
        return false;
    }

    /** Versión sincrónica (retrocompatibilidad). */
    _isOwner(jid, jidAlt) {
        if (this.ownerSet.size === 0) return false;
        const numLid = jid ? String(jid).split('@')[0] : '';
        const numPn  = jidAlt ? String(jidAlt).split('@')[0] : '';
        return (numLid && this.ownerSet.has(numLid)) ||
               (numPn  && this.ownerSet.has(numPn));
    }

    /** ¿El sender está en la lista VIP estática de settings.js (global.vip)? */
    _isVipGlobal(jid, jidAlt) {
        if (!this.vipSet || this.vipSet.size === 0) return false;
        const numLid = jid ? String(jid).split('@')[0] : '';
        const numPn  = jidAlt ? String(jidAlt).split('@')[0] : '';
        return (numLid && this.vipSet.has(numLid)) ||
               (numPn  && this.vipSet.has(numPn));
    }

    /**
     * Chequea si el bot es admin del grupo, considerando AMBAS
     * identidades (PN + LID). Antes solo checaba conn.user.id contra
     * la lista y fallaba si el grupo había migrado a LIDs.
     */
    _isBotAdmin(admins) {
        if (!Array.isArray(admins) || admins.length === 0) return false;
        const botJid = this._getBotJid();
        const botLid = this._getBotLid();
        return !!(
            (botJid && admins.includes(botJid)) ||
            (botLid && admins.includes(botLid))
        );
    }

    /**
     * Devuelve TODAS las formas conocidas de un JID (PN + LID).
     * Usa signalRepository.lidMapping de Baileys v7 para resolver el
     * formato opuesto al que vino. Si el mapping no está disponible,
     * retorna el JID original.
     *
     * Esto es crítico para el admin check: en v7 los admins de la lista
     * pueden venir en LID, pero el m.sender del usuario que envió el
     * mensaje puede venir en PN (o al revés). Sin expansión, la
     * comparación de strings nunca coincide aunque sea el mismo usuario.
     */
    async _expandJidVariants(jid) {
        const out = new Set();
        if (!jid) return out;
        out.add(jid);
        const lm = this.conn?.signalRepository?.lidMapping;
        if (!lm) return out;
        try {
            if (jid.endsWith('@lid') && typeof lm.getPNForLID === 'function') {
                const pn = await lm.getPNForLID(jid);
                if (pn) out.add(pn);
            } else if (jid.endsWith('@s.whatsapp.net') && typeof lm.getLIDForPN === 'function') {
                const lid = await lm.getLIDForPN(jid);
                if (lid) out.add(lid);
            }
        } catch { /* */ }
        return out;
    }

    /** Une las variantes (PN + LID) de TODOS los admins en un único Set. */
    async _buildAdminVariantSet(admins) {
        const set = new Set();
        for (const a of admins || []) {
            const variants = await this._expandJidVariants(a);
            for (const v of variants) set.add(v);
        }
        return set;
    }

    /**
     * adminSet cacheado por grupo. Las variantes LID de los admins cambian
     * muy poco (solo al promover/degradar), así que recalcularlas en cada
     * comando es desperdicio. Se invalida junto con la metadata del grupo.
     */
    async _getAdminVariantSet(jid, admins) {
        const now = Date.now();
        const cached = this._adminSetCache.get(jid);
        const sig = (admins || []).join(',');
        if (cached && cached.sig === sig && now - cached.ts < GROUP_META_TTL_MS) return cached.set;
        const set = await this._buildAdminVariantSet(admins);
        this._adminSetCache.set(jid, { set, sig, ts: now });
        if (this._adminSetCache.size > 300) {
            // poda simple: borra entradas vencidas
            for (const [k, v] of this._adminSetCache) {
                if (now - v.ts > GROUP_META_TTL_MS) this._adminSetCache.delete(k);
            }
        }
        return set;
    }

    /** Une las variantes (PN + LID) del sender en un Set. */
    async _buildSenderVariantSet(m) {
        const set = new Set();
        for (const j of [m.sender, m.senderAlt].filter(Boolean)) {
            const variants = await this._expandJidVariants(j);
            for (const v of variants) set.add(v);
        }
        return set;
    }

    async _getGroupMetadata(jid) {
        const now = Date.now();
        const cached = this.groupMetaCache.get(jid);
        if (cached && now - cached.ts < GROUP_META_TTL_MS) return cached.data;
        try {
            const data = await this.conn.groupMetadata(jid);
            this.groupMetaCache.set(jid, { data, ts: now });
            // Tope de memoria: si crece demasiado, poda entradas vencidas.
            if (this.groupMetaCache.size > 300) {
                for (const [k, v] of this.groupMetaCache) {
                    if (now - v.ts > GROUP_META_TTL_MS) this.groupMetaCache.delete(k);
                }
            }
            return data;
        } catch { return null; }
    }

    _invalidateGroup(jid) { this.groupMetaCache.delete(jid); this._adminSetCache.delete(jid); }

    // ═══════════════════════════════════════════════════════════════
    // connection.update
    // ═══════════════════════════════════════════════════════════════

    async onConnectionUpdate(update) {
        const { connection, lastDisconnect, isNewLogin, receivedPendingNotifications } = update;

        if (connection === 'connecting') {
            console.log(chalk.yellow('[CONEXIÓN] Conectando con WhatsApp...'));
            return;
        }

        if (connection === 'open') {
            global._reconnectAttempts = 0;
            this._botJid = null;
            this._botLid = null;
            console.log(chalk.greenBright(`[CONEXIÓN] ✓ ${global.lenguaje?.smsConectado?.() || 'Conectado.'}`));
            if (isNewLogin) console.log(chalk.green('[CONEXIÓN] Nueva sesión iniciada.'));
            if (receivedPendingNotifications) console.log(chalk.gray('[CONEXIÓN] Pendientes recibidas.'));
            return;
        }

        if (connection === 'close') {
            const err = lastDisconnect?.error;
            const code = (err instanceof Boom ? err : new Boom(err)).output?.statusCode;
            const reasonName = Object.entries(DisconnectReason).find(([, v]) => v === code)?.[0] || 'desconocido';
            console.log(chalk.red(`[CONEXIÓN] Cerrada — código ${code} (${reasonName}).`));

            if (code === DisconnectReason.loggedOut || code === DisconnectReason.badSession) {
                console.log(chalk.red(
                    code === DisconnectReason.loggedOut
                        ? '[CONEXIÓN] Sesión cerrada desde el teléfono. Borra "authFolder/" y reinicia.'
                        : '[CONEXIÓN] Sesión corrupta. Borra "authFolder/" y reinicia.'
                ));
                return;
            }

            if (typeof this._restart === 'function') {
                setTimeout(() => this._restart().catch(e =>
                    console.error(chalk.red('[CONEXIÓN] restart:'), e?.message || e)
                ), 2000);
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // messages.upsert — procesa TODOS los mensajes, batch concurrente
    // ═══════════════════════════════════════════════════════════════

    async onMessageUpsert(update) {
        if (update?.type === 'append') return; // sync histórico
        const messages = update?.messages || [];
        if (!messages.length) return;

        // Procesa con CONCURRENCIA ACOTADA. Un upsert puede traer cientos de
        // mensajes; lanzarlos todos a la vez (Promise.allSettled puro)
        // inundaba el event loop en grupos muy activos. Procesamos en lotes
        // de tamaño fijo para mantener el bot responsivo.
        const LIMIT = 8;
        for (let i = 0; i < messages.length; i += LIMIT) {
            const slice = messages.slice(i, i + LIMIT);
            await Promise.allSettled(slice.map(raw => this._handleOne(raw)));
        }
    }

    async _handleOne(raw) {
        try {
            // Filtros mínimos
            if (!raw?.message) return;
            const remoteJid = raw.key?.remoteJid;
            if (!remoteJid) return;

            // Saltamos status broadcasts (~100/min de spam de "estados").
            // Si los quieres procesar, comenta esta línea.
            if (remoteJid === 'status@broadcast') return;

            // Parseo. smsg desempaca ephemeral/viewOnce y filtra meta keys.
            const m = smsg(this.conn, raw, null);
            if (!m) return;

            // Detección de prefijo y comando
            const body = m.text || '';
            const prefixes = Array.isArray(global.prefix) && global.prefix.length
                ? global.prefix : ['.', '#'];
            const usedPrefix = typeof body === 'string'
                ? prefixes.find(p => body.startsWith(p))
                : null;

            m._isCmd = !!usedPrefix;
            m.prefix = usedPrefix || '';
            m.command = m._isCmd
                ? body.slice(usedPrefix.length).trim().split(/\s+/)[0].toLowerCase()
                : '';
            m.args = m._isCmd
                ? body.slice(usedPrefix.length).trim().split(/\s+/).slice(1)
                : [];
            m.text2 = m.args.join(' ');
            // isOwner: el chequeo async (resuelve LID vía lidMapping) solo se
            // necesita para comandos y atajos de owner. Para mensajes normales
            // usamos el chequeo síncrono (sin await), que es suficiente y barato.
            const needsOwnerCheck = m._isCmd || (typeof body === 'string' && /^(=>|>|\$)/.test(body));
            m.isOwner = m.fromMe
                || (needsOwnerCheck ? await this._isOwnerAsync(m.sender, m.senderAlt)
                                    : this._isOwner(m.sender, m.senderAlt));
            // VIP: lista estática de settings.js (global.vip) O flag en la DB.
            {
                let dbVip = false;
                try {
                    const u = getUser(m.sender);
                    dbVip = !!u?.vip && (!u.vipUntil || Date.now() <= u.vipUntil);
                } catch { /* */ }
                m.isVip = m.isOwner || this._isVipGlobal(m.sender, m.senderAlt) || dbVip;
            }

            // Metadata de grupo (cacheada) + admin checks LID-AWARE.
            //
            // CAUSA RAÍZ del "deja de responder en grupos activos": este
            // bloque hacía decenas de `await lidMapping.getPNForLID(...)` por
            // CADA mensaje (incluidos los que no son comandos). En grupos
            // grandes y activos eso saturaba el event loop con microtareas y
            // los mensajes se encolaban más rápido de lo que se procesaban.
            //
            // FIX: el cálculo costoso de permisos solo se hace cuando hay un
            // comando (m._isCmd). Para mensajes normales basta con adjuntar la
            // metadata cacheada (barata) y dejar el conteo de actividad.
            if (m.isGroup) {
                const meta = await this._getGroupMetadata(remoteJid);
                if (meta) {
                    m.groupMetadata = meta;
                    m.participants  = meta.participants;
                    m.groupName     = meta.subject;

                    if (m._isCmd) {
                        const admins = getGroupAdmins(meta.participants || []);
                        // adminSet cacheado por grupo (las variantes LID de los
                        // admins cambian poco; recalcular en cada comando es caro).
                        const adminSet = await this._getAdminVariantSet(remoteJid, admins);
                        const senderSet = await this._buildSenderVariantSet(m);

                        let isSender = false;
                        for (const s of senderSet) { if (adminSet.has(s)) { isSender = true; break; } }

                        const botJid = this._getBotJid();
                        const botLid = this._getBotLid();
                        const botSet = new Set();
                        for (const j of [botJid, botLid].filter(Boolean)) {
                            const variants = await this._expandJidVariants(j);
                            for (const v of variants) botSet.add(v);
                        }
                        let isBot = false;
                        for (const b of botSet) { if (adminSet.has(b)) { isBot = true; break; } }

                        m.isBotAdmin    = isBot;
                        m.isSenderAdmin = isSender;
                        m.groupAdmins   = admins;

                        console.log(chalk.gray(
                            `[perm] sender=[${[...senderSet].join(' | ')}] ` +
                            `admins=[${[...adminSet].slice(0, 4).join(' | ')}${adminSet.size > 4 ? ' …' : ''}] ` +
                            `bot=[${[...botSet].join(' | ')}] ` +
                            `→ isSenderAdmin:${isSender} isBotAdmin:${isBot} isOwner:${m.isOwner}`
                        ));
                    } else {
                        // Mensaje normal (no comando): admins en forma simple,
                        // sin expansión LID (no se necesita y sería caro).
                        m.groupAdmins = getGroupAdmins(meta.participants || []);
                    }
                }
            }

            // Log
            this._logMsg(m, body);

            // Conteo de actividad (ligero, sin escritura inmediata a disco):
            // por usuario/grupo guardamos nº de mensajes y último visto.
            if (m.isGroup && m.sender && !m.fromMe) {
                try {
                    const u = getUser(m.sender);
                    u.activity ||= {};
                    const a = (u.activity[m.chat] ||= { count: 0, last: 0 });
                    a.count++; a.last = Date.now();
                    db.markDirty(); // se persiste en el flush periódico, no aquí
                } catch { /* */ }
            }

            // Atajos del owner sin prefijo (>, =>, $)
            if (m.isOwner && !m._isCmd && body) {
                if (body.startsWith('=>')) return commands.evalAsync(this.conn, m, [], body.slice(2).trim());
                if (body.startsWith('>'))  return commands.evalSync(this.conn, m, [], body.slice(1).trim());
                if (body.startsWith('$'))  return commands.shell(this.conn, m, [], body.slice(1).trim());
            }

            // Middleware (anti-* + AFK)
            const blocked = await runMiddleware(this.conn, m).catch(err => {
                console.error(chalk.red('[Handler] middleware:'), err?.message || err);
                return false;
            });
            if (blocked) return;

            // Dispatch del comando
            if (!m._isCmd || !m.command) return;
            const fn = this.cmdMap.get(m.command);
            if (!fn) return; // comando desconocido — silencio

            try {
                await fn(this.conn, m, m.args, m.text2);
            } catch (err) {
                console.error(chalk.red(`[Handler] "${m.command}":`), err?.message || err);
                try { await m.reply('❌ ' + (err?.message || 'Error desconocido')); }
                catch { /* */ }
            }
        } catch (err) {
            console.error(chalk.red('[Handler] _handleOne:'), err?.message || err);
            this._notifyOwnerOnce(err);
        }
    }

    _logMsg(m, body) {
        try {
            const hh = new Date().toTimeString().slice(0, 8);
            const place = m.isGroup ? chalk.cyan(m.groupName || 'grupo') : chalk.gray('priv');
            const display = body && body.trim()
                ? (body.length > 80 ? body.slice(0, 80) + '…' : body)
                : `[${m.mtype || '?'}]`;
            const who = m.pushName || m.sender?.split('@')[0] || '?';
            console.log(
                chalk.bold.magenta('[MSG]'),
                chalk.gray(hh),
                chalk.yellow(who), '@', place,
                m._isCmd ? chalk.greenBright('»') : '→',
                chalk.white(display)
            );
        } catch { /* */ }
    }

    // ═══════════════════════════════════════════════════════════════
    // Eventos de grupo
    // ═══════════════════════════════════════════════════════════════

    async onGroupsUpdate(updates) {
        for (const u of updates || []) if (u?.id) this._invalidateGroup(u.id);
    }

    async onGroupParticipantsUpdate(event) {
        // Solo invalida el cache. Los mensajes bonitos los maneja
        // kim/announcements.js, que se conecta aparte desde index.js.
        const { id } = event || {};
        if (id) this._invalidateGroup(id);
    }

    _notifyOwnerOnce(error) {
        if (!error) return;
        const key = String(error?.message || error).slice(0, 80);
        const now = Date.now();
        const last = this.errorCooldown.get(key) || 0;
        if (now - last < ERROR_THROTTLE_MS) return;
        this.errorCooldown.set(key, now);

        if (this.errorCooldown.size > 200) {
            for (const [k, ts] of this.errorCooldown) {
                if (now - ts > ERROR_THROTTLE_MS * 5) this.errorCooldown.delete(k);
            }
        }

        const ownerJid = (() => {
            const first = global.owner?.find(o => Array.isArray(o) && o[0]);
            return first ? `${first[0]}@s.whatsapp.net` : null;
        })();
        if (!ownerJid) return;
        const formatted = util.format(error).slice(0, 1500);
        this.conn.sendMessage(ownerJid, { text: `⚠️ *Error*\n\n${formatted}` })
            .catch(() => { /* */ });
    }
}
