# Alerta «copia»

**Qué significa.** La copia diaria de la base ha fallado.

**Qué mirar primero.** `docker ps` (¿está la base?) y el espacio libre en disco.

**Qué hacer.** Arregla la causa y lanza `scripts/copia_db.sh` a mano; comprueba que restaura con `scripts/restaurar_db.sh`.
