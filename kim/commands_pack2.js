// kim/commands_pack2.js — Comandos de la LISTA DEL PDF (tematizados BL/Yaoi).
//
// Incluye: #tag, economía temática (Lazos 💞), gacha BL/Yaoi, interacciones
// anime SFW con GIFs, perfiles, administración, utilidades y descargas
// (las de porno quedan EXCLUIDAS; la categoría NSFW completa también).
//
// Se registran en el mismo registry que el resto, por lo que aparecen
// automáticamente en el menú dinámico.

import axios from 'axios';
import { command } from './registry.js';
import { getUser, getChat, db } from './db.js';
import { getBuffer } from './helpers.js';
import { CURRENCY, fmtMoney, fmtPremium, RARITIES, rollRarity, rarityByKey, CHARACTERS, findCharacter } from './theme.js';
import { getGifBuffer, sendGif } from './media.js';

// ─── Helpers de permisos / utilidades ──────────────────────────────
const needGroup = (m) => { if (!m.isGroup) { m.reply('⚠️ Solo en grupos.'); return false; } return true; };
const needAdmin = (m) => {
    if (!needGroup(m)) return false;
    if (!m.isSenderAdmin && !m.isOwner) { m.reply('⚠️ Solo administradores.'); return false; }
    return true;
};
const target = (m, text) => {
    if (m.mentionedJid?.[0]) return m.mentionedJid[0];
    if (m.quoted?.sender) return m.quoted.sender;
    if (text) { const n = String(text).replace(/[^0-9]/g, ''); if (n.length >= 8) return n + '@s.whatsapp.net'; }
    return null;
};
const ms = (d) => { const s = Math.ceil(d / 1000); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return [h && `${h}h`, m && `${m}m`, `${x}s`].filter(Boolean).join(' '); };
const onCooldown = (u, field, period) => { const last = u[field] || 0; const left = period - (Date.now() - last); return left > 0 ? left : 0; };

// ════════════════════════════════════════════════════════════════════
// #tag  — menciona a todos con un mensaje personalizado (como hidetag)
// ════════════════════════════════════════════════════════════════════
command({ name: 'tag', aliases: ['tagsay'], category: 'group', description: 'Menciona a todos con tu mensaje' },
async (conn, m, args, text) => {
    if (!needAdmin(m)) return;
    const jids = (m.participants || []).map(p => p.id).filter(Boolean);
    if (!jids.length) return m.reply('No pude leer los participantes.');
    // Mensaje: el texto del comando, o el contenido citado, o un aviso.
    const body = (text && text.trim())
        || (m.quoted && (m.quoted.text || m.quoted.msg?.caption))
        || '📢 Atención a todos.';
    // Eficiente en grupos grandes: un único sendMessage con todas las
    // menciones (no se itera ni se spamea); el texto NO incluye los @número
    // visibles (estilo hidetag), pero las notificaciones llegan a todos.
    await conn.sendMessage(m.chat, { text: body, mentions: jids }, { quoted: m.quoted ? undefined : m });
});

// ════════════════════════════════════════════════════════════════════
// ECONOMÍA BL  (moneda: Lazos 💞 ; premium: Corazones 💗)
// ════════════════════════════════════════════════════════════════════
command({ name: 'balance', aliases: ['bal', 'coins'], category: 'rpg', description: 'Ver tus Lazos 💞' },
async (conn, m, text) => {
    const t = target(m, m.text2) || m.sender;
    const u = getUser(t);
    await conn.sendMessage(m.chat, {
        text: `╭─ 💞 *BILLETERA* ─╮\n│ Usuario: @${t.split('@')[0]}\n│ Cartera: ${fmtMoney(u.money)}\n│ Banco: ${fmtMoney(u.bank)}\n│ Premium: ${fmtPremium(u.corazones)}\n│ Total: ${fmtMoney((u.money || 0) + (u.bank || 0))}\n╰────────────╯`,
        mentions: [t],
    }, { quoted: m });
});

command({ name: 'economyinfo', aliases: ['einfo'], category: 'rpg', description: 'Tu información económica' },
async (conn, m) => {
    const u = getUser(m.sender);
    await m.reply(`📊 *Economía BL de @${m.sender.split('@')[0]}*\n\n💞 Lazos: ${u.money}\n🏦 Banco: ${u.bank}\n💗 Corazones: ${u.corazones}\n⬆️ EXP: ${u.exp} (nivel ${u.level})\n🎴 Personajes: ${(u.characters || []).length}`, null, { mentions: [m.sender] });
});

command({ name: 'daily', category: 'rpg', description: 'Recompensa diaria de Lazos' },
async (conn, m) => {
    const u = getUser(m.sender);
    const left = onCooldown(u, 'lastdaily', 86400000);
    if (left) return m.reply(`🕒 Ya reclamaste tu recompensa diaria. Vuelve en ${ms(left)}.`);
    const reward = 500 + Math.floor(Math.random() * 1500);
    const hearts = Math.random() < 0.15 ? 1 : 0;
    u.money += reward; u.corazones += hearts; u.lastdaily = Date.now(); db.markDirty();
    await m.reply(`🎁 *Recompensa diaria*\n+${fmtMoney(reward)}${hearts ? `\n+${fmtPremium(hearts)} (¡suerte!)` : ''}`);
});

command({ name: 'work', aliases: ['w', 'trabajar'], category: 'rpg', description: 'Trabaja para ganar Lazos' },
async (conn, m) => {
    const u = getUser(m.sender);
    const left = onCooldown(u, 'lastwork', 3600000);
    if (left) return m.reply(`😮‍💨 Estás cansado. Descansa ${ms(left)}.`);
    const jobs = ['dibujaste un doujinshi BL', 'trabajaste en una cafetería temática', 'narraste un drama CD', 'vendiste fanart en una convención', 'editaste un capítulo de manga'];
    const earn = 200 + Math.floor(Math.random() * 800);
    u.money += earn; u.exp += 50; u.lastwork = Date.now(); db.markDirty();
    await m.reply(`💼 ${jobs[Math.floor(Math.random() * jobs.length)]} y ganaste ${fmtMoney(earn)} (+50 EXP).`);
});

command({ name: 'crime', category: 'rpg', description: 'Crimen arriesgado por Lazos' },
async (conn, m) => {
    const u = getUser(m.sender);
    const left = onCooldown(u, 'lastcrime', 1800000);
    if (left) return m.reply(`🚓 Demasiado riesgo ahora. Espera ${ms(left)}.`);
    u.lastcrime = Date.now();
    if (Math.random() < 0.5) { const g = 500 + Math.floor(Math.random() * 1500); u.money += g; db.markDirty(); return m.reply(`🦹 ¡Éxito! Ganaste ${fmtMoney(g)}.`); }
    const loss = Math.min(u.money, 200 + Math.floor(Math.random() * 800)); u.money -= loss; db.markDirty();
    await m.reply(`👮 Te atraparon y pagaste una multa de ${fmtMoney(loss)}.`);
});

command({ name: 'slut', category: 'rpg', hidden: true, description: 'Trabajo nocturno arriesgado' },
async (conn, m) => {
    // Reskin SFW del comando original (sin contenido sexual): trabajo nocturno arriesgado.
    const u = getUser(m.sender);
    const left = onCooldown(u, 'lastslut', 1800000);
    if (left) return m.reply(`🌙 Aún no puedes volver a salir. Espera ${ms(left)}.`);
    u.lastslut = Date.now();
    const g = Math.floor(Math.random() * 1200) - 200;
    u.money = Math.max(0, u.money + g); db.markDirty();
    await m.reply(g >= 0 ? `🌃 Saliste a trabajar de noche y ganaste ${fmtMoney(g)}.` : `🌃 La noche salió mal y perdiste ${fmtMoney(-g)}.`);
});

command({ name: 'deposit', aliases: ['dep', 'depositar', 'd'], category: 'rpg', description: 'Depositar Lazos al banco' },
async (conn, m, args, text) => {
    const u = getUser(m.sender);
    let amt = /all|todo/i.test(text || '') ? u.money : parseInt(text);
    if (!amt || amt <= 0) return m.reply(`Uso: .deposit <cantidad|all>`);
    amt = Math.min(amt, u.money);
    if (amt <= 0) return m.reply('No tienes Lazos en la cartera.');
    u.money -= amt; u.bank += amt; db.markDirty();
    await m.reply(`🏦 Depositaste ${fmtMoney(amt)}. Banco: ${fmtMoney(u.bank)}.`);
});

command({ name: 'withdraw', aliases: ['with', 'retirar'], category: 'rpg', description: 'Retirar Lazos del banco' },
async (conn, m, args, text) => {
    const u = getUser(m.sender);
    let amt = /all|todo/i.test(text || '') ? u.bank : parseInt(text);
    if (!amt || amt <= 0) return m.reply(`Uso: .withdraw <cantidad|all>`);
    amt = Math.min(amt, u.bank);
    if (amt <= 0) return m.reply('No tienes Lazos en el banco.');
    u.bank -= amt; u.money += amt; db.markDirty();
    await m.reply(`💸 Retiraste ${fmtMoney(amt)}. Cartera: ${fmtMoney(u.money)}.`);
});

command({ name: 'givecoins', aliases: ['pay', 'coinsgive'], category: 'rpg', description: 'Dar Lazos a alguien' },
async (conn, m, args, text) => {
    const t = target(m, text);
    if (!t) return m.reply('Menciona a quién darle Lazos. Uso: .pay @user <cantidad>');
    const amt = parseInt((args || []).find(a => /^\d+$/.test(a)));
    if (!amt || amt <= 0) return m.reply('Indica una cantidad válida.');
    const u = getUser(m.sender);
    if (u.money < amt) return m.reply('No tienes suficientes Lazos.');
    const r = getUser(t); u.money -= amt; r.money += amt; db.markDirty();
    await conn.sendMessage(m.chat, { text: `🎀 @${m.sender.split('@')[0]} le dio ${fmtMoney(amt)} a @${t.split('@')[0]}.`, mentions: [m.sender, t] }, { quoted: m });
});

command({ name: 'steal', aliases: ['robar', 'rob'], category: 'rpg', description: 'Intentar robar Lazos' },
async (conn, m, args, text) => {
    if (!needGroup(m)) return;
    const t = target(m, text);
    if (!t) return m.reply('Menciona a tu víctima.');
    if (t === m.sender) return m.reply('No puedes robarte a ti mismo.');
    const u = getUser(m.sender); const v = getUser(t);
    const left = onCooldown(u, 'lastrob', 600000);
    if (left) return m.reply(`🚓 Espera ${ms(left)} para volver a robar.`);
    u.lastrob = Date.now();
    if (v.money < 100) return m.reply('Esa persona casi no tiene Lazos, da pena robarle.');
    if (Math.random() < 0.45) { const a = Math.floor(v.money * (0.1 + Math.random() * 0.2)); v.money -= a; u.money += a; db.markDirty(); return conn.sendMessage(m.chat, { text: `🦝 @${m.sender.split('@')[0]} le robó ${fmtMoney(a)} a @${t.split('@')[0]}.`, mentions: [m.sender, t] }, { quoted: m }); }
    const fine = Math.min(u.money, 100 + Math.floor(Math.random() * 300)); u.money -= fine; db.markDirty();
    await m.reply(`👮 ¡Te atraparon! Pagaste ${fmtMoney(fine)} de multa.`);
});

command({ name: 'coinflip', aliases: ['flip', 'cf'], category: 'rpg', description: 'Apuesta a cara o cruz' },
async (conn, m, args, text) => {
    const u = getUser(m.sender);
    const amt = parseInt((args || []).find(a => /^\d+$/.test(a)));
    const side = (args || []).map(a => a.toLowerCase()).find(a => ['cara', 'cruz'].includes(a)) || 'cara';
    if (!amt || amt <= 0) return m.reply('Uso: .cf <cantidad> <cara/cruz>');
    if (u.money < amt) return m.reply('No tienes suficientes Lazos.');
    const result = Math.random() < 0.5 ? 'cara' : 'cruz';
    if (result === side) { u.money += amt; db.markDirty(); return m.reply(`🪙 Salió *${result}*. ¡Ganaste ${fmtMoney(amt)}!`); }
    u.money -= amt; db.markDirty();
    await m.reply(`🪙 Salió *${result}*. Perdiste ${fmtMoney(amt)}.`);
});

command({ name: 'roulette', aliases: ['rt'], category: 'rpg', description: 'Ruleta rojo/negro' },
async (conn, m, args, text) => {
    const u = getUser(m.sender);
    const color = (args || []).map(a => a.toLowerCase()).find(a => ['red', 'black', 'rojo', 'negro'].includes(a));
    const amt = parseInt((args || []).find(a => /^\d+$/.test(a)));
    if (!color || !amt) return m.reply('Uso: .roulette <red/black> <cantidad>');
    if (u.money < amt) return m.reply('No tienes suficientes Lazos.');
    const norm = (color === 'rojo') ? 'red' : (color === 'negro') ? 'black' : color;
    const result = Math.random() < 0.486 ? 'red' : (Math.random() < 0.946 ? 'black' : 'green');
    if (result === norm) { u.money += amt; db.markDirty(); return m.reply(`🎡 Cayó en *${result}*. ¡Ganaste ${fmtMoney(amt)}!`); }
    u.money -= amt; db.markDirty();
    await m.reply(`🎡 Cayó en *${result}*. Perdiste ${fmtMoney(amt)}.`);
});

command({ name: 'economyboard', aliases: ['eboard', 'baltop'], category: 'rpg', description: 'Ranking de Lazos' },
async (conn, m) => {
    const entries = Object.entries(db.data.users || {})
        .map(([jid, u]) => ({ jid, total: (u.money || 0) + (u.bank || 0) }))
        .filter(e => e.total > 0).sort((a, b) => b.total - a.total).slice(0, 10);
    if (!entries.length) return m.reply('Aún no hay datos económicos.');
    const list = entries.map((e, i) => `${i + 1}. @${e.jid.split('@')[0]} — ${fmtMoney(e.total)}`).join('\n');
    await conn.sendMessage(m.chat, { text: `💞 *TOP LAZOS*\n\n${list}`, mentions: entries.map(e => e.jid) }, { quoted: m });
});

export default true;
