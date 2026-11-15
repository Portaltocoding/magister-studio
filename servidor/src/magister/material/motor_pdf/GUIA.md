# Guía del motor y de la estructura de las fichas

## Motor
- Cada ficha vive en `_src/<ID>/`: `ficha.md` (contenido), `fuentes/` (extractos de texto de los libros con pdftotext, si hacen falta) y lo que genere el build.
- Build: `python3 /home/portal/Downloads/fichas-estudio/_src/_motor/build.py /home/portal/Downloads/fichas-estudio/_src/<ID>`
  - pandoc markdown -> `ficha.html` (CSS `ficha.css`, KaTeX local) -> `render.mjs` (Chromium headless, dos pasadas: la segunda rellena el índice con páginas reales) -> PDF en la ruta `salida` del front matter.
  - Genera `prev/p-NN.png` (pdftoppm -r 40, todas las páginas) y `contacto.png` (hoja de contactos de todas).
  - Avisa de páginas casi vacías (<40 % de alto ocupado, salvo la última) y de «—». Si hay «—» sale con código 1.
- Revisión visual obligatoria: mira `contacto.png` y, si algo es dudoso, la página suelta en `prev/`. Busca: títulos (h3/h4) solos al pie, cajas o tablas cortadas, páginas casi vacías, fórmulas mal renderizadas (texto LaTeX crudo o rojo), índice con «?».
- Un solo proceso pesado a la vez: nada de lanzar dos builds en paralelo.

## Convenciones del markdown
```
---
titulo: A1 · Context engineering
pie: A1 · Context engineering · fichas de estudio
salida: /home/portal/Downloads/fichas-estudio/01-ai-avanzado/A1-context-engineering.pdf
---
# Título de portada {.nb .noidx}     <- h1 sin salto ni entrada en el índice
[[INDICE]]                           <- índice automático de h1 y h2, con páginas reales
# Bloque 1. Nombre                   <- h1: abre página, entra en el índice
## Síntesis del bloque 1             <- h2: abre página, entra en el índice
### Subapartado                      <- h3/h4: no abren página, no entran en el índice
[[3]]                                <- 3 líneas para escribir (en su propio párrafo o al final de un li)
- [ ] texto                          <- casilla
[ESENCIAL]{.ess}  [SECUNDARIO]{.sec2}   <- etiquetas
$x^2$  y  $$\sum_i x_i$$             <- fórmulas KaTeX (inline y display)
::: debo / ::: box / ::: aviso / ::: ok / ::: esqueleto / ::: s60 / ::: resp / ::: keep   <- cajas (no se parten)
[texto]{.cita}                       <- cita pequeña en gris
```
- Un h2 SIEMPRE abre página: úsalo solo para secciones que llenen al menos media página. Para lo demás, h3.
- Nada de «—» (raya). Usa coma, dos puntos, paréntesis o punto.
- Las cajas no se parten: no metas en una caja más de ~1/2 página. Las listas largas, fuera de caja.

## Estructura de cada ficha (validada por Carlos)
1. **Portada** (`# Título {.nb .noidx}`): caja `debo` con el «debo» del día (entregable comprobable), «Con qué saldrás» (5-7 casillas), «Cómo trabajar esta ficha» (orden: preguntas sin mirar, contrastar con la síntesis, luego la teoría) y `[[INDICE]]`.
2. `## De dónde partes`: diagnóstico de 6-8 preguntas con hueco `[[2]]`; «respuestas en la p. X» (las respuestas van en un h2 del final, `## Respuestas del diagnóstico`).
3. **3-5 bloques**. Cada uno:
   - `# Bloque N. Tema`: «Qué buscar» (caja `box`, 4-7 puntos) y la **teoría** en h3: intuición primero, luego lo formal, ejemplos numéricos trabajados paso a paso; en ML, las matemáticas necesarias sin saltos. Cita la fuente en cada afirmación relevante: `[Huyen, *AI Engineering*, cap. 6]{.cita}`. Normalmente 2-4 páginas.
   - `## Síntesis del bloque N`: lista con [ESENCIAL]/[SECUNDARIO]; caja `esqueleto` (los pasos EN ORDEN para montar la respuesta a la pregunta de entrevista del bloque, cada paso con su porqué); caja `s60` con un ejemplo resuelto de 60 s (la pregunta y la respuesta hablada, en primera persona).
   - `## Preguntas para recordar del bloque N`: 6-8 preguntas, solo de lo visto en ESE bloque, dentro de `::: preg`, cada una seguida de `[[3]]`. Llena ~2/3 de página.
   - `## Aplícalo del bloque N`: 3-4 preguntas de transferencia con escenarios nuevos («diseña», «qué harías si», «encuentra el fallo», «contesta en 60 s», «haz la cuenta»), dentro de `::: preg`, cada una con `[[6]]`. Llena una página.
   - `## Respuestas del bloque N`: respuestas breves a las de recordar y respuestas modelo de Aplícalo (decisión concreta, alternativa descartada y por qué, cita).
4. `## Respuestas del diagnóstico y bibliografía` al final (bibliografía como `### Bibliografía` dentro, para no dejar una página casi vacía) (libro, capítulo o sección; URLs solo si existen y las has verificado).
5. Total: 18-28 páginas A4 (las páginas de preguntas son de escribir). Con 3 bloques salen ~22; con 4, ~28. Ficha de referencia ya validada: `_src/A1/ficha.md` (léela para copiar la forma, no el contenido).

## Estilo
Español de España, directo, sin relleno ni tono de clase de venta. Términos técnicos en inglés con la traducción entre paréntesis la primera vez: «prefill (prellenado)». Sin «—». No inventes citas, páginas ni URLs: si no lo has comprobado en el texto, cita solo libro y capítulo que hayas visto en el índice del PDF.

## Respuesta fantasma (fichas generales de teoría, 2-nov-2026)
```
1. Pregunta de repaso.

   ::: fantasma
   Respuesta razonada, con el porqué. Se imprime en gris claro sobre renglones; queda un renglón libre debajo.
   :::
```
Reglas en `~/workspace/roadmap-ai-engineer/REGLAS-FICHA-GENERAL.md`.
