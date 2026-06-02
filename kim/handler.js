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
import { getUser, getChat, getSettings } from './db.js';
import { runMiddleware } from './middleware.js';
import './commands.js'; // ← side-effect import: registra TODOS los comandos
import './commands_extra.js'; // ← comandos migrados desde el bot de referencia
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

        this.groupMetaCache = new Map();
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
        for (const j of [jid, jidAlt].filter(Boolean)) {
            candidates.add(String(j).split('@')[0]);
            // Si es LID, intentar resolver a PN
            if (j.endsWith('@lid')) {
                try {
                    const pn = await this.conn?.signalRepository?.lidMapping?.getPNForLID?.(j);
                    if (pn) candidates.add(String(pn).split('@')[0]);
                } catch { /* */ }
            }
        }
        for (const num of candidates) {
            if (num && this.ownerSet.has(num)) return true;
        }
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
            return data;
        } catch { return null; }
    }

    _invalidateGroup(jid) { this.groupMetaCache.delete(jid); }

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

        // Procesa el batch en paralelo. Errores quedan aislados por mensaje.
        await Promise.allSettled(messages.map(raw => this._handleOne(raw)));
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
            m.isOwner = (await this._isOwnerAsync(m.sender, m.senderAlt)) || m.fromMe;

            // Metadata de grupo (cacheada) + admin checks LID-AWARE
            if (m.isGroup) {
                const meta = await this._getGroupMetadata(remoteJid);
                if (meta) {
                    // getGroupAdmins ahora recoge id + lid + phoneNumber de
                    // cada admin (todas las formas conocidas).
                    const admins = getGroupAdmins(meta.participants || []);

                    // Expandimos admins y sender con signalRepository.lidMapping
                    // para que la comparación LID↔PN funcione aunque vengan
                    // los dos lados en formatos distintos.
                    const adminSet     = await this._buildAdminVariantSet(admins);
                    const senderSet    = await this._buildSenderVariantSet(m);

                    // Intersección: ¿alguna variante del sender está entre los admins?
                    let isSender = false;
                    for (const s of senderSet) {
                        if (adminSet.has(s)) { isSender = true; break; }
                    }

                    // Bot admin: también con expansión LID↔PN
                    const botJid = this._getBotJid();
                    const botLid = this._getBotLid();
                    const botSet = new Set();
                    for (const j of [botJid, botLid].filter(Boolean)) {
                        const variants = await this._expandJidVariants(j);
                        for (const v of variants) botSet.add(v);
                    }
                    let isBot = false;
                    for (const b of botSet) {
                        if (adminSet.has(b)) { isBot = true; break; }
                    }

                    m.isBotAdmin    = isBot;
                    m.isSenderAdmin = isSender;
                    m.groupMetadata = meta;
                    m.participants  = meta.participants;
                    m.groupAdmins   = admins;
                    m.groupName     = meta.subject;

                    // Log diagnóstico: si los checks fallan, verás exactamente
                    // qué hay en cada lado y por qué no coincide.
                    if (m._isCmd) {
                        console.log(chalk.gray(
                            `[perm] sender=[${[...senderSet].join(' | ')}] ` +
                            `admins=[${[...adminSet].slice(0, 4).join(' | ')}${adminSet.size > 4 ? ' …' : ''}] ` +
                            `bot=[${[...botSet].join(' | ')}] ` +
                            `→ isSenderAdmin:${isSender} isBotAdmin:${isBot} isOwner:${m.isOwner}`
                        ));
                    }
                }
            }

            // Log
            this._logMsg(m, body);

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
