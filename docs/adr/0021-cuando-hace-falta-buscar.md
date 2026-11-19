# ADR-0021. Cuándo hace falta buscar fuentes, y que lleguen solas a lo que vas a estudiar

**Estado:** aceptada. **Fecha:** 2026-11-19. Completa a ADR-0020 (research por objetivos) y a ADR-0019 (lo del research entra solo).

**Contexto.** Hasta ahora el research se lanzaba igual para todas las lecciones: «para aprender a dividir no hace falta una research, me lo dice directamente cualquier IA». A la vez, lo que sí la necesitaba no siempre la tenía: el plan de Topografía se aceptó sin buscar y nada volvía a buscar si no se pulsaba a mano, y los apuntes de L1 a L4 del plan 2 se hicieron mientras su research aún corría, con el apoyo vacío y sin dejar constancia de con qué se hicieron.

**Decisión.**

1. **El plan decide por lección, sin llamadas de más.** La llamada que ya escribe el plan (`planificar`) añade a cada lección `necesita_fuentes` (no, conviene o imprescindible) y `fuentes_por_que`, una frase para el alumno. Los criterios, con ejemplos, están en `cerebro/prompts/comun/fuentes_leccion.md`: «no» es lo básico y estable que cualquier modelo explica bien; «conviene», lo que mejora con una buena fuente; «imprescindible», lo que caduca, lo muy especializado, lo que exige cita y el temario concreto de un curso. Ante la duda entre «no» y «conviene», «conviene»: no buscar cuando hacía falta es el fallo caro. En código (`plan/esquemas.LeccionNueva`), el valor tiene que ser uno de los tres y el motivo no puede ir vacío. Se guarda en `lecciones.necesita_fuentes` y `lecciones.fuentes_por_que` (migración `d6f1b3a8c240`); las lecciones de antes se leen como «conviene».
2. **Tu material manda.** Si tienes documentos tuyos del tema (no web), ninguna lección sale como «no» (`plan/apoyo.necesidad_efectiva`).
3. **Lo cambias tú.** En Roadmap la etiqueta es un chip con su porqué y tres opciones (`PATCH /api/planes/{plan}/lecciones/{clave}/fuentes`). En las de «no», «Buscar fuentes» queda como acción secundaria.
4. **Qué se busca.** «Aceptar y buscar fuentes» y el research automático se saltan las de «no» (`research/tareas.lanzar`, ADR-0020); pedir una lección a mano busca siempre.
5. **Lo que se acerca se investiga solo.** Con `MAGISTER_RESEARCH_AUTO=true` (por defecto), un bucle de la API revisa cada 10 minutos los planes aceptados y lanza el research de las lecciones sin material cuya primera sesión pendiente cae en los próximos `MAGISTER_RESEARCH_HORIZONTE_DIAS` días (7) o ya pasó (la llevas atrasada), como mucho 2 por vuelta (`plan/horizonte.py`). Repite una búsqueda cortada o una acabada hace más de 14 días si la lección sigue sin material. No lanza nada con el freno echado ni si el plan tiene una búsqueda en curso, y lo anota en el registro de automatizaciones.
6. **Los apuntes esperan a sus fuentes.** La automatización de preparar la lección siguiente espera, como mucho `MAGISTER_MATERIAL_ESPERA_FUENTES` minutos (20), a una lección con research en curso, propuestas por incorporar o versiones indexándose. Cada material de apuntes guarda en `versiones` los fragmentos de apoyo que usó, la huella del apoyo y las versiones de sus prompts; el Roadmap compara eso con el apoyo de ahora (`plan/apoyo.estado_apuntes`) y ofrece rehacerlos con un botón, nunca solo.
7. **Se mide aparte.** `evals/cuando_research.py`, con el banco `evals/banco/cuando-research-v1.yaml` (30 lecciones etiquetadas a mano), cuenta los aciertos y, aparte, los fallos caros («no» donde se esperaba «imprescindible»). Llama al modelo: solo a mano y con `--gastar`.

**Consecuencias.**

- Un plan nuevo puede ahorrar varias búsquedas (2 llamadas cada una) en las lecciones básicas.
- El research automático gasta cuota sin un clic: unas 2 llamadas por lección, solo para lo que vas a estudiar en la semana, y se apaga con el ajuste.
- La lección de mañana puede esperar hasta 20 minutos a sus fuentes en la automatización (pedirla a mano no espera).
- Cambian las versiones de `planificar` y aparece la plantilla `cuando_research`; la tabla `lecciones` gana dos columnas, así que hay que lanzar `alembic upgrade head` antes de reiniciar la API.
