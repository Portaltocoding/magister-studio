# Cómo se adapta Magister a ti

Lo que la investigación dice que funciona para un sistema que «se adapta al alumno» (resumen de engram, docs/13, y de
la literatura que cita) y cómo lo hace Magister. Lo que no está aquí (estilos de aprendizaje, la «regla del 85 %»,
modelos profundos con pocos datos) está desmentido o no aplica con los datos de una sola persona.

## 1. Cuándo repasas: FSRS ajustado a ti

- Programador: FSRS-6 (`aprender/programador.py`). Solo el primer intento de cada día es un repaso (`aprender/estado.py`):
  repetir el mismo día no informa del olvido y sesgaría el ajuste.
- Ajuste personal por escalones (`aprender/personal.py`), una vez al día y con el botón «Ajustar ahora» de Progreso:
  - menos de 8 conceptos con dos repasos: parámetros por defecto;
  - desde 8: las cuatro estabilidades iniciales, por máxima verosimilitud con un tirón hacia el valor por defecto y
    monótonas;
  - desde 64: el vector entero con el optimizador de `fsrs` (necesita `pandas`; si no está, se queda en el escalón inicial).
  - Un ajuste solo se acepta si baja la pérdida logarítmica sobre tus repasos.
- Lo recién aprendido vuelve pronto: como mucho a los 3 días del primer repaso y a los 9 del segundo
  (`ajustes.tope_inicial`, apagable con `MAGISTER_TOPE_INICIAL=false`).

## 1 bis. La red neuronal encima de FSRS

`aprender/red.py`. Una red pequeña (18 características, 32 y 16 neuronas) aprende una corrección sobre la predicción
de tu FSRS: p = sigmoide(logit(p_FSRS) + red(x)). Ve lo que FSRS no mira: tu seguridad y tu tiempo en el último
repaso, si te pasaste de seguro, la hora, tu racha, tu acierto reciente, la estabilidad y la dificultad.

- Recién creada es exactamente tu FSRS (la última capa empieza a cero) y un castigo la mantiene cerca salvo que los
  datos digan otra cosa.
- Se entrena una vez al día (y con «Ajustar ahora») a partir de 160 repasos predecibles. Se valida con el último
  cuarto en el tiempo, que no ha visto: solo decide si baja la pérdida de FSRS al menos un 1 %. Si no, queda «en
  sombra». Validada, se reentrena con todo.
- Nunca programa más tarde que FSRS con sus topes de lo recién aprendido.
- Con un alumno inventado que de noche recuerda peor, la red baja la pérdida en lo no visto de 0,63 a 0,39 y pasa a
  mandar (`tests/test_aprender.py`).

## 2. Qué repasas primero

- Con tiempo limitado, primero lo que aún se salva barato (probabilidad de recordar alta, cerca del umbral). Lo casi
  olvidado (p < 0,10) va al final como «a reaprender». Ordenar por «lo más vencido primero» es lo peor en todas las
  simulaciones con presupuesto.
- A igualdad, antes lo que bloquea a otros conceptos (idea de learn-anything).

## 3. Reaprender en la misma sesión

Lo que fallas hoy vuelve al final de la tanda, con otra pregunta, hasta acertarlo una vez (como mucho 3 intentos al
día). Esos reintentos no cuentan para el programador. Es el efecto más grande de la revisión (Rawson y Dunlosky).

## 4. Más ayuda donde no sabes, menos donde ya sabes

El tutor recibe tus conceptos flojos (más andamiaje: un ejemplo resuelto antes de pedirte nada) y los que dominas (sin
lo básico: matices y casos límite). Es la única interacción aptitud y tratamiento que sobrevive a la evidencia: la ayuda
sirve a quien empieza y estorba a quien ya sabe.

## 5. Metacognición con tus datos

Si dices «seguro» y fallas a menudo (2 de cada 5 en tus últimos 30 días), te lo dice con tus cifras al corregir. Deja de
decirlo cuando tu seguridad vuelve a cuadrar con tus aciertos.

## 6. Tus elecciones

Modos de aprendizaje, nivel, estilo e instrucciones: eliges entre opciones válidas, no la pedagogía de fondo.

## Fuentes

- engram (nagisanzenin/engram, MIT): docs/13 «The Adaptive Instrument».
- learn-anything (ChenChenyaqi/learn-anything, MIT): explicación precisa antes que analogía, práctica tipo TDD con un
  marco fijo de corrección y prioridad para los requisitos. Se adaptaron las ideas; no se copió código.
