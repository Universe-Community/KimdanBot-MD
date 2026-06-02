// kim/theme.js — Economía oficial y tematización Jinx / BL / Yaoi.
//
// ECONOMÍA UNIFICADA (única fuente de verdad para TODO el bot):
//   💜 Jinx Coins  (JX) → economía principal: trabajo, minería, comercio,
//                          tienda, rankings, recompensas, objetos.
//   💎 Heart Gems  (HG) → premium: eventos, gacha premium, objetos raros.
//   🤝 Affinity Points (AP) → relaciones, eventos BL, sistema social,
//                          compatibilidad, gacha temático, interacciones.
//
// Campos reales en la DB (se conservan por compatibilidad histórica):
//   money → JX   |   corazones → HG   |   affinity → AP

export const CURRENCY = {
    // Principal
    code: 'JX', name: 'Jinx Coins', short: 'JX', emoji: '💜', field: 'money',
    // Premium
    premiumCode: 'HG', premiumName: 'Heart Gems', premiumEmoji: '💎', premiumField: 'corazones',
    // Afinidad
    affinityCode: 'AP', affinityName: 'Affinity Points', affinityEmoji: '🤝', affinityField: 'affinity',
};

const n = (x) => Number(x || 0).toLocaleString('es');
/** `1.250 💜 JX` */
export function fmtMoney(v)   { return `${n(v)} ${CURRENCY.emoji} ${CURRENCY.short}`; }
export function fmtPremium(v) { return `${n(v)} ${CURRENCY.premiumEmoji} ${CURRENCY.premiumCode}`; }
export function fmtAffinity(v){ return `${n(v)} ${CURRENCY.affinityEmoji} ${CURRENCY.affinityCode}`; }

// ─── Gacha BL/Yaoi ──────────────────────────────────────────────────
// Rarezas con peso (probabilidad relativa) y valor base en JX.
export const RARITIES = [
    { key: 'C',   name: 'Común',      emoji: '🤍', weight: 50, value: 100,   stars: '★' },
    { key: 'R',   name: 'Raro',       emoji: '💙', weight: 28, value: 350,   stars: '★★' },
    { key: 'SR',  name: 'Super Raro', emoji: '💜', weight: 14, value: 900,   stars: '★★★' },
    { key: 'SSR', name: 'Ultra Raro', emoji: '💖', weight: 6,  value: 2500,  stars: '★★★★' },
    { key: 'UR',  name: 'Legendario', emoji: '🌟', weight: 2,  value: 7000,  stars: '★★★★★' },
];
export function rollRarity() {
    const total = RARITIES.reduce((s, r) => s + r.weight, 0);
    let x = Math.random() * total;
    for (const r of RARITIES) { if ((x -= r.weight) <= 0) return r; }
    return RARITIES[0];
}
export function rarityByKey(k) { return RARITIES.find(r => r.key === k) || RARITIES[0]; }

// Roster ampliado: personajes de Jinx + BL populares de manhwa / manga /
// anime / donghua. Todo SFW (coleccionables, sin contenido sexual).
// genre 'male' = personaje masculino (temática BL).
export const CHARACTERS = [
    // —— Jinx (manhwa) — serie homónima del bot ——
    { id: 1,  name: 'Kim Dan',          series: 'Jinx', genre: 'male' },
    { id: 2,  name: 'Joo Jaekyung',     series: 'Jinx', genre: 'male' },
    // —— Painter of the Night ——
    { id: 3,  name: 'Na-kyum',          series: 'Painter of the Night', genre: 'male' },
    { id: 4,  name: 'Seungho',          series: 'Painter of the Night', genre: 'male' },
    // —— Semantic Error ——
    { id: 5,  name: 'Chu Sangwoo',      series: 'Semantic Error', genre: 'male' },
    { id: 6,  name: 'Jang Jaeyoung',    series: 'Semantic Error', genre: 'male' },
    // —— BJ Alex ——
    { id: 7,  name: 'Ahn Jiwon',        series: 'BJ Alex', genre: 'male' },
    { id: 8,  name: 'Nam Dong-gyun',    series: 'BJ Alex', genre: 'male' },
    // —— Cherry Blossoms After Winter ——
    { id: 9,  name: 'Seo Haebom',       series: 'Cherry Blossoms After Winter', genre: 'male' },
    { id: 10, name: 'Jo Taesung',       series: 'Cherry Blossoms After Winter', genre: 'male' },
    // —— Sign ——
    { id: 11, name: 'Yu Soohyun',       series: 'Sign', genre: 'male' },
    { id: 12, name: 'Kang Jihwan',      series: 'Sign', genre: 'male' },
    // —— Love is an Illusion ——
    { id: 13, name: 'Park Hae',         series: 'Love is an Illusion', genre: 'male' },
    { id: 14, name: 'Dojin',            series: 'Love is an Illusion', genre: 'male' },
    // —— Warehouse / Walk on Water ——
    { id: 15, name: 'Yoo Habin',        series: 'Walk on Water', genre: 'male' },
    { id: 16, name: 'Cha Eunhyuk',      series: 'Walk on Water', genre: 'male' },
    // —— 19 Days (Old Xian) ——
    { id: 17, name: 'He Tian',          series: '19 Days', genre: 'male' },
    { id: 18, name: 'Mo Guan Shan',     series: '19 Days', genre: 'male' },
    { id: 19, name: 'Jian Yi',          series: '19 Days', genre: 'male' },
    { id: 20, name: 'Zhan Zhengxi',     series: '19 Days', genre: 'male' },
    // —— Mo Dao Zu Shi / The Untamed (donghua) ——
    { id: 21, name: 'Wei Wuxian',       series: 'Mo Dao Zu Shi', genre: 'male' },
    { id: 22, name: 'Lan Wangji',       series: 'Mo Dao Zu Shi', genre: 'male' },
    // —— Heaven Official's Blessing (TGCF) ——
    { id: 23, name: 'Xie Lian',         series: "Heaven Official's Blessing", genre: 'male' },
    { id: 24, name: 'Hua Cheng',        series: "Heaven Official's Blessing", genre: 'male' },
    // —— Given ——
    { id: 25, name: 'Mafuyu Sato',      series: 'Given', genre: 'male' },
    { id: 26, name: 'Ritsuka Uenoyama', series: 'Given', genre: 'male' },
    { id: 27, name: 'Akihiko Kaji',     series: 'Given', genre: 'male' },
    { id: 28, name: 'Haruki Nakayama',  series: 'Given', genre: 'male' },
    // —— Yuri!!! on Ice ——
    { id: 29, name: 'Victor Nikiforov', series: 'Yuri!!! on Ice', genre: 'male' },
    { id: 30, name: 'Yuri Katsuki',     series: 'Yuri!!! on Ice', genre: 'male' },
    // —— Sasaki to Miyano ——
    { id: 31, name: 'Shun Sasaki',      series: 'Sasaki to Miyano', genre: 'male' },
    { id: 32, name: 'Yoshikazu Miyano', series: 'Sasaki to Miyano', genre: 'male' },
    // —— Sekaiichi Hatsukoi ——
    { id: 33, name: 'Ritsu Onodera',    series: 'Sekaiichi Hatsukoi', genre: 'male' },
    { id: 34, name: 'Masamune Takano',  series: 'Sekaiichi Hatsukoi', genre: 'male' },
    // —— Junjou Romantica ——
    { id: 35, name: 'Misaki Takahashi', series: 'Junjou Romantica', genre: 'male' },
    { id: 36, name: 'Akihiko Usami',    series: 'Junjou Romantica', genre: 'male' },
    // —— Ten Count ——
    { id: 37, name: 'Tadaomi Shirotani',series: 'Ten Count', genre: 'male' },
    { id: 38, name: 'Riku Kurose',      series: 'Ten Count', genre: 'male' },
    // —— Doukyuusei ——
    { id: 39, name: 'Hikaru Kusakabe',  series: 'Doukyuusei', genre: 'male' },
    { id: 40, name: 'Rihito Sajou',     series: 'Doukyuusei', genre: 'male' },
    // —— Super Lovers ——
    { id: 41, name: 'Haru Kaidou',      series: 'Super Lovers', genre: 'male' },
    { id: 42, name: 'Ren Kaidou',       series: 'Super Lovers', genre: 'male' },
    // —— Dakaichi ——
    { id: 43, name: 'Takato Saijo',     series: 'Dakaichi', genre: 'male' },
    { id: 44, name: 'Junta Azumaya',    series: 'Dakaichi', genre: 'male' },
    // —— Hitorijime My Hero ——
    { id: 45, name: 'Masahiro Setagawa',series: 'Hitorijime My Hero', genre: 'male' },
    { id: 46, name: 'Kousuke Ooshiba',  series: 'Hitorijime My Hero', genre: 'male' },
    // —— Banana Fish ——
    { id: 47, name: 'Ash Lynx',         series: 'Banana Fish', genre: 'male' },
    { id: 48, name: 'Eiji Okumura',     series: 'Banana Fish', genre: 'male' },
    // —— No.6 ——
    { id: 49, name: 'Shion',            series: 'No.6', genre: 'male' },
    { id: 50, name: 'Nezumi',           series: 'No.6', genre: 'male' },
    // —— Gravitation ——
    { id: 51, name: 'Shuichi Shindou',  series: 'Gravitation', genre: 'male' },
    { id: 52, name: 'Eiri Yuki',        series: 'Gravitation', genre: 'male' },
    // —— Love Stage!! ——
    { id: 53, name: 'Izumi Sena',       series: 'Love Stage!!', genre: 'male' },
    { id: 54, name: 'Ryoma Ichijou',    series: 'Love Stage!!', genre: 'male' },
    // —— Saezuru Tori wa Habatakanai ——
    { id: 55, name: 'Yashiro',          series: 'Saezuru', genre: 'male' },
    { id: 56, name: 'Chikara Doumeki',  series: 'Saezuru', genre: 'male' },
    // —— Killing Stalking (manhwa) ——
    { id: 57, name: 'Yoon Bum',         series: 'Killing Stalking', genre: 'male' },
    { id: 58, name: 'Oh Sangwoo',       series: 'Killing Stalking', genre: 'male' },
    // —— Here U Are (manhua) ——
    { id: 59, name: 'Yu Yang',          series: 'Here U Are', genre: 'male' },
    { id: 60, name: 'Li Huan',          series: 'Here U Are', genre: 'male' },
    // —— Pian Pian (manhua) ——
    { id: 61, name: 'Ah Yue',           series: 'Pian Pian', genre: 'male' },
    { id: 62, name: 'Shino',            series: 'Pian Pian', genre: 'male' },
    // —— Umibe no Étranger ——
    { id: 63, name: 'Shun Hashimoto',   series: 'Umibe no Étranger', genre: 'male' },
    { id: 64, name: 'Mio Chibana',      series: 'Umibe no Étranger', genre: 'male' },
    // —— Old Fashion Cupcake ——
    { id: 65, name: 'Nozue',            series: 'Old Fashion Cupcake', genre: 'male' },
    { id: 66, name: 'Togawa',           series: 'Old Fashion Cupcake', genre: 'male' },
    // —— Restart wa Tadaima no Ato de ——
    { id: 67, name: 'Aki Ono',          series: 'Restart After Come Back Home', genre: 'male' },
    { id: 68, name: 'Mitsuomi Sumida',  series: 'Restart After Come Back Home', genre: 'male' },
    // —— Tale of the Ninth Mountain / extra populares ——
    { id: 69, name: 'Yang Hyun',        series: 'Define the Relationship', genre: 'male' },
    { id: 70, name: 'Kim Suho',         series: 'Define the Relationship', genre: 'male' },
];

export function findCharacter(query) {
    if (!query) return null;
    const q = String(query).toLowerCase().trim();
    return CHARACTERS.find(c => String(c.id) === q || c.name.toLowerCase().includes(q)) || null;
}
export function charsBySeries() {
    const map = {};
    for (const c of CHARACTERS) (map[c.series] ||= []).push(c);
    return map;
}

// ─── Datos temáticos BL para comandos de entretenimiento ────────────
export const BL_QUOTES = [
    'El hilo rojo del destino une a quienes están predestinados a encontrarse.',
    'No importa cuántas vidas pasen, te encontraré de nuevo.',
    'Tu sonrisa es el único amanecer que necesito.',
    'Te elegiría en cien vidas, en cualquier versión de la realidad.',
    'Quédate. Aunque el mundo arda, quédate a mi lado.',
    'Aprendí que el hogar no es un lugar, eres tú.',
    'Si el universo conspira, que sea para acercarnos.',
    'Cada latido lleva tu nombre escrito.',
];
export const BL_RECS = [
    { t: 'Given', d: 'Música, duelo y un primer amor que cura heridas.' },
    { t: 'Sasaki to Miyano', d: 'Comedia escolar dulce sobre descubrir sentimientos.' },
    { t: 'Heaven Official\'s Blessing', d: 'Fantasía épica, dioses y un amor de 800 años.' },
    { t: 'Semantic Error', d: 'Enemigos a amantes entre un programador y un diseñador.' },
    { t: 'Cherry Blossoms After Winter', d: 'Amigos de la infancia que reescriben su historia.' },
    { t: 'Painter of the Night', d: 'Drama histórico intenso de arte y deseo.' },
    { t: 'Yuri!!! on Ice', d: 'Patinaje artístico y una relación que inspira al mundo.' },
    { t: 'Sign', d: 'Romance con lengua de señas, sensible y cálido.' },
];
