// kim/commands_extra.js — Comandos MIGRADOS desde el bot de referencia.
//
// Todos estos comandos provienen de KimdanBot-MD1 (Baileys legacy, CommonJS)
// y fueron REESCRITOS para la arquitectura del proyecto principal:
//   • CommonJS  → ESM
//   • switch en kim.js  → registry.command()
//   • Baileys legacy    → Baileys v7 (LID-aware)
//   • APIs muertas/de pago (lolhuman, akuari, simsimi, brainshop, zahwazein)
//     → reemplazadas por servicios keyless funcionales (pollinations,
//       duckduckgo, lyrics.ovh, github, catbox) o por ffmpeg local.
//   • MongoDB (libros) → base de datos JSON local (db.data.others.books)
//
// Se registran en el MISMO registry que commands.js, así que el handler
// los despacha sin cambios y aparecen en el menú por categoría.

import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';
import axios from 'axios';

import { command } from './registry.js';
import { getBuffer, fetchJson, isUrl, getRandom, sleep, ytAudioUrl, ytVideoUrl } from './helpers.js';
import { getUser, getChat, db } from './db.js';

// ─── Helpers de permisos (equivalentes a commands.js) ──────────────────
const needGroup = (m) => {
    if (!m.isGroup) { m.reply('⚠️ Este comando solo funciona en grupos.'); return false; }
    return true;
};
const needGroupAdmin = (m) => {
    if (!needGroup(m)) return false;
    if (!m.isSenderAdmin && !m.isOwner) { m.reply('⚠️ Solo administradores.'); return false; }
    return true;
};
const needBotAdmin = (m) => {
    if (!m.isBotAdmin) { m.reply('⚠️ Necesito ser admin del grupo.'); return false; }
    return true;
};
const needOwner = (m) => {
    if (!m.isOwner) { m.reply('⚠️ Solo el propietario del bot.'); return false; }
    return true;
};
const resolveTarget = (m, text) => {
    if (m.mentionedJid?.[0]) return m.mentionedJid[0];
    if (m.quoted?.sender) return m.quoted.sender;
    if (text) {
        const num = String(text).replace(/[^0-9]/g, '');
        if (num.length >= 8) return num + '@s.whatsapp.net';
    }
    return null;
};
const pickRandom = (l) => l[Math.floor(Math.random() * l.length)];

// ─── ffmpeg helper (efectos de audio) ──────────────────────────────────
async function runFfmpeg(inputBuf, args, outExt = 'mp3') {
    const tmpIn = path.join(os.tmpdir(), `kimfx_${Date.now()}_${getRandom()}`);
    const tmpOut = `${tmpIn}.${outExt}`;
    await fs.promises.writeFile(tmpIn, inputBuf);
    return new Promise((resolve, reject) => {
        const ff = spawn('ffmpeg', ['-y', '-i', tmpIn, ...args, tmpOut]);
        ff.on('error', (e) => reject(/ENOENT/.test(String(e?.message)) ? new Error('Falta "ffmpeg" en el sistema.') : e));
        ff.on('close', async (code) => {
            try {
                if (code !== 0) return reject(new Error('ffmpeg falló (código ' + code + ').'));
                resolve(await fs.promises.readFile(tmpOut));
            } catch (e) { reject(e); }
            finally {
                fs.promises.unlink(tmpIn).catch(() => {});
                fs.promises.unlink(tmpOut).catch(() => {});
            }
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════
// INFO / OWNER
// ═══════════════════════════════════════════════════════════════════════

// ─── Metadatos de todos los comandos migrados ──────────────────────────
const COMMAND_META = [
    { name: 'imagen', category: 'info', description: 'Envía la foto del chat/grupo' },
    { name: 'colaborador1', aliases: ['colab1'], category: 'info', description: 'Datos de un colaborador' },
    { name: 'getcase', category: 'owner', hidden: true, description: 'Muestra el código de un comando' },
    { name: 'update', aliases: ['actualizar'], category: 'owner', description: 'git pull para actualizar' },
    { name: 'listagrupos', aliases: ['groupkim', 'grouplist', 'listagru'], category: 'owner', description: 'Lista los grupos del bot' },
    { name: 'autoadmin', aliases: ['tenerpoder'], category: 'owner', description: 'El owner se da admin a sí mismo' },
    { name: 'join', aliases: ['unete'], category: 'owner', description: 'El bot se une a un grupo por link' },
    { name: 'leave', aliases: ['salte'], category: 'owner', description: 'El bot sale del grupo' },
    { name: 'editinfo', aliases: ['editarinfo'], category: 'group', description: 'Bloquea/desbloquea edición de info del grupo' },
    { name: 'totag', category: 'group', description: 'Reenvía el mensaje citado etiquetando a todos' },
    { name: 'aprobar', aliases: ['prueba'], category: 'group', description: 'Aprueba solicitudes de ingreso pendientes' },
    { name: 'rechazar', aliases: ['prueba2'], category: 'group', description: 'Rechaza solicitudes de ingreso pendientes' },
    { name: 'allmessage', category: 'config', description: 'Activa/desactiva bienvenida+despedida+avisos' },
    { name: 'autolevel', category: 'config', description: 'Auto-subida de nivel del grupo' },
    { name: 'buy', aliases: ['buyall'], category: 'rpg', description: 'Compra diamantes con EXP (.buy <n> | .buyall)' },
    { name: 'cofre', category: 'rpg', description: 'Abre un cofre diario (nivel 9+)' },
    { name: 'nivel', aliases: ['levelup'], category: 'rpg', description: 'Sube de nivel con tu EXP' },
    { name: 'myns', category: 'rpg', hidden: true, description: 'Tu número de serie de registro' },
    { name: 'simi', aliases: ['alexa', 'siri'], category: 'fun', description: 'Habla con la IA' },
    { name: 'follar', aliases: ['violar'], category: 'fun', description: 'Broma para adultos (texto)' },
    { name: 'pregunta', aliases: ['preg'], category: 'game', description: 'Hazme una pregunta de sí/no' },
    { name: 'doxear', aliases: ['doxxeo'], category: 'fun', description: 'Doxxeo falso (broma)' },
    { name: 'personalidad', category: 'fun', description: 'Analiza la personalidad (broma)' },
    { name: 'topgays', aliases: ['topotakus'], category: 'fun', description: 'Top 10 del grupo (broma)' },
    { name: 'alegay', category: 'fun', description: '% de alegría' },
    { name: 'diego', category: 'fun', hidden: true, description: 'ASCII art' },
    { name: 'mario', category: 'fun', hidden: true, description: 'ASCII art' },
    { name: 'ia', aliases: ['chatgpt'], category: 'tools', description: 'Pregúntale a la IA (texto)' },
    { name: 'aimg', aliases: ['imagine', 'dalle', 'dall-e', 'ia2'], category: 'tools', description: 'Genera una imagen con IA' },
    { name: 'wallpaper', category: 'search', description: 'Genera un wallpaper con IA' },
    { name: 'blackpink', aliases: ['bloodfrosted', 'neon', 'minion', 'cloud', 'avenger', 'space'], category: 'fun', description: 'Logo con texto estilizado (IA)' },
    { name: 'google', category: 'search', description: 'Busca en la web' },
    { name: 'gitclone', category: 'download', description: 'Descarga un repo de GitHub (.zip)' },
    { name: 'mediafire', category: 'download', description: 'Descarga un archivo de MediaFire' },
    { name: 'lyrics', aliases: ['letra'], category: 'search', description: 'Letra de una canción (artista - título)' },
    { name: 'play3', aliases: ['playdoc', 'playaudiodoc', 'ytmp3doc'], category: 'download', description: 'YouTube audio como documento' },
    { name: 'play4', aliases: ['playdoc2', 'playvideodoc', 'ytmp4doc'], category: 'download', description: 'YouTube video como documento' },
    { name: 'facebook', aliases: ['fb'], category: 'download', description: 'Descarga video de Facebook' },
    { name: 'instagram', aliases: ['ig'], category: 'download', description: 'Descarga de Instagram' },
    { name: 'igstalk', aliases: ['iig'], category: 'search', description: 'Información de un perfil de Instagram' },
    { name: 'wm', aliases: ['take'], category: 'sticker', description: 'Re-empaqueta un sticker' },
    { name: 'tourl', category: 'tools', description: 'Sube una imagen/video y devuelve su URL' },
    { name: 'bass', aliases: ['blown', 'deep', 'earrape', 'fast', 'fat', 'nightcore', 'reverse', 'robot', 'slow', 'smooth', 'squirrel'], category: 'media', description: 'Aplica efectos a un audio' },
    { name: 'serbot', aliases: ['qr', 'jadibot'], category: 'owner', description: 'Conecta un sub-bot (QR o --code)' },
    { name: 'sercode', category: 'owner', description: 'Conecta un sub-bot por código de 8 dígitos' },
    { name: 'deljadibot', aliases: ['stop'], category: 'owner', description: 'Desconecta tu sub-bot' },
    { name: 'bots', aliases: ['listbots'], category: 'info', description: 'Lista los sub-bots conectados' },
    { name: 'listonline', aliases: ['liston'], category: 'group', description: 'Lista miembros marcados como en línea' },
    { name: 'testt', category: 'owner', hidden: true, description: 'Mensaje de prueba (debug)' },
    { name: 'hd', category: 'tools', description: 'Mejora la calidad de una imagen (x2)' },
    { name: 'spotify', aliases: ['music'], category: 'download', description: 'Descarga una canción por nombre' },
    { name: 'pinterest', category: 'search', description: 'Busca imágenes en Pinterest' },
    { name: 'apk', aliases: ['modoapk'], category: 'download', description: 'Descarga un APK desde Aptoide' },
    { name: 'toanime', category: 'media', description: 'Convierte una foto a estilo anime' },
    { name: 'yaoi', category: 'fun', description: 'Arte anime del género (SFW)' },
];

// Helpers compartidos por play3/play4 (YouTube como documento)
async function ytDocAudio(conn, m, text) {
    if (!text) return m.reply('Uso: .' + m.command + ' <canción o link>');
    let yts;
    try { ({ default: yts } = await import('yt-search')); }
    catch { return m.reply('⚠️ Falta yt-search: npm i yt-search'); }
    const r = await yts(text);
    const v = r.videos?.[0];
    if (!v) return m.reply('Sin resultados.');
    try {
        const dl = await ytAudioUrl(v.url);
        if (!dl) throw new Error('no url');
        const buf = await getBuffer(dl, { timeout: 120000 });
        await conn.sendMessage(m.chat, { document: buf, mimetype: 'audio/mpeg', fileName: `${v.title}.mp3` }, { quoted: m });
    } catch {
        await m.reply(`🎵 *${v.title}*\n${v.url}\n\n⚠️ La descarga directa no está disponible ahora; usa el enlace.`);
    }
}
async function ytDocVideo(conn, m, text) {
    if (!text) return m.reply('Uso: .' + m.command + ' <video o link>');
    let yts;
    try { ({ default: yts } = await import('yt-search')); }
    catch { return m.reply('⚠️ Falta yt-search: npm i yt-search'); }
    const r = await yts(text);
    const v = r.videos?.[0];
    if (!v) return m.reply('Sin resultados.');
    try {
        const dl = await ytVideoUrl(v.url);
        if (!dl) throw new Error('no url');
        const buf = await getBuffer(dl, { timeout: 180000 });
        await conn.sendMessage(m.chat, { document: buf, mimetype: 'video/mp4', fileName: `${v.title}.mp4` }, { quoted: m });
    } catch {
        await m.reply(`🎬 *${v.title}*\n${v.url}\n\n⚠️ La descarga directa no está disponible ahora; usa el enlace.`);
    }
}

export async function execute(conn, m, cmd, args, text) {
    switch (cmd) {
    case 'imagen': {

    try {
        const url = await conn.profilePictureUrl(m.chat, 'image');
        const buf = await getBuffer(url);
        await conn.sendMessage(m.chat, { image: buf, caption: '🖼️ Foto del chat.' }, { quoted: m });
    } catch { await m.reply('❌ Este chat no tiene foto o es privada.'); }
        break;
    }
    case 'colaborador1': {

    const c = global.owner?.find(o => Array.isArray(o) && o[1]) || ['', 'Equipo'];
    await m.reply(`🌸 *Colaborador*\n\n• Nombre: ${c[1] || 'Equipo KimdanBot'}\n• Rol: Colaborador oficial`);
        break;
    }
    case 'getcase': {

    if (!needOwner(m)) return;
    if (!args[0]) return m.reply('🚩 Indica el nombre del case. Ej: .getcase ping');
    try {
        const src = fs.readFileSync(new URL('./commands.js', import.meta.url), 'utf-8');
        const marker = `case '${args[0]}'`;
        if (!src.includes(marker)) return m.reply('🚩 Case no encontrado.');
        const body = 'case ' + `'${args[0]}'` + src.split(marker)[1].split('\n            case ')[0];
        await m.reply(body.slice(0, 3500));
    } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
        break;
    }
    case 'update': {

    if (!needOwner(m)) return;
    try {
        const { execSync, spawn } = await import('child_process');
        let out = execSync('git pull' + (text ? ' ' + text : ''), { encoding: 'utf-8', timeout: 60000 }).toString();
        if (/Already up to date/i.test(out)) { await m.reply('✅ Nada por actualizar.'); break; }
        await m.reply('✅ *Actualizado:*\n\n' + out.slice(0, 3000) + '\n\n🔄 Reiniciando para aplicar cambios...');
        try { await db.flush?.(); } catch { /* */ }
        try {
            const proc = spawn(process.argv[0], process.argv.slice(1), { cwd: process.cwd(), detached: true, stdio: 'inherit' });
            proc.unref();
        } catch (e) { console.error('[update] respawn:', e?.message || e); }
        setTimeout(() => process.exit(0), 1500);
    } catch (e) { await m.reply('❌ git pull falló:\n' + String(e?.message || e).slice(0, 1500)); }
        break;
    }
    case 'listagrupos': {

    if (!needOwner(m)) return;
    try {
        const all = await conn.groupFetchAllParticipating();
        const groups = Object.values(all || {});
        if (!groups.length) return m.reply('No estoy en ningún grupo.');
        const list = groups.map((g, i) => `${i + 1}. *${g.subject}* (${g.participants?.length || 0} miembros)\n   ${g.id}`).join('\n\n');
        await m.reply(`🌸 *Grupos (${groups.length}):*\n\n${list}`.slice(0, 3800));
    } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
        break;
    }
    case 'autoadmin': {

    if (!needGroup(m) || !needOwner(m) || !needBotAdmin(m)) return;
    try {
        await conn.groupParticipantsUpdate(m.chat, [m.sender], 'promote');
        await m.reply('😎 Listo, ahora eres admin.');
    } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
        break;
    }
    case 'join': {

    if (!needOwner(m)) return;
    const link = (text || '').match(/chat\.whatsapp\.com\/([0-9A-Za-z]+)/);
    if (!link) return m.reply('Uso: .join <link de invitación>');
    try {
        await conn.groupAcceptInvite(link[1]);
        await m.reply('✅ Me uní al grupo.');
    } catch (e) { await m.reply('❌ No pude unirme: ' + (e?.message || e)); }
        break;
    }
    case 'leave': {

    if (!needGroup(m) || !needOwner(m)) return;
    await m.reply('👋 Adiós, fue un gusto. Hasta pronto.');
    try { await conn.groupLeave(m.chat); } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
        break;
    }
    case 'editinfo': {

    if (!needGroupAdmin(m) || !needBotAdmin(m)) return;
    const a = (args[0] || '').toLowerCase();
    if (a !== 'open' && a !== 'close') return m.reply('Uso: .editinfo open | close');
    try {
        await conn.groupSettingUpdate(m.chat, a === 'open' ? 'unlocked' : 'locked');
        await m.reply(a === 'open' ? '✅ Todos pueden editar la info.' : '🔒 Solo admins editan la info.');
    } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
        break;
    }
    case 'totag': {

    if (!needGroup(m)) return;
    if (!m.quoted) return m.reply('Responde a un mensaje con .totag');
    const jids = (m.participants || []).map(p => p.id).filter(Boolean);
    if (!jids.length) return m.reply('No pude leer los participantes.');
    // Reenvía el contenido citado etiquetando a todos. Construimos un
    // WAMessage válido a partir del mensaje citado para que `forward`
    // funcione y adjuntamos las menciones (JID canónico del grupo).
    try {
        const fake = {
            key: {
                remoteJid: m.chat,
                fromMe: !!m.quoted.fromMe,
                id: m.quoted.id || m.quoted.key?.id,
                participant: m.quoted.sender,
            },
            message: m.quoted.message,
        };
        await conn.sendMessage(m.chat, { forward: fake, mentions: jids }, { quoted: m });
    } catch {
        // Fallback robusto: reenvía el texto/caption citado con menciones.
        const body = m.quoted.text || m.quoted.msg?.caption || '📢';
        await conn.sendMessage(m.chat, { text: body, mentions: jids }, { quoted: m });
    }
        break;
    }
    case 'aprobar': {

    if (!needGroupAdmin(m) || !needBotAdmin(m)) return;
    try {
        const reqs = await conn.groupRequestParticipantsList(m.chat);
        if (!reqs?.length) return m.reply('No hay solicitudes pendientes.');
        const jids = reqs.map(r => r.jid);
        await conn.groupRequestParticipantsUpdate(m.chat, jids, 'approve');
        await m.reply(`✅ Aprobadas ${jids.length} solicitud(es).`);
    } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
        break;
    }
    case 'rechazar': {

    if (!needGroupAdmin(m) || !needBotAdmin(m)) return;
    try {
        const reqs = await conn.groupRequestParticipantsList(m.chat);
        if (!reqs?.length) return m.reply('No hay solicitudes pendientes.');
        const jids = reqs.map(r => r.jid);
        await conn.groupRequestParticipantsUpdate(m.chat, jids, 'reject');
        await m.reply(`🚫 Rechazadas ${jids.length} solicitud(es).`);
    } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
        break;
    }
    case 'allmessage': {

    if (!needGroupAdmin(m)) return;
    const a = (args[0] || '').toLowerCase();
    if (a !== 'on' && a !== 'off') return m.reply('Uso: .allmessage on | off');
    const c = getChat(m.chat);
    const v = a === 'on';
    c.welcome = v; c.bye = v; c.detect = v;
    db.markDirty();
    await m.reply(v ? '✅ Bienvenida, despedida y avisos ACTIVADOS.' : '🍃 Bienvenida, despedida y avisos DESACTIVADOS.');
        break;
    }
    case 'autolevel': {

    if (!needGroupAdmin(m)) return;
    const a = (args[0] || '').toLowerCase();
    if (a !== 'on' && a !== 'off') return m.reply('Uso: .autolevel on | off');
    const c = getChat(m.chat);
    c.autolevelup = a === 'on';
    db.markDirty();
    await m.reply(c.autolevelup ? '✅ Auto-nivel activado.' : '🍃 Auto-nivel desactivado.');
        break;
    }
    case 'buy': {

    const u = getUser(m.sender);
    let count;
    if (m.command === 'buyall') count = Math.floor((u.exp || 0) / 450);
    else count = parseInt(args[0]) || 1;
    count = Math.max(1, count);
    const cost = 450 * count;
    if ((u.exp || 0) < cost) return m.reply(`🔶 No tienes EXP suficiente. Necesitas *${cost}* EXP para *${count}* 💎. Consigue EXP con .work / .mine.`);
    u.exp -= cost;
    u.diamond = (u.diamond || 0) + count;
    db.markDirty();
    await m.reply(`╔═❖ *NOTA DE PAGO*\n║ Compraste: *${count}* 💎\n║ Gastaste: *${cost}* EXP\n╚═══════════`);
        break;
    }
    case 'cofre': {

    const u = getUser(m.sender);
    if ((u.level || 0) < 9) return m.reply('❇️ Necesitas nivel 9 para usar el cofre. Mira tu nivel con .nivel');
    const last = u.lastcofre || 0;
    if (Date.now() - last < 86400000) {
        const left = 86400000 - (Date.now() - last);
        return m.reply(`🎁 Ya abriste tu cofre. Vuelve en ${Math.ceil(left / 3600000)}h.`);
    }
    const exp = Math.floor(Math.random() * 9000);
    const dia = Math.floor(Math.random() * 60);
    const money = Math.floor(Math.random() * 6500);
    u.exp = (u.exp || 0) + exp;
    u.diamond = (u.diamond || 0) + dia;
    u.money = (u.money || 0) + money;
    u.lastcofre = Date.now();
    db.markDirty();
    await m.reply(`╔══🎉══⬣\n║🛒 *OBTIENES UN COFRE*\n║⚡ ${exp} EXP\n║💎 ${dia} Diamantes\n║🪙 ${money} Coins\n╚═════════⬣`);
        break;
    }
    case 'nivel': {

    const u = getUser(m.sender);
    const mult = global.multiplier || 90;
    const need = (lvl) => Math.round(mult * (lvl + 1) * (Math.pow(lvl + 1, 1.4)));
    const before = u.level || 0;
    let lvl = before;
    while ((u.exp || 0) >= need(lvl)) lvl++;
    if (lvl === before) {
        return m.reply(`╭╌「 *TUS ESTADÍSTICAS* 」\n├ NOMBRE: ${m.pushName || '?'}\n├ EXP: ${u.exp || 0}\n├ NIVEL: ${u.level || 0}\n├ RANGO: ${u.role || 'Novato'}\n╰╌ Te faltan *${need(before) - (u.exp || 0)}* EXP para subir.`);
    }
    u.level = lvl;
    db.markDirty();
    await m.reply(`╭╌「 *LEVEL UP 🎊* 」\n├ 🥳 ${m.pushName || ''} ¡Felicidades!\n├ NIVEL ANTERIOR: ${before}\n├ NIVEL ACTUAL: ${u.level}\n├ RANGO: ${u.role || 'Novato'}\n╰╌ Interactúa más para subir.`);
        break;
    }
    case 'myns': {

    const { createHash } = await import('crypto');
    const sn = createHash('md5').update(m.sender).digest('hex');
    await m.reply(`🔑 Tu número de serie:\n${sn}`);
        break;
    }
    case 'simi': {

    if (!text) return m.reply('💬 Escríbeme algo. Ej: .simi hola');
    try {
        await conn.sendPresenceUpdate('composing', m.chat).catch(() => {});
        const res = await axios.get(`https://text.pollinations.ai/${encodeURIComponent(text)}`, { timeout: 40000 });
        const out = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
        await m.reply((out || '🤖 ...').slice(0, 3500));
    } catch (e) { await m.reply('🤖 La IA no respondió, intenta de nuevo.'); }
        break;
    }
    case 'follar': {

    const tgt = resolveTarget(m, text);
    if (!tgt) return m.reply('Etiqueta o menciona a alguien.');
    await conn.sendMessage(m.chat, {
        text: `🥵 *@${m.sender.split('@')[0]}* le dio cariño intenso a *@${tgt.split('@')[0]}* (?) 😳`,
        mentions: [m.sender, tgt],
    }, { quoted: m });
        break;
    }
    case 'pregunta': {

    if (!text) return m.reply('🤔 ¿Y la pregunta? Ej: .pregunta ¿lloverá mañana?');
    const r = pickRandom(['no', 'sí', 'no sé', 'puede ser', 'no creo', 'obvio', 'jamás', 'tal vez']);
    await m.reply(`🔸 *Pregunta:* ${text}\n🔸 *Respuesta:* ${r}`);
        break;
    }
    case 'doxear': {

    const tgt = resolveTarget(m, text);
    const name = tgt ? `@${tgt.split('@')[0]}` : (text || m.pushName || 'usuario');
    const { key } = await conn.sendMessage(m.chat, { text: '😱 *¡Empezando doxxeo!*', mentions: tgt ? [tgt] : [] }, { quoted: m });
    for (const p of ['10%', '47%', '88%', '100%']) {
        await sleep(500);
        await conn.sendMessage(m.chat, { text: `🔎 ${p}`, edit: key }).catch(() => {});
    }
    const fake = `🤣 *Persona "hackeada" con éxito*\n\n*Objetivo:* ${name}\n*IP:* 92.28.211.234\n*ISP:* Ucom Universal\n*DNS:* 8.8.8.8\n*MAC:* 5A:78:3E:7E:00\n*Gateway:* 192.168.0.1\n*Puertos:* 80, 443, 8080\n\n_(Es 100% una broma 😜)_`;
    await conn.sendMessage(m.chat, { text: fake, mentions: tgt ? [tgt] : [], edit: key }).catch(() => {});
        break;
    }
    case 'personalidad': {

    if (!text) return m.reply('Ingresa un nombre. Ej: .personalidad Ana');
    const pct = () => pickRandom(['6%', '20%', '35%', '49%', '66%', '78%', '92%', '99%', '0.4%']);
    await m.reply(`┏━ *PERSONALIDAD* ━┓
┃ Nombre: ${text}
┃ Buena moral: ${pct()}
┃ Mala moral: ${pct()}
┃ Tipo: ${pickRandom(['De buen corazón', 'Arrogante', 'Tacaño', 'Generoso', 'Humilde', 'Tímido', 'Entrometido'])}
┃ Inteligencia: ${pct()}
┃ Coraje: ${pct()}
┃ Fama: ${pct()}
┗━━━━━━━━━━━`);
        break;
    }
    case 'topgays': {

    if (!needGroup(m)) return;
    const members = (m.participants || []).map(p => p.id);
    if (members.length < 3) return m.reply('No hay suficientes miembros.');
    const pick = () => members[Math.floor(Math.random() * members.length)];
    const sel = Array.from({ length: 10 }, pick);
    const title = m.command === 'topotakus' ? '🌸 TOP 10 OTAKUS DEL GRUPO 🌸' : '🌈 TOP 10 DEL GRUPO 🌈';
    const list = sel.map((j, i) => `*${i + 1}.* @${j.split('@')[0]}`).join('\n');
    await conn.sendMessage(m.chat, { text: `${title}\n\n${list}`, mentions: sel }, { quoted: m });
        break;
    }
    case 'alegay': {

    const tgt = m.mentionedJid?.[0] ? `@${m.mentionedJid[0].split('@')[0]}` : (text || m.pushName || 'tú');
    await conn.sendMessage(m.chat, { text: `🌈 ${tgt} tiene ${Math.floor(Math.random() * 101)}% de alegría 🎉`, mentions: m.mentionedJid || [] }, { quoted: m });
        break;
    }
    case 'diego': {

    await m.reply('⣿⣿⣿⠟⢹⣶⣶⣝⣿⣿⣿\n⣿⣿⡟⢰⡌⠿⢿⣿⡾⢹⣿\n⣿⣿⣿⢸⣿⣤⣒⣶⣾⣳⡻\n⣿⣿⣿⠸⣿⣿⣿⣿⢇⠃⣟\n⣿⣿⣿⣇⢻⣿⣿⣯⣕⠧⢿');
        break;
    }
    case 'mario': {

    await m.reply('🟥🟥🟥⬜⬜🟥🟥🟥\n🟥🟥🟥⬜⬜🟥🟥🟥\n🟥🟥🟥🟥🟥🟥🟥🟥\n🏻⬜🟦🏻🏻🟦⬜🏻\n🟫🏻🏻🏻🏻🏻🏻🟫\n🏻⬛⬛⬛⬛⬛⬛🏻');
        break;
    }
    case 'ia': {

    if (!text) return m.reply('Uso: .ia <pregunta>');
    try {
        const res = await axios.get(`https://text.pollinations.ai/${encodeURIComponent(text)}`, { timeout: 45000 });
        const out = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
        await m.reply((out || '🤖 ...').slice(0, 3800));
    } catch (e) { await m.reply('❌ La IA no respondió: ' + (e?.message || e)); }
        break;
    }
    case 'aimg': {

    if (!text) return m.reply('Uso: .aimg <descripción>');
    try {
        await m.reply('🎨 Generando imagen...');
        const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(text)}?width=1024&height=1024&nologo=true`;
        const buf = await getBuffer(url, { timeout: 60000 });
        if (!buf) throw new Error('Sin respuesta del generador.');
        await conn.sendMessage(m.chat, { image: buf, caption: `🎨 ${text}` }, { quoted: m });
    } catch (e) { await m.reply('❌ No se pudo generar la imagen: ' + (e?.message || e)); }
        break;
    }
    case 'wallpaper': {

    if (!text) return m.reply('Uso: .wallpaper <tema>');
    try {
        const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(text + ' wallpaper 4k high quality')}?width=1280&height=720&nologo=true`;
        const buf = await getBuffer(url, { timeout: 60000 });
        if (!buf) throw new Error('Sin respuesta.');
        await conn.sendMessage(m.chat, { image: buf, caption: `🖼️ Wallpaper: ${text}` }, { quoted: m });
    } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
        break;
    }
    case 'blackpink': {

    if (!text) return m.reply(`Uso: .${m.command} <texto>`);
    const styles = {
        blackpink: 'blackpink kpop neon pink logo text', bloodfrosted: 'frozen blood ice horror logo text',
        neon: 'glowing neon sign logo text', minion: 'cute minion cartoon logo text',
        cloud: 'fluffy clouds sky 3d logo text', avenger: 'marvel avengers metal logo text',
        space: 'galaxy space stars 3d logo text',
    };
    try {
        const prompt = `${styles[m.command] || 'stylized logo text'} that says "${text}", centered, high detail`;
        const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=512&nologo=true`;
        const buf = await getBuffer(url, { timeout: 60000 });
        if (!buf) throw new Error('Sin respuesta.');
        await conn.sendMessage(m.chat, { image: buf, caption: `✨ Estilo: ${m.command}` }, { quoted: m });
    } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
        break;
    }
    case 'google': {

    if (!text) return m.reply('Uso: .google <consulta>');
    try {
        const res = await axios.get('https://api.duckduckgo.com/', {
            params: { q: text, format: 'json', no_html: 1, skip_disambig: 1 }, timeout: 15000,
        });
        const d = res.data;
        let out = `🔎 *Resultados para:* ${text}\n\n`;
        if (d.AbstractText) out += `${d.AbstractText}\n${d.AbstractURL || ''}\n\n`;
        const topics = (d.RelatedTopics || []).filter(t => t.Text).slice(0, 6);
        for (const t of topics) out += `• ${t.Text}\n${t.FirstURL || ''}\n\n`;
        if (out.trim() === `🔎 *Resultados para:* ${text}`) out += '_Sin resultados directos. Prueba .yts o .wiki._';
        await m.reply(out.slice(0, 3800));
    } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
        break;
    }
    case 'gitclone': {

    if (!text) return m.reply('Uso: .gitclone <url de GitHub>');
    const mt = text.match(/github\.com\/([^/]+)\/([^/\s]+)/);
    if (!mt) return m.reply('URL de GitHub inválida.');
    const [, user, repoRaw] = mt;
    const repo = repoRaw.replace(/\.git$/, '');
    try {
        const url = `https://api.github.com/repos/${user}/${repo}/zipball`;
        const buf = await getBuffer(url, { headers: { 'User-Agent': 'KimdanBot' }, timeout: 60000 });
        if (!buf) throw new Error('No se pudo descargar.');
        await conn.sendMessage(m.chat, {
            document: buf, fileName: `${repo}.zip`, mimetype: 'application/zip',
        }, { quoted: m });
    } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
        break;
    }
    case 'mediafire': {
    if (!text || !/mediafire\.com/.test(text)) return m.reply('Uso: .mediafire <link de MediaFire>');
    try {
        const page = await axios.get(text.trim(), { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 20000 });
        const html = page.data;
        const dl = (html.match(/href="((https?:\/\/download[^"]+))"/) || [])[1]
            || (html.match(/"(https?:\/\/download\d+\.mediafire\.com[^"]+)"/) || [])[1];
        if (!dl) throw new Error('No encontré el enlace directo.');
        const name = decodeURIComponent((dl.split('/').pop() || 'archivo').split('?')[0]);
        await m.reply(`📥 *${name}*\nDescargando...`);
        const buf = await getBuffer(dl, { timeout: 120000 });
        await conn.sendMessage(m.chat, { document: buf, fileName: name, mimetype: 'application/octet-stream' }, { quoted: m });
    } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
        break;
    }
    case 'lyrics': {

    if (!text || !text.includes('-')) return m.reply('Uso: .lyrics <artista> - <título>\nEj: .lyrics Coldplay - Yellow');
    const [artist, title] = text.split('-').map(s => s.trim());
    try {
        const res = await axios.get(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`, { timeout: 15000 });
        const lyr = res.data?.lyrics;
        if (!lyr) throw new Error('No encontré la letra.');
        await m.reply(`🎵 *${artist} — ${title}*\n\n${lyr}`.slice(0, 3800));
    } catch (e) { await m.reply('❌ No encontré la letra (usa el formato "artista - título").'); }
        break;
    }
    case 'play3': {
        await (ytDocAudio(conn, m, text));
        break;
    }
    case 'play4': {
        await (ytDocVideo(conn, m, text));
        break;
    }
    case 'facebook': {

    if (!text || !/facebook\.com|fb\.watch/.test(text)) return m.reply('Uso: .facebook <link>');
    try {
        const res = await axios.get(`https://api.vreden.my.id/api/fbdl?url=${encodeURIComponent(text.trim())}`, { timeout: 30000 });
        const dl = res.data?.result?.[0]?.url || res.data?.result?.hd || res.data?.result?.sd;
        if (!dl) throw new Error('sin url');
        const buf = await getBuffer(dl, { timeout: 120000 });
        await conn.sendMessage(m.chat, { video: buf, mimetype: 'video/mp4', caption: '📥 Facebook' }, { quoted: m });
    } catch { await m.reply('❌ No se pudo descargar el video de Facebook (servicio externo no disponible).'); }
        break;
    }
    case 'instagram': {

    if (!text || !/instagram\.com/.test(text)) return m.reply('Uso: .instagram <link>');
    try {
        const res = await axios.get(`https://api.vreden.my.id/api/igdl?url=${encodeURIComponent(text.trim())}`, { timeout: 30000 });
        const items = res.data?.result || [];
        if (!items.length) throw new Error('sin resultados');
        for (const it of items.slice(0, 5)) {
            const url = it.url || it;
            const buf = await getBuffer(url, { timeout: 120000 });
            if (!buf) continue;
            const isVid = /\.mp4|video/i.test(url) || it.type === 'video';
            await conn.sendMessage(m.chat, isVid ? { video: buf, caption: '📥 Instagram' } : { image: buf, caption: '📥 Instagram' }, { quoted: m });
        }
    } catch { await m.reply('❌ No se pudo descargar de Instagram (servicio externo no disponible).'); }
        break;
    }
    case 'igstalk': {

    if (!text) return m.reply('Uso: .igstalk <usuario>');
    try {
        const res = await axios.get(`https://api.vreden.my.id/api/igstalk?username=${encodeURIComponent(text.replace('@', '').trim())}`, { timeout: 25000 });
        const a = res.data?.result;
        if (!a) throw new Error('sin datos');
        await m.reply(`📷 *Instagram*\n\n• Usuario: ${a.username || text}\n• Nombre: ${a.fullName || a.fullname || '-'}\n• Posts: ${a.posts ?? '-'}\n• Seguidores: ${a.followers ?? '-'}\n• Siguiendo: ${a.following ?? '-'}\n• Bio: ${a.biography || a.bio || '-'}`);
    } catch { await m.reply('❌ No se pudo consultar el perfil (servicio externo no disponible).'); }
        break;
    }
    case 'wm': {

    const target = m.quoted || m;
    const mime = target.msg?.mimetype || '';
    if (!/webp|image|video/.test(mime)) return m.reply('Responde a un sticker/imagen/video con .wm');
    try {
        const buf = await target.download();
        if (/video/.test(mime)) await conn.sendVideoAsSticker(m.chat, buf, m, { packname: global.packname, author: global.author });
        else await conn.sendImageAsSticker(m.chat, buf, m, { packname: global.packname, author: global.author });
    } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
        break;
    }
    case 'tourl': {

    const target = m.quoted || m;
    const mime = target.msg?.mimetype || '';
    if (!/image|video|audio/.test(mime)) return m.reply('Responde a una imagen/video/audio con .tourl');
    try {
        const buf = await target.download();
        const FormData = (await import('form-data')).default;
        const form = new FormData();
        form.append('reqtype', 'fileupload');
        const ext = (mime.split('/')[1] || 'bin').split(';')[0];
        form.append('fileToUpload', buf, `file.${ext}`);
        const res = await axios.post('https://catbox.moe/user/api.php', form, {
            headers: form.getHeaders(), timeout: 60000,
        });
        await m.reply(`🔗 ${res.data}`);
    } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
        break;
    }
    case 'bass': {

    const target = m.quoted || m;
    const mime = target.msg?.mimetype || '';
    if (!/audio|video/.test(mime)) return m.reply(`Responde a un audio con .${m.command}`);
    const fx = AUDIO_FX[m.command];
    if (!fx) return m.reply('Efecto no reconocido.');
    try {
        await conn.sendPresenceUpdate('recording', m.chat).catch(() => {});
        const inBuf = await target.download();
        const out = await runFfmpeg(inBuf, fx, 'mp3');
        await conn.sendMessage(m.chat, { audio: out, mimetype: 'audio/mpeg', fileName: `${m.command}.mp3` }, { quoted: m });
    } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
        break;
    }
    case 'serbot': {

    const useQR = !(args[0] === '--code' || args[0] === 'code' || m.command === 'jadibot');
    const { startJadibot } = await import('./jadibot.js');
    await startJadibot(conn, m, useQR).catch(e => m.reply('❌ ' + (e?.message || e)));
        break;
    }
    case 'sercode': {

    const { startJadibot } = await import('./jadibot.js');
    await startJadibot(conn, m, false).catch(e => m.reply('❌ ' + (e?.message || e)));
        break;
    }
    case 'deljadibot': {

    const { stopJadibot } = await import('./jadibot.js');
    await stopJadibot(conn, m).catch(e => m.reply('❌ ' + (e?.message || e)));
        break;
    }
    case 'bots': {

    const { listJadibots } = await import('./jadibot.js');
    await m.reply(listJadibots());
        break;
    }
    case 'listonline': {

    if (!needGroup(m)) return;
    const online = Object.entries(conn.chats?.[m.chat]?.presences || {})
        .filter(([, p]) => p?.lastKnownPresence === 'available' || p?.lastKnownPresence === 'composing')
        .map(([jid]) => jid);
    if (!online.length) return m.reply('🟢 No tengo registro de miembros en línea ahora (el bot debe llevar un rato activo y suscrito a presencias).');
    await conn.sendMessage(m.chat, {
        text: `🟢 *En línea (${online.length}):*\n` + online.map(j => `• @${j.split('@')[0]}`).join('\n'),
        mentions: online,
    }, { quoted: m });
        break;
    }
    case 'testt': {

    if (!needOwner(m)) return;
    await m.reply('✅ test ok — bot activo.');
        break;
    }
    case 'hd': {

    const target = m.quoted || m;
    const mime = target.msg?.mimetype || '';
    if (!/image/.test(mime)) return m.reply('Responde a una imagen con .hd');
    try {
        const sharp = (await import('sharp')).default;
        const buf = await target.download();
        const meta = await sharp(buf).metadata();
        const w = Math.min((meta.width || 512) * 2, 2048);
        const out = await sharp(buf)
            .resize({ width: w, withoutEnlargement: false, kernel: 'lanczos3' })
            .sharpen({ sigma: 1.2 })
            .png({ quality: 95 })
            .toBuffer();
        await conn.sendMessage(m.chat, { image: out, caption: `✨ Mejorada a ${w}px de ancho.` }, { quoted: m });
    } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
        break;
    }
    case 'spotify': {

    if (!text) return m.reply('Uso: .spotify <nombre de la canción>');
    let yts;
    try { ({ default: yts } = await import('yt-search')); }
    catch { return m.reply('⚠️ Falta yt-search: npm i yt-search'); }
    try {
        const q = text.replace(/https?:\/\/open\.spotify\.com\/\S+/g, '').trim() || text;
        const r = await yts(q);
        const v = r.videos?.[0];
        if (!v) return m.reply('Sin resultados.');
        await m.reply(`🎵 *${v.title}*\nDescargando audio...`);
        try {
            const api = `https://api.vreden.my.id/api/ytmp3?url=${encodeURIComponent(v.url)}`;
            const res = await axios.get(api, { timeout: 45000 });
            const dl = res.data?.result?.download?.url || res.data?.result?.url;
            if (!dl) throw new Error('no url');
            const buf = await getBuffer(dl, { timeout: 120000 });
            await conn.sendMessage(m.chat, { audio: buf, mimetype: 'audio/mpeg', fileName: `${v.title}.mp3` }, { quoted: m });
        } catch {
            await m.reply(`⚠️ Descarga directa no disponible ahora. Enlace:\n${v.url}`);
        }
    } catch (e) { await m.reply('❌ ' + (e?.message || e)); }
        break;
    }
    case 'pinterest': {

    if (!text) return m.reply('Uso: .pinterest <búsqueda>');
    try {
        const res = await axios.get(`https://api.vreden.my.id/api/pinterest?query=${encodeURIComponent(text)}`, { timeout: 25000 });
        const list = res.data?.result || res.data?.data || [];
        const urls = (Array.isArray(list) ? list : []).map(x => x?.images_url || x?.url || x).filter(u => typeof u === 'string');
        if (!urls.length) throw new Error('sin resultados');
        const pick = urls[Math.floor(Math.random() * urls.length)];
        const buf = await getBuffer(pick, { timeout: 60000 });
        await conn.sendMessage(m.chat, { image: buf, caption: `📌 Pinterest: ${text}` }, { quoted: m });
    } catch { await m.reply('❌ No se pudo buscar en Pinterest (servicio externo no disponible).'); }
        break;
    }
    case 'apk': {

    if (!text) return m.reply('Uso: .apk <nombre de la app>');
    try {
        await m.reply('🔎 Buscando APK...');
        const search = await axios.get(`https://ws75.aptoide.com/api/7/apps/search/query=${encodeURIComponent(text)}/limit=1`, { timeout: 20000 });
        const app = search.data?.datalist?.list?.[0];
        if (!app) throw new Error('no encontrada');
        const meta = await axios.get(`https://ws75.aptoide.com/api/7/app/getMeta/app_id=${app.id}`, { timeout: 20000 });
        const file = meta.data?.nodes?.meta?.data?.file;
        const dl = file?.path_alt || file?.path;
        if (!dl) throw new Error('sin enlace de descarga');
        const name = `${(app.package || app.name || 'app').replace(/[^\w.]/g, '_')}.apk`;
        await m.reply(`📦 *${app.name}*\nv${file?.vername || '?'} — descargando...`);
        const buf = await getBuffer(dl, { timeout: 180000 });
        await conn.sendMessage(m.chat, { document: buf, fileName: name, mimetype: 'application/vnd.android.package-archive' }, { quoted: m });
    } catch (e) { await m.reply('❌ No se pudo descargar el APK: ' + (e?.message || e)); }
        break;
    }
    case 'toanime': {
    const target = m.quoted || m;
    const mime = target.msg?.mimetype || '';
    if (!/image/.test(mime)) return m.reply('Responde a una imagen con .toanime');
    try {
        await m.reply('🎨 Procesando estilo anime...');
        const buf = await target.download();
        const FormData = (await import('form-data')).default;
        const form = new FormData();
        form.append('reqtype', 'fileupload');
        form.append('fileToUpload', buf, 'img.jpg');
        const up = await axios.post('https://catbox.moe/user/api.php', form, { headers: form.getHeaders(), timeout: 60000 });
        const imgUrl = String(up.data).trim();
        const res = await axios.get(`https://api.vreden.my.id/api/toanime?url=${encodeURIComponent(imgUrl)}`, { timeout: 60000 });
        const out = res.data?.result?.url || res.data?.result;
        if (!out || typeof out !== 'string') throw new Error('sin resultado');
        const outBuf = await getBuffer(out, { timeout: 60000 });
        await conn.sendMessage(m.chat, { image: outBuf, caption: '🌸 Estilo anime' }, { quoted: m });
    } catch { await m.reply('❌ No se pudo convertir a anime (servicio externo no disponible).'); }
        break;
    }
    case 'yaoi': {

    try {
        const prompts = [
            'wholesome anime art of two boys best friends smiling, soft pastel colors, safe for work, non-explicit, fully clothed',
            'cute anime illustration two male characters friendship, warm lighting, sfw, fully dressed, no nudity',
            'soft anime romance art two boys holding hands, wholesome, safe for work, fully clothed',
        ];
        const prompt = prompts[Math.floor(Math.random() * prompts.length)];
        const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=768&height=1024&nologo=true&safe=true`;
        const buf = await getBuffer(url, { timeout: 60000 });
        if (!buf) throw new Error('Sin respuesta del generador.');
        await conn.sendMessage(m.chat, { image: buf, caption: '🌸 Yaoi (arte SFW del género).' }, { quoted: m });
    } catch (e) { await m.reply('❌ No se pudo generar la imagen: ' + (e?.message || e)); }
        break;
    }
    }
}

for (const meta of COMMAND_META) {
    const canonical = meta.name;
    command({ name: canonical, aliases: meta.aliases || [], category: meta.category, description: meta.description, hidden: meta.hidden },
        (conn, m, args, text) => execute(conn, m, canonical, args, text));
}
export { COMMAND_META };
export default true;
