# Discovery: modo tutor y vídeo

Decidido con Carlos el 5-nov-2026, en sesión de preguntas por CLI. Es la base para los criterios del producto final y para revisar las Partes II, IV y V del libro.

## Modo tutor

**Núcleo:** partir un tema en ideas clave pequeñas (una idea por bloque) y acompañar al alumno por ellas. Repasar, revisar un documento o preparar un examen son usos de ese núcleo, no modos aparte.

| Aspecto | Decisión |
|---|---|
| Alcance | Tutoriza frente al roadmap entero (en qué lección vas, qué toca, qué fallas) o frente a una lección concreta (sus ideas una a una) |
| Entrada | Pestaña Tutor. Configuración corta la primera vez (nivel, cómo prefieres que te expliquen, tiempo habitual); después, «Continuar donde lo dejaste» con un clic o «Nueva sesión». Desde Hoy se abre ya configurada |
| Ajustes al crear una sesión | Tema o lección, duración y nivel de profundidad. Lo demás sale del perfil |
| Origen de los bloques | Del plan: la lección ya viene partida en ideas; el tutor las afina con tus fuentes y puedes reordenar o quitar |
| Tamaño del bloque | Una idea que se explica y se comprueba en pocos minutos (criterio general, a ajustar con el uso) |
| Secuencia por bloque | Explica (con tus fuentes), comprueba (pregunta socrática o «explícamelo tú») y sigue |
| Modos de explicación | Cambiar de explicación si no lo pillas (analogía, ejemplo, formal, ejercicio), destilar conceptos (idea de apolo) y diagramas |
| Comprobación | Avisa y decides: si fallas te lo dice; puedes saltar y queda marcado para repasar |
| Interacción además de escribir | Botones rápidos («no lo pillo», «otro ejemplo», «más despacio», «siguiente»), pizarra en la zona central y «marcar para repasar» |
| Mapa de ideas visible | No hace falta |
| Cierre | Resumen de 3 líneas (qué viste, qué costó, qué toca), fallos al repaso espaciado y oferta de fichas o vídeo |
| Memoria | Perfil completo y visible: lo que sabes, tus errores típicos y cómo aprendes mejor; lo puedes ver y borrar |

## Vídeo

| Aspecto | Decisión |
|---|---|
| Para qué | Entender un tema antes de estudiarlo |
| Tipos en la pantalla de selección | Explicación de un concepto y resumen de lección |
| Antes de generar | Guion por escenas con duración estimada; se aprueba o se cambia y luego se monta |
| Contenido | De tus fuentes con citas; lo que venga del modelo, marcado |
| Montaje | HyperFrames, como en `clase-magna`: escenas, voz y subtítulos desde un guion con marcadores. Se toma la idea; el código se rehace |
| Duración | Concepto 2 a 4 min, lección 6 a 8 min (criterio general de partida) |
| Voz | Local con Piper, más subtítulos siempre |
| Dónde | Modo Vídeo: biblioteca por tema y lección, reproductor con capítulos y botón de nuevo vídeo que abre la selección |

## Producto en general

| Aspecto | Decisión |
|---|---|
| Para quién | Una aplicación que cualquiera descarga del repo, instala en su ordenador y usa con sus propias suscripciones de IA. Cada instalación es de una persona |
| Plataforma | Web en local (navegador contra el servidor de tu máquina) y aplicación de escritorio |
| Datos | Todo en local: Postgres en tu máquina; solo salen las peticiones al modelo de tu suscripción |
| Suscripciones | La v1.0 funciona con Claude; otras entran después de la v1.0 detrás de `generar()` |
| Temas y proyectos | Un tema es algo que aprendes. Un proyecto es algo que construyes: Magister saca el camino de lo que el proyecto pide, te acompaña cuando te atascas y lleva un diario de decisiones (como los ADR) |
| Cómo nace un camino | Conversación de diagnóstico, o a partir de un temario que le das |
| Fuentes | PDF y libros, y páginas web (incluido el research que hace el tutor) |
| Material | Fichas, preguntas de repaso, diapositivas, ficha en papel y vídeo |
| Repaso | Cuando tú quieras, sin agenda impuesta; el modelo de olvido propone, no obliga |
| Progreso | % del camino, dominio por concepto, racha y tiempo |
| Exportar | Fichas a Anki, notas a Markdown y vídeos a fichero |
| Modo de construcción | Un modo propio en la barra lateral que aplica el método del libro a cualquier tema: aprender por bloques que se construyen desde la base, se iteran, se prueban y se cierran de punta a punta. El libro de Magister, con su rúbrica, sus patrones y su suite de evals, es el golden set de ese modo |
| Éxito de uso | Completar un camino entero con Magister, de principio a fin |
| Voz como entrada | Después de la v1.0 |

El libro de construcción de Magister es personal: es la guía de Carlos para aprender mientras construye. No se escribe para otros lectores.

## Pendiente

- Nombre del modo de construcción en la barra lateral.
- Impacto en el libro: la Parte IV solo deja el montaje como ampliación (capítulo «Diapositivas y guion de vídeo»); con esta decisión, HyperFrames pasa a construirse. El núcleo del tutor toca la Parte II (lecciones partidas en ideas) y la Parte V (comprobar y repasar).
