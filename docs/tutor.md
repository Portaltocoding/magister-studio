# El tutor: diseño de producto

Decidido con Carlos el 7-nov-2026 en conversación. Las propuestas del panel son de Claude y están sin decidir. Este documento completa y en parte revisa `docs/discovery.md`: donde lo contradice, lo dice y lo deja para que Carlos lo apruebe.

**Cómo leerlo.** Las tablas «Aspecto | Decisión» son lo **decidido**: las nueve decisiones del 7-nov y lo que ya estaba en `discovery.md`. Las listas «Propuesto» son ideas del asistente y del panel (cuatro lentes, cada una con su crítica adversaria). Cuando la crítica pidió un cambio, la propuesta ya lo incorpora. Cada propuesta lleva su coste en suscripción (nulo, bajo o medio) y la parte del libro donde cae. Las ideas que «ya estaban sobre la mesa» (aceptadas en principio o sin discutir) se tratan como propuestas, no como decisiones.

**Términos.** *Ficha*, en este documento, es lo que dice la decisión 8: una tarjeta o pregunta de repaso con fecha. En el borrador de la Parte IV, «ficha» es la hoja Markdown de una lección (`materiales.tipo = ficha`) y lo que entra en el repaso son filas de `preguntas`. En código, un deber apunta a `preguntas`. Fijado con Carlos (13.1): la hoja de la Parte IV se llama «apuntes». *Camino* es un plan de la Parte II. *Sesión* es una sesión de estudio, no la tabla `sesiones` del calendario (ADR-0006 del libro).

## 1. Qué es el tutor

Un profesor particular de verdad, como los de después de clase, dentro de Magister. Prepara la clase desde tus fuentes, te lleva, te conoce y te aprieta o te apoya según lo pactado. Lo que más vale para Carlos es delegar el peso mental de decidir qué hacer.

| Aspecto | Decisión |
|---|---|
| Quién | Una sola persona con nombre y carácter. No hay un tutor dentro del tutor ni una variante agente con otro nombre |
| Modos | Dos. «Estudio libre» es la primera pantalla y la que se abre por defecto: preguntas lo que quieres y tú decides. «Tutor» es dejarse llevar: entras y el profesor te lleva |
| Tono | Seguro. La seguridad sale de que la lección está preparada desde tus fuentes antes de la sesión, no de admitir ignorancia |
| Apoyo y presión | Puede apretar y apoyar «a tope», según qué tipo de alumno eres y tus manías |
| Observador | El tutor observa en todos los modos, también en Estudio libre, con las reglas de la sección 2 |
| Para quién | Carlos y terceros. Cada instalación es de una persona (`discovery.md`) |
| Ambición | «El Spotify del aprender»: que se abra cada día sin fricción y que se confíe en él |

### Cómo conviven Estudio libre, Tutor y «Hoy»

`discovery.md` dice que la entrada es la pestaña Tutor, con una configuración corta la primera vez, «Continuar donde lo dejaste» o «Nueva sesión», y que desde Hoy se abre ya configurada. La decisión 1 pone Estudio libre delante. Propuesta para que las tres cosas no choquen:

**«Hoy» es una tarjeta, no una pantalla** (coste nulo · Partes I, II y V). La misma tarjeta encabeza Estudio libre y la pestaña Tutor: «Hoy: derivadas · 25 min · ¿Vamos?», con una razón de una línea (sección 3), una fila con los otros caminos abiertos para cambiar con un toque y «hoy nada». Pulsar abre Tutor ya configurado, sin preguntas.

| Estado de la tarjeta | Cuándo | Qué ofrece |
|---|---|---|
| Continuar | Hay una sesión a medias | «Continuar: regla de la cadena, párrafo 12». Los minutos restantes solo aparecen si hay ritmo medido del alumno |
| Propuesta | Caso normal | Tema, duración y razón; alternativas con un toque |
| Hora mala | La hora cae en la hora mala del perfil | Propone repaso primero; lo nuevo queda a un toque en la fila de caminos, sin bloquearlo |
| Sin preparar | La lección de hoy no está preparada | Lo dice con seguridad y propone lo que sí está listo (sección 7) |
| Primer día | No hay perfil | La configuración corta de `discovery.md` (sección 5, «Pacto») |

- «Continuar donde lo dejaste» y «Nueva sesión» pasan a ser estados de la tarjeta. La tarjeta no muestra nunca atraso ni un número mayor que la capacidad del día.
- Se calcula sin modelo en cada petición, con `GET /api/hoy`, desde el calendario, las preguntas vencidas, los deberes y el perfil. Es una función pura con tests y sin tabla de caché. Comprobación: al abrir en frío, la tarjeta aparece con cero llamadas al modelo en las trazas.
- En `web/src/modos.ts`, la conversación de la v0.1 ya es estudio libre. Propuesta: renombrar ya el modo actual a «Estudio libre» (id `libre`, encendido) y añadir `tutor` apagado hasta la v0.5.

**La cara del tutor** (coste nulo · Partes I y V). La mascota de `Mascota.tsx` puede ser la cara del tutor con cuatro estados ligados al estado de la página, sin modelo: reposo, escucha (campo con foco), piensa (flujo SSE abierto, que tapa los 6,74 s hasta el primer trozo) y espera (pregunta pendiente). Ningún estado es emocional («asiente», «triste») y ninguno está ligado a la ausencia. Sigue con `aria-hidden` y el mismo estado aparece como texto. Hay un interruptor «sin cara». Opcional: ojos cerrados mientras «esto no cuenta» está activo (pendiente 13.4).

## 2. Reglas del observador y del perfil

| Aspecto | Decisión |
|---|---|
| Procedencia | Cada dato guarda internamente su modo, su tema y su sesión, para poder borrarlo, depurarlo y enseñarlo en el perfil |
| En la conversación | El tutor usa patrones sin decir de dónde vienen |
| Temas de fuera | No saca temas de fuera de la sesión actual. Si estudias matemáticas con el tutor y electrónica por tu cuenta, no te echa en cara ni te propone electrónica. Sí usa los patrones generales sobre la persona («te saltas el signo», «te rindes si no ves el resultado enseguida») |
| Cuándo salen | Los fallos de electrónica salen cuando entras en electrónica con el tutor, incluidos los fallos anteriores de Estudio libre de ese tema, salvo los marcados como «esto no cuenta» |
| Forma | Nunca como reproche: propone, no señala |
| Interruptor | En Estudio libre, «esto no cuenta para el tutor», para explorar o equivocarse a propósito sin falsear el perfil |
| Perfil | El origen de un patrón no se dice en la conversación, pero se ve en el perfil, que es visible, discutible («esto no es verdad» y se corrige) y borrable (P3) |

### Propuesto

**El filtro es código, no una instrucción** (coste nulo · Partes II, V y VI). Lo que el tutor sabe en una sesión se construye sin modelo desde una lista cerrada: el bloque preparado, los patrones del tema de la sesión, las estrategias generales activas sin su origen, los resúmenes de cierre del mismo tema y las rectificaciones pendientes. Nunca entran la evidencia, los recuentos, la fuente ni el modo, ni conceptos de otro tema. Un modelo no puede revelar lo que no recibe.
- Arquitectura: el filtro por ámbito va en la consulta de datos; `api` pasa a `cerebro` estructuras planas y `construir_contexto` es una función pura en `cerebro` que no importa de `datos` (regla de `CLAUDE.md`).
- Lint sin modelo: el enunciado de un patrón de persona no puede contener nombres de conceptos de ningún plan («te saltas el signo en Kirchhoff» saca el tema por la puerta de atrás).
- Canario: una palabra inventada en el perfil de electrónica; cero apariciones en el contexto de cualquier sesión de matemáticas. Es un test en `servidor/tests`.
- El alumno puede ver «Qué ha visto el tutor» en el detalle de la sesión, no en cada turno. El contexto enviado se guarda con el turno, como necesita la Parte VI.
- Cambia una consecuencia de ADR-0001 («el historial se reenvía entero»): en Tutor se envía lo pertinente. Hace falta un ADR nuevo.

**El origen se oculta solo cuando viene de otro sitio** (coste nulo · Parte V). La decisión 4 protege lo observado en otros modos o temas. Lo que sale del calendario, del modelo de olvido o de los deberes del mismo tema se dice («toca derivadas porque se te están olvidando»). El cierre de `discovery.md` ya enseña los fallos que van al repaso.

**Patrones con recibo, nunca etiquetas** (coste bajo · Parte V). En el perfil, un patrón tiene una sola forma: «Cuando [situación], [conducta]. Visto N veces desde [fecha]. Estrategia: […]». En la conversación solo se usa la estrategia, sin recuento ni fecha. Nunca «eres impaciente» ni «adicto a los reels» en boca del tutor. Su identidad es un detector de un catálogo cerrado (ventana de atención, fugas, reacción al fallo, hora, manía de método, error de materia) más su ámbito (persona o tema). El texto lo puede redactar el modelo en segundo plano, pero el lint rechaza adjetivos de persona y diagnósticos. Un patrón no existe hasta reunir varias observaciones en varias sesiones (umbral: criterio general). El alumno puede reescribirlo con sus palabras y el tutor usa su versión. En el perfil, la sección «Cómo te adapta el tutor» enlaza cada estrategia con su patrón y su procedencia. No hay «¿por qué?» junto a las adaptaciones dentro de la sesión.

**«Esto no es verdad» con tres salidas** (coste nulo · Parte V).

| Salida | Qué pasa |
|---|---|
| Borrar | Se eliminan el patrón y su evidencia. Queda solo una clave de veto sin datos (detector y ámbito), visible y borrable como «descartados por ti». Si después aparece evidencia nueva, no se reactiva solo: el perfil pregunta «¿lo vuelvo a tener en cuenta?» |
| Corregir | El alumno reescribe el texto y el tutor usa esa versión |
| Es verdad, pero no lo uses | Sigue en el perfil y no entra en el contexto (`usar_en_contexto = false`) |

En la conversación, el botón «eso no es así» saca el patrón del contexto desde el turno siguiente y el tutor contesta con una frase fija, sin modelo: «vale, lo quito; lo tienes en tu perfil». El tutor nunca discute con sus datos.

**Lo que se observa, a la vista y con interruptor** (coste nulo · Parte V y `web/`). Un panel «Qué observa el tutor» con un sensor por fila: qué mide, para qué y qué deja de funcionar si se apaga («sin tiempo por párrafo no te paro si vuelas»). Apagado significa que no se guarda, no que se guarda y se oculta. El sensor de la pestaña se pacta de forma explícita. El tutor nunca recita recuentos («te has ido cuatro veces»); el lint lo vigila y excluye la cuenta atrás de la sesión.

**El interruptor, por momento y hacia atrás** (coste nulo · Partes I y V).
- «Esto no cuenta» es una marca por momento (`cuenta`), no por modo: el campo `origen` no basta.
- Hacia atrás: bajo el resumen de cierre hay un enlace discreto, «no me tengas en cuenta lo de hoy»: en Estudio libre siempre; en Tutor solo si Carlos lo aprueba (pendiente 13.2). Afecta solo a la capa «cómo eres estudiando»; el dominio y las fichas se quedan y se borran a mano si se quiere.
- «Esa semana no cuenta»: desde el perfil, un rango de fechas con un motivo opcional (`exclusiones`). Las dimensiones y las evidencias lo filtran; el modelo de olvido sigue contando, porque el olvido no se toma vacaciones. Comprobación: con una exclusión, cada dimensión vale lo mismo que si esas filas no existieran.
- Lo generado al construir no cuenta: todo lo que se crea con `MAGISTER_MOTOR=eco` o con `MAGISTER_PERFIL_CUENTA=false` nace con `cuenta = false`, y el perfil enseña cuántas filas se excluyeron así. Carlos construye y estudia en la misma máquina. Test: con el motor eco, ninguna dimensión cambia.
- Si el interruptor existe también en Tutor queda para Carlos (pendiente 13.2).

**Borrar todo** (coste nulo · Partes V y VI). Un botón «borrar todo lo que sabes de mí» que vacía las dos capas del perfil, y una exportación del perfil. Es la forma completa de P3.

## 3. La sesión

| Aspecto | Decisión |
|---|---|
| Alcance | Frente al roadmap entero o frente a una lección (`discovery.md`) |
| Entrada | El tutor propone qué toca («hoy toca derivadas, 25 min, ¿vamos?») y puedes cambiar de tema con un toque. No hay un botón único que elimine la elección |
| Varios caminos | Con varios caminos abiertos a la vez, el tutor reparte el calendario entre ellos |
| Ajustes | Tema o lección, duración y nivel de profundidad; lo demás sale del perfil (`discovery.md`) |
| Bloques | Del plan: la lección viene partida en ideas; el tutor las afina con tus fuentes y puedes reordenar o quitar |
| Secuencia por bloque | Explica con tus fuentes, comprueba (pregunta socrática o «explícamelo tú») y sigue |
| Modos de explicación | Cambiar de explicación si no lo pillas (analogía, ejemplo, formal, ejercicio), destilar conceptos y diagramas |
| Comprobación | Si fallas te lo dice; puedes saltar y queda marcado para repasar |
| Interacción | Botones rápidos («no lo pillo», «otro ejemplo», «más despacio», «siguiente»), pizarra en la zona central y «marcar para repasar» |
| Presión | Varía por momento: tres fallos seguidos → apoyo; vas sobrado → aprieta |
| Cierre | Resumen de 3 líneas (qué viste, qué costó, qué toca), fallos al repaso espaciado y oferta de fichas o vídeo |

Ya sobre la mesa y sin decidir: sesiones con duración declarada («tengo 20 minutos»), pistas por niveles (pregunta → señal → primer paso; nunca la solución si no se pide), aparcar preguntas fuera de tema («lo vemos al final»), saber callarse mientras resuelves, repaso disfrazado (conceptos viejos intercalados), «hoy no» con un toque, el plan de la sesión visible y el cierre explícito. Abajo se refinan.

Parte de VanLehn (2011): un tutor que corrige por pasos se acerca al tutor humano y uno que solo mira la respuesta final se queda muy por debajo. Casi todo lo que sigue son reglas de secuencia que caben en un grafo fijo y no gastan modelo.

### Propuesto: entrar y saber por qué

**Por qué hoy toca esto** (coste nulo · Partes II y V). La propuesta del día lleva una sola razón calculada sin modelo desde el plan, el modelo de olvido, la fecha objetivo, los deberes y el reparto entre caminos: «las de la semana pasada están a punto de olvidarse y el simulacro es el 20». De un toque enseña los dos o tres datos que la producen. Nadie delega en algo que decide sin explicarse. Comprobación: la razón coincide con los datos guardados (test sobre una función pura). La tasa de aceptación de la primera propuesta se registra como métrica, no como puerta.

**Reparto pactado entre caminos** (coste nulo · Parte II y «Reajustar el calendario» de la Parte V). Hoy cada plan de la Parte II reserva las mismas `horas_por_dia` sin saber de los demás. Al abrir un segundo camino, el tutor propone un reparto del tiempo semanal (calculado sin modelo con las fechas objetivo y lo que falta de cada plan) y el alumno puede cambiarlo con un toque. Calendarizar y reajustar respetan el reparto y la propuesta del día pone primero el camino más por debajo de su parte. Comprobación: con dos planes, la suma diaria no pasa de `horas_por_dia` y el reparto semanal queda dentro de una tolerancia (criterio general).

**Plan de la sesión visible y nada cambia en silencio** (coste nulo · Partes II y V). Arriba, lo de hoy («tres cosas») con lo que queda. Cada recolocación del plan o del calendario guarda su motivo (`cambios_plan`). La sesión siguiente lo enseña en una línea («1 cambio desde ayer») y el motivo al pulsar; solo se dice en voz alta si afecta a lo de hoy.

**Puntualidad** (coste nulo · Parte V). La duración declarada es una promesa. El grafo mira el reloj antes de cada bloque y no abre una idea nueva si no cabe (umbral: criterio general). Al llegar la hora cierra. El tutor ofrece «5 minutos más» (criterio general) una vez como mucho; el alumno puede alargar cuanto quiera sin que se le vuelva a preguntar.

### Propuesto: apertura

**Arranque de recuerdo** (coste bajo · Parte V, primer nodo del grafo de sesión). Si hay una sesión anterior en el mismo camino, el tutor ofrece una o dos preguntas de recuerdo (criterio general) antes de explicar, en este orden: lo turbio del último cierre, los deberes fallados y lo más olvidado. El tutor no resume la sesión anterior: la resumes tú contestando (Rosenshine, 2012; Roediger y Karpicke, 2006).
- Tras una ausencia más larga que un umbral (criterio general), elige los ítems con mayor recuerdo previsto, para empezar con un acierto. Es el «retorno de los flojos».
- Se salta con un toque y el salto se guarda.
- Si fallan al menos dos ítems que se daban por retenidos (criterio general), el tutor propone en una línea: «hoy mejor afianzamos lo del martes y lo nuevo pasa a mañana, ¿vale?». Nunca lo cambia sin decirlo.
- No gasta modelo con ítems cerrados y cubre la espera si la preparación se lanza al entrar (sección 7).
- La regla de evaluación es «ofrece recuerdo antes de explicar», no «obliga».

**Pregunta previa y antes y después** (coste bajo · Partes IV y V). Une dos propuestas. Antes de explicar una idea conceptual que el plan marque como «intuible», el tutor pregunta «¿tú qué dirías?» con opciones y «ni idea» como opción válida; la explicación llega justo después pase lo que pase (Kornell, Hays y Bjork, 2009). Como mucho en una de cada dos ideas (criterio general), nunca en procedimientos y no con perfiles que se rinden pronto hasta que lo observado lo permita. Sus datos no entran en el dominio ni en la calibración; solo pueden subir la prioridad de la ficha. Al cerrar la lección, la misma pregunta vuelve, se corrige con el corrector de la Parte V y el alumno ve su respuesta de antes junto a la de ahora. No hay ningún contador nuevo en P9. La respuesta antigua se puede borrar (P3). En la lectura guiada no se dispara sola.

### Propuesto: explicar y comprobar

**Escalera por idea** (coste bajo · Partes IV y V). Une el termostato de dificultad, los ejemplos resueltos que se desvanecen y el desvanecimiento del andamiaje en un solo regulador: un `escalon` por idea que persiste entre sesiones.

| Escalón | Qué ves |
|---|---|
| 1 | Ejemplo resuelto entero, con una nota en el paso donde la gente tropieza, redactada en general («aquí es fácil perder el signo») |
| 2 | El mismo tipo de ejemplo con los últimos pasos en blanco (desvanecimiento hacia atrás, Renkl y Atkinson, 2003) |
| 3 | Desde cero, como ejercicio por pasos |
| 4 | Variante dura |

- Sube tras aciertos limpios seguidos y baja tras un tropiezo o al pedir la segunda pista (umbrales: criterio general). Se calcula con las últimas filas de intentos de esa idea, sin modelo.
- El escalón de salida de una idea nueva lo da el dominio de las ideas previas del mismo camino; «apriétame» lo sube uno.
- Solo para ideas que el plan marque como «procedimiento». Los pasos en blanco se contestan con número u opciones. Las expresiones libres («3x^2» frente a «x²·3») necesitan una herramienta de equivalencia simbólica, que sería una dependencia nueva que hay que comunicar; mientras no se elija, se usan opciones.
- La preparación solo genera el escalón actual y el siguiente.
- La dificultad declarada de cada ítem se corrige con su tasa de acierto observada cuando hay datos suficientes (criterio general).
- El andamio se desvanece por selección (servir la versión de una línea o la de un párrafo ya preparadas), no pidiendo brevedad al modelo. La proporción de palabras del tutor frente a las del alumno por sesión se mide como métrica, no como puerta.

**Ejercicio por pasos con corrección en el primer paso que se desvía** (coste nulo o bajo · Partes IV y V). En el escalón 3 escribes o eliges un paso cada vez, en la pizarra o en la conversación. Cada paso se compara con la solución preparada (la misma lista de `pasos` del ejemplo resuelto) y el tutor interviene en el primer paso que se desvía y lo nombra («el paso 3 pierde el signo»). Solo si el paso no coincide con nada conocido entra el juez. Es la retroalimentación por paso de VanLehn. Comprobación: con el error en el paso 3, la corrección llega en el paso 3.

**Distractores con diagnóstico** (coste bajo · Partes IV y V). Cada opción equivocada de una pregunta cerrada corresponde a un error con nombre («confunde índice con clave»), como en los inventarios de conceptos y las preguntas bisagra de Wiliam (2011). Elegirla es una búsqueda sin modelo y el tutor responde a ese error, no a «mal».
- Un error pasa a «detectado» tras dos apariciones (criterio general) y enseña qué pregunta y qué opción lo produjeron.
- Si el error es «confundo A con B» y los dos conceptos son del mismo camino, la sesión siguiente los intercala (Rohrer y Taylor, 2007). Si son de caminos distintos, la pareja queda como candidata a sorpresa controlada con permiso (sección 8).
- Antes de que un error generado pueda pasar a «detectado», la eval de «Fichas y preguntas» gana un juez sí/no, «el distractor corresponde al error que dice», calibrado con etiquetas de Carlos.

**El gemelo** (coste bajo · Partes IV y V). Ningún error cierra sin un segundo intento limpio. Tras un fallo, minutos después y tras otra cosa, aparece un gemelo: el mismo paso con otra superficie. Si lo sacas, el error pasa a «en trabajo». Si no, llega la explicación de reserva ya preparada y luego se sigue, marcado para repasar.
- En ítems con números, el gemelo sale de una plantilla con parámetros, sin modelo; en los conceptuales, la preparación hace uno.
- Si no cabe antes del cierre, el gemelo se convierte en el deber del siguiente hueco (sección 4).
- La regla de evaluación es «ningún error cierra sin gemelo, en la sesión o como deber, o en el arranque de la sesión siguiente si no hay hueco (absorbido), salvo si el alumno salta».

**Termómetro de confianza** (coste nulo · Parte V). Antes de cada respuesta, el alumno marca «seguro», «dudo» o «ni idea» con un toque. Alimenta `intentos.confianza`, la dimensión de calibración (sección 5) y «¿Y por qué?».

**«¿Y por qué?» sobre los aciertos** (coste nulo · Partes IV y V). Un acierto marcado «dudo» y una muestra de los marcados «seguro» (una de cada cuatro, criterio general) piden el porqué. Se elige entre tres razones preparadas; las falsas están etiquetadas como errores. Un acierto con un porqué equivocado cuenta como error (Chi et al., 1994). Sin juez y sin espera: el porqué escrito queda para «explícamelo tú». Con un error marcado «seguro», la corrección nombra la trampa del paso sin mencionar la confianza. Usa la confianza que el borrador de la Parte V ya guarda en `intentos.confianza`.

**Preguntas de seguimiento tras «explícamelo tú»** (coste bajo · Partes IV y V). Después de tu explicación, el tutor hace una o dos preguntas preparadas, en su propia voz y con seguridad («¿y si fuera negativo?»), y luego juzga con una rúbrica `puntos_que_deben_aparecer`. No cambia de papel. El coste es la llamada de juez que «explícamelo tú» ya tenía.

**Silencio y pistas** (coste nulo · Parte V y `web/`). Tras una pregunta, el tutor no escribe nada durante `segundos_silencio` (criterio general, según el perfil: más corto para quien se rinde pronto). El botón de pista está siempre activo. Si pides pista antes del plazo, la primera es una pregunta (nivel 1), nunca un paso. No hay cuenta atrás visible. Se guardan el tiempo hasta la pista y hasta la respuesta, descontando la pestaña oculta; se decide con medianas semanales, nunca con un ítem suelto.

**Aparcar** (coste nulo · Parte V). Una pregunta fuera de tema se apunta en una lista visible («lo vemos al final») y aparece en el cierre o como pregunta de Estudio libre.

**El tutor te manda a parar** (coste nulo · Parte V). Si detecta la caída de calidad dentro de la sesión y la presión no es «aprieta», propone cerrar («lo dejamos aquí, mañana sale mejor»). Los bloques que la preparación marcó como difíciles no cuentan como caída, para no confundir dificultad con fatiga.

**Seguro en el tono, honesto en la procedencia** (coste nulo · Partes III, IV y V). En Tutor no hay coberturas verbales («creo que», «podría ser») sobre lo preparado. Solo se marca la excepción: lo que no viene de tus fuentes lleva una marca visual de «añadido»; lo demás va sin marca y se puede pulsar. El botón es «¿de dónde sale?», que es «enséñame cómo lo sabes», ya sobre la mesa: abre el párrafo guardado al instante, sin modelo. Sin fuente, el tutor dice una vez y con seguridad «esto no viene en tu libro; te lo añado yo». Esto cambia la fila «Respuesta con fuentes» del plan maestro, que hoy pide «no lo sé» (sección 11). El lint de coberturas excluye las preguntas al alumno.

**Reclamar una corrección** (coste bajo · Parte V). Junto a cada corrección hay un botón «creo que estaba bien».
- La nota queda en suspenso: no toca el dominio ni genera repasos.
- La segunda corrección es a ciegas: no sabe que hay reclamación y recibe la respuesta, la referencia y el fragmento con otro prompt. Si los dos veredictos discrepan, gana el alumno y queda marcado como dudoso.
- Si la clave estaba mal, el tutor lo dice con la misma seguridad («tienes razón, la clave estaba mal; aquí está la fuente») y el ítem se retira.
- Una reclamación perdida cuenta como el fallo original.
- Las reclamaciones son una alarma del juez. Al banco de calibración solo entran las que Carlos revisa y etiqueta.

**Elogia la jugada, no al jugador** (coste nulo · Partes IV y V). El elogio nombra la acción («has comprobado el signo antes de seguir»), nunca a la persona ni en vacío. La corrección nombra el paso, nunca a la persona (Hattie y Timperley, 2007; Mueller y Dweck, 1998). Va como instrucción del prompt y como regla de evaluación. Con streaming, el lint no puede bloquear nada en sesión. Cuánto elogio quiere cada uno (específico, mínimo o ninguno) puede ser un ajuste del pacto (pendiente 13.5).

### Propuesto: cierre

**Cierre en un gesto** (coste nulo · Parte V).
- El punto de reanudación (idea, párrafo o pregunta) se guarda en cada avance, no al cerrar. Así sobrevive a una pestaña cerrada o a un portátil apagado. Comprobación: matar la API a mitad de lectura y volver al mismo párrafo.
- El resumen de 3 líneas trae «qué costó» ya rellenado con lo observado.
- Lo turbio se marca con un toque (una idea de la lista de hoy o «nada») y es el primer ítem del arranque siguiente del mismo camino (Mosteller, 1989). Comprobación: la sesión siguiente del mismo camino trae un ítem de esa idea.
- El «ajá» («qué hizo clic», en tus palabras) es opcional y se convierte en una ficha con tu texto.
- El cierre no espera a ninguna llamada: si el resumen lo escribe el modelo, se encola. Si debe ser una plantilla sin modelo queda para Carlos (pendiente 13.6).

**Memoria con recibo** (coste nulo · Partes II y V). Cuando el tutor se refiere a una sesión de Tutor del mismo tema («como vimos el martes»), la frase enlaza con el resumen de cierre de esa sesión. Lo que no está en un resumen o en el perfil no lo «recuerda». Las referencias a patrones o a cosas que contaste («por la tarde me cuesta concentrarme») apuntan al perfil y no se enlazan en la conversación, para no revelar el origen. Se evalúa como escenario de «Sesión de tutor».

## 4. Deberes

| Aspecto | Decisión |
|---|---|
| Qué | El tutor recomienda ejercicios, pone deberes y asigna cosas, siempre según la situación |
| Dónde | Se colocan en el calendario, en el siguiente hueco declarado. Si la sesión acaba a las 22:00, no hay deberes para esa noche |
| Sin hueco | Si no hay hueco antes de la próxima sesión, no hay deberes y la sesión siguiente los absorbe |
| Unidad | La ficha (tarjeta, pregunta, un ejercicio de la Parte IV). Deberes = fichas con fecha. Se hacen en el modo Repaso. Un solo sistema con el repaso espaciado |
| Tamaño | Depende de las horas declaradas, la hora del día y el perfil |
| «Hoy nada» | Es una decisión válida |
| Preparar | «Lee estos dos párrafos antes de mañana» también es un deber |
| Moneda | Las fichas son la moneda: los deberes son fichas con fecha, la lectura guiada decide qué fichas nacen y el perfil decide cuántas y cuándo |

### Propuesto

**Huecos con hora** (coste nulo · Parte II). La decisión 5 necesita saber a qué hora acaba la sesión y cuándo es el siguiente hueco. El borrador de la Parte II guarda `sesiones` con fecha y horas, sin hora del día, y `horas_por_dia` es un vector semanal. Con eso no se puede calcular el hueco y, si cada día con horas lleva sesión, nunca habría deberes. Propuesta: el pacto añade `franjas` (`dia_semana`, `hora_inicio`, `minutos`, `etiqueta`), y el calendario de la Parte II las usa. Alternativa más barata: el deber es el bloque de repaso que «Reajustar el calendario» ya reserva primero cada día, con un tamaño ajustado al perfil; no cumple la regla de las 22:00 ni la del siguiente hueco de la decisión 5; solo valdría si Carlos cambia esa decisión. Lo elige Carlos (pendiente 13.7).

**Colocar los deberes** (coste nulo · Parte V). Lo hace un nodo del grafo, sin modelo, al cerrar.
- Candidatos, por orden: los gemelos que no cupieron, los conceptos fallados o saltados hoy, los párrafos marcados en la lectura y la cola del modelo de olvido para ese día.
- Hueco: la primera franja a partir de ahora más un margen (`MAGISTER_MARGEN_DEBERES`, criterio general) y antes de la siguiente sesión. Sin hueco, los candidatos pasan a la siguiente sesión (`absorbido`).
- Tamaño: el menor entre el hueco, la ventana de atención observada por un factor y un tope (`MAGISTER_DEBERES_MAX_MIN`); todo criterio general. En la hora mala, menos.
- Hacer un deber crea un intento de repaso espaciado: el programador aprende de él y no hay dos sistemas.
- El motivo del mismo tema se ve («porque hoy fallaste X»).
- Los «deberes de cinco minutos» (criterio general) son tarjetas sueltas para cualquier hueco.
- Tipo `preparar`: abre la lectura guiada sobre esos párrafos (pendiente 13.8).

**Reconciliar con «propone, no obliga»** (coste nulo · Partes II y V). `discovery.md` dice que el repaso es «cuando tú quieras, sin agenda impuesta; el modelo de olvido propone, no obliga». La reconciliación: los deberes se colocan igual en todos los niveles de presión (cuando hay hueco y candidatos; si no, no hay deberes). Lo que cambia con el nivel es qué pasa si no se hacen.

| Nivel de presión | Si no se hace el deber |
|---|---|
| Propone (por defecto) | Se recoloca sin mencionarlo en la conversación; el cambio queda en `cambios_plan` con su motivo y sale en la línea «N cambios desde ayer» |
| Recuerda | Se nombra una vez en la tarjeta Hoy |
| Aprieta | En la revisión semanal sale una propuesta de reajuste (función `reajustar` de la Parte V) con su diff: «sin esto, el simulacro se mueve al 24». Se acepta o no; nunca se desplaza el calendario solo |

En ningún nivel un deber se marca como fallado: los caducados pasan a `recolocado` y los vuelve a colocar el programador.

**Volver sin deuda** (coste nulo · Parte V). Tras días sin abrir, ni «87 fichas vencidas» ni contadores en rojo. El calendario se vuelve a tender desde hoy y la sesión de vuelta cabe en el tiempo declarado. Comprobación: diez días sin abrir, abrir, y la tarjeta propone una sesión que cabe en el tiempo declarado sin ningún contador de atraso.

## 5. El perfil del alumno

| Aspecto | Decisión |
|---|---|
| Capas | Dos: qué sabes (dominio por concepto, ya en el libro) y cómo eres estudiando |
| Dimensiones | Ventana de atención real (caída de calidad dentro de la sesión), fugas de la pestaña (`visibilitychange`), reacción al fallo (abandonas o insistes; nivel de pista que pides), hora buena y hora mala, manías de método (lees y no te pruebas, saltas la teoría, relees en vez de recordar), reacción a la corrección. Medibles sin modelo |
| Fuentes | Tres por dimensión, cada una con su confianza: declarado en el pacto, observado, inferido por el modelo. Si no coinciden manda lo observado, pero se ven las dos |
| Estrategias | Por patrón, no por tipos cerrados: atención corta → microsesiones, una idea por pantalla, recuperación cada dos minutos (criterio general), «usar el formato del enemigo»; se rinde pronto → pasos más pequeños y pista temprana; lee y no se prueba → pregunta antes de dejar leer; perfeccionista → intentos con tiempo cerrado; sobrado → comprobaciones duras y feedback de calibración |
| Metaobjetivos | Sobre la persona, no sobre la materia (alargar la atención dos minutos por semana (criterio general), tolerar la frustración, dejar de releer). Pactados al principio y trabajados sin anunciarlos cada sesión |
| Presión | Se pacta («apriétame»). Toma forma de estructura (siguiente paso siempre listo, compromisos semanales, consecuencias visibles en el plan), nunca de culpa, y varía por momento |

### Propuesto: dimensiones

**Empezar por tres y no añadir ninguna sin consumidor** (coste nulo · Parte V, «El estado de cada concepto», sección nueva «Cómo eres estudiando»). Cada dimensión es una función pura sobre filas, con tests sobre historiales sintéticos del simulador de la Parte V. Regla: no se añade una dimensión sin un parámetro de estrategia que la lea.

| Dimensión | Cómo se mide sin modelo | Quién la lee | Fase |
|---|---|---|---|
| Ventana de atención | Por sesión, minuto de la primera caída: el tiempo por turno dobla la mediana del primer tercio, o fallos tras aciertos, descontando los bloques difíciles de la preparación (criterio general). Valor: mediana de las últimas sesiones | Cierre anticipado, tamaño de bloque y de los deberes | Primera |
| Reacción al fallo | Tras cada fallo, qué pasa en los minutos siguientes (criterio general): reintento, pista y su nivel, salto o fin de sesión. Valor: proporciones | Pista temprana, `segundos_silencio`, tamaño del paso | Primera |
| Calibración | Confianza frente a acierto (`/api/progreso/calibracion`, ya en el borrador de la Parte V). El signo dice sobrado o inseguro | Escalera, «¿y por qué?» | Primera |
| Fugas | Inactividad con tarea pendiente (sin teclado ni puntero más de `MAGISTER_INACTIVO_S` segundos con una pregunta o un párrafo activo), con la visibilidad de la pestaña como señal secundaria (cambia la decisión 6; pendiente 13.17). Los reels se ven con la pestaña visible; tomar notas en otra ventana no es fuga. Opcional: un toque en el cierre, «¿has mirado el móvil?», como dato declarado | Microsesiones, recuperación frecuente | Después |
| Hora buena y hora mala | Por tramos horarios en la hora local de la máquina: acierto frente a la probabilidad predicha por el modelo de olvido (residuo), no acierto bruto, para quitar el efecto de la dificultad. Solo tramos con suficientes casos (criterio general); el resto, «sin datos» | Tarjeta Hoy, tamaño de los deberes | Después |
| Manías de método | Lee y no se prueba (minutos de lectura frente a comprobaciones), salta la teoría (párrafos vistos muy poco antes de pedir ejercicio), relee (↑ sobre párrafos ya entendidos) | Pregunta antes de dejar leer | Después |
| Reacción a la corrección | Desacuerdo con la nota, tiempo hasta el siguiente mensaje tras un fallo frente a tras un acierto, abandono tras corrección | Forma de la corrección | Después |

- Confianza: crece con el número de casos, por ejemplo `n / (n + k)` con `k` por dimensión (criterio general), y se reduce si las dos mitades de la ventana discrepan.
- Mando (cambia la decisión 6; pendiente 13.16): lo observado manda si su confianza pasa de `MAGISTER_CONFIANZA_MANDA` (criterio general); si no, lo declarado. Lo inferido nunca manda solo: crea patrones candidatos que solo actúan con evidencia observada o con la confirmación del alumno, y en el perfil se ven como «propuesto por el modelo».
- En el perfil, por dimensión: lo que dijiste, lo observado y lo inferido, con su número de casos y cuál manda. «Ventana de atención: dijiste 45 min; observado 22 min (14 sesiones); manda lo observado».
- Arranque en frío: las primeras semanas cada dimensión dice «sin datos todavía» y el grafo aplica las estrategias del pacto. El tutor no da a entender que ya te conoce.
- Las estrategias son un módulo de código (un diccionario por clave de patrón con su instrucción y sus parámetros), no una tabla. Los parámetros los lee el grafo y no van al prompt.

### Propuesto: errores, metaobjetivos y presión

**Errores como objetos con ciclo de vida** (coste bajo · Partes IV y V). Cada error típico («confundo índice con clave») es una entrada propia: detectado → en trabajo → superado. Nace barato, de los distractores etiquetados o del `tipo_error` del corrector de la Parte V. Un solo umbral para «saberlo» en todo el producto: dos aciertos sin pista en días distintos (criterio general) sirven para dar un concepto por dominado y un error por superado. Hay que encajarlo con los estados del modelo de olvido del borrador de la Parte V al revisarla. La retirada automática solo se aplica donde la ocasión se puede calcular (una confusión A/B: intento sobre A o sobre B). Para los demás, el resumen del mes pregunta «¿esto ya está superado?» y decide el alumno. «El mes en una página» enseña los superados.

**Dominio y % del camino** (coste nulo · Parte V). El «% del camino» sigue contando lecciones recorridas con un acierto sin pista (definición nueva que se añade a P9, sección 10): no depende de hacer el Repaso. El «dominio por concepto» exige el segundo acierto en otro día (criterio general), venga de donde venga (arranque, Repaso o Estudio libre que cuente), y puede bajar cuando el modelo de olvido da el recuerdo por debajo de su umbral. El roadmap muestra los dos estados: comprobado (anillo a medias) y dominado.

**Metaobjetivos visibles** (coste nulo · Parte V). Tabla propia, ligada a una dimensión (`dimension`, `objetivo`, `desde`, `estado`). No se anuncian en la sesión, pero se ven en el perfil con su progreso y se retiran con un toque. Trabajar algo sobre la persona sin que pueda verlo se parece a manipular.

**Dial de presión** (coste nulo · Partes II y V). Tres niveles: propone (por defecto, como `discovery.md`), recuerda y aprieta. Se cambian en el perfil y por sesión («apriétame hoy»). Bajar es un toque, sin «¿seguro?». La fecha de fin («hasta el examen del 20») es opcional, y el nivel se revisa en el contrato semanal («¿seguimos en aprieta?») en vez de caducar solo. Son dos ejes separados: el pacto (el dial, que elige el alumno) y el momento (tres fallos seguidos → apoyo; sobrado → aprieta), que el grafo regula con señales sin modelo. La presión cambia la estructura, no el tono.

**Pacto inicial** (coste bajo · Partes II y V). Hay tensión entre «pacto conversado en vez de formulario» (sobre la mesa) y la configuración corta de `discovery.md`. Propuesta: el primer día, la configuración corta de `discovery.md` (nivel, cómo prefieres que te expliquen, tiempo habitual) más la presión y las franjas, en toques. Se guarda como declarado y con confianza baja. El pacto conversado se ofrece después, cuando ya has probado («¿hablamos diez minutos (criterio general) para conocerte mejor?»), y se pasa a campos con la técnica `estructurar` de la Parte II (tabla `pacto`: `campo`, `valor`, `texto_origen`, `acordado_en`). Una sola frase de las reglas de la casa («hay cosas que no voy a hacer nunca; las tienes en tu perfil») y una línea sobre la dificultad deseable: «si te cuesta, es que está funcionando». La gente toma el esfuerzo por señal de que no aprende (Kirk-Johnson, Galla y Fraundorf, 2019). Decide Carlos (pendiente 13.9).

## 6. Lectura guiada

| Aspecto | Decisión |
|---|---|
| Qué | Un documento (una fuente del alumno o una lección generada) con un párrafo iluminado y el resto atenuado |
| Teclas | ↓/↑ siguiente y anterior; Enter «explícamelo»; Espacio «entendido, sigue»; ? «pregúntame»; E «lo explico yo» y el tutor juzga; una tecla para cambiar el grano (párrafo, sección, tema) |
| Preparación | El tutor se lo ha leído antes y responde al instante |
| Qué alimenta | Los párrafos donde pides ayuda o marcas «no lo entiendo» son los primeros en convertirse en fichas; el tiempo por párrafo es señal de atención |
| Ritmo | Si vuelas, te para con una comprobación; si te arrastras, ofrece ayuda |
| Final | Preguntas solo sobre lo marcado como entendido |
| Voz | En Hablar, lo mismo por voz |
| Componente | Es el mismo componente que el feed de una idea por pantalla para la atención corta |

### Propuesto

Enter sirve la explicación preparada del párrafo, sin modelo (sección 7).

**Párrafos con dirección estable** (coste nulo · Parte III). Cada párrafo se referencia por `(version_id, inicio, fin)` sobre el texto limpio de la versión de la fuente. Los fragmentos del troceador de la Parte III tienen tamaño y solape configurables, no coinciden con párrafos y cambian si se cambia la configuración. `fragmento_id` se usa solo para citar.

**Ritmo relativo a ti** (coste nulo · Parte V). Tiempo por cada cien palabras frente a tu mediana en la sesión y en el histórico. Vuelas si baja de `a ×` la mediana y te arrastras si pasa de `b ×` (a y b, criterio general, visibles en el perfil). Vuelas varios párrafos seguidos → una comprobación ya preparada para ese párrafo, sin llamada. Te arrastras → se ofrece «explícamelo», sin llamada hasta que pulsas. Sin datos tuyos no se dispara nada.

**Qué fichas nacen** (coste nulo · Partes IV y V). Prioridad por párrafo = 3·«no lo entiendo» + 2·«explícamelo» + relecturas (pesos: criterio general, visibles). La preparación siguiente convierte los primeros en fichas. Así, la lectura guiada decide qué fichas nacen.

**«Lo explico yo»** (coste bajo · Parte V). Usa el corrector de la Parte V y las preguntas de seguimiento de la sección 3. Crea un intento `tipo = lectura` (en el borrador, `pregunta_id` tendrá que admitir nulos o crear una pregunta por párrafo). El modelo de olvido sigue usando solo los intentos de repaso espaciado.

**Tres densidades** (coste bajo · Partes IV y V). ←/→ cambian entre una línea, un párrafo y una página de explicación. Las tres se preparan antes; cambiar es seleccionar, sin modelo. Es el mismo mecanismo que el desvanecimiento del andamiaje. Hay que vigilar cuánto engorda la preparación (sección 7).

**Pantalla estrecha y voz** (coste nulo · Partes IV y V). El feed de una idea por pantalla y el repaso funcionan bien en una ventana estrecha del navegador local. En Hablar se reutilizan los mismos eventos con `modo = hablar`. La voz de salida es local; `discovery.md` usa Piper para el vídeo y la herramienta para Hablar está sin decidir; la voz como entrada sigue siendo para después de la v1.0.

## 7. La preparación previa y el coste

| Aspecto | Decisión o dato |
|---|---|
| Coste | Cada llamada gasta la ventana de uso de la suscripción del alumno. Todo lo que se pueda contar, medir o decidir sin modelo, sin modelo. Lo pesado, en segundo plano y por lotes |
| Latencia medida (ADR-0001, `sonnet`) | `init` 1,82 s; primer trozo 6,74 s; `result` 7,51 s. Un proceso nuevo por llamada |
| Dónde | Todo local; sin servicio en la nube de Magister |
| Trabajos | La cola de trabajos de la Parte IV (lease, reintentos, idempotencia, un trabajador para el modelo) |

Ya sobre la mesa y sin decidir: preparación nocturna de la lección desde las fuentes, dos explicaciones de reserva por idea, «saber lo que te va a costar» y planificar lo pesado según la ventana de cuota. Abajo se refinan.

### Propuesto

**Preparar cuando la máquina está encendida, no «de noche»** (coste medio · Partes IV y V). En un portátil personal, de noche lo normal es que esté apagado o suspendido. Además `escritorio/main.cjs` cierra la aplicación y para la API al cerrar la ventana. Una preparación con ventana de reloj fija casi nunca correría. Disparadores:

| Cuándo | Qué se encola |
|---|---|
| Al cerrar una sesión | La siguiente sesión del mismo camino, con lo turbio, los fallos y el escalón aún frescos |
| Al arrancar Magister | Lo que falte para hoy y mañana en cada camino abierto |
| Al aceptar la propuesta del día | Lo que falte de esa lección; el arranque de recuerdo cubre la espera |
| De noche | Solo si el equipo sigue encendido con la aplicación abierta y hay cuota libre; es una preferencia, no un requisito |

- Alcance: la próxima lección propuesta por cada camino abierto, no el plan entero. Si una o dos sesiones, lo decide Carlos (pendiente 13.10).
- Una preparación caduca (`caducada`) cuando cambian las fuentes de la lección, el prompt o el dominio; mientras no, se reutiliza por clave.
- Un modo residente en la bandeja que prepare con la ventana cerrada sería una decisión aparte de la Parte VI.

**Qué se prepara por idea** (coste medio · Partes IV y V). Explicación (y sus versiones de una línea y de un párrafo), dos explicaciones de reserva, pregunta previa si es intuible, preguntas de comprobación con distractores etiquetados y su razón, el escalón actual y el siguiente, un gemelo o su plantilla, preguntas de seguimiento con la rúbrica y la previsión («lo que te va a costar»: ideas que tocan conceptos frágiles y errores activos del tema, calculada sin modelo). El tamaño del banco por idea no está medido (no comprobado) y necesita un tope.

**Comprobar la clave contra la fuente** (coste bajo · Partes III y IV). Un tutor que no duda y corrige con una clave mal generada destruye la confianza de golpe. En la preparación, cada respuesta de referencia se contrasta con su fragmento citado, con el juez de «Respuesta con fuentes». Se reutiliza esa eval, no se crea otra.

**El tutor sabe si se ha preparado** (coste nulo · Partes IV y V). Cada bloque tiene un estado calculado sin modelo a partir de las piezas que existen: `preparado`, `a_medias` o `sin_preparar`. Si el tema de hoy no está listo, la propuesta lo dice con seguridad: «derivadas está a medio preparar; empezamos por el repaso mientras lo termino» o «hoy te propongo integrales, que está listo». Nunca habla con el aplomo de lo preparado sobre lo que no lo está. Comprobación: borrar la preparación de un bloque, entrar en Tutor y ver que no se ofrece como preparado y que la preparación se lanza.

**Lo preparado se sirve sin modelo y la sesión sobrevive al motor** (coste nulo; ahorra llamadas · Partes IV, V y VI). La explicación, las reservas, las comprobaciones cerradas y su corrección salen de la base de datos. El modelo entra solo para lo que se sale del guion: una pregunta libre, «otro ejemplo» sin reserva preparada, «lo explico yo» o una respuesta abierta. La regla es: cero llamadas en un bloque sin interacción libre y como mucho una por turno con interacción. Si el motor falla o se acaba la cuota a mitad de sesión, la sesión sigue por los bloques preparados y lo que necesitaba juez se encola («esto te lo corrijo luego; sigue»). Comprobación: con un fallo simulado del motor a mitad de sesión, la sesión recorre todos los bloques preparados.

**Sin motor, con tres causas** (coste nulo · Partes I y VI). `generar()` distingue tres estados y `/api/salud` los expone: `claude` no instalado, no autenticado o sesión caducada (el fallo más probable de un tercero) y cuota agotada con hora de reinicio. Repaso y lectura guiada siguen funcionando; la tarjeta Hoy reordena y pone primero lo que no necesita modelo.

**Cuota a la vista y con tope** (coste nulo · Partes IV y VI). `rate_limit_info` llega dentro de la respuesta de una llamada: solo se conoce después de gastar. Cada llamada guarda en `llamadas_modelo` su propósito (sesión, preparación, juez, inferencia, pacto, libre), su duración, sus tokens y el último `rate_limit_info`; sus campos están por comprobar. El siguiente lote se decide con ese último dato y con una reserva para la sesión en vivo (tamaño: no comprobado). Si llega un error de límite, el lote se para. El perfil dice qué parte de la ventana ha usado Magister esta semana y cuánto en segundo plano. El alumno fija un tope para el segundo plano (por defecto: criterio general); al llegar, no arranca ninguna preparación nueva hasta la ventana siguiente. Un botón «preparar ahora» avisa de que gasta cuota de día.

**Latencia del juez en sesión** (coste nulo · Parte V). Cada juicio en vivo tarda del orden del `result` medido, 7,51 s. Por eso las comprobaciones son cerradas por defecto y el juez queda para «lo explico yo» y las respuestas abiertas (pendiente 13.11).

### Qué llama al modelo y qué no

| Nunca llama al modelo | Llama al modelo |
|---|---|
| Tarjeta Hoy y su razón, reparto entre caminos | Preparar lecciones (segundo plano) |
| Arranque de recuerdo con ítems cerrados | Comprobar claves contra la fuente (segundo plano) |
| Servir explicaciones, reservas y densidades preparadas | Pregunta libre del alumno, «otro ejemplo» sin reserva |
| Corregir comprobaciones cerradas, distractores, pasos con número u opción | Juzgar «lo explico yo» y respuestas abiertas |
| Escalera, gemelos con plantilla, pistas, silencio | Reclamar una corrección (rara, la pide el alumno) |
| Colocar deberes, recolocar, reajustar | Redactar el texto de un patrón e inferir candidatos (por lotes, semanal, criterio general) |
| Dimensiones, confianza, mando, patrones observados | Pasar el pacto conversado a campos (`estructurar`) |
| Contexto de la sesión, lints, canarios | Escribir una conexión entre temas (sección 8) |
| Cierre por plantilla, marcapáginas, lo turbio | Resumen de cierre, si Carlos lo quiere escrito por el modelo |

## 8. Más propuestas del panel

Las que no encajan en las secciones anteriores. Están sin decidir, salvo la sorpresa controlada, que es la decisión 9.

### Sorpresa y motivación

| Aspecto | Decisión |
|---|---|
| Sorpresa controlada | De vez en cuando, una conexión entre dos cosas estudiadas por separado, respetando la regla de no sacar temas de fuera sin permiso |

| Propuesta | Qué es | Coste | Parte |
|---|---|---|---|
| Sorpresa controlada: cómo (propuesto) | Una conexión entre dos ideas consolidadas. Dentro de un mismo camino puede ir al final de una sesión. Entre caminos, el permiso se pide la primera vez con la propia tarjeta («¿quieres ver una conexión entre matemáticas y electrónica?») y se guarda por pareja. Los candidatos los propone el modelo en un lote semanal (criterio general) sobre listas de conceptos con permiso; «no hay conexión» es la salida esperada. Cada conexión cita fragmentos de las dos fuentes o lleva marca (P4). Como mucho una por semana (criterio general), nunca tras un fallo | Bajo | III, IV y V |
| Pre-mortem semanal | En el contrato semanal: «¿qué va a hacer que esta semana no estudies?». La respuesta mueve franjas y tamaño de los deberes. Una pregunta, sin modelo si se responde con opciones | Nulo | II y V |
| Contrato semanal | Lunes propone carga; domingo revisa uso real de cada franja, nivel de presión y anclas que no se usan, sin destacar ninguna | Nulo | II y V |
| Fecha objetivo y simulacro | Un simulacro sin ayuda antes de la fecha objetivo, colocado por el calendario | Bajo | II y V |
| Racha | Días seguidos (se pierde) frente a un conteo que no se pierde («días con sesión este mes»). Lo decide Carlos | Nulo | V (P9) |
| «Me lo quedo» | Un gesto en cualquier respuesta (Estudio libre, Tutor, lectura) que crea una pregunta de repaso con `origen` y el texto literal guardado. Con «esto no cuenta» activo, no se enlaza a ningún concepto y sus intentos no tocan dominio ni patrones. Una reescritura en lote es opcional y conserva la literal | Nulo | I, IV y V |
| Tareas fuera de pantalla | «Explícaselo a alguien», «busca un ejemplo en tu día», para quien está saturado de pantalla. Se cierran con un toque en la sesión siguiente | Nulo | V |

### Terceros e instalación

| Propuesta | Qué es | Coste | Parte |
|---|---|---|---|
| Un camino es un fichero | Exportar e importar plan y lista de fuentes (metadatos y hash), nunca perfil, intentos ni sesiones, ni el calendario: se vuelve a calendarizar con las horas de destino. Entrada no confiable: pasa la validación del plan de la Parte II y el texto importado entra marcado como dato; el banco de «Atacar tu propio tutor» incluye un camino con instrucciones plantadas. El material generado solo viaja si sus citas apuntan a fragmentos incluidos | Bajo | II, IV y VI |
| Catálogo de temas preparados | Después de la v1.0, y solo con fuentes abiertas troceadas dentro del fichero, para que P4 se cumpla. Gasta la cuota de Carlos y es un producto editorial aparte | Medio | IV y VI |
| Del doble clic a Hoy, medido | Eval determinista con el modo `--comprobar` de `escritorio/main.cjs`: tiempo hasta la tarjeta Hoy pintada y cero llamadas al modelo en ese tramo (umbral: no comprobado) | Nulo | VI |
| Informe de uso para enviar a mano | Un fichero local con cifras agregadas (días con sesión, abandonos antes del primer turno, veces sin motor, tiempo de arranque, versión), sin ningún texto. Un test comprueba la lista blanca de campos. Es la única forma de que Carlos sepa si los terceros lo usan | Nulo | VI |
| Actualizar sin perder datos | Migraciones al arrancar con copia previa | Nulo | VI |
| Móvil en la red local | Después de la v1.0, con emparejamiento por código de un solo uso diseñado en «Atacar tu propio tutor» | Nulo | VI |
| Anclas | `etiqueta` y `aviso` como columnas de las franjas. Sin notificaciones en la v1.0: la aplicación no tiene proceso con la ventana cerrada. Si la Parte VI añade un modo residente, llegan apagadas por defecto | Nulo | II y VI |

### Confianza

| Propuesta | Qué es | Coste | Parte |
|---|---|---|---|
| Fe de erratas | Fase 1, solo como eval: pasar el juez «cada afirmación la sostiene su cita» sobre las sesiones de Carlos para medir cuántas frases citadas o añadidas están mal. Fase 2, si la tasa lo justifica: revisar por lotes las frases que dieron origen a una ficha o que el alumno marcó como entendidas, y enseñar la rectificación como una línea del plan («ayer dije X; es Y, página 42») | Medio | III, IV y V |
| Ver qué se envió | En el detalle de una llamada, el texto exacto que salió de la máquina (las trazas ya existen). Es la prueba de «todo en local» para quien no lee código | Nulo | VI |

## 9. Qué se guarda desde la v0.1

El alcance de la v0.1 no cambia: en la v0.1 no hay modo tutor, ni comprobaciones, ni temas con sentido, y lo que se mediría sería a Carlos probando lo que construye. Los tiempos de respuesta y la longitud de los mensajes ya se pueden derivar después de `mensajes`. Solo se proponen dos cosas que no se pueden reconstruir más tarde:

| Qué | Dónde | Por qué ahora |
|---|---|---|
| `cuenta` booleano, por defecto verdadero (con `conversaciones.cuenta` opcional como valor inicial) | `mensajes` (y lo heredan las tablas posteriores) | El interruptor es por momento; no se puede saber después qué contaba |
| `motor` con el que se generó | `mensajes` | Todo lo generado con `eco` nace con `cuenta = false` |

Si entran perfiles de varias personas por instalación, `perfil_id` tendría que estar desde la v0.1 en todas las tablas (pendiente 13.3).

Tablas mínimas que vienen después, con solo las columnas que fijan el diseño:

| Tabla | Columnas clave | Parte |
|---|---|---|
| `franjas` | `dia_semana`, `hora_inicio`, `minutos`, `etiqueta`, `aviso` | II |
| `reparto_caminos` | `plan_id`, `parte_semanal`, `origen` (tutor, que lo propone; alumno, si lo cambia) | II |
| `cambios_plan` | `fecha`, `que`, `motivo`, `origen` (tutor, alumno, automatico) | II y V |
| `lecciones_preparadas` | `plan_id`, `leccion_clave`, `version_fuentes`, `version_prompt`, `clave`, `contenido`, `prevision`, `estado`, `preparado_en` | IV |
| `llamadas_modelo` | `momento`, `proposito`, `modelo`, `sesion_uso_id`, `trabajo_id`, `tokens_entrada`, `tokens_salida`, `ms_primer_token`, `ms_total`, `estado`, `info_limite` (guarda el `rate_limit_info` de `claude -p`) | IV y VI |
| `sesiones_uso` | `inicio`, `fin`, `ultimo_latido`, `motivo_fin`, `modo`, `plan_id`, `duracion_declarada_min`, `presion`, `cuenta` | V |
| `bitacora` | `momento`, `tipo` (lista cerrada), `modo`, `sesion_uso_id`, `plan_id`, `concepto_id`, `cuenta`, `datos` (solo números, impuesto con un test) | V |
| `intentos` (ampliada) | `nivel_pista`, `segundos_hasta_pista`, `segundos_hasta_respuesta`, `origen`, `cuenta`, `estado_correccion` (firme, reclamada, revisada) | V |
| `deberes` | `sesion_uso_id`, `tipo` (ficha, pregunta, preparar), `pregunta_id`, `fecha_para`, `franja_id`, `minutos_estimados`, `estado` (pendiente, hecho, absorbido, recolocado), `motivo` | V |
| `pacto` | `campo`, `valor`, `texto_origen`, `acordado_en` | V |
| `patrones` | `detector`, `ambito`, `plan_id`, `texto`, `texto_alumno`, `fuente`, `confianza`, `estado`, `usar_en_contexto` | V |
| `evidencias` | `patron_id`, `intento_id` o `bitacora_id`, `modo`, `plan_id`, `sesion_uso_id`, `momento` | V |
| `vetos` | `detector`, `ambito`, `vetado_en` (sin datos de evidencia) | V |
| `perfil_dimensiones` | `dimension`, `fuente`, `valor`, `n`, `confianza`, `calculado_en`, `version_calculo` | V |
| `metaobjetivos` | `dimension`, `objetivo`, `desde`, `estado` | V |
| `exclusiones` | `desde`, `hasta`, `motivo` | V |
| `sensores` | `nombre`, `proposito`, `activo` | V |
| `lecturas` | `sesion_uso_id`, `version_id`, `grano`, `inicio`, `fin` | V |
| `cruces` | `concepto_a`, `concepto_b`, `texto`, `estado`, `permiso`, `valoracion` | V |

Tipos de `bitacora`: solo lo que no tiene otra tabla dueña: `pestana_oculta`, `pestana_visible`, `inactivo`, `parrafo_visto`, `parrafo_accion`, `pista_pedida`, `propuesta_elegida`, `cruce_ofrecido`. Mensajes e intentos se leen de sus tablas, sin copiarlos. La hora local la calcula la API con la zona del sistema o `MAGISTER_ZONA`: servidor y navegador están en la misma máquina. Las rutas nuevas no usan `/api/sesiones`, que es el calendario de la Parte II.

## 10. Reglas duras y criterios de producto nuevos

### Reglas duras del tutor

- Nada de la columna «Nunca llama al modelo» de la sección 7 hace una llamada. Comprobación: un test por pieza que ve cero filas nuevas en `llamadas_modelo`.
- Lo preparado se sirve sin modelo.
- El filtro de temas de fuera y de procedencia es código, no una instrucción.
- Lo inferido por el modelo nunca cambia una estrategia sin evidencia observada o la confirmación del alumno.
- Un sensor apagado no guarda nada.
- Nada cambia en el plan ni en el calendario sin un motivo visible.
- Ninguna pantalla ni ningún texto convierte la ausencia en deuda o en culpa.
- Ninguna cifra sin medir se presenta como medida: lleva «(criterio general)» o «(no comprobado)».

### Reglas de la casa

Una frase en el pacto; la lista, en el perfil.

1. No reprocha («otra vez», «ya te lo dije», «deberías haber»).
2. Habla de conductas, nunca de ti con adjetivos ni de tu estado emocional.
3. No saca temas de fuera de la sesión ni dice de dónde viene un patrón, salvo la conexión pactada y preparada (sorpresa controlada).
4. No da la solución si no la pides.
5. Cuando le corriges con la fuente, la relee y rectifica o enseña el párrafo; no se defiende con autoridad (qué hace si sigue pensando que tiene razón: pendiente 13.19).
6. No alarga la sesión sin preguntar y ofrece prórroga una vez como mucho.
7. No habla de rachas perdidas ni pregunta «¿seguro?» cuando bajas la presión o te vas.
8. No usa el perfil como excusa («como eres de los que…») ni recita recuentos.

### Criterios de producto

Comprobaciones nuevas dentro de criterios existentes:

| # | Qué se añade | Cómo comprobarlo (resultado: sí/no) |
|---|---|---|
| P2 | El tutor no cierra un error sin un segundo intento limpio (en la sesión o como deber) y corrige el ejercicio por pasos en el primer paso que se desvía | Una sesión con un fallo a propósito y un ejercicio con el error en el paso 3. Sí si aparece el gemelo antes del cierre, como deber o en el arranque de la sesión siguiente si no hay hueco (absorbido), y la corrección llega en el paso 3 |
| P3 | Lo de otro tema no entra en el contexto; borrar un patrón lo elimina con su evidencia y no vuelve de la misma evidencia; «no lo uses» y «eso no es así» lo sacan del contexto desde el turno siguiente; cada patrón es una conducta situada con recuento | Canario de electrónica en una sesión de matemáticas; borrar un patrón y relanzar la inferencia; discutir otro en la conversación. Sí si el canario no aparece, el borrado no vuelve, el discutido no está en el turno siguiente y todos los patrones pasan el lint |
| P4 | En Tutor, lo que no viene de tus fuentes va marcado como añadido y se dice «no viene en tu libro», sin coberturas verbales; cada clave de corrección está contrastada con su fuente | Una sesión sobre una lección preparada. Sí si todas las frases de una muestra abren su fragmento o llevan la marca, el lint de coberturas da cero y las claves pasaron la comprobación |
| P9 | El % del camino cuenta lo recorrido con un acierto sin pista y el dominio por concepto exige el segundo acierto en otro día (criterio general) | Una semana de uso. Sí si los dos datos cuadran con los intentos guardados |

Criterios nuevos:

| # | Criterio de producto | Cómo comprobarlo (resultado: sí/no) |
|---|---|---|
| P12 | Delegar sin esperar: al abrir, el tutor propone qué toca, con una razón y alternativas a un toque, propone un reparto entre caminos que el alumno puede cambiar con un toque y no espera al modelo. (Partes II y V) | Abrir en frío con dos caminos abiertos. Sí si la propuesta aparece con cero llamadas al modelo, su razón cuadra con los datos, hay alternativas a un toque, la suma diaria no pasa de las horas declaradas y el reparto semanal queda dentro de la tolerancia (criterio general) |
| P13 | Deberes situacionales: se colocan en el siguiente hueco declarado, con el tamaño del hueco y del perfil, nunca se marcan como fallados y la presión cambia solo lo que pasa si no se hacen. (Partes II y V) | Una sesión que acaba a las 22:00, otra sin hueco antes de la siguiente y diez días sin abrir. Sí si el deber cae en el hueco siguiente, el tamaño no pasa del hueco, en el segundo caso no hay deberes y se absorben, ningún deber queda como fallado, con presión «propone» el deber caducado pasa a `recolocado` sin mensaje y al volver no hay ningún contador de atraso |
| P14 | Te conoce sin vigilarte: el perfil de cómo estudias enseña cada dimensión con sus tres fuentes y cuál manda, cada sensor se puede apagar, «no cuenta» funciona hacia atrás y lo generado con el motor de pruebas no cuenta. (Parte V) | Apagar un sensor, marcar como «no cuenta» una conversación de Estudio libre al cerrarla y hacer una sesión con `MAGISTER_MOTOR=eco`. Sí si del sensor no se guarda nada, ninguna dimensión cambia por las otras dos y el perfil muestra, para cada dimensión, lo declarado, lo observado, lo inferido y cuál manda |
| P15 | Funciona sin preparar y sin cuota: el tutor sabe qué tiene preparado, lo dice sin fingir y la sesión sigue por lo preparado si el motor falla. (Partes IV, V y VI) | Borrar la preparación de un bloque y, en otra prueba, simular un fallo del motor a mitad de sesión. Sí si la propuesta no ofrece el bloque como preparado y la sesión recorre los bloques preparados y encola lo que necesitaba juez |

### Evaluaciones

En el formato de `docs/plan-maestro.md`. Lo que es comportamiento de código (cerrar por inactividad, colocar deberes, cero llamadas al abrir, tope de cuota, exclusiones, canario) va como test con nombre en `servidor/tests`, no en `servidor/evals/`.

| Artefacto | Deterministas | Con referencia | Juez sí/no | Por pares | Etiquetas de Carlos | Dónde | Estado |
|---|---|---|---|---|---|---|---|
| Sesión de tutor | Además: ofrece recuerdo antes de explicar; ningún error cierra sin gemelo (en sesión, como deber o en el arranque de la sesión siguiente si no hay hueco, absorbido) salvo salto; ≤ 1 llamada por turno con interacción y 0 sin ella; cierra a la hora declarada | | Banco de tentaciones: al menos un escenario por regla de la casa (pide deberes a las 22:00, insiste en un error, menciona otro tema, pide la solución, dice «soy tonto», corrige con la fuente, baja la presión), con alumnos simulados | Explicación A frente a B | Tus sesiones etiquetadas | V, capítulo nuevo | Amplía la nueva |
| Contexto del tutor | Lint del contexto renderizado: sin recuentos, fuente, modo ni conceptos de temas no abiertos; tamaño acotado | | Ninguna frase dice de dónde sabe algo ni reprocha | | Una muestra de tus sesiones | V, capítulo nuevo | Nueva |
| Dimensiones del perfil | Con un historial sintético con un patrón sembrado, cada dimensión lo devuelve y su confianza sube con los casos; con pocos casos no manda lo observado | Acierto frente al patrón sembrado | | | Tu veredicto por dimensión tras unas semanas | V, «El estado de cada concepto» | Nueva |
| Lección preparada | Tiene todas las piezas por idea; cada clave apunta a un fragmento | | Fidelidad a las fuentes y clave sostenida por su fragmento (reutiliza «Respuesta con fuentes») | Entre versiones del prompt | | IV, «Trabajos en segundo plano» | Nueva |
| Conexiones entre temas | Nunca entre caminos sin permiso; como mucho una por semana | | La sostienen fragmentos de las dos fuentes | | Tu valoración | III y V | Nueva |
| Fichas y preguntas | Además: toda pregunta cerrada tiene al menos dos distractores etiquetados (criterio general) | | Además: el distractor corresponde al error que dice | | Etiquetas de distractores | IV, «La eval de completitud» | Amplía la existente |
| Respuesta con fuentes | | | En Tutor, sin fuente dice «no viene en tu libro» y lo marca como añadido, en vez de «no lo sé» | | | III | Amplía la existente |
| Corrección de respuestas abiertas | La segunda corrección no recibe la reclamación | | | | Solo reclamaciones revisadas por ti | V | Amplía la existente |
| Tono | Además, sobre los textos que no van en streaming (cierre, deberes, tarjeta Hoy, recolocaciones, reajuste): lista cerrada de construcciones sobre ausencia, racha y retraso; si salta, se regenera antes de mostrarse | | Juez de tono sobre deberes, presión y vista del calendario en «aprieta» | | | IV, «El guardián del tono» | Amplía la existente |
| Coste y latencia | Además: los tokens de entrada por turno no crecen con el número de sesiones; llamadas por sesión y por propósito | | | | | VI | Amplía la existente |
| Instalación | Además: del doble clic a la tarjeta Hoy en menos de N s (no comprobado) y sin llamadas al modelo | | | | | VI | Amplía la nueva |

Si se aceptan todas, la tabla pasa de 16 a 20 evaluaciones (4 nuevas) y amplía 7. Métricas que se registran sin ser puertas: aceptación de la primera propuesta, uso de «¿de dónde sale?», abandonos a mitad de sesión, retorno tras días sin abrir, proporción de palabras del tutor frente al alumno y nivel de pista medio por tema.

## 11. Qué cambia en discovery.md, criterios.md, plan-maestro.md y en el libro

Ningún cambio se aplica hasta que Carlos lo apruebe.

### discovery.md

| Fila | Cambio propuesto |
|---|---|
| Modo tutor, Entrada | «Estudio libre es la primera pantalla. Tutor y Estudio libre llevan arriba la tarjeta Hoy, calculada sin modelo: propone qué toca con una razón y alternativas a un toque. "Continuar donde lo dejaste" y "Nueva sesión" son estados de la tarjeta. Configuración corta la primera vez, más presión y franjas» |
| Secuencia por bloque | «Recuerdo al empezar (se puede saltar); explica (con tus fuentes), comprueba y sigue. En ideas intuibles, a veces, una pregunta previa» |
| Comprobación | Añadir: «un error no se cierra sin un segundo intento limpio, en la sesión o como deber; toda corrección se puede reclamar» |
| Cierre | Añadir: «"qué costó" llega rellenado; lo turbio, con un toque; el "ajá", opcional. El cierre no espera al modelo» |
| Memoria | «Perfil en dos capas (qué sabes y cómo estudias), con procedencia visible, sensores apagables y borrado que no vuelve» |
| Mapa de ideas visible | Se mantiene «no hace falta»; el plan de la sesión visible es otra cosa |
| Repaso | «Cuando tú quieras. El modelo de olvido propone y el tutor coloca deberes en tus huecos; el nivel de presión (por defecto, "propone") decide qué pasa si no se hacen» |
| Progreso | Concretar el dominio a dos días (criterio general); la racha queda pendiente |
| Para quién | Si Magister se dirige a menores, pendiente |
| Plataforma | «Funciona en pantalla estrecha en el navegador local; el móvil en la red local, después de la v1.0» |
| Cómo nace un camino y Exportar | Caminos como fichero y catálogo: después de la v1.0, pendiente |
| Pendiente | Añadir el término «ficha» (decisión 8 frente a la Parte IV) |

### criterios.md

- P2, P3, P4 y P9 ganan las comprobaciones de la sección 10.
- Nuevos P12 a P15.
- El alcance de la v0.1 no cambia; las dos columnas de la sección 9 no añaden criterios.

### plan-maestro.md

- Sección 1, piezas nuevas: Estudio libre y tarjeta Hoy (Parte I la pantalla, Parte V la propuesta, v0.1 y v0.5); preparación cuando la máquina está encendida (Parte IV, v0.4); perfil de cómo estudias, deberes, lectura guiada y dial de presión (Parte V, v0.5); sin motor, contador de cuota y borrado total (Parte VI, v1.0).
- Sección 3: las filas de la sección 10 de este documento. El recuento («Son 16 evaluaciones: 10… 6 nuevas») pasa a 20 evaluaciones (4 nuevas más).
- Sección 4: «Página» gana Estudio libre y la tarjeta Hoy; «Cerebro» recibe el contexto ya filtrado y no lee tablas. Fila «Evals»: 20 evaluaciones; los comportamientos de código, como tests en `servidor/tests`.
- ADR nuevo: «En Tutor se envía lo pertinente, no el historial entero» (cambia una consecuencia de ADR-0001).

### El libro, parte por parte

| Parte | Cambio |
|---|---|
| I | Modo `libre` («Estudio libre») en `modos.ts`; `tutor` apagado. Columnas `mensajes.cuenta` (con `conversaciones.cuenta` opcional como valor inicial) y `mensajes.motor`. Mascota con estados de página (opcional) |
| II | `franjas` y reparto entre caminos en el calendario; `cambios_plan`; la técnica `estructurar` para el pacto. El grafo del planificador no cambia; la sesión es un segundo grafo fijo en la Parte V. El campo `errores` del estado del grafo de la Parte II son errores de validación del plan y no se toca |
| III | Párrafos por `(version_id, inicio, fin)`; citas por frase con la marca «añadido»; candidatos de conexión con cita en las dos fuentes |
| IV | Preparación por eventos (cerrar, arrancar, aceptar, noche opcional); `lecciones_preparadas` con estado y caducidad; distractores etiquetados, gemelos o plantillas, escalones, razones, preguntas de seguimiento y densidades; comprobación de claves; `llamadas_modelo`; el guardián del tono gana lints de coberturas y de ausencia; el término «ficha» |
| V | Capítulo nuevo de sesión: grafo fijo con arranque, escalera, gemelo, pistas, silencio, cierre, colocar deberes y reclamar. «El estado de cada concepto» gana la sección «Cómo eres estudiando» (dimensiones, patrones, vetos, metaobjetivos, exclusiones, sensores). `intentos` gana columnas; `pregunta_id` admite nulos para `tipo = lectura`. `reajustar` recibe la presión. Hay que encajar el dominio a dos días con los estados del modelo de olvido del borrador |
| VI | Tres causas de sin motor en `/api/salud`; contador y tope de cuota; del doble clic a Hoy medido; ver qué se envió; exportar y borrar todo el perfil; actualizaciones con copia; informe de uso a mano |

### Hallazgo de seguridad del módulo 00

`proxy/Caddyfile` escucha en `:8080`, es decir, en todas las interfaces, y añade el token con `header_up`. Así, cualquier equipo de la red local llega a la API con el token ya puesto. No es del tutor, pero conviene arreglarlo ya: mantener `:8080` y añadir la directiva `bind 127.0.0.1` dentro del bloque (o usar `http://127.0.0.1:8080`).

## 12. Descartado y por qué

| Idea | Por qué |
|---|---|
| Un tutor dentro del tutor (variante agente con nombre aparte) | Lo rechazó Carlos: un solo tutor (decisión 2) |
| Que el tutor diga cuándo duda como fuente de confianza | Lo rechazó Carlos: la seguridad sale de la preparación. La procedencia va en la interfaz, no en la voz |
| Un único botón «Empezar» sin elección de tema | Lo rechazó Carlos: el tutor propone y se cambia con un toque |
| «El tutor hace de alumno» con cambio de papel | Es un tutor dentro del tutor y suena a duda. Además, el efecto citado sale de agentes que de verdad no saben. Queda como preguntas de seguimiento en la voz del tutor |
| Modo invitado, informe para terceros y política de menores | En local, el invitado abre el perfil desde la barra lateral; el informe necesita un lint que no funciona sin modelo; la edad autodeclarada es fingir protección. «Esto no cuenta» cubre el caso del invitado. Lo de menores queda como pregunta |
| Botón de pista bloqueado con cuenta atrás | Contradice «se rinde pronto → pista temprana» y los botones rápidos de `discovery.md`. Queda el silencio del tutor con el botón siempre activo |
| «¿Qué te hacía estar tan seguro?» antes de corregir | Suena a interrogatorio y a reproche (decisión 4). La hipercorrección no la necesita |
| Bajar la idea nueva en silencio tras un mal arranque | Cambia el plan sin decirlo, contra la decisión 3. Queda como propuesta de una línea |
| Que el % del camino cuente solo lo dominado | Pone el progreso en manos del Repaso, contra «sin agenda impuesta», y cambia P9 sin necesidad |
| Vídeo automático en la hora mala | `discovery.md` exige aprobar el guion por escenas antes de montar |
| Estados emocionales de la mascota («asiente», ligados a la ausencia) | Premiar o castigar con una cara es manipulación |
| Notificaciones de anclas en la v1.0 y la pregunta tras tres anclas saltadas | No hay proceso con la ventana cerrada, y la pregunta es un mensaje provocado por la ausencia |
| Bitácora de eventos en la v0.1 | Mediría a Carlos construyendo y duplicaría lo que ya guarda `mensajes`. Nace en la Parte V como `bitacora`, con lo que no tiene otra tabla dueña |
| `desfase_min` del navegador | Servidor y navegador están en la misma máquina |
| Estrategias como tabla versionada | Es un catálogo estático; el código ya está versionado en git |
| Embeddings de conceptos para elegir conexiones | Entre nombres de pocas palabras encuentra homónimos y pierde las conexiones valiosas. Los candidatos los propone el modelo en un lote semanal |
| Preparación con ventana de reloj nocturna | El portátil suele estar apagado. Se dispara por eventos |
| `longitud_objetivo` como instrucción al modelo | Es pedirle brevedad, que cumple a medias. El andamio se desvanece por selección de versiones preparadas |
| Llamar al modelo en `explicar` con la explicación ya preparada | Gasta cuota y unos 6,74 s por bloque, contra «responde al instante» |
| «Aprieta» desplaza el calendario solo | Contradice «Reajustar el calendario» (se propone y se acepta) y reproduce la culpa por otra vía |
| Contador de «ahora lo sé» que nunca baja | Es autoevaluación metida en P9, que tiene que cuadrar con lo hecho |
| Tres preguntas que «casi seguro fallarás» al empezar cada lección | Castiga a quien se rinde pronto. Queda una pregunta previa, opcional y saltable |
| Fecha de fin obligatoria al subir la presión | Decide por el alumno y puede bajar la presión justo antes del examen |
| Recitar las reglas de la casa en el pacto y tarjeta en cada sesión | Es fricción y cabina de mandos. Una frase en el pacto y la lista en el perfil |
| Lints de frases como puerta en vivo | Con streaming no bloquean nada y dan falsos positivos («léelo otra vez»). Son alarma y eval; solo bloquean en textos que no van en streaming |
| Reclamaciones de cada alumno como etiquetas de calibración | Son etiquetas interesadas; el plan maestro calibra con etiquetas de Carlos |
| El camino exportado como copia de seguridad | Sin perfil, intentos ni sesiones no es una copia. La copia es un volcado de Postgres de la Parte VI |
| Tabla `propuesta_hoy` cacheada | Estado duplicado que se queda viejo. Se calcula en cada petición |
| Reparto por «el camino más retrasado primero» sin reparto explícito | No reparte: dos planes reservan las mismas horas |

## 13. Decidido con Carlos en la segunda ronda (7-nov-2026)

Respuestas a las 26 preguntas pendientes, hechas en conversación. Mandan sobre lo propuesto en las secciones 1 a 12; esas secciones aún no se han reescrito para reflejarlas.

**Términos y alcance**

| # | Aspecto | Decisión |
|---|---|---|
| 1 | Ficha | Ficha = tarjeta de repaso (decisión 8). La hoja Markdown de la Parte IV pasa a llamarse «apuntes» |
| 2 | Días malos en Tutor | No hay interruptor «esto no cuenta» en Tutor. Una sesión con muchos fallos fuera de lo normal se marca sola como «día malo»: esos fallos no bajan el dominio de cada idea, pero sí alimentan los patrones del día (hora, cansancio, duración). Se ve y se discute en el perfil. El interruptor sigue en Estudio libre |
| 3 | Perfiles | Una persona por instalación. Sin `perfil_id` |
| 4 | Nombre | Nombre propio fijo con su carácter. Se puede renombrar; el carácter no cambia |
| 5 | Elogio | Específico y escaso, solo cuando hay algo concreto. Nunca «¡muy bien!» genérico |
| 6 | Resumen de cierre | Plantilla sin modelo, rellenada con los datos de la sesión |

**Deberes y presión**

| # | Aspecto | Decisión |
|---|---|---|
| 7 | Huecos | Franjas con hora en el calendario de la Parte II; la decisión 5 se cumple tal cual |
| 8 | Deberes «preparar» | Se hacen en la lectura guiada. Las fichas, en Repaso |
| 9 | Pacto | Corto en toques el primer día y conversado tras unas sesiones |
| 10 | Preparación | Una sesión preparada por delante en cada camino activo, con botón «preparar ahora» |
| 11 | Comprobaciones | Mezcla: cerradas por defecto, abiertas (con juez) cuando la idea lo pide o tras fallar una cerrada |
| 12 | Presión de Carlos | «Propone», como para todo el mundo |
| 13 | Racha (P9) | Conteo que no se pierde («34 días estudiados»). Se vuelve sin deuda |

**Perfil y observación**

| # | Aspecto | Decisión |
|---|---|---|
| 14 | Sensores | Encendidos y avisados en el pacto, pero **solo en sesiones de foco**, que el tutor propone en el calendario cuando el perfil tiene un patrón de atención y el alumno acepta o quita con un toque. Condición: Magister pone delante todo el material que el alumno necesita (PDF, apuntes, sus ejercicios y fichas antiguas) para que salir sea una señal real y no algo forzado por la herramienta |
| 14b | Umbral de fuga | 10 segundos fuera |
| 15 | «¿Por qué dices eso?» | Responde como una persona: «porque soy tu tutor y te conozco». Sin evidencias ni recuentos en la conversación; los fallos son algo sensible. El detalle vive en el perfil, sin empujar hacia él |
| 16 | Qué manda | Lo declarado hasta un umbral de evidencia (p. ej. 5 sesiones). Después manda lo observado y el perfil dice cuál está mandando |
| 17 | Fuga | Pestaña oculta + inactividad con tarea pendiente, solo en sesiones de foco. Mirar material dentro de Magister nunca cuenta |
| 18 | Retirar errores | Automático donde se pueda calcular (dos aciertos sin pista en días distintos); propuesta mensual en el resto |
| 19 | Reclamación que el tutor no acepta | Mantiene la corrección y la escala a un modelo aparte, que la revisa a ciegas. Si ese modelo da la razón al alumno, el tutor rectifica en la sesión siguiente |

**Sesión**

| # | Aspecto | Decisión |
|---|---|---|
| 20 | Comprobar frente a explicar | Sin cifra fija: el tutor mueve el reparto según lo que ve. Punto de partida, un tercio de comprobación |
| 21 | Continuar | Directo al contenido, sin recuerdo previo |
| 22 | Sorpresa controlada | Permiso general en el pacto (sí/no para todos los caminos) |

**Terceros**

| # | Aspecto | Decisión |
|---|---|---|
| 23 | Menores | Solo adultos. Una línea en el README de la Parte VI |
| 24 | Caminos como fichero y catálogo | Después de la v1.0 |
| 26 | Móvil en la red local | Después de la v1.0 |

**Abierto**

- **Mascota.** A Carlos le gusta, pero duda si se parece demasiado a la de Grok. Sigue decorativa hasta revisar el diseño.
- **Instalación para terceros (25).** Carlos pregunta por una forma mixta. Propuesta: el escritorio trae Postgres con pgvector embebido por defecto, y quien ya tenga Docker o su propio Postgres lo usa cambiando `MAGISTER_DB_URL` (el ajuste `db_url` que añade el capítulo Guardar de la Parte I). Solo cambia el empaquetado de la Parte VI.
