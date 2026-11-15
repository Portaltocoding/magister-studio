# Plan maestro: dónde se construye cada pieza y cómo se evalúa

Redactado por Claude el 5-nov-2026 a partir de `docs/discovery.md`, `docs/criterios.md` y el texto actual de las Partes I a VI. Las ubicaciones las decidió Claude por encargo de Carlos y son revisables. Las Partes II a VI son borradores sin revisar: donde este plan dice «existe», quiere decir que el borrador ya lo trae, no que esté bien.

## 1. Dónde se construye cada pieza

| Pieza | Dónde | Versión | Por qué ahí |
|---|---|---|---|
| Andamiaje (cajas, contrato, proxy) | Módulo 00, antes de la Parte I | v0.0 | Todo lo demás se enchufa en sus cajas |
| Conversación con streaming | Parte I | v0.1 | Es el tutor mínimo: hablar con el modelo |
| Camino desde una conversación | Parte II, «La conversación de diagnóstico» y «Salida estructurada» | v0.2 | Ya existe en el borrador |
| Lecciones partidas en ideas clave | Parte II, ampliando «Qué es un buen plan» | v0.2 | El tutor saca sus bloques del plan; el plan tiene que traerlos |
| Camino desde un temario o un proyecto, y diario de decisiones | Parte II, capítulo nuevo tras «La conversación de diagnóstico» | v0.2 | Es otra entrada del mismo planificador; el diario es una tabla y el formato de los ADR |
| Explicar con tus fuentes y citas | Parte III | v0.3 | La recuperación con citas ya está ahí |
| Vídeo: selección, guion aprobado, montaje HyperFrames, Piper y subtítulos | Parte IV: «Diapositivas y guion de vídeo» más un capítulo nuevo tras «Trabajos en segundo plano» | v0.4 | Montar un vídeo es un trabajo largo: necesita la cola de trabajos de ese capítulo |
| Exportar (Anki, Markdown, vídeo) | Parte IV, en «El generador de fichas» | v0.4 | Sale del mismo material |
| Sesión de tutor idea a idea (pestaña, comprobar, cambiar de explicación, saltar y marcar, cierre) | Parte V, capítulo nuevo tras «Preguntar y corregir» | v0.5 | Necesita corregir respuestas y el modelo del alumno, que viven en esa parte |
| Perfil visible y errores típicos | Parte V, en «El estado de cada concepto» | v0.5 | Es el modelo del alumno ampliado |
| Progreso (% del camino, dominio, racha y tiempo) | Parte V | v0.5 | Lee del modelo del alumno y de las sesiones |
| Instalable en cualquier ordenador y aplicación de escritorio | Parte VI, reorientando «Desplegarlo para usarlo cada día» | v1.0 | Es la forma de «producción» de una app local |
| Modo de construcción | Parte VII, nueva, después de la v1.0 | v1.1 | Usa todo lo anterior (plan, fuentes, material, trabajos y evals) y conviene que lo demás esté estable |

Dos condiciones para la Parte VII. Todas sus llamadas al modelo pasan por `generar()`, como el resto del producto (la suite del libro llama a `claude -p` directamente; eso vale para la herramienta del libro, no para el producto). Y la Parte VII todavía no se crea como fichero: `construir.py` calcula los porcentajes del mapa «Dónde estás» con las partes que existen, y añadir una cambiaría el PDF de la Parte I.

## 2. Qué parte cubre cada ficha del roadmap

| Ficha | Partes |
|---|---|
| 00 Plan del proyecto de IA | Todas: es el mapa general |
| 01 Evals | Hilo en todas: II, III, IV, V, VI y VII |
| 02 RAG | III |
| 03 | No hay carpeta 03 en `pdfs/fichas-roadmap/06-roadmap`; falta averiguar qué era |
| 04 Prompt y contexto | I, II y IV |
| 05 Observabilidad | VI, «Ver qué pasa» |
| 06 Serving | VI, «Coste y latencia» y la instalación |
| 07 Fine-tuning | VI, «¿Compensa afinar un modelo para el tono?» |
| 08 Data engineering | III (ingesta) y módulo A |
| 09 Internals de LLM | VI, «Dentro del modelo» |
| 10 ML clásico | V, «Predecir el olvido con modelos lineales» y «Medir y elegir el modelo de olvido» |
| 11 Seguridad | Módulo 00 (mínima) y VI, «Atacar tu propio tutor» |
| 12 Arquitectura | Módulo 00, I, VI («El design doc del tutor») y módulo B |
| Fullstack 00 Web | Módulo 00 y I |

## 3. Cómo se evalúa cada cosa

**La regla.** Las comprobaciones de sí o no (deterministas o de un juez) son las puertas: deciden si algo vale. La comparación por pares, intercambiando el orden de las dos opciones para anular el sesgo de posición, sirve para elegir entre dos versiones cuando la calidad es subjetiva (tono, explicaciones, guiones). Las métricas con referencia son para lo que tiene respuesta conocida, como la recuperación. Todo juez se calibra contra etiquetas de Carlos antes de fiarse de él. Ningún umbral está medido todavía: cada uno lleva «(criterio general)» o «(no comprobado)» hasta que lo esté.

| Artefacto | Deterministas | Con referencia | Juez sí/no | Por pares | Etiquetas de Carlos | Dónde | Estado |
|---|---|---|---|---|---|---|---|
| Plan o camino | Esquema válido, dependencias sin ciclos, cabe en las horas | Cobertura del temario | Orden pedagógico | Entre versiones del prompt | Banco de peticiones | II, «Medir el planificador» | Existe |
| Camino desde un proyecto | Lo mismo que el plan | Cubre lo que pide el proyecto | | | | II, capítulo nuevo | Nuevo, reutiliza el anterior |
| Recuperación | | recall@k, MRR y nDCG@10 sobre un banco con preguntas sin respuesta | | | Relevancia por fragmento | III, «Medir la recuperación y las respuestas» | Existe |
| Respuesta con fuentes | La cita existe y apunta a un fragmento | | Cada afirmación la sostiene su cita; dice «no lo sé» si no hay fuente | | Una muestra de respuestas | III, mismo capítulo | Existe |
| Fichas y preguntas | Formato y longitud | Completitud como recall sobre conceptos | Fidelidad a la fuente | Entre versiones | | IV, «La eval de completitud» | Existe |
| Tono | Lint de reglas | | Juez de tono | Entre versiones | Banco etiquetado, acuerdo con kappa | IV, «El guardián del tono» | Existe |
| Corrección de respuestas abiertas | | Respuesta de referencia | Juez que corrige | | Acuerdo con tus notas | V, «Corregir una respuesta abierta con un juez» | Existe |
| Modelo de olvido | | log-loss, AUC y calibración sobre tu historial | | Entre modelos | Tus repasos | V, «Medir y elegir el modelo de olvido» | Existe |
| Sesión de tutor | Reglas por turno: no avanza sin comprobar, cambia de explicación tras un fallo, cita | | Juez por turno con alumnos simulados (novato, con un error típico, avanzado) | Explicación A frente a B | Tus sesiones etiquetadas | V, capítulo nuevo | Nuevo |
| Efecto en lo que aprendes | | Antes y después, y retención en repasos | | | Tus resultados | V, «Medir si el tutor te hace aprender más» | Existe |
| Guion de vídeo | Escenas con marcador, duración estimada por palabras | Cubre las ideas de la lección | Fidelidad y claridad | Guion A frente a B | | IV, capítulo nuevo | Nuevo |
| Vídeo montado | Duración real, audio y subtítulos sincronizados, sin fotogramas vacíos en un muestreo | Subtítulos frente a guion | Juez con imágenes sobre fotogramas muestreados (coste no comprobado) | | Tu visionado de una muestra | IV, capítulo nuevo | Nuevo |
| Guía del modo de construcción | Reglas duras y puerta de calidad | | Patrones y rúbrica del libro | Frente al golden set (el libro) | Tus etiquetas del libro | VII | Nuevo, reutiliza la suite del libro |
| Seguridad | | Banco de ataques: tasa de éxito | Juez de fuga | | | VI, «Atacar tu propio tutor» | Existe |
| Coste y latencia | Primer trozo, tiempo total, tokens por sesión | | | | | VI, «Coste y latencia» | Existe |
| Instalación | Arranca en una máquina limpia siguiendo el README | | | | | VI | Nuevo |

Son 16 evaluaciones: 10 ya están en los borradores (sin revisar) y 6 son nuevas. Las nuevas son las del camino desde un proyecto, la sesión de tutor, el guion de vídeo, el vídeo montado, la guía del modo de construcción y la instalación. La más difícil es la sesión de tutor, porque es una conversación de varios turnos: no basta con juzgar una respuesta suelta, hay que simular al alumno.

## 4. Cómo se enchufa cada pieza en el andamiaje

| Caja del módulo 00 | Qué recibe después |
|---|---|
| Página (`web/`) | Un modo por pieza: Tutor, Roadmap, Calendario, Temas y fuentes, Fichas, Vídeo, Repaso, Proyectos y, en la v1.1, Construcción |
| API (`magister.api`) | Las rutas de cada modo, bajo `/api`, con el sobre del contrato |
| Cerebro (`magister.cerebro`, y el grafo en `flujo`) | `generar()`, los prompts y el grafo del tutor y del planificador |
| Datos (`magister.datos`) | Las tablas de cada parte, con migraciones de Alembic |
| Trabajos (Parte IV) | Vídeo, material largo y las guías del modo de construcción |
| Evals (`servidor/evals/`) | Las 16 evaluaciones de la tabla anterior |

## 5. Pendiente

- La Parte I todavía dice «cinco criterios del producto» y su mapa del producto no tiene vídeo con montaje, proyectos, modo de construcción ni la instalación. Se sincroniza cuando Carlos la haya leído.
- `INDICE-LIBRO.md` dice que la Parte I fija los paquetes `tutor/api`, `tutor/cerebro` y `tutor/datos`, y las partes usan variables `TUTOR_DB_URL*`. La Parte I y el `CLAUDE.md` usan el paquete `magister` y variables `MAGISTER_*`. Hay que unificarlo al revisar las Partes II a VI.
- Escribir los capítulos nuevos: proyecto en la II, vídeo en la IV, sesión de tutor en la V, instalación en la VI, y la Parte VII.
- Ver en el Linux qué hizo `clase-magna` con HyperFrames antes de escribir el capítulo de vídeo.
