# subbots/

Nueva arquitectura de sub-bots (kim/subbots/).
- sessions/<id>/   credenciales multi-file por sub-bot (no versionar)
- registry.json    índice para reconexión automática al arrancar

Cada sesión: estado, caché y reconexión INDEPENDIENTES. Un fallo en un
sub-bot no afecta a otros ni al bot principal. Reconexión con backoff
exponencial; loggedOut/badSession purgan credenciales y no reintentan.
