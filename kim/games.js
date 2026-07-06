// kim/games.js — Motor de minijuegos por chat (ESM).
// ─────────────────────────────────────────────────────────────────────
// Estado en memoria por chat para juegos que se responden con mensajes
// normales (sin prefijo): adivina el número, mates, ahorcado y gato
// (tres en raya). El middleware llama a checkGameAnswer(conn, m) para
// cada mensaje de texto sin comando; si el mensaje era una respuesta de
// juego, se consume ahí y no sigue el pipeline.
//
// Recompensas en 💜 Jinx Coins (JX) vía getUser + markDirty.

import { getUser, db } from './db.js';
import { fmtMoney } from './theme.js';

const TTL_MS = 5 * 60 * 1000;       // partidas expiran a los 5 min de inactividad
const games = new Map();            // chatJid → { type, ...estado, ts }

function setGame(chat, g) { games.set(chat, { ...g, ts: Date.now() }); }
export function getGame(chat) {
    const g = games.get(chat);
    if (!g) return null;
    if (Date.now() - g.ts > TTL_MS) { games.delete(chat); return null; }
    return g;
}
export function endGame(chat) { games.delete(chat); }

function reward(jid, amount) {
    try { const u = getUser(jid); u.money = (u.money || 0) + amount; db.markDirty(); } catch { /* */ }
}

// Poda periódica (por si un chat abandona la partida).
setInterval(() => {
    const now = Date.now();
    for (const [k, g] of games) if (now - g.ts > TTL_MS) games.delete(k);
}, 10 * 60 * 1000).unref();

// ═══════════════ ADIVINA EL NÚMERO ═══════════════

export function startGuess(chat) {
    const target = 1 + Math.floor(Math.random() * 100);
    setGame(chat, { type: 'guess', target, tries: 0, max: 7 });
    return '🔮 *Adivina el número* (1–100)\n\n₊˚ Tienes *7 intentos*. Escribe solo el número.\n₊˚ Premio: *300 💜 JX* (menos intentos = más bonus ✨)';
}

async function handleGuess(conn, m, g) {
    const n = parseInt(m.text.trim());
    if (!Number.isInteger(n) || n < 1 || n > 100) return false; // no era respuesta
    g.tries++; g.ts = Date.now();
    if (n === g.target) {
        endGame(m.chat);
        const bonus = Math.max(0, (g.max - g.tries) * 50);
        const total = 300 + bonus;
        reward(m.sender, total);
        await m.reply(`🎉 ¡Correcto! Era *${g.target}*.\n💜 @${m.sender.split('@')[0]} gana ${fmtMoney(total)} (${g.tries} intento${g.tries === 1 ? '' : 's'}).`);
        return true;
    }
    if (g.tries >= g.max) {
        endGame(m.chat);
        await m.reply(`💔 Se acabaron los intentos. El número era *${g.target}*.\nUsa *.adivina* para otra ronda 🫐`);
        return true;
    }
    await m.reply(`${n < g.target ? '📈 Más alto' : '📉 Más bajo'} — intento ${g.tries}/${g.max} 🍓`);
    return true;
}

// ═══════════════ MATES ═══════════════

const MATH_LEVELS = {
    facil:   { ops: '+-',   max: 20,  prize: 150, label: 'Fácil' },
    medio:   { ops: '+-*',  max: 50,  prize: 300, label: 'Medio' },
    dificil: { ops: '+-*/', max: 100, prize: 600, label: 'Difícil' },
};

export function startMath(chat, level = 'facil') {
    const lv = MATH_LEVELS[level] || MATH_LEVELS.facil;
    const op = lv.ops[Math.floor(Math.random() * lv.ops.length)];
    let a = 1 + Math.floor(Math.random() * lv.max);
    let b = 1 + Math.floor(Math.random() * lv.max);
    if (op === '/') { const r = 1 + Math.floor(Math.random() * 12); b = 1 + Math.floor(Math.random() * 12); a = r * b; }
    if (op === '-' && b > a) [a, b] = [b, a];
    const answer = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : a / b;
    setGame(chat, { type: 'math', answer, prize: lv.prize });
    const pretty = op === '*' ? '×' : op === '/' ? '÷' : op;
    return `🧮 *Mates — ${lv.label}*\n\n✨ ¿Cuánto es *${a} ${pretty} ${b}*?\n₊˚ Premio: *${lv.prize} 💜 JX* · 60 s ⏳`;
}

async function handleMath(conn, m, g) {
    const n = Number(m.text.trim().replace(',', '.'));
    if (!Number.isFinite(n)) return false;
    g.ts = Date.now();
    if (Math.abs(n - g.answer) > 1e-9) { await m.reply('❌ Nop~ intenta otra vez 🫐'); return true; }
    endGame(m.chat);
    reward(m.sender, g.prize);
    await m.reply(`🎉 ¡Exacto! @${m.sender.split('@')[0]} gana ${fmtMoney(g.prize)} ✨`);
    return true;
}

// ═══════════════ AHORCADO ═══════════════

const HANGMAN_WORDS = [
    'yaoi','manhwa','jinx','afinidad','corazon','sticker','whatsapp','kimdan','gacha','waifu',
    'romance','novela','beso','abrazo','destino','protagonista','universo','estrella','galaxia',
    'donghua','manga','anime','pareja','flechazo','carino','ternura','confesion','cita','poema',
];
const HANGMAN_STAGES = ['😊','🙂','😐','😕','😟','😢','💀'];

export function startHangman(chat) {
    const word = HANGMAN_WORDS[Math.floor(Math.random() * HANGMAN_WORDS.length)];
    setGame(chat, { type: 'hangman', word, guessed: new Set(), fails: 0, maxFails: 6 });
    return renderHangman(getGame(chat)) + '\n\n₊˚ Escribe *una letra* por mensaje (o la palabra completa).\n₊˚ Premio: *400 💜 JX* ✨';
}

function renderHangman(g) {
    const shown = [...g.word].map(c => g.guessed.has(c) ? c.toUpperCase() : '·').join(' ');
    const wrong = [...g.guessed].filter(c => !g.word.includes(c)).map(c => c.toUpperCase()).join(' ') || '—';
    return `🪢 *Ahorcado* ${HANGMAN_STAGES[g.fails]}\n\n🔤 ${shown}\n💔 Falladas: ${wrong}\n⏳ Vidas: ${g.maxFails - g.fails}/${g.maxFails}`;
}

async function handleHangman(conn, m, g) {
    const t = m.text.trim().toLowerCase();
    if (!/^[a-zñ]+$/.test(t)) return false;
    g.ts = Date.now();

    // Palabra completa
    if (t.length > 1) {
        if (t === g.word) {
            endGame(m.chat); reward(m.sender, 400);
            await m.reply(`🎉 ¡Sí! La palabra era *${g.word.toUpperCase()}*.\n💜 @${m.sender.split('@')[0]} gana ${fmtMoney(400)} ✨`);
            return true;
        }
        if (t.length !== g.word.length) return false; // probablemente charla normal
        g.fails++;
        if (g.fails >= g.maxFails) { endGame(m.chat); await m.reply(`💀 Nooo… era *${g.word.toUpperCase()}*. Usa *.ahorcado* para otra 🫐`); return true; }
        await m.reply('❌ Esa no es~\n\n' + renderHangman(g));
        return true;
    }

    // Una letra
    if (g.guessed.has(t)) { await m.reply('🍓 Esa letra ya salió~'); return true; }
    g.guessed.add(t);
    if (!g.word.includes(t)) {
        g.fails++;
        if (g.fails >= g.maxFails) { endGame(m.chat); await m.reply(`💀 Se acabó… la palabra era *${g.word.toUpperCase()}*.\nUsa *.ahorcado* para la revancha 🫐`); return true; }
        await m.reply(renderHangman(g));
        return true;
    }
    const complete = [...g.word].every(c => g.guessed.has(c));
    if (complete) {
        endGame(m.chat); reward(m.sender, 400);
        await m.reply(`🎉 ¡Palabra completa! Era *${g.word.toUpperCase()}*.\n💜 @${m.sender.split('@')[0]} gana ${fmtMoney(400)} ✨`);
        return true;
    }
    await m.reply(renderHangman(g));
    return true;
}

// ═══════════════ GATO (tres en raya) ═══════════════

const TTT_EMOJI = { X: '❌', O: '⭕' };
const TTT_CELLS = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣'];
const TTT_WINS = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

function renderTTT(g) {
    const b = g.board.map((v, i) => v ? TTT_EMOJI[v] : TTT_CELLS[i]);
    return `${b[0]}${b[1]}${b[2]}\n${b[3]}${b[4]}${b[5]}\n${b[6]}${b[7]}${b[8]}`;
}

/** Reta a un rival (o abre sala). */
export function startTTT(chat, challenger, rival = null) {
    setGame(chat, {
        type: 'ttt', board: Array(9).fill(null),
        players: { X: challenger, O: rival },      // O puede ser null → sala abierta
        turn: 'X', started: !!rival,
    });
    return rival
        ? `🎮 *Gato* — ${TTT_EMOJI.X} @${challenger.split('@')[0]} vs ${TTT_EMOJI.O} @${rival.split('@')[0]}\n\n${renderTTT(getGame(chat))}\n\n✨ Turno de ${TTT_EMOJI.X}. Escribe un número del 1 al 9.\n₊˚ Premio: *500 💜 JX*`
        : `🎮 *Gato* — @${challenger.split('@')[0]} busca rival 💜\n\n🍓 El primero que escriba un número (1-9) juega con ${TTT_EMOJI.O}.\n₊˚ Premio: *500 💜 JX*`;
}

async function handleTTT(conn, m, g) {
    const t = m.text.trim();
    if (!/^[1-9]$/.test(t)) return false;
    const idx = parseInt(t) - 1;

    // Sala abierta: el primer ajeno que juegue se convierte en O.
    if (!g.players.O && m.sender !== g.players.X) { g.players.O = m.sender; g.started = true; }
    const symbol = m.sender === g.players.X ? 'X' : (m.sender === g.players.O ? 'O' : null);
    if (!symbol) return false;                       // espectador: ignora
    if (symbol !== g.turn) { await m.reply(`🍵 Paciencia~ es el turno de ${TTT_EMOJI[g.turn]}`); return true; }
    if (g.board[idx]) { await m.reply('🫐 Esa casilla ya está ocupada~'); return true; }

    g.board[idx] = symbol; g.ts = Date.now();
    const win = TTT_WINS.some(([a,b,c]) => g.board[a] === symbol && g.board[b] === symbol && g.board[c] === symbol);
    if (win) {
        endGame(m.chat); reward(m.sender, 500);
        await conn.sendMessage(m.chat, {
            text: `${renderTTT(g)}\n\n🏆 ¡Gana ${TTT_EMOJI[symbol]} @${m.sender.split('@')[0]}! +${fmtMoney(500)} ✨`,
            mentions: [m.sender],
        }, { quoted: m });
        return true;
    }
    if (g.board.every(Boolean)) {
        endGame(m.chat);
        await m.reply(`${renderTTT(g)}\n\n🤝 ¡Empate! Buen juego 💜`);
        return true;
    }
    g.turn = symbol === 'X' ? 'O' : 'X';
    const next = g.players[g.turn];
    await conn.sendMessage(m.chat, {
        text: `${renderTTT(g)}\n\n✨ Turno de ${TTT_EMOJI[g.turn]}${next ? ` @${next.split('@')[0]}` : ''}`,
        mentions: next ? [next] : [],
    }, { quoted: m });
    return true;
}

// ═══════════════ HOOK PARA EL MIDDLEWARE ═══════════════

/**
 * Consume la respuesta de un juego activo en el chat (mensajes SIN
 * prefijo). Devuelve true si el mensaje era una jugada (y ya se
 * respondió), false para dejarlo seguir por el pipeline normal.
 */
export async function checkGameAnswer(conn, m) {
    if (!m?.text || m.fromMe) return false;
    const g = getGame(m.chat);
    if (!g) return false;
    try {
        if (g.type === 'guess')   return await handleGuess(conn, m, g);
        if (g.type === 'math')    return await handleMath(conn, m, g);
        if (g.type === 'hangman') return await handleHangman(conn, m, g);
        if (g.type === 'ttt')     return await handleTTT(conn, m, g);
    } catch { /* nunca romper el pipeline por un juego */ }
    return false;
}
