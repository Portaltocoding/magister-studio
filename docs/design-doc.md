# Magister Studio: design doc (borrador)

> Borrador escrito al construir. El libro pide que lo escribas tú y que lo revise una sesión de Claude sin historial: cámbialo entero si quieres.

## Problema y usuario

Una persona que estudia por su cuenta necesita un profesor particular: que entienda qué quiere aprender, lo planifique en sus horas, le enseñe desde sus fuentes con citas, le prepare material con un tono cuidado, le pregunte y le corrija, y le programe el repaso. Uso personal, una instalación por persona.

## Requisitos medibles

| Requisito | Cómo se mide | Estado (2026-11-15) |
|---|---|---|
| La respuesta llega escribiéndose | `ms_primer_token` de `mensajes`; p50 < 5 s | Medido con Haiku: 1,9 a 2,4 s |
| El plan cabe en tus horas | `evals.correr` (capacidad, dependencias, días) | 100 % en el caso medido |
| Las citas existen y sostienen lo dicho | Citas comprobadas sin modelo; `evals.fidelidad` | Juez comprobado (Einstein 0,5) |
| El corrector no deja pasar fallos | Recall de fallo en `evals.corrector.medir` | 1,0 en 6 casos (banco provisional) |
| El modelo de olvido está calibrado | ECE en walk-forward < 0,05 | 0,046 (simulado) |
| Las defensas deterministas aguantan | `evals.ataques --salir-si-falla` | 0 éxitos en imagen, SSRF y fuga |

## Arquitectura

Monolito modular en Python (FastAPI) con capas `api`, `flujo` (LangGraph), `cerebro` (el modelo detrás de `generar` y `estructurar`), `plan` (código puro), `fuentes`, `research`, `material`, `tono`, `trabajos`, `aprender`, `observar`, `seguridad` y `datos` (Postgres 16 con pgvector). El modelo es `claude -p` con la suscripción. Ver los ADR 0001 a 0016.

## Alternativas descartadas, con su número

- Agente de research frente a flujo fijo: el agente gana en éxito (100 % frente a 75 %) pero cuesta 4 veces las llamadas: se queda el fijo (ADR-0008).
- Leitner frente a FSRS: Leitner como probabilidad tiene ECE 0,377; FSRS 0,093 (ADR-0013).
- Langfuse obligatorio: tres servicios más para una persona (ADR-0014).

## Qué pasa si cae cada pieza

| Pieza | Efecto | Qué hace el sistema |
|---|---|---|
| `claude -p` | No hay respuestas nuevas | Reintentos, cortacircuitos y mensaje de error claro; lo guardado sigue accesible |
| Postgres | Nada funciona | Copias diarias y restauración probada |
| Trabajador | El material no avanza | La cola persiste; se retoma al volver (lease) |
| Embeddings locales | No se indexa | Las versiones quedan `pendiente` hasta que vuelve |

## Coste

`uv run python -m magister.observar.informes coste --semanas 4` extrapola a 12 meses desde `llamadas` (coste equivalente en API, aunque pagues con la suscripción).

## Riesgos abiertos

Juez de tono sin calibrar contra tus etiquetas; bancos de evals provisionales; modelo de olvido entrenado solo con datos simulados.
