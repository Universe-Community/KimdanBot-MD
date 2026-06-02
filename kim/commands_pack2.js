// kim/commands_pack2.js — #tag, economía oficial (JX/HG/AP), sistema de
// actividad y comandos sociales BL. Arquitectura nativa KimdanBot:
// COMMAND_META + switch/case/break en execute() + registro en el registry.

import { command } from './registry.js';
import { getUser, getChat, db } from './db.js';
import { fmtMoney, fmtPremium, fmtAffinity, CURRENCY, vipMult, isVip } from './theme.js';
import { box, bar } from './ui.js';

// ─── Helpers ────────────────────────────────────────────────────────
const needGroup = (m) => { if (!m.isGroup) { m.reply('⚠️ Solo en grupos.'); return false; } return true; };
const needAdmin = (m) => { if (!needGroup(m)) return false; if (!m.isSenderAdmin && !m.isOwner) { m.reply('⚠️ Solo administradores.'); return false; } return true; };
const target = (m, text) => {
    if (m.mentionedJid?.[0]) return m.mentionedJid[0];
    if (m.quoted?.sender) return m.quoted.sender;
    if (text) { const n = String(text).replace(/[^0-9]/g, ''); if (n.length >= 8) return n + '@s.whatsapp.net'; }
    return null;
};
const numArg = (args) => parseInt((args || []).find(a => /^\d+$/.test(a)));
const fmtDur = (d) => { const s = Math.ceil(d / 1000); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return [h && `${h}h`, m && `${m}m`, `${x}s`].filter(Boolean).join(' '); };
const cd = (u, f, p) => { const left = p - (Date.now() - (u[f] || 0)); return left > 0 ? left : 0; };

const COMMAND_META = [
    // —— GRUPOS ——
    { names: ['tag', 'tagsay'], category: 'group', description: 'Menciona a todos con tu mensaje' },
    // —— ECONOMÍA (JX / HG / AP) ——
    { names: ['balance', 'bal', 'coins'], category: 'rpg', description: 'Ver tus Jinx Coins 💜' },
    { names: ['economyinfo', 'einfo'], category: 'rpg', description: 'Tu información económica' },
    { names: ['daily'], category: 'rpg', description: 'Recompensa diaria de JX' },
    { names: ['work', 'w', 'trabajar'], category: 'rpg', description: 'Trabaja por Jinx Coins' },
    { names: ['crime'], category: 'rpg', description: 'Crimen arriesgado por JX' },
    { names: ['slut'], category: 'rpg', hidden: true, description: 'Trabajo nocturno arriesgado' },
    { names: ['deposit', 'dep', 'depositar', 'd'], category: 'rpg', description: 'Depositar JX al banco' },
    { names: ['withdraw', 'with', 'retirar'], category: 'rpg', description: 'Retirar JX del banco' },
    { names: ['givecoins', 'pay', 'coinsgive'], category: 'rpg', description: 'Dar JX a alguien' },
    { names: ['steal', 'robar', 'rob'], category: 'rpg', description: 'Intentar robar JX' },
    { names: ['coinflip', 'flip', 'cf'], category: 'rpg', description: 'Apuesta a cara o cruz' },
    { names: ['roulette', 'rt'], category: 'rpg', description: 'Ruleta rojo/negro' },
    { names: ['economyboard', 'eboard', 'baltop'], category: 'rpg', description: 'Ranking de Jinx Coins' },
    // —— SISTEMA SOCIAL / AFINIDAD (AP) ——
    { names: ['affinity', 'afinidad', 'ap'], category: 'rpg', description: 'Tus Affinity Points 🤝' },
    { names: ['giveaffinity', 'giveap', 'darafinidad'], category: 'rpg', description: 'Regala Affinity Points' },
    { names: ['affinityboard', 'aptop', 'topafinidad'], category: 'rpg', description: 'Ranking de afinidad' },
    // —— ACTIVIDAD ——
    { names: ['msgcount', 'contar', 'count', 'messages', 'mensajes'], category: 'group', description: 'Conteo de mensajes de un usuario (.contar [@user] o respondiendo)' },
    { names: ['topcount', 'topmessages', 'topmsgcount', 'topmensajes'], category: 'group', description: 'Top de usuarios más activos' },
    { names: ['topinactive', 'topinactivos', 'topinactiveusers'], category: 'group', description: 'Top de usuarios inactivos' },
];

export async function execute(conn, m, cmd, args, text) {
    switch (cmd) {

    // ═══════════════ #tag ═══════════════
    case 'tag': {
        if (!needAdmin(m)) return;
        const jids = (m.participants || []).map(p => p.id).filter(Boolean);
        if (!jids.length) return m.reply('No pude leer los participantes.');
        const body = (text && text.trim())
            || (m.quoted && (m.quoted.text || m.quoted.msg?.caption))
            || '📢 Atención a todos.';
        await conn.sendMessage(m.chat, { text: body, mentions: jids });
        break;
    }

    // ═══════════════ ECONOMÍA JX/HG/AP ═══════════════
    case 'balance': {
        const t = target(m, text) || m.sender; const u = getUser(t);
        await conn.sendMessage(m.chat, {
            text: box(`💜 BILLETERA JINX`, [
                `👤 @${t.split('@')[0]}`,
                `💰 ${fmtMoney(u.money)}`,
                `🏦 ${fmtMoney(u.bank)} (banco)`,
                `💎 ${fmtPremium(u.corazones)}`,
                `🤝 ${fmtAffinity(u.affinity)}`,
                `Σ Total: ${fmtMoney((u.money||0)+(u.bank||0))}`,
            ]),
            mentions: [t],
        }, { quoted: m });
        break;
    }
    case 'economyinfo': {
        const u = getUser(m.sender);
        await conn.sendMessage(m.chat, { text: box(`📊 ECONOMÍA · @${m.sender.split('@')[0]}`, [
            `💜 Jinx Coins: ${u.money}`,
            `🏦 Banco: ${u.bank}`,
            `💎 Heart Gems: ${u.corazones}`,
            `🤝 Affinity: ${u.affinity}`,
            `⬆️ EXP ${u.exp} · Nivel ${u.level}`,
            `🎴 Personajes: ${(u.characters||[]).length}`,
        ]), mentions: [m.sender] }, { quoted: m });
        break;
    }
    case 'daily': {
        const u = getUser(m.sender); const left = cd(u, 'lastdaily', 86400000);
        if (left) return m.reply(`🕒 Ya reclamaste tu diaria. Vuelve en ${fmtDur(left)}.`);
        const reward = 500 + Math.floor(Math.random() * 1500);
        const hg = Math.random() < 0.15 ? 1 : 0;
        u.money += reward; u.corazones += hg; u.lastdaily = Date.now(); db.markDirty();
        await m.reply(`🎁 *Recompensa diaria*\n+${fmtMoney(reward)}${hg ? `\n+${fmtPremium(hg)} (¡suerte!)` : ''}`);
        break;
    }
    case 'work': {
        const u = getUser(m.sender); const left = cd(u, 'lastwork', 3600000);
        if (left) return m.reply(`😮‍💨 Estás cansado. Descansa ${fmtDur(left)}.`);
        const jobs = ['dibujaste un doujinshi BL', 'atendiste una cafetería temática', 'narraste un drama CD', 'vendiste fanart en una convención', 'editaste un capítulo de manhwa'];
        const mult = vipMult(u, m);
        const earn = (200 + Math.floor(Math.random() * 800)) * mult;
        const xp = 50 * mult;
        u.money += earn; u.exp += xp; u.lastwork = Date.now(); db.markDirty();
        await m.reply(`💼 ${jobs[Math.floor(Math.random()*jobs.length)]} y ganaste ${fmtMoney(earn)} (+${xp} EXP).${mult > 1 ? ' 👑 _Bono VIP x2_' : ''}`);
        break;
    }
    case 'crime': {
        const u = getUser(m.sender); const left = cd(u, 'lastcrime', 1800000);
        if (left) return m.reply(`🚓 Demasiado riesgo. Espera ${fmtDur(left)}.`);
        u.lastcrime = Date.now();
        if (Math.random() < 0.5) { const g = 500 + Math.floor(Math.random()*1500); u.money += g; db.markDirty(); return m.reply(`🦹 ¡Éxito! Ganaste ${fmtMoney(g)}.`); }
        const loss = Math.min(u.money, 200 + Math.floor(Math.random()*800)); u.money -= loss; db.markDirty();
        await m.reply(`👮 Te atraparon y pagaste ${fmtMoney(loss)}.`);
        break;
    }
    case 'slut': {
        const u = getUser(m.sender); const left = cd(u, 'lastslut', 1800000);
        if (left) return m.reply(`🌙 Aún no puedes salir. Espera ${fmtDur(left)}.`);
        u.lastslut = Date.now();
        const g = Math.floor(Math.random()*1200) - 200; u.money = Math.max(0, u.money + g); db.markDirty();
        await m.reply(g >= 0 ? `🌃 Trabajaste de noche y ganaste ${fmtMoney(g)}.` : `🌃 La noche salió mal y perdiste ${fmtMoney(-g)}.`);
        break;
    }
    case 'deposit': {
        const u = getUser(m.sender);
        let amt = /all|todo/i.test(text || '') ? u.money : parseInt(text);
        if (!amt || amt <= 0) return m.reply('Uso: .deposit <cantidad|all>');
        amt = Math.min(amt, u.money); if (amt <= 0) return m.reply('No tienes JX en la cartera.');
        u.money -= amt; u.bank += amt; db.markDirty();
        await m.reply(`🏦 Depositaste ${fmtMoney(amt)}. Banco: ${fmtMoney(u.bank)}.`);
        break;
    }
    case 'withdraw': {
        const u = getUser(m.sender);
        let amt = /all|todo/i.test(text || '') ? u.bank : parseInt(text);
        if (!amt || amt <= 0) return m.reply('Uso: .withdraw <cantidad|all>');
        amt = Math.min(amt, u.bank); if (amt <= 0) return m.reply('No tienes JX en el banco.');
        u.bank -= amt; u.money += amt; db.markDirty();
        await m.reply(`💸 Retiraste ${fmtMoney(amt)}. Cartera: ${fmtMoney(u.money)}.`);
        break;
    }
    case 'givecoins': {
        const t = target(m, text); if (!t) return m.reply('Uso: .pay @user <cantidad>');
        const amt = numArg(args); if (!amt || amt <= 0) return m.reply('Indica una cantidad válida.');
        const u = getUser(m.sender); if (u.money < amt) return m.reply('No tienes suficientes JX.');
        const r = getUser(t); u.money -= amt; r.money += amt; db.markDirty();
        await conn.sendMessage(m.chat, { text: `🎀 @${m.sender.split('@')[0]} le dio ${fmtMoney(amt)} a @${t.split('@')[0]}.`, mentions: [m.sender, t] }, { quoted: m });
        break;
    }
    case 'steal': {
        if (!needGroup(m)) return; const t = target(m, text);
        if (!t) return m.reply('Menciona a tu víctima.'); if (t === m.sender) return m.reply('No puedes robarte a ti mismo.');
        const u = getUser(m.sender), v = getUser(t); const left = cd(u, 'lastrob', 600000);
        if (left) return m.reply(`🚓 Espera ${fmtDur(left)} para volver a robar.`);
        u.lastrob = Date.now();
        if (v.money < 100) return m.reply('Casi no tiene JX, da pena robarle.');
        if (Math.random() < 0.45) { const a = Math.floor(v.money*(0.1+Math.random()*0.2)); v.money -= a; u.money += a; db.markDirty(); return conn.sendMessage(m.chat, { text: `🦝 @${m.sender.split('@')[0]} le robó ${fmtMoney(a)} a @${t.split('@')[0]}.`, mentions: [m.sender, t] }, { quoted: m }); }
        const fine = Math.min(u.money, 100 + Math.floor(Math.random()*300)); u.money -= fine; db.markDirty();
        await m.reply(`👮 ¡Te atraparon! Pagaste ${fmtMoney(fine)} de multa.`);
        break;
    }
    case 'coinflip': {
        const u = getUser(m.sender); const amt = numArg(args);
        const side = (args||[]).map(a=>a.toLowerCase()).find(a=>['cara','cruz'].includes(a)) || 'cara';
        if (!amt || amt <= 0) return m.reply('Uso: .cf <cantidad> <cara/cruz>');
        if (u.money < amt) return m.reply('No tienes suficientes JX.');
        const result = Math.random() < 0.5 ? 'cara' : 'cruz';
        if (result === side) { u.money += amt; db.markDirty(); return m.reply(`🪙 Salió *${result}*. ¡Ganaste ${fmtMoney(amt)}!`); }
        u.money -= amt; db.markDirty(); await m.reply(`🪙 Salió *${result}*. Perdiste ${fmtMoney(amt)}.`);
        break;
    }
    case 'roulette': {
        const u = getUser(m.sender);
        const color = (args||[]).map(a=>a.toLowerCase()).find(a=>['red','black','rojo','negro'].includes(a));
        const amt = numArg(args);
        if (!color || !amt) return m.reply('Uso: .roulette <red/black> <cantidad>');
        if (u.money < amt) return m.reply('No tienes suficientes JX.');
        const norm = color === 'rojo' ? 'red' : color === 'negro' ? 'black' : color;
        const result = Math.random() < 0.486 ? 'red' : (Math.random() < 0.946 ? 'black' : 'green');
        if (result === norm) { u.money += amt; db.markDirty(); return m.reply(`🎡 Cayó en *${result}*. ¡Ganaste ${fmtMoney(amt)}!`); }
        u.money -= amt; db.markDirty(); await m.reply(`🎡 Cayó en *${result}*. Perdiste ${fmtMoney(amt)}.`);
        break;
    }
    case 'economyboard': {
        const e = Object.entries(db.data.users || {}).map(([jid, u]) => ({ jid, total: (u.money||0)+(u.bank||0) })).filter(x => x.total > 0).sort((a,b)=>b.total-a.total).slice(0, 10);
        if (!e.length) return m.reply('Aún no hay datos económicos.');
        await conn.sendMessage(m.chat, { text: `💜 *TOP JINX COINS*\n\n` + e.map((x,i)=>`${i+1}. @${x.jid.split('@')[0]} — ${fmtMoney(x.total)}`).join('\n'), mentions: e.map(x=>x.jid) }, { quoted: m });
        break;
    }

    // ═══════════════ AFINIDAD (AP) ═══════════════
    case 'affinity': {
        const t = target(m, text) || m.sender; const u = getUser(t);
        await conn.sendMessage(m.chat, { text: `🤝 @${t.split('@')[0]} tiene ${fmtAffinity(u.affinity)}.`, mentions: [t] }, { quoted: m });
        break;
    }
    case 'giveaffinity': {
        if (!needGroup(m)) return; const t = target(m, text);
        if (!t) return m.reply('Uso: .giveap @user <cantidad>'); if (t === m.sender) return m.reply('No puedes darte afinidad a ti mismo.');
        const amt = numArg(args) || 1; const u = getUser(m.sender);
        const left = cd(u, 'lastap', 3600000); if (left) return m.reply(`💞 Ya regalaste afinidad. Espera ${fmtDur(left)}.`);
        const give = Math.min(amt, 10); getUser(t).affinity = (getUser(t).affinity||0) + give; u.lastap = Date.now(); db.markDirty();
        await conn.sendMessage(m.chat, { text: `🤝 @${m.sender.split('@')[0]} le dio ${fmtAffinity(give)} a @${t.split('@')[0]} 💞`, mentions: [m.sender, t] }, { quoted: m });
        break;
    }
    case 'affinityboard': {
        const e = Object.entries(db.data.users || {}).map(([jid, u]) => ({ jid, ap: u.affinity||0 })).filter(x => x.ap > 0).sort((a,b)=>b.ap-a.ap).slice(0, 10);
        if (!e.length) return m.reply('Aún nadie tiene afinidad.');
        await conn.sendMessage(m.chat, { text: `🤝 *TOP AFINIDAD*\n\n` + e.map((x,i)=>`${i+1}. @${x.jid.split('@')[0]} — ${fmtAffinity(x.ap)}`).join('\n'), mentions: e.map(x=>x.jid) }, { quoted: m });
        break;
    }

    // ═══════════════ ACTIVIDAD ═══════════════
    case 'msgcount': {
        if (!needGroup(m)) return; const t = target(m, text) || m.sender;
        // Ranking del usuario dentro del grupo (posición #N)
        const rank = Object.entries(db.data.users || {})
            .map(([jid, u]) => ({ jid, n: u.activity?.[m.chat]?.count || 0 }))
            .filter(x => x.n > 0).sort((a, b) => b.n - a.n);
        const a = getUser(t).activity?.[m.chat]; const n = a?.count || 0;
        const pos = rank.findIndex(x => x.jid === t);
        const posTxt = pos >= 0 ? `#${pos + 1}` : 'sin posición';
        let lastTxt = 'nunca';
        if (a?.last) {
            const diff = Date.now() - a.last;
            lastTxt = diff < 86400000 ? 'hoy' : `hace ${fmtDur(diff)}`;
        }
        await conn.sendMessage(m.chat, { text: box('👤 CONTEO DE MENSAJES', [
            `👤 Usuario: @${t.split('@')[0]}`,
            `📨 Mensajes enviados: ${n}`,
            `📅 Última actividad: ${lastTxt}`,
            `📊 Posición en grupo: ${posTxt}`,
        ]), mentions: [t] }, { quoted: m });
        break;
    }
    case 'topcount': {
        if (!needGroup(m)) return;
        const rows = Object.entries(db.data.users || {})
            .map(([jid, u]) => ({ jid, n: u.activity?.[m.chat]?.count || 0 }))
            .filter(x => x.n > 0).sort((a,b)=>b.n-a.n).slice(0, 15);
        if (!rows.length) return m.reply('Aún no hay actividad registrada en este grupo.');
        await conn.sendMessage(m.chat, { text: box('🏆 TOP DE ACTIVIDAD',
            rows.map((x,i)=>`${i+1}. @${x.jid.split('@')[0]} → ${x.n} mensajes`)
        ), mentions: rows.map(x=>x.jid) }, { quoted: m });
        break;
    }
    case 'topinactive': {
        if (!needGroup(m)) return;
        const members = (m.participants || []).map(p => p.id);
        const rows = members.map(jid => { const a = getUser(jid).activity?.[m.chat]; return { jid, last: a?.last || 0, n: a?.count || 0 }; })
            .sort((a,b)=> (a.n - b.n) || (a.last - b.last)).slice(0, 15);
        if (!rows.length) return m.reply('No pude leer la actividad del grupo.');
        await conn.sendMessage(m.chat, { text: box('😴 USUARIOS INACTIVOS',
            rows.map((x,i)=>`${i+1}. @${x.jid.split('@')[0]} → ${x.n} mensajes${x.last ? ` · hace ${fmtDur(Date.now()-x.last)}` : ' · sin actividad'}`)
        ), mentions: rows.map(x=>x.jid) }, { quoted: m });
        break;
    }

    }
}

for (const meta of COMMAND_META) {
    const canonical = meta.names[0];
    command({ name: canonical, aliases: meta.names.slice(1), category: meta.category, description: meta.description, hidden: meta.hidden },
        (conn, m, args, text) => execute(conn, m, canonical, args, text));
}
export { COMMAND_META };
export default true;
