# Criterios de producto y alcance de la v0.1

## Lista de producto

Magister es un deep tutor que crea tu camino de aprendizaje y te acompaña por él. Se descarga del repo, se instala en tu ordenador y funciona con tus suscripciones de IA, con los datos en local. Estos criterios describen el producto completo (v1.0); no son requisitos de la v0.1. Las decisiones de fondo están en `docs/discovery.md`.

| # | Criterio de producto | Cómo comprobarlo (resultado: sí/no) |
|---|---|---|
| P1 | Crea el camino desde una conversación o desde un temario: lecciones partidas en ideas clave, con dependencias y un calendario que cabe en tus horas. (Parte II) | Pedir un tema y pasarle un temario. Sí si los dos caminos respetan dependencias y horas; no si falla alguno. |
| P2 | Acompaña idea a idea, frente al roadmap o a una lección: explica con tus fuentes, comprueba, cambia de explicación si no lo pillas y te deja saltar marcando para repasar. (Partes I, II y V) | Una sesión en la que falles a propósito una comprobación. Sí si cambia de explicación y, al saltar, el concepto queda para repasar. |
| P3 | Recuerda quién eres: lo que sabes, tus errores típicos y cómo aprendes, en un perfil visible que puedes borrar. (Parte V) | Ver el perfil tras tres sesiones y borrar una entrada. Sí si refleja las sesiones y el borrado se respeta. |
| P4 | Enseña con tus fuentes (PDF, libros y web): cada afirmación cita su fuente y lo que viene del modelo va marcado. (Parte III) | Revisar una muestra. Sí si cada afirmación tiene su cita o su marca. |
| P5 | Vídeo para entender antes de estudiar: eliges concepto o lección, apruebas el guion por escenas y se monta con HyperFrames, voz local y subtítulos. (Parte IV) | Generar uno de cada tipo. Sí si los dos se reproducen en el modo Vídeo con voz, subtítulos y citas. |
| P6 | Material completo con tu tono: fichas, preguntas de repaso, diapositivas y ficha en papel, exportables a Anki y Markdown. (Parte IV) | Generar y exportar el material de una lección. Sí si todo pasa el guardián del tono y se importa en Anki. |
| P7 | Proyectos: saca el camino de lo que construyes, te ayuda cuando te atascas y lleva un diario de decisiones. (Partes II y V) | Usarlo con un proyecto real. Sí si el camino sale del proyecto y el diario recoge las decisiones. |
| P8 | Modo de construcción: aplica el método del libro (bloques que se construyen desde la base, se iteran, se prueban y se cierran) a otro tema, con el libro de Magister como golden set. (v1.1, Parte VII) | Generar la guía de un tema nuevo y evaluarla con la suite del libro. Sí si pasa la puerta de calidad. |
| P9 | Ves que avanzas: % del camino, dominio por concepto, racha y tiempo. (Parte V) | La vista de progreso tras una semana de uso. Sí si muestra los cuatro datos y cuadran con lo hecho. |
| P10 | Se instala en otro ordenador desde el repo y funciona con la suscripción de esa persona. (Parte VI) | Instalarlo en una máquina limpia siguiendo el README. Sí si arranca y conversa sin tocar el código. |
| P11 | Lo usas de verdad: completas un camino entero con Magister. | Sí si un tema real se completa de principio a fin con él. |

Fuera de la v1.0: el modo de construcción (P8, llega en la v1.1), la voz como entrada y otras suscripciones además de Claude. Dónde se construye cada pieza y cómo se evalúa: `docs/plan-maestro.md`.

## Alcance de la v0.1

Cada criterio se evalúa con sí o no. Solo se incluyen aquí capacidades de la v0.1.

| Criterio de alcance | Cómo comprobarlo (resultado: sí/no) |
|---|---|
| La respuesta empieza a aparecer antes de que el modelo termine. | Generar una respuesta con demora. Sí si aparece texto antes de que termine la generación; no si solo aparece al final. |
| Si se recarga la página o se reinicia la API, la conversación sigue ahí y en orden. | Enviar varios mensajes, recargar la página y reiniciar la API. Sí si se recuperan todos en el orden original; no si falta alguno o cambia el orden. |
| Si se pulsa «Parar» o se cierra la pestaña, lo recibido se guarda como interrumpido y el modelo deja de generar. | Interrumpir una respuesta con «Parar» y, en otra prueba, cerrando la pestaña. Sí si en ambos casos se guarda lo recibido como interrumpido y cesa la generación; no si falla cualquiera de esas condiciones. |
| Cada respuesta guardada lleva el tiempo del primer fragmento y el tiempo total. | Revisar las respuestas guardadas. Sí si cada una contiene ambos tiempos; no si falta alguno. |
| Un fallo del modelo se muestra como error en la conversación. | Simular un fallo del modelo. Sí si el error se muestra en la conversación; no si no se muestra. |

Postgres 16 con pgvector y el streaming entran a propósito: Postgres evita migrar después desde un fichero, y el streaming permite ver la respuesta antes de que termine de generarse.

Quedan fuera por ahora:

| Fuera de la v0.1 | Por qué | Llega en |
|---|---|---|
| Plan y calendario | Primero hay que entender qué quieres aprender, y eso sale de conversar. | Parte II |
| Fuentes e ingesta | Es un RAG entero; sin conversación sería un almacén sin puerta. | Parte III |
| Material, práctica y modelo del alumno | Dependen del plan y de las fuentes. | Partes IV y V |
| Instalarlo en otro ordenador | Mientras solo lo usas tú en tu máquina, no aporta nada. | Parte VI |
| Memoria a largo plazo | Cuesta más con cada turno («La versión 0.1 y la pregunta siguiente»). | Parte II |
