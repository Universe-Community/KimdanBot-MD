# KimdanBot-MD v3.0 — Eventos y comandos extendidos

## Lo nuevo en esta versión

### 📡 Nuevos eventos manejados desde `kim/announcements.js`

| Evento de Baileys | Qué hace |
|---|---|
| `group-participants.update` | Welcome / bye / promote / demote con banners |
| `groups.update` | Avisa cuando cambia nombre, descripción o foto del grupo |
| **`call`** | Anti-llamada: rechaza automático y opcionalmente bloquea |
| **`messages.upsert` (cache)** | Guarda mensajes para anti-delete (200/chat, TTL 1h) |
| **`messages.update`** | Anti-delete (recupera borrado) + log de ediciones |
| **`presence.update`** | Avisa cuando un AFK vuelve a estar online |
| **`contacts.update`** | Log silencioso de cambios de foto/nombre |

Todo en `kim/announcements.js`. Modificarlo NO afecta dispatcher ni comandos.

### 🛠️ 13 comandos nuevos usando la API completa de Baileys

| Comando | Categoría | Hace |
|---|---|---|
| `.check <num>` | tools | `onWhatsApp` — verifica si existe en WhatsApp |
| `.bio <@user>` | tools | `fetchStatus` — lee la biografía |
| `.fotoperfil <@user>` | tools | `profilePictureUrl` — descarga foto HD |
| `.business <@user>` | tools | `getBusinessProfile` — info de empresa |
| `.setppgrupo` | group | `updateProfilePicture` — foto del grupo (responde a imagen) |
| `.setppbot` | owner | `updateProfilePicture` — foto del bot |
| `.encuesta P\|A\|B\|C` | group | `sendMessage({poll})` — crea encuestas |
| `.creargrupo <nombre>` | owner | `groupCreate` — crea grupo desde el bot |
| `.antillamada on/off` | config | rechaza llamadas automáticas |
| `.bloquearllamada on/off` | config | además bloquea al que llama |
| `.antidelete on/off` | config | recupera mensajes borrados (por grupo) |
| `.editlog on/off` | config | log de ediciones (por grupo) |
| `.notifychanges on/off` | config | avisos de cambios del grupo |

### Total final

- **108 comandos** registrados (213 con aliases)
- **12 categorías** en el menú auto-generado
- **7 listeners** de eventos cubiertos

### Categorías (por cantidad de comandos)

```
config: 21    media:    4
group:  19    game:     4
owner:  16    download: 3
info:   10    misc:     3
tools:   9    search:   2
rpg:     9    sticker:  4
fun:     8
```

## Cómo aplicar

```bash
cd ~
rm -rf KimdanBot-MD/authFolder      # OBLIGATORIO
unzip -o x-v7.zip -d KimdanBot-MD/
cd KimdanBot-MD
rm -rf node_modules package-lock.json
npm install
npm start
```

## Cómo agregar más cosas

### Agregar un anuncio para un evento nuevo

En `kim/announcements.js`:

```js
async function onChatsUpdate(conn, updates) {
    // tu lógica
}

// dentro de attachAnnouncements():
conn.ev.on('chats.update', (updates) =>
    onChatsUpdate(conn, updates).catch(err =>
        console.error('[chats]', err?.message || err)
    )
);
```

### Agregar un comando

En `kim/commands.js`:

```js
export const miCmd = command({
    name: 'micmd',
    aliases: ['mc'],
    category: 'fun',
    description: 'Lo que hace',
}, async (conn, m, args, text) => {
    return m.reply('hola');
});
```

Aparece solo en `.menu` en la sección DIVERSIÓN.

## Diagnóstico

Logs claros en consola:
- `[MSG]` mensajes recibidos
- `[announcements]` eventos de grupo
- `[anti-call]` llamadas rechazadas
- `[anti-delete]` mensajes recuperados
- `[Handler]` errores de comandos
- `[CONEXIÓN]` cambios de conexión
