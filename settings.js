// settings.js — Configuración global del bot (ESM).
//
// Define todos los `global.*` que usan los demás módulos. Este archivo
// se importa una sola vez al inicio (desde index.js) por sus side-effects.

import { es, en } from './kim/idiomas/index.js';

// ═════════════ OWNERS ═════════════
// Formato: [numero_sin_+, nombre, esCreador]
global.owner = [
    ['573234628903', 'creador', true],
    ['573044062173', '', false],
    ['50685690440',  '', false],
    ['573173090446',  'owner', true],
];
global.vip = [...global.owner];
global.aport = [...global.vip];

// ═════════════ IDIOMA / ZONA HORARIA ═════════════
global.place = 'America/Bogota';
global.lenguaje = es;

// ═════════════ PREFIJOS ═════════════
// Solo `.` y `#`. El handler hace fast-filter con esta lista — los
// mensajes que no empiezan con uno de estos se descartan en microsegundos.
global.prefix = ['.', '#'];

// ═════════════ MANTENIMIENTO DE SESIÓN (authFolder) ═════════════
// Ver kim/authcare.js. IMPORTANTE: la limpieza NO poda claves de Signal por
// antigüedad — eso corrompía la sesión (borraba pre-keys aún válidas y
// anunciadas en el servidor). Solo sanea archivos corruptos/vacíos. Una
// carpeta grande es normal y sana. Sobrescribible por variables de entorno
// (AUTHCARE_*). No hace falta tocar esto para un funcionamiento correcto.
global.authCare = {
    enabled: true,        // integridad automática activada
    intervalHours: 3,     // cada 3h (barato y seguro: no borra claves válidas)
    graceMinutes: 5,      // no tocar archivos más nuevos que esto (evita carreras)
    deepStartup: true,    // al arrancar, validar JSON a fondo (recupera de crashes)
    hard: {               // SOLO para .authclean --hard (manual, presión de disco)
        sessionDays: 90,      // poda session-* sin actividad > 90 días
        senderKeyDays: 60,    // poda sender-key-* sin actividad > 60 días
    },
};

// ═════════════ APIS (sin cambios) ═════════════
const keysZens = ['LuOlangNgentot', 'c2459db922', '37CC845916', '6fb0eff124', 'hdiiofficial', 'fiktod', 'BF39D349845E', '675e34de8a', '0b917b905e6f'];
global.keysxxx = keysZens[Math.floor(Math.random() * keysZens.length)];

const keysxteammm = ['29d4b59a4aa687ca', '5LTV57azwaid7dXfz5fzJu', 'cb15ed422c71a2fb', '5bd33b276d41d6b4', 'HIRO', 'kurrxd09', 'ebb6251cc00f9c63'];
global.keysxteam = keysxteammm[Math.floor(Math.random() * keysxteammm.length)];

const keysneoxrrr = ['5VC9rvNx', 'cfALv5'];
global.keysneoxr = keysneoxrrr[Math.floor(Math.random() * keysneoxrrr.length)];

global.lolkeysapi = 'GataDios';
global.itsrose = '4b146102c4d500809da9d1ff';

global.APIs = {
    CFROSAPI:  'https://api.cafirexos.com',
    nrtm:      'https://fg-nrtm.ddns.net',
    fgmods:    'https://api.fgmods.xyz',
    xteam:     'https://api.xteam.xyz',
    dzx:       'https://api.dhamzxploit.my.id',
    lol:       'https://api.lolhuman.xyz',
    neoxr:     'https://api.neoxr.my.id',
    zenzapis:  'https://api.zahwazein.xyz',
    akuari:    'https://api.akuari.my.id',
    akuari2:   'https://apimu.my.id',
    botcahx:   'https://api.botcahx.biz.id',
    rose:      'https://api.itsrose.site',
    popcat:    'https://api.popcat.xyz',
    xcoders:   'https://api-xcoders.site',
    erdwpe:    'https://api.erdwpe.com',
    xyroinee:  'https://api.xyroinee.xyz',
    nekobot:   'https://nekobot.xyz',
};
global.APIKeys = {
    'https://api.xteam.xyz':       global.keysxteam,
    'https://api.lolhuman.xyz':    'GataDios',
    'https://api.neoxr.my.id':     global.keysneoxr,
    'https://api.zahwazein.xyz':   global.keysxxx,
    'https://api.fgmods.xyz':      'DRLg5kY7',
    'https://api.botcahx.biz.id':  'Admin',
    'https://api.itsrose.site':    'Rs-Zeltoria',
    'https://api-xcoders.site':    'Frieren',
    'https://api.xyroinee.xyz':    'uwgflzFEh6',
};
global.API = (name, path = '/', query = {}, apiKeyParam) => {
    const base = global.APIs[name] || name;
    const apiKey = apiKeyParam ? { [apiKeyParam]: global.APIKeys[base] } : {};
    const params = new URLSearchParams({ ...query, ...apiKey });
    const qs = params.toString();
    return base + path + (qs ? '?' + qs : '');
};

// ═════════════ ENLACES ═════════════
global.md     = 'https://github.com/Kimdanbot-MD/KimdanBot-MD';
global.yt     = 'https://youtube.com/@universobl';
global.tiktok = 'https://www.tiktok.com/@universo_yaoi_bl';
global.fb     = 'https://www.instagram.com/_universo.bl';
global.red    = [global.md, global.yt, global.tiktok, global.fb];

global.nna  = 'https://whatsapp.com/channel/0029VaFFJab3QxS5sqmnXR3l';
global.nna2 = 'https://whatsapp.com/channel/0029VaNCiOMFSAtAQVOwA50y';
global.nna3 = 'https://whatsapp.com/channel/0029VaIJ2NSGE56k4PCzfd1E';
global.nna4 = 'https://whatsapp.com/channel/0029VaFFJab3QxS5sqmnXR3l';
global.nn   = 'https://chat.whatsapp.com/C0lYCnklEtg1HUkbR4uPxA';
global.nn2  = 'https://chat.whatsapp.com/Fj2edZ8XtV48tyNLZn3rdE';
global.nn3 = global.nn4 = global.nn5 = global.nn6 = global.nn7 =
global.nn8 = global.nn9 = global.nn10 = global.nn2;

global.ca = [global.nna, global.nna2, global.nna3, global.nna4];
global.wa = [global.nna, global.nna2, global.nna3, global.nna4,
             global.nn, global.nn2, global.nn3, global.nn4, global.nn5,
             global.nn6, global.nn7, global.nn8, global.nn9, global.nn10];

// ═════════════ MENSAJES (lazy getters) ═════════════
const lazyMess = (key, fallback) => () =>
    typeof global.lenguaje?.[key] === 'function' ? global.lenguaje[key]() : fallback;

global.mess = {
    get admin()        { return lazyMess('admin',        'Solo administradores.')(); },
    get botAdmin()     { return lazyMess('botAdmin',     'Necesito ser admin.')(); },
    get owner()        { return lazyMess('propietario',  'Solo el propietario.')(); },
    get group()        { return lazyMess('group',        'Solo en grupos.')(); },
    get private()      { return lazyMess('private',      'Solo en privado.')(); },
    get bot()          { return lazyMess('bot',          'Función del bot.')(); },
    get registrarse()  { return lazyMess('registra',     '¡Regístrate primero!')(); },
    get error()        { return lazyMess('error',        'Ocurrió un error.')(); },
    get advertencia()  { return lazyMess('advertencia',  'Advertencia:')(); },
    get limit()        { return lazyMess('limit',        'Sin límites.')(); },
    get AntiNsfw()     { return lazyMess('AntiNsfw',     'NSFW desactivado.')(); },
    get endLimit()     { return lazyMess('endLimit',     'Tu límite se acabó.')(); },
    wait: '🤚 𝐏𝐎𝐑 𝐅𝐀𝐕𝐎𝐑 𝐄𝐒𝐏𝐄𝐑𝐀 𝐔𝐍 𝐌𝐎𝐌𝐄𝐍𝐓𝐎 🍇',
};
global.info = {
    wait:    `*. : ｡✿ * ﾟ * .: ｡ ✿ * ﾟ  * . : ｡ ✿ *. : ｡✿ * ﾟ * .: ｡*\n\n*_💐▷ Cargando..._* █▒▒▒▒▒▒▒▒▒ *(っ◞‸◟c)*`,
    waitt:   `*. : ｡✿ * ﾟ * .: ｡ ✿ * ﾟ  * . : ｡ ✿ *. : ｡✿ * ﾟ * .: ｡*\n\n*_💐▷ Cargando..._* ██▒▒▒▒▒▒▒▒ *(｡>ㅅ<｡)*`,
    waittt:  `*. : ｡✿ * ﾟ * .: ｡ ✿ * ﾟ  * . : ｡ ✿ *. : ｡✿ * ﾟ * .: ｡*\n\n*_💐▷ Cargando..._* ████▒▒▒▒▒▒ *:;(∩´﹏﹏\`∩);:*`,
    waitttt: `*. : ｡✿ * ﾟ * .: ｡ ✿ * ﾟ  * . : ｡ ✿ *. : ｡✿ * ﾟ * .: ｡*\n\n*_💐▷ Cargando..._* ████████▒▒ *(〃ﾟ3ﾟ〃)*`,
    waittttt:`*. : ｡✿ * ﾟ * .: ｡ ✿ * ﾟ  * . : ｡ ✿ *. : ｡✿ * ﾟ * .: ｡*\n\n*_💐▷ Cargando..._* ██████████ *(人´∀\`〃)*`,
    result:  'Resultado:',
};

// ═════════════ REACCIONES Y EMOJIS ═════════════
global.rwait  = '⌛'; global.dmoji  = '🤭'; global.done   = '✅';
global.error  = '❌'; global.xmoji  = '🔥';

// ═════════════ INFO BOT ═════════════
global.botname  = '𝐊𝐢𝐦𝐝𝐚𝐧𝐁𝐨𝐭-𝐌𝐃';
global.wm       = '                𝐊𝐢𝐦𝐝𝐚𝐧𝐁𝐨𝐭-𝐌𝐃';
global.packname = '🍓 𝐊𝐢𝐦𝐝𝐚𝐧𝐁𝐨𝐭-𝐌𝐃 🍓';
global.author   = '🍒𝐃𝐚𝐧𝐨𝐧𝐢𝐧𝐨🍒';
global.vs       = '𝟑.𝟎.𝟎';

// ═════════════ LISTAS ═════════════
global.mods      = []; global.premium   = []; global.blockList = [];
global.multiplier = 90; global.maxwarn = '4';

export {}; // marca este módulo como ESM aunque solo tenga side effects
