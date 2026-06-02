// kim/announcements.js — Módulo independiente de eventos + anuncios.
//
// Centraliza TODOS los listeners de eventos de Baileys que producen
// anuncios automáticos. Tocar este archivo no afecta al despachador
// ni a los comandos.
//
// Eventos manejados:
//
//   group-participants.update → welcome / bye / promote / demote
//   groups.update             → cambio de nombre / descripción / foto
//   call                      → anti-llamada (rechaza + opcionalmente bloquea)
//   messages.upsert           → cache para anti-delete y AFK back
//   messages.update           → anti-delete + log de ediciones
//   presence.update           → "X volvió a estar online" si estaba AFK
//   contacts.update           → cambios de foto/nombre de contactos
//
// Configuración por chat (en chats[jid]):
//   welcome             → bienvenida (default true)
//   bye                 → despedida  (default true)
//   detect              → avisos promote/demote (default true)
//   notifyGroupChanges  → cambios de nombre/desc/foto (default true)
//   antidelete          → log de mensajes borrados (default false)
//   editlog             → log de ediciones (default false)
//
// Configuración global del bot (en settings[botJid]):
//   antillamada         → rechazar llamadas (default true)
//   bloquearLlamada     → además bloquear al que llama (default false)

import chalk from 'chalk';
import { getBuffer } from './helpers.js';
import { getChat, getSettings, db } from './db.js';

// ─── TEXTOS centralizados ───────────────────────────────────────────

export const ANNOUNCEMENT_TEXTS = {
    welcomeOpen:
        `───✱*.｡:｡✱*.:｡✧*.｡✰*.:｡✧*.｡:｡*.｡✱ ───\n\n*💐❈ ᑲіᥱᥒ᥎ᥱᥒіძ᥆* `,
    welcomeBody:
        `\n\n───✱*.｡:｡✱*.:｡✧*.｡✰*.:｡✧*.｡:｡*.｡✱ ───\n\n*🍓 һ᥆ᥣі s᥆ᥡ kіmძᥲᥒ ᥱᥣ һᥱrm᥆s᥆ ᥡ grᥲᥒძі᥆s᥆ ᑲ᥆𝗍 ძᥱ ᥱs𝗍ᥱ grᥙ⍴᥆ (✿❛◡❛) 🍓*\n\n     • ────── ✾ ────── •\n\n*🫐꙰୨୧₊ ᥱs⍴ᥱr᥆ ძіs𝖿rᥙ𝗍ᥱs 𝗍ᥙ ᥱs𝗍ᥲᥒᥴіᥲ ᥱᥒ ᥱs𝗍ᥱ һᥱrm᥆s᥆ grᥙ⍴᥆. ₊ ୨୧🫐꙰* \n\n      • ────── ✾ ────── •\n\n*📰 ⍴᥆r𝖿іs ᥣᥱᥱ ᥣᥲ ძᥱsᥴrі⍴ᥴі᥆́ᥒ ძᥱᥣ grᥙ⍴᥆ ᥙᥕᥙ, rᥱᥴᥙᥱrძᥲ sᥱgᥙіr ᥣᥲs rᥱgᥣᥲs 📰* ✨(♡´▽\`♡)✨\n\n✦▭▭▭✧◦✦◦✧▭▭▭✦`,
    welcomeTitle: `✧༺ 💞ճíҽղѵҽղíժօ💞 ༻✧`,

    byeOpen:
        `*╔═⪼ 🌺 𝐊𝐢𝐦𝐝𝐚𝐧𝐁𝐨𝐭-𝐌𝐃 🌺 ⪻═ ✿*\n*║ 🍇 sᥱ 𝖿ᥙᥱ`,
    byeBody:
        `*║ 🍬 grᥲᥴіᥲs por los ᑲᥙᥱᥒ᥆s m᥆mᥱᥒ𝗍᥆s*\n*║ ✨ 𝖿ᥙᥱ ᥙᥒ ⍴ᥣᥲᥴᥱr ᥴ᥆ᥒ᥆ᥴᥱr𝗍ᥱ*\n*║ 🫐 ᥲძі᥆́s. 🫐*\n*╚══════════════ ❀*`,
    byeTitle: `✧༺ 💔 αժíօ́s 💔 ༻✧`,

    promoteOpen:    `╔══════ ೋღ 🌺 ღೋ ══════┅\n║ 🎉 ᥒᥙᥱ᥎᥆ ᥲძmіᥒ 🎉\n║ 🌟`,
    promoteMid:     `ᥲһ᥆rᥲ ᥱs ᥲძmіᥒ 🌟\n║ 🌼 ᥆𝗍᥆rgᥲძ᥆ ⍴᥆r`,
    promoteClose:   `🌼\n╚══════ ೋღ 🌺 ღೋ ══════┅`,
    promoteTitle:   `⭐ 𝐍𝐮𝐞𝐯𝐨 𝐀𝐝𝐦𝐢𝐧𝐢𝐬𝐭𝐫𝐚𝐝𝐨𝐫 ⭐`,

    demoteOpen:     `╔══════ ೋღ 🌺 ღೋ ══════┅\n║ ❄ ᥙᥒ ᥲძmіᥒ mᥱᥒ᥆s ❄\n║ 🫐`,
    demoteMid:      `ძᥱȷᥲ ძᥱ sᥱr ᥲძmіᥒ 🫐\n║ 🌼 ᥲᥴᥴі᥆́ᥒ rᥱᥲᥣіzᥲძᥲ ⍴᥆r`,
    demoteTitle:    `🍃 𝐔𝐧 𝐀𝐝𝐦𝐢𝐧 𝐌𝐞𝐧𝐨𝐬 🍃`,

    groupOpen:
        `*✿═══━ ❀ ━═══✿*\n*🌸 𝐆𝐑𝐔𝐏𝐎 𝐀𝐁𝐈𝐄𝐑𝐓𝐎 🌸*\n*✿═══━ ❀ ━═══✿*\n\n*💐 Todos pueden enviar mensajes.*`,
    groupClose:
        `*✿═══━ ❀ ━═══✿*\n*🔒 𝐆𝐑𝐔𝐏𝐎 𝐂𝐄𝐑𝐑𝐀𝐃𝐎 🔒*\n*✿═══━ ❀ ━═══✿*\n\n*🌺 Solo los admins pueden escribir.*`,

    subjectChange:  `*✿ 𝐍𝐨𝐦𝐛𝐫𝐞 𝐝𝐞𝐥 𝐠𝐫𝐮𝐩𝐨 𝐚𝐜𝐭𝐮𝐚𝐥𝐢𝐳𝐚𝐝𝐨 ✿*`,
    descChange:     `*✿ 𝐃𝐞𝐬𝐜𝐫𝐢𝐩𝐜𝐢𝐨́𝐧 𝐝𝐞𝐥 𝐠𝐫𝐮𝐩𝐨 𝐚𝐜𝐭𝐮𝐚𝐥𝐢𝐳𝐚𝐝𝐚 ✿*`,
    iconChange:     `*✿ 𝐅𝐨𝐭𝐨 𝐝𝐞𝐥 𝐠𝐫𝐮𝐩𝐨 𝐚𝐜𝐭𝐮𝐚𝐥𝐢𝐳𝐚𝐝𝐚 ✿*`,

    callReject:
        `*(○｀д´)ﾉｼ  𝐒𝐓𝐎𝐏!* 🛑\n\n🫐❗ *𝐍𝐨 𝐬𝐞 𝐩𝐞𝐫𝐦𝐢𝐭𝐞𝐧 𝐥𝐥𝐚𝐦𝐚𝐝𝐚𝐬 𝐚𝐥 𝐛𝐨𝐭.* ❗🫐\n\n*🌟 𝐒𝐢 𝐧𝐞𝐜𝐞𝐬𝐢𝐭𝐚𝐬 𝐚𝐲𝐮𝐝𝐚, 𝐞𝐬𝐜𝐫𝐢𝐛𝐞 𝐞𝐧 𝐞𝐥 𝐜𝐡𝐚𝐭. 🌟*`,
    callBlocked:
        `🚫 *𝐔𝐬𝐮𝐚𝐫𝐢𝐨 𝐛𝐥𝐨𝐪𝐮𝐞𝐚𝐝𝐨* 🚫\n\nIntentaste llamarme. Si fue por error, contacta al creador.`,

    antideletePrefix:
        `🗑️ *𝐌𝐞𝐧𝐬𝐚𝐣𝐞 𝐛𝐨𝐫𝐫𝐚𝐝𝐨 𝐝𝐞𝐭𝐞𝐜𝐭𝐚𝐝𝐨*`,
    editPrefix:
        `✏️ *𝐌𝐞𝐧𝐬𝐚𝐣𝐞 𝐞𝐝𝐢𝐭𝐚𝐝𝐨*`,
    afkBackTitle:
        `🌸 *𝐃𝐞 𝐯𝐮𝐞𝐥𝐭𝐚 𝐝𝐞 𝐀𝐅𝐊*`,
};

const DEFAULT_GROUP_PIC = 'https://i.ibb.co/RBx5SQC/avatar-group-large-v2.png';

// ─── Caches en memoria ──────────────────────────────────────────────

// Cache de fotos de grupo (TTL 30 min)
const _groupPicCache = new Map();
const GROUP_PIC_TTL = 30 * 60 * 1000;

/**
 * Invalida (borra) la foto cacheada de un grupo. Se llama cuando el
 * icono del grupo cambia (groups.update → icon) o tras .setppgrupo,
 * para que el próximo anuncio que use la foto del grupo la vuelva a
 * descargar. Antes esta función se invocaba pero NO existía, lo que
 * lanzaba un ReferenceError silencioso y rompía el aviso de cambio de
 * foto. Se exporta para que commands.js pueda importarla.
 */
export function invalidateGroupPic(jid) {
    if (jid) _groupPicCache.delete(jid);
}

// Cache de mensajes recientes por chat (para anti-delete y edit log)
// chatJid → Map<messageId, {raw, savedAt, sender, body}>
const _messageCache = new Map();
const MAX_MSG_PER_CHAT = 200;
const MSG_TTL_MS = 60 * 60 * 1000; // 1h

// Cache de presencia (para AFK-back)
// jid → lastSeenOnline timestamp
const _presenceCache = new Map();

// Cooldown de avisos AFK-back (para no spamear)
const _afkBackCooldown = new Map();
const AFK_BACK_COOLDOWN_MS = 5 * 60 * 1000;

// ─── Helpers ────────────────────────────────────────────────────────

function botIdentities(conn) {
    const decode = conn.decodeJid || (j => j);
    return new Set([
        conn.user?.id  ? decode(conn.user.id)  : null,
        conn.user?.lid ? decode(conn.user.lid) : null,
    ].filter(Boolean));
}

// FIX v7 (versión final): los anuncios fallan silenciosamente cuando se
// envían con `externalAdReply` + padding de 850 caracteres invisibles
// (los chars U+200E del bot original). WhatsApp acepta el message ID
// del lado servidor pero filtra el contenido y nunca lo entrega al chat.
//
// Solución: enviar como IMAGEN con CAPTION. La foto del usuario es la
// imagen principal, el texto va abajo como caption. Es el tipo de mensaje
// más básico de WhatsApp y NUNCA se filtra. Si no hay foto, fallback a
// texto plano con mentions top-level.

const DEFAULT_USER_PIC = 'https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_960_720.png';

// Intenta convertir un LID a su PN equivalente para que las menciones
// se rendericen como @número-real en lugar de @LID-anónimo.
async function resolveJidForMention(conn, jid) {
    if (!jid || !jid.endsWith('@lid')) return jid;
    try {
        const pn = await conn.signalRepository?.lidMapping?.getPNForLID?.(jid);
        if (pn) return pn;
    } catch { /* */ }
    return jid;
}

/**
 * Obtiene el nombre para mostrar del usuario (notify / pushName / verifiedName).
 * Intenta varias fuentes:
 *   1. groupMetadata.participants — el server suele incluir notify
 *   2. conn.contacts — caché de contactos del bot
 *   3. Buscando también por LID/PN equivalente
 * Si no encuentra nada, retorna null y el caller debe caer al fallback @<número>.
 */
function getDisplayName(jid, conn, groupMeta) {
    if (!jid) return null;
    const candidates = [jid];
    // También probar la forma cruzada (si es LID, intentar PN, y viceversa)
    if (jid.endsWith('@lid')) candidates.push(jid.replace('@lid', '@s.whatsapp.net'));
    else if (jid.endsWith('@s.whatsapp.net')) candidates.push(jid.replace('@s.whatsapp.net', '@lid'));

    // 1) groupMetadata.participants
    const participants = groupMeta?.participants;
    if (Array.isArray(participants)) {
        for (const c of candidates) {
            const part = participants.find(p =>
                p?.id === c || p?.jid === c || p?.lid === c || p?.phoneNumber === c
            );
            if (part) {
                const name = part.notify || part.name || part.verifiedName || part.pushName;
                if (name && name.trim()) return name.trim();
            }
        }
    }

    // 2) conn.contacts (Map o objeto)
    if (conn?.contacts) {
        for (const c of candidates) {
            let contact = null;
            if (typeof conn.contacts.get === 'function') contact = conn.contacts.get(c);
            else if (typeof conn.contacts === 'object') contact = conn.contacts[c];
            if (contact) {
                const name = contact.notify || contact.name || contact.verifiedName || contact.pushName;
                if (name && name.trim()) return name.trim();
            }
        }
    }

    return null;
}

/**
 * Decide si se debe enviar un anuncio según la jerarquía de flags:
 *   allowAnnouncements (master) → categoría → individual
 * Si CUALQUIERA está explícitamente en false, retorna false.
 * Si todas están en true o undefined, retorna true.
 *
 * Uso: shouldAnnounce(chatCfg, 'notifyMembers', 'welcome')
 */
function shouldAnnounce(chatCfg, ...flags) {
    if (!chatCfg) return true;
    if (chatCfg.allowAnnouncements === false) return false; // master apagado
    for (const f of flags) {
        if (chatCfg[f] === false) return false; // categoría o individual apagado
    }
    return true;
}

async function getUserPicBuffer(conn, jid) {
    try {
        const url = await conn.profilePictureUrl(jid, 'image');
        const buf = await getBuffer(url);
        if (buf && buf.length > 100) return buf;
    } catch { /* */ }
    try {
        const buf = await getBuffer(DEFAULT_USER_PIC);
        if (buf && buf.length > 100) return buf;
    } catch { /* */ }
    return null;
}

/**
 * Envía un anuncio como imagen+caption (preferido) o texto plano
 * (fallback). Con timeout duro para detectar cuelgues.
 */
async function sendAnnouncement(conn, chatJid, text, mentions, picBuf, label = 'ann') {
    console.log(chalk.cyan(
        `[ann] ${label} → ${chatJid?.split('@')[0]} (txt:${text.length}ch, pic:${picBuf ? picBuf.length + 'B' : 'null'}, mentions:${mentions?.length || 0})`
    ));

    // Intento 1: imagen + caption (formato más confiable de v7)
    if (picBuf) {
        try {
            const result = await Promise.race([
                conn.sendMessage(chatJid, {
                    image: picBuf,
                    caption: text,
                    mentions,
                }),
                new Promise((_, rej) => setTimeout(
                    () => rej(new Error('Timeout 30s — imagen+caption colgado')), 30000
                )),
            ]);
            if (result?.key?.id) {
                console.log(chalk.green(`[ann] ✓ imagen+caption enviada, id: ${result.key.id}`));
                return result;
            }
            console.warn(chalk.yellow('[ann] imagen+caption respondió sin id'));
        } catch (err) {
            console.warn(chalk.yellow(`[ann] imagen+caption FALLÓ: ${err?.message || err}`));
        }
    }

    // Intento 2: texto puro con mentions top-level (formato más simple)
    try {
        const result = await Promise.race([
            conn.sendMessage(chatJid, { text, mentions }),
            new Promise((_, rej) => setTimeout(
                () => rej(new Error('Timeout 30s — texto plano colgado')), 30000
            )),
        ]);
        if (result?.key?.id) {
            console.log(chalk.green(`[ann] ✓ texto plano enviado, id: ${result.key.id}`));
            return result;
        }
    } catch (err) {
        console.error(chalk.red(`[ann] texto plano FALLÓ: ${err?.message || err}`));
    }

    return null;
}

// ─── group-participants.update ──────────────────────────────────────

async function onParticipantsUpdate(conn, event) {
    const { id: chatJid, participants, action, author } = event;

    console.log(chalk.bold.magenta(
        `[ann] ${action} en ${chatJid?.split('@')[0]}: ${participants?.length} usuario(s) [author: ${author ? author.split('@')[0] : '—'}]`
    ));

    if (!chatJid || !Array.isArray(participants) || participants.length === 0 || !action) {
        console.warn(chalk.yellow('[ann] evento incompleto, se omite'));
        return;
    }

    let chatCfg;
    try { chatCfg = getChat(chatJid); }
    catch (err) { console.error(chalk.red('[ann] getChat falló:'), err?.message); return; }
    console.log(chalk.gray(`[ann] cfg → master:${chatCfg.allowAnnouncements} miembros:${chatCfg.notifyMembers} welcome:${chatCfg.welcome} bye:${chatCfg.bye} detect:${chatCfg.detect}`));

    // Atajo: si todos los anuncios de miembros están apagados, ni siquiera
    // entremos al bucle. Nos ahorramos fetchear metadata + fotos.
    if (!shouldAnnounce(chatCfg, 'notifyMembers')) {
        console.log(chalk.gray('[ann] anuncios de miembros apagados — se omite todo'));
        return;
    }

    let meta = null;
    try { meta = await conn.groupMetadata(chatJid); }
    catch (err) { console.warn(chalk.yellow('[ann] groupMetadata falló (uso fallbacks):'), err?.message); }
    const subject = meta?.subject || 'este grupo';

    const botJids = botIdentities(conn);
    const botName = global.botname || 'KimdanBot-MD';

    for (const participant of participants) {
        const num = typeof participant === 'string'
            ? participant
            : (participant?.id ?? participant?.jid ?? '');
        if (!num) { console.warn('[ann] participante sin JID, se omite'); continue; }

        const isBotItself = botJids.has(num);
        const numClean = num.split('@')[0];

        console.log(chalk.gray(`[ann] participante: ${numClean} isBotItself=${isBotItself}`));
        if (isBotItself) continue;

        // ── ¿Quién hizo la acción? 4 escenarios posibles ────────────
        const isByOther = author && author !== num;
        const isByBot   = author && botJids.has(author);
        const isByAdmin = isByOther && !isByBot;
        const authorClean = author?.split('@')[0];

        // Resuelve LID → PN si es posible (para que las menciones se vean
        // como @número-real en lugar de @LID-anónimo).
        const numForMention    = await resolveJidForMention(conn, num);
        const authorForMention = author ? await resolveJidForMention(conn, author) : null;
        const mentions = [numForMention];
        if (isByAdmin && authorForMention) mentions.push(authorForMention);

        // ── FIX MENCIÓN (igual que el bot de referencia) ───────────
        // Una mención solo se renderiza como tag clickeable cuando el
        // @<número> del TEXTO coincide EXACTAMENTE con el user-part del
        // JID incluido en `mentions`. El bug anterior derivaba el número
        // mostrado de `num` (que en v7 puede ser un LID) mientras que
        // `mentions` llevaba el JID ya resuelto a PN → no coincidían y la
        // mención no se activaba. Ahora el número mostrado se deriva SIEMPRE
        // del mismo JID que va en `mentions`, garantizando la mención en
        // todos los casos (PN o LID).
        const numMentionClean    = String(numForMention || num).split('@')[0];
        const authorMentionClean = authorForMention
            ? String(authorForMention).split('@')[0]
            : (authorClean || '');

        // Si conocemos el nombre, lo mostramos junto al tag clickeable
        // (`Nombre @número`); si no, solo el tag `@número`.
        const userName   = getDisplayName(num, conn, meta);
        const authorName = author ? getDisplayName(author, conn, meta) : null;
        const userTag    = userName
            ? `*${userName}* @${numMentionClean}`
            : `@${numMentionClean}`;
        const authorTag  = authorName
            ? `*${authorName}* @${authorMentionClean}`
            : (authorMentionClean ? `@${authorMentionClean}` : '');

        // Foto de perfil del usuario (será la imagen principal del mensaje)
        const ppBuf = await getUserPicBuffer(conn, num);

        try {
            // ═════ BIENVENIDA (3 variantes según quién agregó) ═════
            if (action === 'add' && shouldAnnounce(chatCfg, 'notifyMembers', 'welcome')) {
                let text;
                if (isByAdmin) {
                    text =
`🌸 *¡Bienvenida(o) ${userTag}!* 💞

💐 Fuiste agregada(o) al grupo *${subject}* por ${authorTag}.

🍓 Soy *${botName}*, el bot kawaii del grupo (✿❛◡❛)

📰 Por favor lee la *descripción del grupo* y sigue las reglas.
✨(♡´▽\`♡)✨`;
                } else if (isByBot) {
                    text =
`🌸 *¡Bienvenida(o) ${userTag}!* 💞

💐 Fuiste agregada(o) al grupo *${subject}*.

🍓 Soy *${botName}*, el bot kawaii del grupo (✿❛◡❛)

📰 Por favor lee la *descripción del grupo*.
✨(♡´▽\`♡)✨`;
                } else {
                    // Variante: se unió por sí misma(o) (link de invitación)
                    text =
`🌸 *¡Bienvenida(o) ${userTag}!* 💞

💐 Te uniste al grupo *${subject}*.

🍓 Soy *${botName}*, el bot kawaii del grupo (✿❛◡❛)

🫐 Espero disfrutes tu estancia.
📰 Por favor lee la *descripción del grupo* y sigue las reglas.
✨(♡´▽\`♡)✨`;
                }
                await sendAnnouncement(conn, chatJid, text, mentions, ppBuf, 'welcome');
            }

            // ═════ DESPEDIDA (3 variantes según quién removió) ═════
            else if (action === 'remove' && shouldAnnounce(chatCfg, 'notifyMembers', 'bye')) {
                let text;
                if (isByAdmin) {
                    text =
`❌ *${userTag} fue expulsada(o) del grupo* 🍇

🫐 Acción realizada por ${authorTag}.
👋 Hasta luego.`;
                } else if (isByBot) {
                    text =
`❌ *${userTag} fue expulsada(o) del grupo* 🍇

🤖 Acción realizada por el bot.
👋 Hasta luego.`;
                } else {
                    text =
`👋 *${userTag} salió del grupo* 🍇

🍬 Gracias por los buenos momentos.
✨ Fue un placer conocerte.
🫐 Hasta pronto.`;
                }
                await sendAnnouncement(conn, chatJid, text, mentions, ppBuf, 'bye');
            }

            // ═════ ASCENSO A ADMIN ═════════════════════════════════
            else if (action === 'promote' && shouldAnnounce(chatCfg, 'notifyMembers', 'detect')) {
                const text = isByAdmin
                    ? `⭐ *¡Nuevo administrador!* 🎉

🌟 ${userTag} ahora es admin del grupo.
🌼 Promoción otorgada por ${authorTag}.`
                    : `⭐ *¡Nuevo administrador!* 🎉

🌟 ${userTag} ahora es admin del grupo.`;
                await sendAnnouncement(conn, chatJid, text, mentions, ppBuf, 'promote');
            }

            // ═════ DEGRADACIÓN DE ADMIN ════════════════════════════
            else if (action === 'demote' && shouldAnnounce(chatCfg, 'notifyMembers', 'detect')) {
                const text = isByAdmin
                    ? `🍃 *Un admin menos* 🫐

❄ ${userTag} ya no es admin del grupo.
🌼 Acción realizada por ${authorTag}.`
                    : `🍃 *Un admin menos* 🫐

❄ ${userTag} ya no es admin del grupo.`;
                await sendAnnouncement(conn, chatJid, text, mentions, ppBuf, 'demote');
            }

            else {
                console.log(chalk.gray(`[ann] acción '${action}' omitida (cfg desactivada o no aplica)`));
            }

        } catch (err) {
            console.error(chalk.red('[ann] error en bucle de participantes:'), err?.message || err);
        }
    }
}

// ─── groups.update ──────────────────────────────────────────────────

async function onGroupsUpdate(conn, updates) {
    for (const u of updates || []) {
        if (!u.id) continue;

        // Log diagnóstico: muestra qué campos cambió WhatsApp.
        const fields = Object.keys(u).filter(k => k !== 'id');
        console.log(chalk.bold.magenta(
            `[announcements] groups.update en ${u.id.split('@')[0]}: ${fields.join(', ')}`
        ));

        const chatCfg = getChat(u.id);
        // Atajo: si la categoría completa está apagada, salimos.
        if (!shouldAnnounce(chatCfg, 'notifyGroupChanges')) continue;

        try {
            let txt = null;

            // CAMBIOS DE CONFIGURACIÓN — cada uno consulta su flag individual:
            //   announce  → notifyAnnounce (grupo abierto/cerrado)
            //   restrict  → notifyRestrict (quién puede editar info)
            if (u.announce === true) {
                if (!shouldAnnounce(chatCfg, 'notifyAnnounce')) continue;
                txt = ANNOUNCEMENT_TEXTS.groupClose;
            } else if (u.announce === false) {
                if (!shouldAnnounce(chatCfg, 'notifyAnnounce')) continue;
                txt = ANNOUNCEMENT_TEXTS.groupOpen;
            } else if (u.restrict === true) {
                if (!shouldAnnounce(chatCfg, 'notifyRestrict')) continue;
                txt = `*✿═══━ ❀ ━═══✿*\n*🔒 𝐂𝐨𝐧𝐟𝐢𝐠𝐮𝐫𝐚𝐜𝐢𝐨́𝐧 𝐝𝐞 𝐠𝐫𝐮𝐩𝐨 𝐀𝐂𝐓𝐔𝐀𝐋𝐈𝐙𝐀𝐃𝐀 🔒*\n*✿═══━ ❀ ━═══✿*\n\n*🌺 Solo los admins pueden editar la info del grupo.*`;
            } else if (u.restrict === false) {
                if (!shouldAnnounce(chatCfg, 'notifyRestrict')) continue;
                txt = `*✿═══━ ❀ ━═══✿*\n*🌸 𝐂𝐨𝐧𝐟𝐢𝐠𝐮𝐫𝐚𝐜𝐢𝐨́𝐧 𝐝𝐞 𝐠𝐫𝐮𝐩𝐨 𝐀𝐂𝐓𝐔𝐀𝐋𝐈𝐙𝐀𝐃𝐀 🌸*\n*✿═══━ ❀ ━═══✿*\n\n*💐 Todos pueden editar la info del grupo.*`;
            }

            // CAMBIOS DE METADATA — flags individuales:
            //   subject → notifySubject (nombre)
            //   desc    → notifyDesc    (descripción)
            //   icon    → notifyIcon    (foto)
            else if (u.subject !== undefined && u.subject !== null) {
                if (!shouldAnnounce(chatCfg, 'notifySubject')) continue;
                txt = `${ANNOUNCEMENT_TEXTS.subjectChange}\n\n*Nuevo nombre:* ${u.subject}`;
            } else if (u.desc !== undefined) {
                if (!shouldAnnounce(chatCfg, 'notifyDesc')) continue;
                txt = `${ANNOUNCEMENT_TEXTS.descChange}${u.desc ? '\n\n*Nueva descripción:*\n' + u.desc : '\n\n(descripción vacía)'}`;
            } else if (u.icon !== undefined) {
                // Foto cambió: invalida el cache para que la próxima
                // bienvenida use la nueva foto.
                invalidateGroupPic(u.id);
                if (!shouldAnnounce(chatCfg, 'notifyIcon')) continue;
                txt = ANNOUNCEMENT_TEXTS.iconChange;
            }

            if (txt) await conn.sendMessage(u.id, { text: txt });
        } catch (err) {
            console.error(chalk.red('[announcements] groups.update:'), err?.message || err);
        }
    }
}

// ─── call (Anti-llamada) ────────────────────────────────────────────
// Cuando alguien llama al bot, lo rechazamos automáticamente y opcionalmente
// bloqueamos al usuario. Por defecto está activado (settings.antillamada=true).

async function onCall(conn, calls) {
    const botJid = botIdentities(conn);
    const aBotJid = [...botJid][0];
    if (!aBotJid) return;
    const settings = getSettings(aBotJid);
    if (settings.antillamada === false) return; // desactivado explícitamente

    for (const call of calls || []) {
        // Solo nos interesa el 'offer' (la primera ringada)
        if (call.status !== 'offer') continue;
        const from = call.from;
        if (!from) continue;

        try {
            // Rechaza la llamada
            await conn.rejectCall(call.id, from);
            console.log(chalk.yellow(`[anti-call] Llamada rechazada de ${from.split('@')[0]}`));

            // Aviso al usuario
            await conn.sendMessage(from, { text: ANNOUNCEMENT_TEXTS.callReject })
                .catch(() => {});

            // Bloqueo opcional
            if (settings.bloquearLlamada) {
                await conn.sendMessage(from, { text: ANNOUNCEMENT_TEXTS.callBlocked })
                    .catch(() => {});
                await conn.updateBlockStatus(from, 'block').catch(() => {});
                console.log(chalk.red(`[anti-call] Usuario ${from.split('@')[0]} bloqueado`));
            }
        } catch (err) {
            console.error(chalk.red('[anti-call]'), err?.message || err);
        }
    }
}

// ─── messages.upsert (cache para anti-delete) ───────────────────────

function cacheMessage(raw) {
    if (!raw?.key?.remoteJid || !raw.message) return;
    const chatJid = raw.key.remoteJid;
    if (!_messageCache.has(chatJid)) _messageCache.set(chatJid, new Map());
    const chatMap = _messageCache.get(chatJid);
    const id = raw.key.id;
    if (!id) return;

    // Extrae el texto/contenido para mostrar más rápido luego
    const msg = raw.message;
    let text = '';
    let mtype = Object.keys(msg).find(k => k !== 'messageContextInfo' && k !== 'senderKeyDistributionMessage') || 'unknown';
    if (msg.conversation) text = msg.conversation;
    else if (msg.extendedTextMessage?.text) text = msg.extendedTextMessage.text;
    else if (msg[mtype]?.caption) text = msg[mtype].caption;

    chatMap.set(id, {
        raw,
        savedAt: Date.now(),
        sender: raw.key.participant || raw.key.remoteJid,
        text,
        mtype,
    });

    // Mantén tamaño bajo
    if (chatMap.size > MAX_MSG_PER_CHAT) {
        const oldest = chatMap.keys().next().value;
        chatMap.delete(oldest);
    }
}

function onMessagesUpsert(conn, { messages, type }) {
    if (type === 'append') return;
    for (const m of (messages || [])) cacheMessage(m);
}

// ─── messages.update (anti-delete + edit log) ───────────────────────

async function onMessagesUpdate(conn, updates) {
    for (const { key, update } of updates || []) {
        if (!key?.remoteJid || !key?.id) continue;

        // Solo en grupos
        const isGroup = key.remoteJid.endsWith('@g.us');
        if (!isGroup) continue;

        const chatCfg = getChat(key.remoteJid);

        // ── Borrado (update.message === null o protocolMessage.type === 0) ──
        const isDeleted =
            update.message === null ||
            update.messageStubType === 1 ||
            update.message?.protocolMessage?.type === 0;

        if (isDeleted && chatCfg.antidelete) {
            try {
                const original = _messageCache.get(key.remoteJid)?.get(key.id);
                if (!original) continue;
                const sender = original.sender;
                const senderClean = sender?.split('@')[0] || '?';

                let body = `${ANNOUNCEMENT_TEXTS.antideletePrefix}\n\n*De:* @${senderClean}\n*Tipo:* ${original.mtype}`;
                if (original.text) body += `\n*Mensaje:*\n${original.text.slice(0, 1000)}`;

                await conn.sendMessage(key.remoteJid, {
                    text: body,
                    mentions: sender ? [sender] : [],
                }).catch(() => {});

                // Si era media (image/video/audio/sticker), reenvíalo
                const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage'];
                if (mediaTypes.includes(original.mtype) && original.raw?.message) {
                    try {
                        await conn.relayMessage(key.remoteJid, original.raw.message, {});
                    } catch { /* */ }
                }
            } catch (err) {
                console.error(chalk.red('[anti-delete]'), err?.message || err);
            }
        }

        // ── Edición ──
        const editedContent = update.message?.editedMessage?.message ||
                              update.message?.protocolMessage?.editedMessage;
        if (editedContent && chatCfg.editlog) {
            try {
                const original = _messageCache.get(key.remoteJid)?.get(key.id);
                let newText = '';
                if (editedContent.conversation) newText = editedContent.conversation;
                else if (editedContent.extendedTextMessage?.text) newText = editedContent.extendedTextMessage.text;

                if (!newText) continue;

                const sender = original?.sender || key.participant;
                const senderClean = sender?.split('@')[0] || '?';
                const oldText = original?.text || '(no estaba en caché)';

                const body = `${ANNOUNCEMENT_TEXTS.editPrefix}\n\n*De:* @${senderClean}\n*Antes:* ${oldText.slice(0, 300)}\n*Ahora:* ${newText.slice(0, 300)}`;
                await conn.sendMessage(key.remoteJid, {
                    text: body,
                    mentions: sender ? [sender] : [],
                }).catch(() => {});
            } catch (err) {
                console.error(chalk.red('[edit-log]'), err?.message || err);
            }
        }
    }
}

// ─── presence.update (avisa cuando AFK vuelve online) ───────────────

async function onPresenceUpdate(conn, { id, presences }) {
    if (!presences) return;
    for (const [jid, p] of Object.entries(presences)) {
        if (!p.lastKnownPresence) continue;
        const wasOnline = _presenceCache.get(jid);
        const isOnline = p.lastKnownPresence === 'available' || p.lastKnownPresence === 'composing';
        _presenceCache.set(jid, isOnline ? Date.now() : 0);

        // Si pasó de offline a online y estaba AFK, avisa en el grupo (una vez)
        if (isOnline && !wasOnline) {
            const user = db.data.users?.[jid];
            if (!user || user.afkTime === undefined || user.afkTime < 0) continue;

            const cooldown = _afkBackCooldown.get(jid) || 0;
            if (Date.now() - cooldown < AFK_BACK_COOLDOWN_MS) continue;
            _afkBackCooldown.set(jid, Date.now());

            try {
                const senderClean = jid.split('@')[0];
                const text = `${ANNOUNCEMENT_TEXTS.afkBackTitle}\n\n*@${senderClean}* volvió a estar disponible.`;
                await conn.sendMessage(id, { text, mentions: [jid] }).catch(() => {});
            } catch (err) {
                console.error(chalk.red('[presence-update]'), err?.message || err);
            }
        }
    }
}

// ─── contacts.update (cambios de foto/nombre) ───────────────────────
// Log silencioso. No envía mensajes a nadie por defecto, solo registra.

function onContactsUpdate(conn, updates) {
    for (const u of updates || []) {
        if (u.id && (u.imgUrl !== undefined || u.notify)) {
            console.log(chalk.gray(`[contacts] ${u.id.split('@')[0]}: ${u.notify || 'foto/nombre actualizado'}`));
        }
    }
}

// ─── API pública ────────────────────────────────────────────────────

/**
 * Conecta TODOS los listeners de anuncios a la conexión Baileys.
 * Llamar una sola vez después de tener el socket creado.
 */
export function attachAnnouncements(conn) {
    if (!conn?.ev) return;
    if (conn.__announcementsAttached) return;
    conn.__announcementsAttached = true;

    conn.ev.on('group-participants.update', (e) =>
        onParticipantsUpdate(conn, e).catch(err =>
            console.error(chalk.red('[announcements]'), err?.message || err)
        )
    );
    conn.ev.on('groups.update', (updates) =>
        onGroupsUpdate(conn, updates).catch(err =>
            console.error(chalk.red('[announcements]'), err?.message || err)
        )
    );
    conn.ev.on('call', (calls) =>
        onCall(conn, calls).catch(err =>
            console.error(chalk.red('[anti-call]'), err?.message || err)
        )
    );
    conn.ev.on('messages.upsert', (u) => onMessagesUpsert(conn, u));
    conn.ev.on('messages.update', (updates) =>
        onMessagesUpdate(conn, updates).catch(err =>
            console.error(chalk.red('[anti-delete]'), err?.message || err)
        )
    );
    conn.ev.on('presence.update', (u) =>
        onPresenceUpdate(conn, u).catch(err =>
            console.error(chalk.red('[presence]'), err?.message || err)
        )
    );
    conn.ev.on('contacts.update', (u) => onContactsUpdate(conn, u));

    // Limpieza periódica del cache de mensajes (cada 30 min, mensajes >1h)
    setInterval(() => {
        const cutoff = Date.now() - MSG_TTL_MS;
        for (const [chatJid, chatMap] of _messageCache) {
            for (const [id, entry] of chatMap) {
                if (entry.savedAt < cutoff) chatMap.delete(id);
            }
            if (chatMap.size === 0) _messageCache.delete(chatJid);
        }
    }, 30 * 60 * 1000).unref();

    console.log(chalk.cyan('[announcements] ✓ welcome/bye/promote/demote'));
    console.log(chalk.cyan('[announcements] ✓ anti-llamada'));
    console.log(chalk.cyan('[announcements] ✓ anti-delete + edit log'));
    console.log(chalk.cyan('[announcements] ✓ AFK presence tracking'));
}
