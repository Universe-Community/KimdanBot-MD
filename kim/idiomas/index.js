// Wrapper ESM que carga los archivos de idiomas de KimdanBot (CJS, sin tocar
// (~60K de strings de mensajes del bot) usando createRequire.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
export const es = require('./es.cjs');
export const en = require('./en.cjs');
