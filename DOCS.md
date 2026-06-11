# 📘 Documentación Técnica — KimdanBot-MD

Guía para desarrolladores. Cómo está construido el bot y cómo extenderlo.

---

## Arquitectura general

```
index.js                 Arranque: conexión Baileys, pairing, reconexión, caches
settings.js              global.owner / global.vip / global.prefix / config
kim/
├── handler.js           Despachador central (clase Handler)
├── registry.js          Registro dinámico de comandos + generador de menú
├── db.js                Base de datos JSON (atómica, coalescing por dirty-flag)
├── helpers.js           smsg(), serializeConn(), utilidades LID-aware
├── theme.js             Monedas, rarezas, personajes BL, helpers VIP
├── ui.js                Cajas/separadores/caritas para textos premium
├── media.js             GIFs locales + caché en disco/RAM
├── announcements.js     welcome/bye/promote + anti-* + bienvenidas masivas
├── middleware.js        anti-link / anti-spam / anti-fake / AFK
├── commands*.js         Comandos (case/switch + COMMAND_META)
├── subbots/             Sistema de sub-bots (sesión, gestor, persistencia)
└── idiomas/             Traducción y cadenas localizadas
libs/biblioteca.js       Modelo MongoDB de libros (Mongoose)
```

### Flujo de un mensaje

```
Baileys ──messages.upsert──▶ Handler.onMessageUpsert
   └─ por lotes (concurrencia 8) ▶ _handleOne(raw)
        ├─ smsg(raw) ▶ normaliza m (sender, senderAlt, isGroup, quoted…)
        ├─ calcula prefijo/comando (m._isCmd)
        ├─ si _isCmd: resuelve permisos LID (owner/admin/bot) — solo aquí
        ├─ cuenta actividad (markDirty, flush diferido)
        └─ despacha al handler del comando vía cmdMap
```

### Eventos suscritos
- `messages.upsert` — mensajes (handler) + cache de mensajes propios.
- `group-participants.update` — welcome/bye/promote/demote.
- `groups.update` — cambios de grupo (con supresión durante consultas masivas).
- `connection.update` — reconexión + restauración de sub-bots.

---

## Sistema de comandos

Cada comando se declara en un `COMMAND_META` y se maneja en un `switch`:

```js
// en COMMAND_META
{ names: ['saludar', 'hi'], category: 'fun', description: 'Saluda' },

// en execute()
case 'saludar': {
    await m.reply('¡Hola! 💜');
    break;
}
```

El registro es automático: `registry.js` recorre `COMMAND_META` y llama a
`command()`. El menú (`buildMenu`) detecta categorías y comandos **dinámicamente**
— no hay que editar el menú al añadir uno nuevo.

### Helpers de permisos (en commands.js)
- `needGroup(m)` — solo en grupos.
- `needGroupAdmin(m)` — admin del grupo.
- `needBotAdmin(m)` — el bot debe ser admin.
- `needOwner(m)` — solo owner.
- `needOwnerPrivate(m)` — owner **y** chat privado (comandos sensibles).

### Objeto `m` (mensaje normalizado)
`m.chat`, `m.sender`, `m.senderAlt` (forma LID/PN alterna), `m.isGroup`,
`m.isOwner`, `m.isVip`, `m.isBotAdmin`, `m.isSenderAdmin`, `m.quoted`,
`m.mentionedJid`, `m.command`, `m.args`, `m.text`, `m.reply()`.

---

## Sistema de economía

Tres monedas en `theme.js`, formateadas con `fmtMoney/fmtPremium/fmtAffinity`:
- 💜 **Jinx Coins (JX)** → campo `money` (+ `bank`)
- 💎 **Heart Gems (HG)** → campo `corazones`/`diamond`
- 🤝 **Affinity Points (AP)** → campo `affinity`

Banco: `deposit`/`withdraw`/`bank`/`banklog`/`invest`/`interest` + rankings
(`topmoney`/`topbank`/`rich`). Anti-exploit: `Number.isSafeInteger`, sin
negativos, cap al saldo, sin auto-transferencia.

VIP: `isVip(u, m)` / `vipMult(u, m)` → x2 en `work` y `mine`. Fuentes:
`global.vip` (settings.js) o flag en DB (`.setvip`).

---

## Sistema de actividad

Hook ligero en `_handleOne`: por cada mensaje de grupo incrementa
`user.activity[chatJid] = { count, last }` y marca la DB como dirty
(escritura diferida cada 5 s, nunca por mensaje). Comandos: `contar`,
`topactivos`, `topinactivo` (paginados 50/pág sobre miembros reales).

---

## Sistema de idiomas

`idiomas/translate.js`: capa con LibreTranslate keyless, caché LRU y fallback
al texto original. Precedencia: usuario > grupo > global. Opt-in (no reescribe
los textos hardcodeados por latencia).

---

## Sistema de GIFs

`media/gifs/<categoría>/` con archivos `.mp4/.gif/.webp`. `media.js`:
- `getLocalGif(cat)` — GIF propio aleatorio de la carpeta (prioridad).
- `getGifBuffer(cat, url)` — local primero, luego nekos.best (cache en disco).
- Listado de carpeta cacheado 60 s para no hacer I/O en cada interacción.

El nombre de carpeta es la **categoría interna**, no el comando (varios
comandos comparten carpeta). Mapa completo en `media/gifs/README.md`.

---

## Sistema de SubBots

`kim/subbots/`:
- **SubBotSession.js** — una sesión = un socket Baileys con estado, caché y
  reconexión propios. Máquina de estados (idle→pairing→open→closing→dead),
  backoff exponencial + jitter, aislamiento de errores.
- **SubBotManager.js** — registro central singleton, persistencia en
  `subbots/registry.json`, reconexión automática al arrancar (`restoreAll`).
- **jadibot.js** — fachada (`startJadibot`/`stopJadibot`/`listJadibots`/
  `restoreSubBots`).

Caches con TTL (sin `maxKeys`, que lanzaría al llenarse).

---

## Base de datos

`db.js` — JSON con escritura atómica (tmp + rename), coalescing por dirty-flag
y throttle de 5 s. `getUser(jid)`, `getChat(jid)`, `getSettings()`, `db.markDirty()`,
`db.flush()`. Para libros: MongoDB vía `libs/biblioteca.js` (degrada sin Mongo).

---

## Estabilidad / rendimiento (decisiones clave)

- Permisos LID costosos solo se calculan en comandos, no en cada mensaje.
- Todos los NodeCache usan TTL (sin `maxKeys` → nunca lanzan al llenarse).
- Maps de larga vida acotados por tamaño o por poda periódica.
- Concurrencia de `messages.upsert` acotada (lotes de 8).
- I/O de GIFs cacheada.

---

## Añadir un comando nuevo (ejemplo completo)

```js
// 1) en COMMAND_META de cualquier commands_packN.js
{ names: ['hola', 'saludo'], category: 'fun', description: 'Saluda con cariño' },

// 2) en execute()
case 'hola': {
    await m.reply('¡Hola, ' + (m.pushName || 'lindura') + '! 💜');
    break;
}
```
Aparecerá en el menú automáticamente. No tocar `registry.js`.
