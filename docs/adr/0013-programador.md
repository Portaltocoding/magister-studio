# ADR-0013. El programador de repasos

**Estado:** aceptada. **Fecha:** 2026-11-15.

**Medido** (base de simulación: 200 conceptos, 120 días, 1.865 intentos; walk-forward semanal con un día de hueco; 1.425 predicciones fuera de muestra por modelo):

| Modelo | log-loss | Brier | AUC | ECE |
|---|---|---|---|---|
| Tasa base | 0,482 | 0,152 | 0,510 | 0,012 |
| Leitner como probabilidad | 1,101 | 0,326 | 0,630 | 0,377 |
| FSRS por defecto | 0,590 | 0,149 | 0,699 | 0,093 |
| Logística | 0,446 | 0,140 | 0,709 | 0,039 |
| Logística calibrada (sigmoide) | 0,453 | 0,143 | 0,688 | 0,046 |

Escalera con bootstrap pareado (2.000 remuestreos): la logística mejora a Leitner (Δ log-loss −0,65 [−0,74, −0,57]) y a FSRS (−0,14 [−0,21, −0,08]).

**Decisión.** Por defecto, `MAGISTER_PROGRAMADOR=fsrs`: gana a Leitner con margen y no necesita entrenar. El modelo propio (`modelo`) solo se activa cuando esté reentrenado con tus intentos reales (`python -m evals.olvido walkforward --calibrar` sin `--simulado`): la ventaja de arriba está medida con datos simulados, que siguen la misma curva de FSRS-6 que la logística aprende a imitar.
