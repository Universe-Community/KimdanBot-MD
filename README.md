<div align="center">

# 💜 KimdanBot-MD

### Bot de WhatsApp Multi-Device · Temática BL / Yaoi / Jinx

*Economía Jinx · Gacha BL · SubBots · Moderación LID-aware · 374 comandos*

`Baileys v7` · `Node ≥ 20` · `ESM` · `MongoDB opcional`

</div>

---

## 📖 ¿Qué es?

KimdanBot-MD es un bot de WhatsApp construido sobre **Baileys v7** con una
arquitectura modular propia. Está tematizado en torno al universo **BL / Yaoi**
(con *Jinx* como insignia) e incluye un sistema económico completo, gacha de
personajes, sub-bots, herramientas de moderación y un catálogo de **374 comandos**
repartidos en 16 categorías.

Toda la lógica vive en `kim/`, separada por responsabilidades: tocar un módulo
no afecta a los demás.

---

## ✨ Características principales

| Sistema | Descripción |
|---|---|
| 💰 **Economía** | 💜 Jinx Coins (JX) · 💎 Heart Gems (HG) · 🤝 Affinity Points (AP) |
| 🏦 **Banco completo** | depósito, retiro, historial, inversión, interés diario y rankings |
| 🎴 **Gacha BL** | 70 personajes (Jinx, manhwa, manga y anime BL) con rarezas y colección |
| 👑 **Rango VIP** | x2 en trabajar y minar; lista fija en `settings.js` o por comando |
| 🤖 **SubBots** | arquitectura aislada con reconexión automática y persistencia |
| 🛡️ **Moderación** | kick LID-aware, warns, anti-link, anti-spam, anti-fake, anti-toxic |
| 🎉 **Bienvenidas masivas** | agrupa entradas en una ventana de 60 s (sin spam) |
| 📊 **Estadísticas** | `.contar`, top activos e inactivos con paginación (grupos grandes) |
| 🔎 **Búsqueda BL** | manga/manhwa/novelas vía AniList y MangaDex (fuentes legales) |
| 🎨 **Stickers** | conversión + sistema de packs (metadata, favoritos, público/privado) |
| 🌐 **Multilenguaje** | capa de traducción opt-in (LibreTranslate) por usuario/grupo/global |
| 📚 **Biblioteca** | catálogo de libros con MongoDB (degradación elegante sin Mongo) |
| 🧹 **Auto-limpieza de sesión** | poda segura del `authFolder` (nunca toca `creds.json` ni AppState Keys) |
| 🪵 **Logs con niveles** | `silent/error/warn/info/debug` vía `LOG_LEVEL`, `settings.js` o `.loglevel` |
| 🎮 **Minijuegos** | adivina el número, mates, ahorcado y gato (tres en raya) con premios en 💜 JX |
| 🎭 **Chat anónimo** | empareja a dos personas en privado y reenvía sus mensajes sin revelar identidad |
| 🔇 **Mute por grupo** | silencia a un usuario (borra sus mensajes) protegiendo owner y admins |
| 👁️ **Anti view-once** | revela los mensajes de "ver una vez" en el grupo |
| 📥 **Descargas robustas** | cadenas multi-proveedor (YouTube, TikTok, IG, FB, X, Pinterest, Spotify, SoundCloud, Threads, MediaFire) |
| 🖼️ **Imagen aleatoria** | `.pruebaimagen` envía una imagen al azar desde la carpeta `media/pruebaimagen/` |

---

## 🧹 Mantenimiento automático del `authFolder`

Con el tiempo, Baileys acumula miles de archivos de sesión (`pre-key-*`,
`session-*`, `sender-key-*`) que ralentizan el arranque y llenan el disco.
`kim/authcare.js` los poda de forma **segura y automática**:

- **Nunca** toca `creds.json` ni `app-state-sync-key/version-*` → la sesión
  y las AppState Keys quedan intactas (no hay que volver a escanear el QR).
- Solo borra archivos que Baileys **regenera solo**, y solo si son viejos
  (por `mtime`): pre-keys > 30 días, sesiones > 21 días, sender-keys > 14 días.
- Se ejecuta al arrancar (solo si hay acumulación real, > 300 archivos podables)
  y cada 12 h. Cubre también las sesiones de sub-bots.
- Configurable en `settings.js → global.authCare` o con variables `AUTHCARE_*`
  (ver `env.example`).

Comandos owner: `.authstatus` (radiografía), `.authclean [--dry]` (poda manual
o simulación), `.loglevel <nivel>` (detalle de consola en caliente).

Más detalles técnicos y el informe completo de cambios: **`AUDITORIA.md`**.

---

## 🆕 Novedades v3.2.0

- **Nuevo comando `.pruebaimagen`** (alias `.testimagen`, `.testimg`): envía una
  imagen al azar de `media/pruebaimagen/` (o `./pruebaimagen/`). Trae 3 imágenes
  de ejemplo; reemplázalas por las tuyas.
- **Descargas más estables**: el timeout de los proveedores ahora cubre también
  la lectura del cuerpo de la respuesta, no solo la conexión.
- **DB con migración de forma**: al iniciar, los registros antiguos reciben
  automáticamente los campos nuevos (evita errores tras actualizar).
- **`getBuffer`/`fetchJson` corregidos**: pasar headers propios ya no elimina el
  `User-Agent` por defecto.
- **Filtro antitóxico afinado**: se quitaron palabras cotidianas inofensivas
  (perro, loca, caca, bobo…) que causaban advertencias por error; se mantienen
  los insultos reales.

---

## 🚀 Instalación

> Requiere **Node.js 20 o superior**.

```bash
# 1) Instalar dependencias
npm install

# 2) (Opcional) Configurar variables de entorno
cp .env.example .env
#   edita .env y añade tu MONGODB_URI si quieres usar la biblioteca

# 3) Iniciar el bot
npm start
#   o:  node index.js
```

Al arrancar, elige el método de vinculación:

- **Código de emparejamiento** — escribe tu número y vincula con
  *WhatsApp ▸ Dispositivos vinculados ▸ Vincular con número de teléfono*.
- **Código QR** — escanéalo desde *Dispositivos vinculados ▸ Vincular dispositivo*.

---

## ⚙️ Configuración (`settings.js`)

| Variable | Para qué |
|---|---|
| `global.owner` | Lista de dueños `['numero','nombre',true]` |
| `global.vip` | VIPs fijos (por defecto `[...global.owner]`) |
| `global.botname` | Nombre que muestra el bot |
| `global.prefix` | Prefijos de comandos (admite varios) |
| `global.groupMemberLimit` | Límite de miembros para aprobar solicitudes (def. 1024) |

Variables de entorno (`.env`):

| Variable | Para qué |
|---|---|
| `MONGODB_URI` | Conexión para el sistema de biblioteca (opcional) |
| `LIBRETRANSLATE_URL` | Endpoint de traducción (opcional) |
| `BOT_LANG` | Idioma global por defecto |

---

## 🗂️ Estructura del proyecto

```
KimdanBot-MD/
├── index.js               Punto de entrada (conexión, pairing, reconexión)
├── settings.js            Owners, VIPs, prefijos, configuración global
├── kim/
│   ├── handler.js         Despachador (permisos LID-aware, anti-saturación)
│   ├── registry.js        Registro de comandos + generador de menú
│   ├── db.js              Base de datos JSON (escritura atómica, coalescing)
│   ├── commands*.js       Los 338 comandos (arquitectura case/switch)
│   ├── theme.js           Monedas, rarezas, 70 personajes BL, VIP
│   ├── media.js           GIFs locales + caché (nekos.best de respaldo)
│   ├── ui.js              Helpers de presentación (cajas, barras)
│   ├── announcements.js   Welcome/bye/promote + anti-* + bienvenidas masivas
│   ├── middleware.js      Anti-link / anti-spam / anti-fake / AFK
│   ├── subbots/           Sistema de sub-bots (sesión, gestor, persistencia)
│   └── idiomas/           Traducción y cadenas localizadas
├── libs/biblioteca.js     Modelo MongoDB de libros
└── media/gifs/<categoría> Tus GIFs propios por categoría (ver su README)
```

---

## 📋 Categorías de comandos

Usa `.menu` para verlas todas en el chat. Resumen:

`INFO` · `OWNER` · `ADMIN` · `GRUPOS` · `CONFIG` · `MEDIA` ·
`🎨 STICKERS` · `🔎 BÚSQUEDAS` · `📥 DESCARGAS` · `🎮 RPG` ·
`🎴 GACHA BL` · `🎲 JUEGOS` · `🌸 ANIME` · `😄 DIVERSIÓN` ·
`🛠️ HERRAMIENTAS` · `OTROS`

### Comandos destacados

```
Economía     .balance  .work  .mine  .daily  .pay  .slot
Banco        .bank  .deposit  .retirar  .invest  .interest  .banklog
Rankings     .topmoney  .topbank  .rich
Gacha BL     .roll  .claim  .harem  .coleccion  .personajes
VIP (owner)  .setvip  .delvip  .viplist  .addmoney  .adddiamond
Moderación   .kick  .warn  .ban  (LID-aware, protege admins)
Stats        .contar  .topactivos  .topinactivo
Stickers     .sticker  .newpack  .stickeradd  .getpack  .stickerpacks
Búsqueda BL  .blsearch  .manhwasearch  .novelbl  .mangabl
SubBots      .serbot  .bots  .stop
Owner        .grupos  .restart  .update
```

---

## 🎞️ Añadir tus propios GIFs

Coloca archivos `.mp4` / `.gif` / `.webp` en `media/gifs/<categoría>/`
(usa el **nombre de categoría**, no el del comando — varios comandos comparten
carpeta). Tus archivos tienen prioridad sobre la fuente remota y funcionan sin
internet. El mapeo completo comando → carpeta está en `media/gifs/README.md`.

---

## 🧱 Estabilidad

- **Caché por TTL** (NodeCache sin `maxKeys`): nunca lanza `Cache max keys exceeded`.
- **Permisos LID solo en comandos**: los mensajes normales no saturan el event loop.
- **Estructuras acotadas**: todos los Map/caché se podan por tiempo o LRU.
- **Reconexión** con backoff y crash-guards globales.

---

## 📦 Dependencias

`baileys` · `@hapi/boom` · `axios` · `node-cache` · `pino` · `sharp` ·
`qrcode` · `qrcode-terminal` · `yt-search` · `moment-timezone` · `form-data` ·
`cfonts` · `chalk` · `mongoose` · `lodash`

---

## ⚠️ Notas

- El sistema de biblioteca necesita MongoDB; sin `MONGODB_URI` el resto del bot
  funciona igual y esos comandos avisan que falta configuración.
- Algunos comandos de descarga/IA dependen de APIs externas: si una no responde,
  el comando degrada con un mensaje claro en lugar de fallar.
- El bot **no incluye** contenido +18: la temática BL/Yaoi se sirve como SFW.

---


---

## ❓ FAQ — Errores comunes

**"No eres owner" en privado siendo owner**
Asegúrate de que tu número esté en `global.owner` en `settings.js` en formato
`['593xxxxxxxxx', 'TuNombre', true]` (solo dígitos, con código de país). El bot
resuelve LID↔PN automáticamente.

**El bot no responde comandos en un grupo muy activo**
Resuelto: los caches usan TTL (no `maxKeys`) y los permisos pesados solo se
calculan en comandos. Si persiste, comparte el log de la consola.

**`Cache max keys amount exceeded`**
Ya no debería ocurrir (se eliminó `maxKeys` de todos los NodeCache). Si aparece,
revisa que no tengas una versión vieja de `index.js`.

**Los comandos de libros dicen que falta configuración**
Necesitan `MONGODB_URI` en `.env`. El resto del bot funciona sin Mongo.

**Una descarga/búsqueda falla**
Depende de APIs externas; si una cae, el comando avisa. Reintenta o usa otra.

**El bot no es admin pero aparezco como admin**
`#grupos` verifica el estado real intentando leer el enlace; si WhatsApp lo
devuelve, el bot es admin aunque la metadata estuviera desactualizada.

---

## 🛠️ Documentación para desarrolladores

Para arquitectura, sistema de comandos, economía, GIFs y SubBots, ver
**[DOCS.md](./DOCS.md)**.

---

## 💖 Créditos

- **Desarrollo, tema y comandos BL/Jinx**: KimdanBot-MD (Danonino · Universo BL).
- **Fuentes BL**: AniList y MangaDex (APIs públicas) para búsquedas.
- Hecho con cariño para la comunidad BL/Yaoi 💜

---

<div align="center">

💜 *KimdanBot-MD · Hecho con cariño para la comunidad BL* 💜

</div>
