# Estilo «ficha práctica» del libro (como la E12 de evals)

El libro se lee y se construye: visualmente y en la forma de explicar se parece a la ficha práctica «Un eval es un pipeline, no un script» (E12). El motor es el mismo que el de las fichas (`build_win.py`), con la hoja `practica.css` (`construir.py` la activa sola).

## Cómo se ve y cómo se explica

- **Una idea por página.** Cada `##` abre página nueva, con una **etiqueta pequeña** encima del título. **Los títulos son descriptivos y sobrios**, dicen de qué va la página: «El adaptador del modelo», «Streaming con SSE en FastAPI», «Índices en Postgres». Nada de títulos llamativos ni frases ingeniosas (decisión de Carlos). Una página que necesita más espacio sigue en la siguiente sin problema.
- **Prosa corta y directa, en segunda persona**, con el porqué de cada cosa. Frases de una idea. Nada de relleno ni de metatexto.
- **Tablas finas** para comparar o mapear (pieza, qué recibe, qué devuelve; opción, a favor, en contra). Máximo unas 4 columnas.
- **Cajas negras numeradas** para secuencias o piezas (de 3 a 6).
- **Aviso amarillo** para «fíjate en esto»: lo que se escapa, el matiz, la trampa.
- **Una frase enmarcada al final de cada página**, la idea que te llevas («Un número sin su receta no se puede comparar con nada»). No en todas a la fuerza: donde haya una idea que merezca quedarse.
- **Capítulos que abren con una página negra**: título grande, un párrafo que plantea la pregunta del capítulo, el número del capítulo en grande y, si encaja, «Con qué saldrás».

## Tres tipos de página, cada uno con su color (decisión de Carlos)

Carlos tiene que saber en todo momento dónde está: en el índice y en cada página se ve si es planteamiento, teoría o práctica. Cada página va dentro de su bloque y su etiqueta empieza por el tipo.

1. **Planteamiento** (azul, `::: planteamiento`, etiqueta «Problema · …»): qué funciona ya, qué falta, la pregunta, las opciones y lo que implica cada una, y `::: decide`. Corto.
2. **Teoría** (amarillo, `::: teoria`, etiqueta «Teoría · …»): lo que hace falta entender para resolverlo, con la densidad de las fichas generales: prosa que razona, fórmulas, cuentas trabajadas, tablas, `###`, todos los conceptos del temario que toquen. Ocupa lo que haga falta.
3. **Práctica** (verde, `::: practica`, etiqueta «Práctica · …»): resolverlo, de forma muy concreta y siempre con esta secuencia:
   - «Para resolver esto tenemos que:» y la lista de pasos (cajas numeradas o lista).
   - Por cada paso: `::: pide` (cómo se lo pides a Claude, el texto o el contrato exacto), `::: construye` (qué tienes que tener al acabar el paso: ficheros, endpoint, tabla, componente), `::: prueba` (el comando o la acción y qué tiene que salir o verse) y, cuando toque, `::: dime` (qué me cuentas para comparar: la salida, el número, la decisión que tomaste).
   - Pistas plegadas si hacen falta y la frase final.

4. **Referencia** (gris, `::: referencia`, etiqueta «Referencia · …»): lo que se consulta, no se lee de corrido: cómo leer el libro, el mapa del repo, el contrato de referencia, la página de arranque, el registro de decisiones y la cobertura.

El ritmo habitual de un tema: planteamiento → teoría → práctica. No es un molde rígido (hay temas con varias páginas de teoría seguidas o con dos prácticas), pero cada página es de un solo tipo y lo dice. La teoría del libro es la necesaria para construir y entender, completa; las fichas generales siguen siendo el material de repaso.

## Convenciones del markdown

```
::: capitulo
# 3. Una interfaz que habla con un modelo
Párrafo que plantea la pregunta del capítulo: qué funciona ya y qué falta.
[Con qué saldrás: …]{.salir}
[3]{.num}
:::

## Cada pieza habla con la siguiente por un contrato fijo {etq="Los contratos"}
Texto de la página…

::: cajas
::: caja
**Banco**
los casos y sus respuestas buenas
:::
::: caja
**Sistema**
lo que mides: entra un caso, sale una respuesta
:::
:::

::: rejilla
::: marco
**Para entender**
Páginas 3 a 5…
:::
::: marco
**Para montar**
Página 22…
:::
:::

::: aviso
**Fíjate en el None de la fila 2**
Cuando el modelo no devuelve un JSON legible…
:::

::: decide
Qué decides aquí, con las opciones y el criterio. La decisión es de Carlos; apúntala como ADR.
:::

::: pide
Lo que le pides a Claude: el contrato exacto (qué entra, qué sale, con qué librería y cómo se prueba).
:::

::: frase
Si para cambiar una pieza tienes que tocar otra, el contrato está mal dibujado.
:::

::: planteamiento
## Cómo combinar la búsqueda léxica y la densa {etq="Problema · Recuperación"}
Qué funciona, qué falla, las opciones.
::: decide
…
:::
:::

::: teoria
## Fusión por puntuaciones y por rangos {etq="Teoría · RAG"}
Prosa que razona, con su cuenta trabajada…

### RRF
…
:::

::: practica
## Montar el retriever híbrido {etq="Práctica · Recuperación"}
Para resolver esto tenemos que: 1) …, 2) …, 3) ….
::: pide
«…»
:::
::: construye
…
:::
::: prueba
`comando` y qué tiene que salir.
:::
::: dime
El recall@5 que te ha salido y si mantienes el híbrido.
:::
:::
```

- `{etq="…"}` en un `##` pone la etiqueta pequeña encima del título. Úsala siempre en los `##`.
- `{.nb}` en un `##` evita el salto de página (para dos ideas cortas en la misma página).
- Siguen valiendo `::: box`, `::: ok`, `::: esqueleto`, `::: s60`, `::: fantasma`, `::: keep`, `[texto]{.cita}`, `[[3]]` (líneas para escribir), `- [ ]` (casillas) y KaTeX (`$…$`, `$$…$$`), como en `GUIA.md`.
- Bloques de código con ``` y líneas de menos de 90 caracteres.
- Sin emojis ni caracteres fuera del Unicode básico. Sin el carácter «—».

## Reglas de construcción (línea dura, revisión de Carlos del 2-nov-2026)

La separación por tipos y colores es definitiva. Además, cada parte cumple esto:

**Navegación**
- **Etiquetas temáticas** en cada `##`, además del tipo: `tags="Backend, IA"`. Vocabulario corto y repetido en todo el libro: IA, RAG, Evals, Prompt, Agentes, Datos, Bases de datos, Backend, Frontend, Arquitectura, Infra, Seguridad, Observabilidad, ML, Aprendizaje.
- **Mapa del repo**: la parte empieza con el árbol de carpetas de lo que habrá al final de la parte y una tabla «qué vive dónde». Cada capítulo cierra con un árbol pequeño con lo nuevo marcado (`# nuevo`). Nombres sin ambigüedad (nada de dos cosas llamadas igual).
- **Página de arranque** (práctica) cuando la parte añade procesos: qué terminales, qué puertos, el `.env` de ejemplo y una chuleta de órdenes.
- **Página de contrato de referencia** cuando hay interfaces entre piezas (eventos SSE, rutas, esquemas JSON): el formato exacto en un solo sitio, y que todo lo demás coincida con él.
- **Cierre en todos los capítulos** con `::: funciona` (qué funciona al acabar). **Registro de decisiones** al final de cada parte: tabla con cada decisión (ADR), qué se eligió y dónde queda escrita.
- **Tiempo y cortes**: cada práctica lleva `[2 sesiones de 1 h. Para al acabar el paso 2.]{.sesion}`.

**Del planteamiento a la práctica**
- Tras cada `::: decide`, un `::: entonces` («Entonces nos falta»): lo que la decisión obliga a construir y por qué, en el orden en que vendrá. Es el índice del tramo siguiente.
- Intercalar: no más de 3 o 4 páginas de teoría seguidas sin una práctica; construir algo cada sesión.
- Diagramas (ASCII en bloque de código) para lo que tiene secuencia o varios actores: flujos de cancelación, rutas con transacciones, grafos.

**Cada práctica**
- «Para resolver esto tenemos que:» y la lista de pasos, **cada paso con su media frase de porqué** («2. Añadir el motor falso, para que el paso 3 y las pruebas no dependan del modelo»).
- `::: pide` como **lista numerada de requisitos** o mini contrato (entra, sale, restricciones, cómo se prueba), nunca un párrafo largo: Carlos la repasa punto por punto contra el código que devuelve Claude.
- `::: construye`, `::: prueba` con **`**Orden**`** (bloque de código) y **`**Debe salir**`** separados, `::: revisa` (qué mirar en el código: caja fija en cada paso) y `::: dime`.
- **Commit** al acabar cada práctica, con su mensaje exacto (punto de retorno si algo sale mal).
- Por capítulo, una tabla **«Si ves esto, es esto»** (síntoma, causa, arreglo).
- Cuando se remite a un repo de Carlos («lee manual/backend.py»), decir **qué buscar** en él.

**Trabajar con Claude**
- La primera práctica del libro crea el **`CLAUDE.md` del proyecto** (stack, regla de dependencias entre capas, nombres en castellano, nada de llamadas bloqueantes, cómo se prueba), y cada parte que añade convenciones lo amplía. Así las cajas `pide` son cortas y el código es coherente entre capítulos.

## Nombres que fija la Parte I (todas las partes los usan igual)

La Parte I manda en los nombres del repo: la carpeta del proyecto Python es `servidor/` (con el paquete `tutor/` dentro y el subpaquete de rutas `tutor/api/`), la del cliente es `web/`, y las convenciones están en el `CLAUDE.md` del proyecto. Antes de nombrar una carpeta, fichero, ruta o evento, mira el mapa del repo y el contrato de la v0.1 en `partes/01-arrancar.md` («Mapa del repo de la v0.1», «Contrato de la v0.1») y síguelos.
