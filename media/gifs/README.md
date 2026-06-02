# media/gifs

Caché de GIFs/MP4 de interacciones anime (hug, kiss, pat, slap, …).
Estructura: media/gifs/<categoria>/<hash>.mp4

- Se descargan bajo demanda desde nekos.best (SFW) y se reutilizan desde disco.
- Caché en RAM (LRU) para las más usadas; dedupe por hash de URL.
- Limpieza: kim/media.js → pruneGifCache(días).

Puedes precargar tus propios GIFs BL/Yaoi colocándolos en la subcarpeta
de la categoría correspondiente (se sirven igual que los descargados).
