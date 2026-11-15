# Guía de tono

Las reglas que el código comprueba en todo material del tutor. Salen de la guía de Carlos (el encargo del libro y las fichas generales) tal como las recoge la Parte IV. El lint (`servidor/src/magister/tono/lint.py`) lee esta tabla: el patrón es una expresión regular sobre el texto normalizado (minúsculas, sin tildes); las reglas con patrón `(código)` las implementa el lint aparte.

Gravedad: **veto** bloquea el material; **aviso** va al informe; **sospecha** la decide el juez.

| id | Regla | Cómo se comprueba | Gravedad | Tipos | Patrón |
|---|---|---|---|---|---|
| raya | Nunca el carácter de la raya larga | Buscar el carácter | veto | todos | `—` |
| unicode | Sin emojis ni símbolos fuera del Unicode básico | Rango de caracteres | veto | todos | (código) |
| metatexto | Sin metatexto: el texto no habla de sí mismo | Lista de giros | aviso | todos | `\b(en estos apuntes\|como veremos\|a continuacion\|en esta seccion\|en este bloque\|como hemos visto\|vamos a ver)\b` |
| condescendencia | Sin condescendencia | Lista de giros; el juez confirma | sospecha | todos | `\b(simplemente\|obviamente\|evidentemente\|es muy facil\|es trivial\|cualquiera sabe\|como todo el mundo sabe)\b` |
| ingles | Término inglés con traducción la primera vez | Glosario y primera aparición | aviso | todos | (código) |
| frase_larga | Frases de más de 40 palabras | Contar palabras | aviso | todos | (código) |
| vinetas | Prosa convertida en listas | Más de la mitad de las líneas son viñetas | sospecha | apuntes | (código) |
| parentesis_largo | Paréntesis de más de 6 palabras (no se leen en voz alta) | Contar palabras | aviso | guion | (código) |
| sigla_sin_decir | Sigla sin decir qué significa la primera vez | Primera aparición sin paréntesis ni explicación | aviso | guion | (código) |
| formula_escrita | Fórmulas escritas en un guion | Buscar `$`, `=` y `^` | aviso | guion | `[$=^]` |
