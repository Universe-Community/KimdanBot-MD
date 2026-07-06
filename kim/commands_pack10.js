// kim/commands_pack10.js — Comandos adicionales de KimdanBot.
// ─────────────────────────────────────────────────────────────────────
// Comandos nuevos adaptados 100% a la arquitectura de KimdanBot
// (COMMAND_META + execute() con case/break, permisos del handler,
// economía JX/HG/AP, textos aesthetic BL).
//
//   Descargas : soundcloud · threads · ttimg (fotos de TikTok)
//   Utilidades: qrcode · calc · morse · readmore · nowa
//   Juegos    : adivina · mates · ahorcado · gato · rendirse
//   Grupos    : mute · unmute · mutelist · antiviewonce
//   Anónimo   : anonimo · siguiente · salirchat  (solo privado)

import { command } from './registry.js';
import { getUser, getChat, db } from './db.js';
import { getBuffer } from './helpers.js';
import { getRandomImage } from './media.js';
import { box } from './ui.js';
import {
    soundcloudDl, soundcloudSearch, threadsMedia, tiktokImages,
} from './providers.js';
import {
    startGuess, startMath, startHangman, startTTT, getGame, endGame,
} from './games.js';
import { anonStart, anonLeave, anonNext } from './anonchat.js';

// ─── Permisos (mismo patrón que los demás packs) ────────────────────
const needGroup = (m) => { if (!m.isGroup) { m.reply(global.mess?.group || '⚠️ Solo en grupos.'); return false; } return true; };
const needGroupAdmin = (m) => {
    if (!needGroup(m)) return false;
    if (!m.isSenderAdmin && !m.isOwner) { m.reply(global.mess?.admin || '⚠️ Solo administradores.'); return false; }
    return true;
};
const needPrivate = (m) => { if (m.isGroup) { m.reply('🔒 Este comando solo funciona en el *chat privado* con el bot 💜'); return false; } return true; };

const target = (m, text) => m.mentionedJid?.[0] || m.quoted?.sender
    || ((text || '').match(/\d{6,}/) ? (text.match(/\d{6,}/)[0] + '@s.whatsapp.net') : null);

// ─── Morse ──────────────────────────────────────────────────────────
const MORSE = {
    a:'.-',b:'-...',c:'-.-.',d:'-..',e:'.',f:'..-.',g:'--.',h:'....',i:'..',j:'.---',k:'-.-',l:'.-..',m:'--',
    n:'-.',o:'---',p:'.--.',q:'--.-',r:'.-.',s:'...',t:'-',u:'..-',v:'...-',w:'.--',x:'-..-',y:'-.--',z:'--..',
    0:'-----',1:'.----',2:'..---',3:'...--',4:'....-',5:'.....',6:'-....',7:'--...',8:'---..',9:'----.',
};
const MORSE_REV = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));

// ─── Metadata + dispatch por case (arquitectura KimdanBot) ──────────

const COMMAND_META = [
    // Descargas
    { names: ['soundcloud', 'sc'], category: 'download', description: 'Busca/descarga audio de SoundCloud' },
    { names: ['threads', 'thread'], category: 'download', description: 'Descarga un post de Threads' },
    { names: ['ttimg', 'tiktokimg', 'tiktokfotos'], category: 'download', description: 'Fotos de un TikTok (carrusel)' },
    // Utilidades
    { names: ['qrcode', 'crearqr'], category: 'tools', description: 'Genera un código QR de un texto' },
    { names: ['pruebaimagen', 'testimagen', 'testimg'], category: 'media', description: 'Envía una imagen aleatoria de la carpeta pruebaimagen' },
    { names: ['calc', 'calculadora'], category: 'tools', description: 'Calculadora (+ - × ÷ π e)' },
    { names: ['morse', 'morsedecode'], category: 'tools', description: 'Codifica/decodifica código Morse' },
    { names: ['readmore', 'leermas'], category: 'tools', description: 'Texto con "leer más" oculto' },
    { names: ['onwa2', 'nowa'], category: 'tools', description: 'Prueba variantes de un número en WhatsApp (usa x)' },
    // Juegos
    { names: ['adivina', 'adivinanum'], category: 'game', description: 'Adivina el número (1-100) — premio en JX' },
    { names: ['mates', 'math'], category: 'game', description: 'Reto matemático (.mates facil|medio|dificil)' },
    { names: ['ahorcado', 'hangman'], category: 'game', description: 'Ahorcado con palabras del universo BL' },
    { names: ['gato', 'ttt', 'tictactoe'], category: 'game', description: 'Tres en raya por 500 JX (reta con @)' },
    { names: ['rendirse', 'surrender'], category: 'game', description: 'Termina el minijuego activo del chat' },
    // Grupos
    { names: ['mute', 'silenciar'], category: 'admin', description: 'Silencia a un usuario (se borran sus mensajes)' },
    { names: ['unmute', 'desilenciar'], category: 'admin', description: 'Quita el silencio a un usuario' },
    { names: ['mutelist', 'silenciados'], category: 'admin', description: 'Lista de usuarios silenciados del grupo' },
    { names: ['antiviewonce', 'antiver'], category: 'config', description: 'Revela los mensajes de "ver una vez"' },
    // Chat anónimo (privado)
    { names: ['anonimo', 'anonymous', 'chatanonimo'], category: 'fun', description: 'Chat anónimo 1:1 (solo privado)' },
    { names: ['siguiente', 'next'], category: 'fun', description: 'Cambia de pareja en el chat anónimo' },
    { names: ['salirchat', 'leavechat'], category: 'fun', description: 'Sale del chat anónimo' },
];

export async function execute(conn, m, cmd, args, text) {
    switch (cmd) {

    // ═══════════════ DESCARGAS ═══════════════

    case 'soundcloud': {
        if (!text) return m.reply('Uso: .soundcloud <nombre o link>\nEjemplo: .soundcloud lofi bl');
        try {
            await m.react?.('🎧').catch(() => {});
            let url = /soundcloud\.com\//i.test(text) ? text.trim() : null;
            let picked = null;
            if (!url) {
                const results = await soundcloudSearch(text, 5);
                if (!results.length) return m.reply('🥺 No encontré esa canción en SoundCloud~');
                picked = results[0];
                url = picked.url;
            }
            const dl = await soundcloudDl(url);
            if (!dl?.url) throw new Error('sin descarga');
            const buf = await getBuffer(dl.url, { timeout: 120000 });
            if (!buf) throw new Error('descarga vacía');
            await conn.sendMessage(m.chat, {
                audio: buf, mimetype: 'audio/mpeg',
                fileName: `${dl.title || picked?.name || 'soundcloud'}.mp3`,
            }, { quoted: m });
        } catch { await m.reply('🥺 No pude descargar de SoundCloud ahora mismo. Intenta más tarde 💜'); }
        break;
    }

    case 'threads': {
        if (!text || !/threads\.(net|com)\//i.test(text)) return m.reply('Uso: .threads <link del post>');
        try {
            await m.react?.('🧵').catch(() => {});
            const r = await threadsMedia(text.trim());
            if (!r?.url) throw new Error('sin media');
            const buf = await getBuffer(r.url, { timeout: 120000 });
            if (!buf) throw new Error('descarga vacía');
            const caption = `🧵 Threads 💜${r.description ? '\n🍓 ' + r.description.slice(0, 300) : ''}`;
            await conn.sendMessage(m.chat, r.type === 'image'
                ? { image: buf, caption }
                : { video: buf, caption, mimetype: 'video/mp4' }, { quoted: m });
        } catch { await m.reply('🥺 No pude descargar ese post de Threads ahora mismo 💜'); }
        break;
    }

    case 'ttimg': {
        if (!text || !/tiktok\.com/i.test(text)) return m.reply('Uso: .ttimg <link de TikTok con fotos>');
        try {
            await m.react?.('📸').catch(() => {});
            const r = await tiktokImages(text.trim());
            if (!r?.images?.length) return m.reply('🥺 Ese TikTok no tiene fotos (o no pude leerlas). Para video usa *.tiktok* 💜');
            for (const img of r.images.slice(0, 10)) {
                const buf = await getBuffer(img, { timeout: 60000 });
                if (buf) await conn.sendMessage(m.chat, { image: buf, caption: '🎀 TikTok 💜' }, { quoted: m });
            }
        } catch { await m.reply('🥺 No pude descargar las fotos de ese TikTok 💜'); }
        break;
    }

    // ═══════════════ UTILIDADES ═══════════════

    case 'qrcode': {
        if (!text) return m.reply('Uso: .qrcode <texto o link>');
        try {
            const qrmod = await import('qrcode');
            const buf = await (qrmod.default || qrmod).toBuffer(text.slice(0, 2048), { scale: 8, margin: 2 });
            await conn.sendMessage(m.chat, { image: buf, caption: '🔳 Tu código QR ✨' }, { quoted: m });
        } catch { await m.reply('❌ No pude generar el QR.'); }
        break;
    }

    case 'pene': {
        // Envía una imagen aleatoria de la carpeta "pruebaimagen"
        // (se busca en ./pruebaimagen y en ./media/pruebaimagen).
        try {
            await m.react?.('🍆').catch(() => {});
            const img = await getRandomImage('pruebaimagen');
            if (!img) {
                return m.reply(
                    '🖼️ *Carpeta pruebaimagen vacía* 🫐\n\n' +
                    '₊˚ Coloca imágenes (.jpg .png .webp .gif) en la carpeta\n' +
                    '   *media/pruebaimagen/* y vuelve a intentarlo 💜'
                );
            }
            await conn.sendMessage(m.chat, {
                image: img.buffer,
                caption: `🍆 *pene aleatorio* 😏\n₊˚ ${img.count} pene${img.count === 1 ? '' : 'es'} en la carpeta 😮‍💨`,
            }, { quoted: m });
        } catch (e) {
            await m.reply('🥺 No pude enviar el pene: ' + (e?.message || e));
        }
        break;
    }

    case 'calc': {
        if (!text) return m.reply('Uso: .calc <operación>\nEjemplo: .calc (5+3)×2 ÷ 4');
        // Sanitizado estricto: SOLO dígitos, operadores, paréntesis, punto,
        // y las constantes π/e. Nada más llega al evaluador.
        const val = text
            .replace(/×/g, '*').replace(/÷/g, '/')
            .replace(/π|pi/gi, 'Math.PI').replace(/(?<![\w.])e(?![\w.])/gi, 'Math.E')
            .replace(/[^0-9+\-*/().MathPIE\s]/g, '');
        if (!/^[0-9+\-*/().\sMathPIE]+$/.test(val) || !/[0-9PE]/.test(val)) {
            return m.reply('🫐 Solo se admiten números y los símbolos + - × ÷ ( ) . π e');
        }
        try {
            const result = Function('"use strict"; return (' + val + ')')();
            if (!Number.isFinite(result)) throw new Error('resultado inválido');
            const pretty = text.trim().slice(0, 80);
            await m.reply(`🧮 *${pretty}* = ✨ *${Number(result.toFixed(10))}* ✨`);
        } catch { await m.reply('🫐 Operación inválida~ revisa los paréntesis y símbolos.'); }
        break;
    }

    case 'morse': {
        if (!text) return m.reply('Uso: .morse <texto o código morse>\nEjemplo: .morse hola  ·  .morse .... --- .-.. .-');
        const isMorse = /^[.\-\s/]+$/.test(text.trim());
        if (isMorse) {
            const out = text.trim().split(/\s*\/\s*|\s{2,}/).map(word =>
                word.trim().split(/\s+/).map(c => MORSE_REV[c] || '?').join('')
            ).join(' ');
            await m.reply(`📡 *Morse → texto*\n\n✨ ${out.toUpperCase()}`);
        } else {
            const out = text.toLowerCase().split(/\s+/).map(word =>
                [...word].map(c => MORSE[c] || '').filter(Boolean).join(' ')
            ).filter(Boolean).join(' / ');
            if (!out) return m.reply('🫐 No pude codificar eso (solo letras y números).');
            await m.reply(`📡 *Texto → Morse*\n\n✨ ${out}`);
        }
        break;
    }

    case 'readmore': {
        if (!text || !text.includes('|')) return m.reply('Uso: .readmore <visible>|<oculto>\nEjemplo: .readmore Hola|sorpresa 💜');
        const [visible, hidden] = text.split('|');
        const READ_MORE = String.fromCharCode(8206).repeat(4001);
        await m.reply(`${visible.trim()}${READ_MORE}${(hidden || '').trim()}`);
        break;
    }

    case 'onwa2': {
        if (!text || !/x/i.test(text)) return m.reply('Uso: .nowa <número con x>\nEjemplo: .nowa 52133344455x\nCada *x* prueba los dígitos 0-9 (máx. 2 equis).');
        const base = text.replace(/[^0-9xX]/g, '');
        const xCount = (base.match(/x/gi) || []).length;
        if (xCount > 2) return m.reply('🫐 Máximo *2 equis* (hasta 100 combinaciones), para no saturar a WhatsApp.');
        await m.react?.('🔎').catch(() => {});
        const total = Math.pow(10, xCount);
        const found = [], notFound = [];
        for (let i = 0; i < total; i++) {
            const digits = [...String(i).padStart(xCount, '0')];
            const num = base.replace(/x/gi, () => digits.shift());
            try {
                const res = await conn.onWhatsApp(num + '@s.whatsapp.net');
                if (res?.[0]?.exists) found.push(num); else notFound.push(num);
            } catch { notFound.push(num); }
        }
        const lines = [
            `✅ Registrados (${found.length}):`,
            ...(found.length ? found.map(n => `• wa.me/${n}`) : ['—']),
            '',
            `❌ No registrados: ${notFound.length}`,
        ];
        await m.reply(box('🔎 NÚMEROS EN WHATSAPP', lines));
        break;
    }

    // ═══════════════ JUEGOS ═══════════════

    case 'adivina': {
        if (getGame(m.chat)) return m.reply('🎲 Ya hay un juego activo en este chat. Termínalo o usa *.rendirse* 🫐');
        await m.reply(startGuess(m.chat));
        break;
    }

    case 'mates': {
        if (getGame(m.chat)) return m.reply('🎲 Ya hay un juego activo en este chat. Termínalo o usa *.rendirse* 🫐');
        const level = (args[0] || 'facil').toLowerCase().replace('á', 'a').replace('í', 'i');
        await m.reply(startMath(m.chat, level));
        break;
    }

    case 'ahorcado': {
        if (getGame(m.chat)) return m.reply('🎲 Ya hay un juego activo en este chat. Termínalo o usa *.rendirse* 🫐');
        await m.reply(startHangman(m.chat));
        break;
    }

    case 'gato': {
        if (!needGroup(m)) return;
        if (getGame(m.chat)) return m.reply('🎲 Ya hay un juego activo en este chat. Termínalo o usa *.rendirse* 🫐');
        const rival = target(m, text);
        if (rival && rival === m.sender) return m.reply('🫐 No puedes retarte a ti mismo~');
        const intro = startTTT(m.chat, m.sender, rival);
        await conn.sendMessage(m.chat, { text: intro, mentions: [m.sender, rival].filter(Boolean) }, { quoted: m });
        break;
    }

    case 'rendirse': {
        if (!getGame(m.chat)) return m.reply('🍃 No hay ningún juego activo en este chat.');
        endGame(m.chat);
        await m.reply('🏳️ Juego terminado. ¡La próxima será! 💜');
        break;
    }

    // ═══════════════ GRUPOS ═══════════════

    case 'mute': {
        if (!needGroupAdmin(m)) return;
        const t = target(m, text);
        if (!t) return m.reply('Uso: .mute @usuario (o responde a su mensaje)');
        const num = String(t).split('@')[0];
        // Protecciones: ni bot, ni owner, ni admins del grupo.
        const botNums = [conn.user?.id, conn.user?.lid].filter(Boolean).map(j => String(conn.decodeJid?.(j) || j).split('@')[0]);
        if (botNums.includes(num)) return m.reply('🙀 ¡No puedes silenciarme a mí!');
        if ((global.owner || []).some(o => Array.isArray(o) && o[0] === num)) return m.reply('👑 El owner del bot no puede ser silenciado.');
        const adminNums = (m.groupAdmins || []).map(j => String(j).split('@')[0]);
        if (adminNums.includes(num)) return m.reply('⚡ No se puede silenciar a un admin del grupo.');
        if (!m.isBotAdmin) return m.reply(global.mess?.botAdmin || '⚠️ Necesito ser admin para borrar sus mensajes.');
        const chat = getChat(m.chat);
        chat.muted ||= [];
        if (chat.muted.includes(num)) return m.reply('🔇 Ese usuario ya está silenciado.');
        chat.muted.push(num); db.markDirty();
        await conn.sendMessage(m.chat, {
            text: `🔇 *Usuario silenciado* 🫐\n\n₊˚ Los mensajes de @${num} se borrarán automáticamente en este grupo.\n₊˚ Un admin puede revertirlo con *.unmute*`,
            mentions: [t],
        }, { quoted: m });
        break;
    }

    case 'unmute': {
        if (!needGroupAdmin(m)) return;
        const t = target(m, text);
        if (!t) return m.reply('Uso: .unmute @usuario (o responde a su mensaje)');
        const num = String(t).split('@')[0];
        const chat = getChat(m.chat);
        const idx = (chat.muted || []).indexOf(num);
        if (idx === -1) return m.reply('🍃 Ese usuario no está silenciado.');
        chat.muted.splice(idx, 1); db.markDirty();
        await conn.sendMessage(m.chat, {
            text: `🔊 *Silencio retirado* 💜\n\n₊˚ @${num} puede volver a hablar en el grupo ✨`,
            mentions: [t],
        }, { quoted: m });
        break;
    }

    case 'mutelist': {
        if (!needGroup(m)) return;
        const chat = getChat(m.chat);
        const list = chat.muted || [];
        if (!list.length) return m.reply('🔊 Nadie está silenciado en este grupo 💜');
        await conn.sendMessage(m.chat, {
            text: box(`🔇 SILENCIADOS · ${list.length}`, list.map((n, i) => `${i + 1}. @${n}`)),
            mentions: list.map(n => n + '@s.whatsapp.net'),
        }, { quoted: m });
        break;
    }

    case 'antiviewonce': {
        if (!needGroupAdmin(m)) return;
        const chat = getChat(m.chat);
        const arg = (args[0] || '').toLowerCase();
        const enable = arg ? ['on', 'enable', '1', 'si', 'sí'].includes(arg) : !chat.viewonce;
        chat.viewonce = enable; db.markDirty();
        await m.reply(enable
            ? '👁️ *Anti view-once activado* ✨\n₊˚ Los mensajes de "ver una vez" se revelarán en el grupo.'
            : '🙈 *Anti view-once desactivado* 💜');
        break;
    }

    // ═══════════════ CHAT ANÓNIMO ═══════════════

    case 'anonimo': {
        if (!needPrivate(m)) return;
        await m.reply(await anonStart(conn, m.sender));
        break;
    }
    case 'siguiente': {
        if (!needPrivate(m)) return;
        await m.reply(await anonNext(conn, m.sender));
        break;
    }
    case 'salirchat': {
        if (!needPrivate(m)) return;
        await m.reply(await anonLeave(conn, m.sender));
        break;
    }

    }
}

// Registro en el cmdMap del handler (mismo patrón que los packs 2-8).
for (const meta of COMMAND_META) {
    const canonical = meta.names[0];
    command({ name: canonical, aliases: meta.names.slice(1), category: meta.category, description: meta.description },
        (conn, m, args, text) => execute(conn, m, canonical, args, text));
}
export { COMMAND_META };
export default true;
