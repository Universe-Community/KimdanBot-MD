// kim/theme.js — Tematización BL/Yaoi del bot.
//
// Centraliza la economía temática y el roster del gacha para que toda la
// lógica use una sola fuente de verdad. La moneda genérica (coins/money)
// se presenta SIEMPRE como "Lazos 💞" (motivo del hilo rojo del destino),
// y la moneda premium del gacha como "Corazones 💗".

export const CURRENCY = {
    name: 'Lazos',
    plural: 'Lazos',
    emoji: '💞',
    field: 'money',          // campo real en la DB (se conserva por compatibilidad)
    premiumName: 'Corazones',
    premiumEmoji: '💗',
    premiumField: 'corazones',
};

/** Formatea una cantidad de la moneda principal: `1.250 💞 Lazos`. */
export function fmtMoney(n) {
    return `${Number(n || 0).toLocaleString('es')} ${CURRENCY.emoji} ${CURRENCY.plural}`;
}
export function fmtPremium(n) {
    return `${Number(n || 0).toLocaleString('es')} ${CURRENCY.premiumEmoji} ${CURRENCY.premiumName}`;
}

// ─── Gacha BL/Yaoi ──────────────────────────────────────────────────
// Rarezas con peso (probabilidad relativa) y valor base en Lazos.
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
export function rarityByKey(k) {
    return RARITIES.find(r => r.key === k) || RARITIES[0];
}

// Roster semilla de personajes BL/Yaoi (parejas y protagonistas conocidos
// de series Boys Love). `series` agrupa; `img` se resuelve dinámicamente
// por búsqueda/generación si no hay archivo local. Ampliable con #suggest.
export const CHARACTERS = [
    { id: 1,  name: 'Victor Nikiforov', series: 'Yuri!!! on Ice', genre: 'male' },
    { id: 2,  name: 'Yuri Katsuki',     series: 'Yuri!!! on Ice', genre: 'male' },
    { id: 3,  name: 'Ritsu Onodera',    series: 'Sekaiichi Hatsukoi', genre: 'male' },
    { id: 4,  name: 'Masamune Takano',  series: 'Sekaiichi Hatsukoi', genre: 'male' },
    { id: 5,  name: 'Shiro',            series: 'Hitorijime My Hero', genre: 'male' },
    { id: 6,  name: 'Kousuke Ooshiba',  series: 'Hitorijime My Hero', genre: 'male' },
    { id: 7,  name: 'Mafuyu Sato',      series: 'Given', genre: 'male' },
    { id: 8,  name: 'Ritsuka Uenoyama', series: 'Given', genre: 'male' },
    { id: 9,  name: 'Haru',             series: 'Sasaki to Miyano', genre: 'male' },
    { id: 10, name: 'Yoshikazu Miyano', series: 'Sasaki to Miyano', genre: 'male' },
    { id: 11, name: 'Shun Sasaki',      series: 'Sasaki to Miyano', genre: 'male' },
    { id: 12, name: 'Seven',            series: 'Doukyuusei', genre: 'male' },
    { id: 13, name: 'Hikaru Kusakabe',  series: 'Doukyuusei', genre: 'male' },
    { id: 14, name: 'Rihito Sajou',     series: 'Doukyuusei', genre: 'male' },
    { id: 15, name: 'Akihiko Kaji',     series: 'Given', genre: 'male' },
    { id: 16, name: 'Haruki Nakayama',  series: 'Given', genre: 'male' },
    { id: 17, name: 'Izumi',            series: 'Love Stage!!', genre: 'male' },
    { id: 18, name: 'Ryoma Ichijou',    series: 'Love Stage!!', genre: 'male' },
    { id: 19, name: 'Kashima',          series: 'Umibe no Étranger', genre: 'male' },
    { id: 20, name: 'Shun Hashimoto',   series: 'Umibe no Étranger', genre: 'male' },
];

export function findCharacter(query) {
    if (!query) return null;
    const q = String(query).toLowerCase().trim();
    return CHARACTERS.find(c => String(c.id) === q || c.name.toLowerCase().includes(q)) || null;
}
