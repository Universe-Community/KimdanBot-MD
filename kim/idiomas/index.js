// Wrapper ESM que carga los archivos de idiomas (CJS legacy, sin tocar
// 60K de strings escritas por el autor original) usando createRequire.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
export const es = require('./es.cjs');
export const en = require('./en.cjs');
