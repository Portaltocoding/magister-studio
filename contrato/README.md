# Contrato

El acuerdo de qué viaja entre las piezas de Magister. Se escribe antes del código y no cambia cuando cambia la tecnología de un lado. El sobre de los mensajes está en `sobre.md`.

## Las piezas

```
   [ Página (web/) ]  ── HTTP + SSE ──▶  [ Proxy ]  ──▶  [ API (magister.api) ]
   pinta, no decide                      conecta,         traduce HTTP a llamadas;
                                         no interpreta    no sabe de modelos ni SQL
                                                               │         │
                                                               ▼         ▼
                                              [ Cerebro (magister.cerebro) ]   [ Datos (magister.datos) ]
                                              decide qué decir;                guarda y lee;
                                              no sabe de HTTP                  no sabe del modelo
                                                      │
                                                      ▼
                                            [ claude -p → tu suscripción ]
```

Las flechas solo van hacia abajo: la API importa de cerebro y datos; ellos nunca importan de la API ni entre sí.

## Lo que hace y lo que no hace cada pieza

| Pieza | Responsabilidad | Lo que no hace |
|---|---|---|
| Página (`web/`) | Pintar, recoger lo que escribes y mostrar el estado | Decidir qué responder o guardar nada que importe |
| Proxy | Reenviar peticiones, poner límites y cabeceras | Entender el contenido de los mensajes |
| API (`magister.api`) | Recibir HTTP, validar, llamar a cerebro y datos, devolver la respuesta | Hablar con el modelo o con la base de datos directamente |
| Cerebro (`magister.cerebro`) | Decidir qué decir, con `claude -p` detrás de `generar()` | Saber de HTTP o de páginas |
| Datos (`magister.datos`) | Guardar y leer en Postgres | Saber del modelo |
