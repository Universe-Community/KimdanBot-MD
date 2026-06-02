// libs/biblioteca.js — Sistema de biblioteca/libros con MongoDB + Mongoose.
// Lógica original de KimdanBot preservada. ÚNICO cambio de seguridad:
// la URI ya NO está hardcodeada; se lee de process.env.MONGODB_URI.
// Si no hay URI configurada, las funciones responden con aviso y el
// resto del bot sigue funcionando con normalidad (sin crashear).

import mongoose from 'mongoose';
import _ from 'lodash';

const { Schema } = mongoose;
const URI = process.env.MONGODB_URI || '';

let Book = null;
let connecting = null;

async function ensureConn() {
    if (!URI) return null;
    if (mongoose.connection.readyState === 1) return Book;
    if (!connecting) {
        connecting = mongoose.connect(URI).then(() => {
            console.log('📚 MongoDB (biblioteca) conectado');
        }).catch((e) => { console.error('MongoDB biblioteca:', e?.message || e); connecting = null; });
    }
    await connecting;
    if (!Book && mongoose.connection.readyState === 1) {
        const bookSchema = new Schema({
            title:  { type: String, required: true, trim: true },
            link:   { type: String, required: true, trim: true },
            author: { type: String, trim: true },
            genre:  { type: String, trim: true },
            isAvailable: { type: Boolean, default: true },
        }, { collection: 'Libros', versionKey: false });
        try { Book = mongoose.model('Kim.Libros', bookSchema); }
        catch { Book = mongoose.model('Kim.Libros'); }
    }
    return Book;
}

function notConfigured(m) {
    return m.reply('📚 La biblioteca requiere MongoDB. Define la variable de entorno *MONGODB_URI* para activarla.');
}
function isValidMediafireLink(s) {
    return /https?:\/\/(www\.)?mediafire\.com\/file\/(.*?)\.pdf\/file/.test(s);
}

export async function getFormattedBookList(conn, m, from, useExternal = false) {
    const B = await ensureConn(); if (!B) return notConfigured(m);
    try {
        const localBooks = await B.find({});
        if (!localBooks.length) return m.reply('No hay libros disponibles.');
        const sorted = localBooks.sort((a, b) => ((a.genre?.localeCompare(b.genre) || 1)) || a.title.localeCompare(b.title));
        const grouped = _.groupBy(sorted, (bk) => bk.genre || 'Sin género');
        let out = '📚 *LISTA DE LIBROS*\n';
        for (const [genre, books] of Object.entries(grouped)) {
            out += `\n*${genre}*\n` + books.map(bk => `• ${bk.title} — _${bk._id}_`).join('\n') + '\n';
        }
        await conn.sendMessage(m.chat, { text: out.slice(0, 4000) }, { quoted: m });
    } catch (e) { console.error(e); return m.reply('Error al obtener la lista de libros.'); }
}

export async function searchBooks(text, conn, m, from) {
    const B = await ensureConn(); if (!B) return notConfigured(m);
    if (!text) return m.reply('No se proporcionó un término de búsqueda.');
    const q = text.toLowerCase().trim();
    try {
        const books = await B.find({ title: { $regex: `.*${q}.*`, $options: 'i' } }).limit(100);
        if (!books.length) return m.reply('No se encontraron libros que coincidan.');
        const results = books.map(bk => `• *${bk.title}* - ${bk.link}`);
        await conn.sendMessage(m.chat, { text: `*¡Título(s) coincidente(s)!*\n${results.join('\n')}` }, { quoted: m });
    } catch (e) { console.error(e); return m.reply('Error al buscar libros.'); }
}

export async function addBook(body, text, conn, m, from) {
    const B = await ensureConn(); if (!B) return notConfigured(m);
    if ((text || '').split('\n').length < 4) return m.reply('Error: proporciona al menos 4 campos separados por renglón (comando / título / link / autor / género).');
    const lines = (body || text).replace(/[^\w\s:;\.\-_\/+\p{Script=Latin}]+/gu, '').split('\n').map(l => l.trim());
    const [, title, link, author, genre] = lines;
    if (!title) return m.reply('Error: El campo "Título" es obligatorio.');
    if (!link) return m.reply('Error: El campo "Link" es obligatorio.');
    if (!author) return m.reply('Error: El campo "Autor" es obligatorio (usa NN si no lo sabes).');
    if (!genre) return m.reply('Error: El campo "Género" es obligatorio.');
    if (!isValidMediafireLink(link)) return m.reply('Error: El enlace debe ser de Mediafire.');
    try {
        const existing = await B.find({ $or: [{ title: { $regex: `^${title}$`, $options: 'i' } }, { link }] });
        if (existing.length) return m.reply('Ya existe un libro con ese título o enlace.');
        const nb = new B({ title, link, author, genre }); await nb.save();
        m.reply(`Se agregó el libro: ${nb.title}`);
    } catch (e) { console.error(e); m.reply('Error al agregar el libro.'); }
}

async function updateField(text, conn, m, field, validateLink = false) {
    const B = await ensureConn(); if (!B) return notConfigured(m);
    const parts = (text || '').replace(/[^\w\s:;\.\-_\/+\p{Script=Latin}]+/gu, '').split('\n').map(l => l.trim());
    const id = parts[1], val = parts[2];
    if (!mongoose.Types.ObjectId.isValid(id)) return m.reply('ID del libro no válida (debe ser un ObjectId).');
    if (!val) return m.reply(`Error: proporciona un nuevo ${field}.`);
    if (validateLink && !isValidMediafireLink(val)) return m.reply('Error: El enlace debe ser de Mediafire.');
    try {
        const updated = await B.findByIdAndUpdate(id, { [field]: val }, { new: true });
        if (!updated) return m.reply('Libro no encontrado.');
        return m.reply(`Se actualizó ${field} a: ${updated[field]}`);
    } catch (e) { console.error(e); return m.reply(`Error al actualizar ${field}.`); }
}
export const updateBookTitle  = (t, c, m) => updateField(t, c, m, 'title');
export const updateBookAuthor = (t, c, m) => updateField(t, c, m, 'author');
export const updateBookGenre  = (t, c, m) => updateField(t, c, m, 'genre');
export const updateBookLink   = (t, c, m) => updateField(t, c, m, 'link', true);

export async function deleteBook(conn, m, text) {
    const B = await ensureConn(); if (!B) return notConfigured(m);
    if (!mongoose.Types.ObjectId.isValid(text)) return m.reply('ID del libro no válida.');
    try {
        const del = await B.findByIdAndDelete(text);
        if (!del) return m.reply('Libro no encontrado.');
        return m.reply('Libro eliminado exitosamente.');
    } catch (e) { console.error(e); return m.reply('Error al eliminar el libro: ' + e.message); }
}
export { ensureConn as _ensureBookConn };
