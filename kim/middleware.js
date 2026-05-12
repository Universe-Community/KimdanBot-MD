// kim/middleware.js — Anti-* + AFK condicionales (ESM).

import { clockString } from './helpers.js';
import { getUser, getChat, getSettings } from './db.js';

const TOXIC_REGEX = /\b(g0re|sap0|sap4|malparid[oa]s?|chocha|chup4l[ao]|chupon|sabandija|hijodelagranputa|hijodeputa|hijadeputa|kbron[a]?|laconchadedios|putit[oa]|put[oa]|coñ[oa]|afeminado|drog4s?|cocaín?a|marihuana|chocho|cagon|pedorr[oa]s?|nmms|mamar|chigadamadre|hijueputa|chupa|caca|bobo|loca?|estupid[oa]s?|pollas?|idiota|maricon|chucha|verga|naco|zorr[oa]s?|huevon[a]?|kbrones|cabron|capullo|carajo|gore|sap[oa]|mierda|cerd[oa]|puerc[oa]|perr[oa]|qliao|imbecil|fuck|shit|bullshit|cunt|bitch|motherfucker)\b/i;

const ANTIFAKE_PREFIXES = ['1', '994', '48', '43', '40', '41', '49'];
const ANTIARABE_PREFIXES = ['212', '265', '234', '258', '263', '967', '20', '92', '91'];
const SPAM_WINDOW_MS = 5000;

export async function runMiddleware(conn, m) {
    const chatCfg = m.isGroup ? getChat(m.chat) : null;
    const userCfg = getUser(m.sender);
    const botJid = conn.user?.jid || conn.decodeJid?.(conn.user?.id);
    const settings = botJid ? getSettings(botJid) : null;

    if (m._isCmd && chatCfg?.antispam && !m.isOwner) {
        const last = userCfg.spam || 0;
        if (Date.now() - last < SPAM_WINDOW_MS) return true;
        userCfg.spam = Date.now();
    }

    if (!m.isGroup && !m.isOwner && settings?.antiprivado) {
        try {
            await conn.sendMessage(m.chat, {
                text: global.lenguaje?.smsAntiPv?.() || '⚠️ El chat privado está prohibido.',
            }, { quoted: m });
            await new Promise(r => setTimeout(r, 1500));
            await conn.updateBlockStatus(m.chat, 'block');
        } catch { /* */ }
        return true;
    }

    if (!m.isGroup || !chatCfg) return false;

    if ((chatCfg.antifake || chatCfg.antiarabe) && !m.isSenderAdmin && m.isBotAdmin) {
        // En grupos con LIDs el sender puede ser xxx@lid; el número real
        // está en m.senderAlt (el participantAlt/PN). Probamos AMBOS.
        const numLid = String(m.sender).split('@')[0];
        const numPn  = String(m.senderAlt).split('@')[0];
        const blocked = (chatCfg.antifake && (
                ANTIFAKE_PREFIXES.some(p => numLid.startsWith(p)) ||
                ANTIFAKE_PREFIXES.some(p => numPn.startsWith(p))
            )) || (chatCfg.antiarabe && (
                ANTIARABE_PREFIXES.some(p => numLid.startsWith(p)) ||
                ANTIARABE_PREFIXES.some(p => numPn.startsWith(p))
            ));
        if (blocked) {
            try {
                await conn.sendMessage(m.chat, {
                    text: chatCfg.antifake
                        ? (global.lenguaje?.smsAntiFake?.() || '⚠️ Número fake detectado.')
                        : (global.lenguaje?.smsAntiArabe?.() || '⚠️ Número no permitido.'),
                    mentions: [m.sender],
                });
                await conn.groupParticipantsUpdate(m.chat, [m.sender], 'remove');
            } catch { /* */ }
            return true;
        }
    }

    if ((chatCfg.antilink || chatCfg.AntiYoutube || chatCfg.AntInstagram ||
         chatCfg.AntiFacebook || chatCfg.AntiTelegram || chatCfg.AntiTiktok ||
         chatCfg.AntiTwitter) && !m.isSenderAdmin && !m.isOwner) {
        const body = m.text || '';
        const matches = (chatCfg.antilink && /chat\.whatsapp\.com\//i.test(body))
                     || (chatCfg.AntiYoutube && /(youtu\.be|youtube\.com)\//i.test(body))
                     || (chatCfg.AntInstagram && /instagram\.com\//i.test(body))
                     || (chatCfg.AntiFacebook && /(facebook\.com|fb\.watch)\//i.test(body))
                     || (chatCfg.AntiTelegram && /t\.me\//i.test(body))
                     || (chatCfg.AntiTiktok && /(tiktok\.com|vm\.tiktok\.com)\//i.test(body))
                     || (chatCfg.AntiTwitter && /(twitter\.com|x\.com)\//i.test(body));
        if (matches) {
            if (!m.isBotAdmin) {
                try {
                    await conn.sendMessage(m.chat, {
                        text: global.lenguaje?.smsAntiLink3?.() || '⚠️ Link detectado pero no soy admin.',
                    }, { quoted: m });
                } catch { /* */ }
                return true;
            }
            try {
                if (chatCfg.antilink) {
                    const inviteCode = await conn.groupInviteCode(m.chat).catch(() => null);
                    if (inviteCode && body.includes(inviteCode)) return false;
                }
                await conn.sendMessage(m.chat, {
                    text: global.lenguaje?.smsAntiLink?.() || '⚠️ No se permiten links.',
                    mentions: [m.sender],
                });
                await conn.sendMessage(m.chat, { delete: m.key });
                await conn.groupParticipantsUpdate(m.chat, [m.sender], 'remove');
            } catch { /* */ }
            return true;
        }
    }

    if (chatCfg.antitoxic && !m.isSenderAdmin && !m.isOwner) {
        if (TOXIC_REGEX.test(m.text || '')) {
            userCfg.warn = (userCfg.warn || 0) + 1;
            const max = parseInt(global.maxwarn) || 4;
            try {
                if (userCfg.warn >= max) {
                    userCfg.warn = 0;
                    userCfg.banned = true;
                    await conn.sendMessage(m.chat, {
                        text: `*@${m.sender.split('@')[0]}* ha sido removido por palabras tóxicas.`,
                        mentions: [m.sender],
                    }, { quoted: m });
                    if (m.isBotAdmin) await conn.groupParticipantsUpdate(m.chat, [m.sender], 'remove');
                } else {
                    await conn.sendMessage(m.chat, {
                        text: `Hey @${m.sender.split('@')[0]}, palabra inapropiada detectada (${userCfg.warn}/${max}).`,
                        mentions: [m.sender],
                    }, { quoted: m });
                }
            } catch { /* */ }
            return true;
        }
    }

    if ((userCfg.afkTime || -1) > -1) {
        try {
            const elapsed = Date.now() - userCfg.afkTime;
            await conn.sendMessage(m.chat, {
                text: `🕔 *Has dejado el modo AFK*\n${userCfg.afkReason ? '*Razón:* ' + userCfg.afkReason + '\n' : ''}*Estuviste inactivo:* ${clockString(elapsed)}`,
            }, { quoted: m });
        } catch { /* */ }
        userCfg.afkTime = -1;
        userCfg.afkReason = '';
    }

    const mentioned = [
        ...(m.mentionedJid || []),
        ...(m.quoted ? [m.quoted.sender] : []),
    ].filter((v, i, a) => v && a.indexOf(v) === i);

    for (const jid of mentioned) {
        const target = global.db?.data?.users?.[jid];
        if (!target || (target.afkTime ?? -1) < 0) continue;
        const elapsed = Date.now() - target.afkTime;
        try {
            await conn.sendMessage(m.chat, {
                text: `[ 💤 NO LO ETIQUETES 💤 ]\n\nEste usuario está AFK\n${target.afkReason ? '*Razón:* ' + target.afkReason : '*Razón:* sin razón'}\n*Inactivo durante:* ${clockString(elapsed)}`,
                mentions: [jid],
            }, { quoted: m });
        } catch { /* */ }
        break;
    }

    return false;
}

export function shouldRunMiddleware(m, chatCfg, settings) {
    if (m._isCmd) return true;
    if (!m.isGroup) return !!settings?.antiprivado;
    if (!chatCfg) return false;
    return !!(chatCfg.antilink || chatCfg.antilink2 || chatCfg.antitoxic ||
              chatCfg.antifake || chatCfg.antiarabe || chatCfg.antispam ||
              chatCfg.AntiYoutube || chatCfg.AntInstagram || chatCfg.AntiFacebook ||
              chatCfg.AntiTelegram || chatCfg.AntiTiktok || chatCfg.AntiTwitter);
}
