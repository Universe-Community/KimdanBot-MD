# AUDITORÍA — KimdanBot-MD v3.0.1 (LTS)

Fecha: 2026-07-05 · Alcance: proyecto completo (arquitectura, handler, comandos, anuncios, sub-bots, DB, middleware, logs, sesión Baileys).

---

## 1. Problemas encontrados (y corregidos)

| # | Severidad | Problema | Archivo | Fix |
|---|-----------|----------|---------|-----|
| 1 | 🔴 Alta | **`.kick` no expulsaba**: el pack de interacciones anime registraba un comando `kick` (GIF de patada) DESPUÉS del `.kick` de admin, y `buildCmdMap()` sobreescribía silenciosamente. Lo mismo con `.love` (la calculadora de amor quedaba tapada por la interacción). | `commands_pack3.js`, `registry.js` | Interacciones renombradas a `.patear/.patada` y `.amar/.amor`. Además `buildCmdMap()` ahora aplica **first-wins + warning** ante cualquier colisión futura. |
| 2 | 🔴 Alta | **Pérdida de datos al apagar**: `shutdown()` llamaba `db.flush()` (async) y `process.exit(0)` no la esperaba → los últimos ~5 s de cambios (economía, warns, gacha) podían perderse en cada reinicio. | `index.js`, `kim/db.js` | Nuevo `db.flushSync()` (escritura atómica tmp+rename) invocado en SIGINT/SIGTERM. |
| 3 | 🟠 Media | **Clave duplicada en `DEFAULT_CHAT`**: `detect: true` … `detect: false` en el mismo literal — la segunda ganaba y los avisos promote/demote quedaban apagados por defecto, contradiciendo la documentación del propio archivo. | `kim/db.js` | Se eliminó el duplicado; `detect` vuelve a su default documentado (`true`). |
| 4 | 🟠 Media | **Fuga de timers**: `attachAnnouncements()` creaba un `setInterval` de limpieza POR SOCKET (bot principal + cada sub-bot + cada reconexión), sobre caches que son de módulo. | `kim/announcements.js` | Janitor único a nivel de módulo (`_ensureCacheJanitor`), idempotente y `unref()`. |
| 5 | 🟠 Media | **Mutaciones sin persistir**: el middleware modificaba `spam`, `warn`, `banned`, `afkTime` sin `db.markDirty()` → esos cambios solo se guardaban si otro comando ensuciaba la DB. | `kim/middleware.js` | `markDirty()` tras cada mutación. |
| 6 | 🟡 Baja | `db.load()` registraba un `setInterval` de flush sin guard ni `unref()` (riesgo de duplicado si se recargaba). | `kim/db.js` | Guard `_flushTimer` + `unref()`. |
| 7 | 🟡 Baja | Ruido de consola: diagnóstico `[perm]` en CADA comando de grupo, y ~15 logs de diagnóstico por cada anuncio de bienvenida. | `handler.js`, `announcements.js` | Ver §3 (sistema de niveles). |

## 2. NUEVO — Mantenimiento automático del `authFolder` (`kim/authcare.js`)

Resuelve la acumulación de miles de archivos de sesión de Baileys.

**Garantías (verificadas con test funcional incluido en la auditoría):**
- `creds.json` — **nunca se toca**.
- `app-state-sync-key-*.json` y `app-state-sync-version-*.json` — **nunca se tocan** (AppState Keys intactas → no se pierde la sesión ni se corrompe el app-state).
- Archivos no reconocidos — **nunca se tocan** (lista blanca estricta).
- Solo se poda por **antigüedad real (mtime)**: nada activo se borra, porque Baileys reescribe (y renueva el mtime de) lo que usa.
- Carpetas sin `creds.json` se ignoran por completo.

**Qué poda (todo regenerable por Baileys):** `pre-key-*.json` > 30 días · `session-*.json` > 21 días · `sender-key-*.json` / `sender-key-memory-*.json` > 14 días.

**Cuándo:** al arrancar (solo si hay > 300 archivos podables — un authFolder sano no se toca) y cada 12 h. Cubre también las sesiones de sub-bots (`subbots/sessions/*`). Todo configurable en `settings.js → global.authCare` o por variables `AUTHCARE_*` (ver `env.example`).

**Test realizado:** carpeta simulada con 474 archivos (450 viejos + protegidos + desconocido + 20 sesiones frescas) → eliminó exactamente los 450 obsoletos; conservó creds, ambas familias app-state, el archivo desconocido y las 20 sesiones recientes. Bajo el umbral no borra nada; `--dry` no toca disco.

**Comandos owner nuevos (`commands_pack9.js`):**
- `.authclean [--dry]` — poda manual forzada (o simulación).
- `.authstatus` — radiografía de acumulación de la sesión.
- `.loglevel <nivel>` — cambia el detalle de logs en caliente.

## 3. NUEVO — Sistema de logs con niveles (`kim/logger.js`)

`silent < error < warn < info < debug`, configurable con `LOG_LEVEL` (env), `global.logLevel` (settings) o `.loglevel` en caliente.

- **info (default):** consola limpia — mensajes `[MSG]`, comandos, conexión, anuncios enviados/fallidos, errores reales.
- **debug:** recupera todo el diagnóstico anterior (`[perm]`, cfg de anuncios, contactos, ids de envío).

Ruido eliminado en modo normal: `[perm]` por comando, ~10 líneas de diagnóstico por bienvenida, log de `contacts.update`, banner de 4 líneas de announcements (ahora 1).

## 4. Optimizaciones aplicadas

- `[perm]` ya no construye strings/Sets de diagnóstico salvo en `debug` (era trabajo extra en el hot path de cada comando de grupo).
- `_logMsg` sale inmediatamente en niveles < info.
- Un solo janitor de caches en vez de N (menos timers, menos wakeups).
- Flush de DB con guard/`unref` (no retiene el event loop al apagar).
- authcare reduce el tamaño del key-store en disco → arranques y `useMultiFileAuthState` más rápidos en sesiones veteranas.

Las optimizaciones previas del proyecto (concurrencia acotada en `messages.upsert`, caches TTL de metadata/adminSet, permisos LID solo para comandos, NodeCache sin `maxKeys`) se revisaron y se conservan: están bien planteadas.

## 5. Validación final

- ✅ `node --check` en los 31 archivos JS: sin errores.
- ✅ Import completo de settings + handler + 9 packs: **353 comandos, 726 nombres/aliases, 0 colisiones** (antes: 2 colisiones silenciosas).
- ✅ Arranque real (`node index.js qr`): banner → versión Baileys → comandos → announcements → authcare → "Conectando con WhatsApp" → cierre limpio con SIGTERM (flushSync).
- ✅ Test funcional de authcare (ver §2).
- ✅ Instalación limpia: `unzip → npm install → npm start` sin pasos manuales.

## 6. Riesgos detectados y recomendaciones futuras

- **APIs de terceros** (`settings.js → global.APIs`): varios proveedores públicos son inestables por naturaleza; `tryProviders()` mitiga, pero conviene revisar periódicamente qué endpoints siguen vivos.
- **Claves API embebidas**: son keys públicas/comunitarias de esos servicios; si algún día se usan keys propias, moverlas a `.env`.
- **database.json**: perfecto hasta ~decenas de MB. Si el bot supera miles de usuarios muy activos, considerar migrar usuarios/chats a MongoDB (la infraestructura de `libs/biblioteca.js` ya conecta Mongoose y puede reutilizarse).
- **Eval/shell del owner** (`>`, `=>`, `$`): correcto que exista solo para owner; mantener la lista `global.owner` mínima.
- El comando `.follar/.violar` y el regex antitoxic son heredados; revisar si encajan con la identidad del bot.

## 7. Impacto estimado

- **CPU:** −5–15 % en grupos activos (menos formateo de logs y diagnósticos en el hot path).
- **RAM:** estable a largo plazo (janitor único + caches ya acotadas); sin crecimiento por timers.
- **Disco/arranque:** en sesiones veteranas el authFolder pasa de miles de archivos a unos cientos, con arranque y key-store notablemente más ágiles.
- **Fiabilidad:** `.kick`/`.love` restaurados; cero pérdida de datos al reiniciar; colisiones de comandos imposibles de introducir sin warning.
