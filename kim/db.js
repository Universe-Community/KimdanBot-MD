// kim/db.js — JSON-backed lightweight DB (ESM).

import fs from 'fs';

const DEFAULT_USER = () => ({
    exp: 0, level: 0, role: 'Novato', diamond: 10, money: 50,
    bank: 0, corazones: 0, affinity: 0,
    activity: {},                 // JX (money) + HG (corazones) + AP (affinity) + actividad por grupo
    lastclaim: 0, lastdaily: 0, lastwork: 0, lastmine: 0,
    lastcrime: 0, lastslut: 0, lastrob: 0, lastroulette: 0, lastcofre: 0,
    registered: false, name: '', age: 0, regTime: -1,
    // Gacha BL/Yaoi
    characters: [], favorite: null, lastroll: 0, lastgachaclaim: 0,
    // Perfil
    married: null, birthday: null, genre: null, description: '',
    afkTime: -1, afkReason: '',
    warn: 0, banned: false, premium: false,
    Language: 'es', lang: null, spam: 0, autolevelup: false,
});

const DEFAULT_CHAT = () => ({
    isBanned: false, welcome: true, bye: true, detect: true, modeadmin: false,
    // Anuncios — jerarquía: master → categoría → individual.
    // Todos arrancan en true; el admin puede apagar lo que no quiera.
    allowAnnouncements: true,       // master switch (apaga TODO)
    notifyMembers: true,            // categoría: welcome + bye + promote/demote
    notifyGroupChanges: true,       // categoría: subject + desc + icon + announce + restrict
    notifySubject: true,            // cambio de nombre del grupo
    notifyDesc: true,               // cambio de descripción
    notifyIcon: true,               // cambio de foto
    notifyAnnounce: true,           // grupo abierto/cerrado (admins-only o no)
    notifyRestrict: true,           // restricción de edición de info
    antidelete: false, editlog: false,
    antilink: false, antilink2: false, antitoxic: false,
    antifake: false, antiarabe: false, antispam: false,
    AntiYoutube: false, AntInstagram: false, AntiFacebook: false,
    AntiTelegram: false, AntiTiktok: false, AntiTwitter: false,
    autosticker: false, simi: false, viewonce: false,
    economy: true, gacha: true, nsfw: false, onlyadmin: false, lang: null, botEnabled: true, detect: false,
    warnlimit: 3,
    sBienvenida: '', sDespedida: '',
});

const DEFAULT_SETTINGS = () => ({
    autobio: false, antiprivado: false, antipv: false, status: 0,
    antillamada: true, bloquearLlamada: false,
    Language: 'es',
});

class DB {
    constructor() {
        this.data = { users: {}, chats: {}, settings: {}, game: {}, sticker: {}, others: {} };
        this._dirty = false;
        this._path = null;
        this._writing = false;
    }

    async load(filepath) {
        this._path = filepath;
        try {
            if (fs.existsSync(filepath)) {
                const raw = fs.readFileSync(filepath, 'utf-8');
                if (raw.trim()) {
                    const parsed = JSON.parse(raw);
                    this.data = {
                        users: parsed.users || {},
                        chats: parsed.chats || {},
                        settings: parsed.settings || {},
                        game: parsed.game || {},
                        sticker: parsed.sticker || {},
                        others: parsed.others || {},
                    };
                }
            }
        } catch (e) {
            console.error('[DB] Error cargando, se usará vacío:', e.message);
            try {
                fs.copyFileSync(filepath, filepath + '.broken-' + Date.now());
            } catch { /* */ }
        }
        setInterval(() => this.flush().catch(() => {}), 5000);
    }

    markDirty() { this._dirty = true; }

    async flush() {
        if (!this._dirty || !this._path || this._writing) return;
        this._writing = true;
        this._dirty = false;
        try {
            const tmp = this._path + '.tmp';
            await fs.promises.writeFile(tmp, JSON.stringify(this.data));
            await fs.promises.rename(tmp, this._path);
        } catch (e) {
            console.error('[DB] Error escribiendo:', e.message);
            this._dirty = true;
        } finally {
            this._writing = false;
        }
    }
}

export const db = new DB();

export function getUser(jid) {
    if (!db.data.users[jid]) {
        db.data.users[jid] = DEFAULT_USER();
        db.markDirty();
    }
    return db.data.users[jid];
}

export function getChat(jid) {
    if (!db.data.chats[jid]) {
        db.data.chats[jid] = DEFAULT_CHAT();
        db.markDirty();
    }
    return db.data.chats[jid];
}

export function getSettings(jid) {
    if (!db.data.settings[jid]) {
        db.data.settings[jid] = DEFAULT_SETTINGS();
        db.markDirty();
    }
    return db.data.settings[jid];
}

export async function initDB(filepath = './database.json') {
    await db.load(filepath);
    global.db = db;
    global.db.read = async () => {};
    global.db.write = () => db.flush();
    return db;
}

export { DEFAULT_USER, DEFAULT_CHAT, DEFAULT_SETTINGS };
