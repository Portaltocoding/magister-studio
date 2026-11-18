# Cómo explica el tutor por áreas de conocimiento (18-11-2026)

Harness: `uv run python -m evals.areas preguntas.json respuestas.json` (llama a `claude`; solo a mano). Cinco evaluadores
expertos (estadística, filosofía, topografía y matemáticas aplicadas, historia y derecho, biología y química) escribieron
6 preguntas de alumno cada uno, de seis tipos (explícame, qué es, por qué, en una frase, ejercicio, no entiendo nada),
sacaron las respuestas reales de `conversar@33e43d28bbcc` y las juzgaron rehaciendo cuentas y comprobando datos.

## Lo que salió

El método del núcleo encaja en las cinco áreas, también en filosofía e historia, y no fuerza fórmulas ni diagramas donde
no tocan. Casi todas las cuentas y datos son correctos. Los fallos que se repetían entre áreas:

| Fallo | Áreas |
|---|---|
| «En una frase» recibe dos o tres párrafos | filosofía, historia, biología, topografía |
| Pasarse del tope en «¿Qué es?» y «No entiendo nada» | estadística, topografía, historia |
| Seguridad excesiva: atribución equivocada (el reloj de Russell como de Gettier), artículo mal citado (art. 1935 CC), simplificación sin avisar (−70 mV como equilibrio del K⁺) | filosofía, historia, biología |
| Ejemplo conductor poco representativo, corregido con un paréntesis al final | estadística |
| Una multiplicación mal hecha justificada con «redondeo» | topografía |
| Pocas figuras donde hay geometría o fases que comparar | biología, topografía |
| LaTeX en bloques que no lo dibujan (`pregunta`, `opciones`) | topografía, estadística |
| Tests que se delatan (la buena, la más larga) o repiten el resultado del ejemplo | filosofía, biología |
| Encabezados genéricos («El error típico») | estadística |
| Causas teleológicas («el sistema quiere aliviar») | biología |

## Lo que se cambió

- `prompts/comun/respuesta.md`: el tramo que `responder` y `conversar` tenían copiado igual pasa a ser común. Longitudes
  como techos (una frase = una frase), cuentas revisadas sin excusa del redondeo, convenios dichos, bloque para materias de
  hechos e interpretación, figuras obligadas con geometría o fases, tests de longitud pareja y con otro resultado, nada de
  LaTeX en los bloques que se pulsan, sin encabezados genéricos.
- `prompts/comun/explicar.md` (el núcleo): rigor al afirmar (atribución, certeza graduada en fechas, artículos y cifras,
  simplificaciones avisadas, posturas enfrentadas), ejemplo conductor representativo, causas y no intenciones.
- `docs/tono.md`: «lo ves enseguida», «es fácil ver», «como puedes ver» (condescendencia); «lo veremos en» (metatexto).

## Comprobación (`conversar@0e64d5a95cff`, las 10 peores preguntas otra vez)

| id | antes | después |
|---|---|---|
| fil-4 «en una frase» | 104 palabras | 47, una frase |
| hd-4 «en una o dos frases» | 116 | 69 |
| bq-4 «en una frase y un ejemplo» | 97 | 59 |
| top-6 «no entiendo nada» | 275, LaTeX en `pregunta` | 168, con figura, sin LaTeX en bloques |
| est-2 «¿qué es?» | 337, encabezado «El error típico» | 294, sin encabezados genéricos |
| fil-2 Gettier | reloj atribuido a Gettier | «el reloj parado es de Bertrand Russell (1948)» |
| hd-5 caso práctico | art. 1935 para el pago voluntario | art. 1935 para la renuncia a la prescripción ganada |
| bq-5 pH | test con el mismo resultado que el ejemplo | test con otros datos (pH 2) |
| top-5 área | multiplicación mal hecha y «es por el redondeo» | camino limpio, 2.491,70 m², con figura |

Pendiente de medir con más preguntas: que las longitudes nuevas no recorten de más en «Explícame» y que la regla de
figuras no dibuje donde no aporta.
