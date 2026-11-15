# Alerta «errores»

**Qué significa.** Más del 5 % de las llamadas al modelo fallan en 24 h.

**Qué mirar primero.** `select error, count(*) from llamadas where error is not null and creada > now() - interval '1 day' group by 1;` y `claude --version`.

**Qué hacer.** Si es «plazo agotado», sube `MAGISTER_PLAZO_PRIMER_TOKEN_S`; si es de cuota o sesión, `claude` en una terminal para reautenticar; si es de un modelo, cambia `MAGISTER_MODELO`.
