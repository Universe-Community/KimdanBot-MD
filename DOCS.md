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
├── media.js             GIFs locales + caché en disco/RAM · imágenes aleatorias (getRandomImage)
├── announcements.js     welcome/bye/promote + anti-* + bienvenidas masivas
├── middleware.js        anti-link / anti-spam / anti-fake / AFK
├── logger.js            Logs con niveles (LOG_LEVEL / .loglevel)
├── authcare.js          Integridad del authFolder (sanea corruptos; NO poda por edad)
├── providers.js         Cadenas multi-proveedor para descargas (fallback)
├── games.js             Motor de minijuegos por chat (número/mates/ahorcado/gato)
├── anonchat.js          Chat anónimo 1:1 por privado (emparejamiento + relay)
├── commands*.js         Comandos (case/switch + COMMAND_META)
├── subbots/             Sub-bots: sesión, gestor, licencias (Mongo) y expiración
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
- **store.js** — licencias (permanente/temporal): MongoDB (`Kim.SubBots`) con
  fallback automático a `subbots/licenses.json` si no hay `MONGODB_URI`.
  Índices: `expiresAt`, `state` y compuesto `{state, expiresAt}`.
  Incluye `parseDuration()` (12h · 7d · 2w · 1m · 1a · permanente).
- **expiry.js** — servicio de expiración. Barrido cada ~10 min con consulta
  INDEXADA (`state='active' AND expiresAt<=now`): nunca recorre la colección
  entera. Al vencer: cierra el socket, purga la sesión, marca `expired` y
  notifica al owner. Idempotente y resistente a reinicios (usa timestamps
  absolutos, no contadores en memoria).
- **jadibot.js** — fachada (`startJadibot`/`stopJadibot`/`listJadibots`/
  `restoreSubBots`).

Caches con TTL (sin `maxKeys`, que lanzaría al llenarse).

### Licencias de sub-bots

Los sub-bots **permanentes siguen funcionando igual que siempre**: si alguien
se conecta con `.serbot` sin licencia previa, se le crea una PERMANENTE
(`expiresAt=null`). Solo se vuelve temporal si un owner lo decide.

| Comando | Uso |
|---|---|
| `.subbot @user <dur>` | Crea/actualiza licencia (`30d`, `12h`, `permanente`…) |
| `.subbotinfo [@user]` | Detalle: creación, duración, expiración, restante, estado |
| `.subbotlist` | Todas las licencias con estado y tiempo restante |
| `.extendsubbot @user 30d` | Amplía el tiempo restante |
| `.reducesubbot @user 15d` | Reduce el tiempo (nunca deja tiempo negativo) |
| `.subbotrenew @user <dur>` | Renueva un sub-bot vencido |
| `.subbotremove @user` | Cierra sesión, purga auth y elimina la licencia |

Formatos de duración: `12h 24h 48h` · `7d 15d 30d 90d` · `2w 3w` ·
`1m 3m 6m 12m` · `1a 2a` · `permanente`.

---

## Logs y filtrado de ruido

La consola solo muestra información útil. El ruido interno del protocolo de
WhatsApp está silenciado por defecto y es reactivable desde
`settings.js → global.logFilter`:

```js
global.logFilter = {
    showProtocolMessages:  false,  // protocolMessage, historySync, deviceSent…
    showSenderKeyMessages: false,  // senderKeyDistributionMessage
    showStickerMessages:   false,  // stickerMessage sin texto
    showReactionMessages:  false,  // reactionMessage / pollUpdate
    showPresenceMessages:  false,  // presencia (escribiendo/en línea)
    showSignalMessages:    false,  // ruido de libsignal (ver abajo)
    showDebugMessages:     false,  // equivale a LOG_LEVEL=debug
};
```

**Importante:** `Decrypted message with closed session` NO es un error. Lo
emite el paquete `libsignal` (dependencia de Baileys) con `console.warn`
directo — por eso el logger pino de Baileys en `level:'silent'` no lo
silencia. Significa que un mensaje se descifró correctamente usando una
sesión ya archivada, algo normal al procesar mensajes en cola tras una
reconexión. Actívalo con `showSignalMessages:true` solo para depurar.

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
