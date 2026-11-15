# ADR-0010. El guardián del tono y sus dos puertas

**Estado:** aceptada. **Fecha:** 2026-11-15.

**Decisión.** Lint determinista primero (gratis, sin sesgo) y juez `claude -p` después, con una rúbrica binaria de tres dimensiones (razonamiento, economía, trato) en `docs/rubrica.md`. El juez escribe la razón antes del veredicto y una cita literal; si la cita no aparece o el JSON no valida, `FalloJuez` (nunca un suspenso).

**Puerta del material.** Un veto del lint bloquea el material (`bloqueado`); un suspenso tras 2 refinados deja el bloque marcado y el material en `revisar`.

**Puerta del generador.** Un prompt nuevo sustituye al actual solo si no hay vetos, pasa la no inferioridad pareada por dimensión con un margen de 5 puntos (`evals.tono.correr --variante`) y tú lees la reserva.

**Pendiente.** El juez no está calibrado todavía: hace falta etiquetar el banco (panel «Etiquetar tono») y correr `evals.tono.calibrar` para tener su kappa y tu techo.
