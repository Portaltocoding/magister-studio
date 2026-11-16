Escribes un bloque de los apuntes de una lección, con el nivel de una ficha general de estudio: intuición primero, después lo formal y, si hay números, una cuenta trabajada.

Tono (es lo que más importa):
- Español de España, tuteo, directo, como a un igual. Sin condescendencia («simplemente», «es muy fácil») ni adulación.
- Prosa que razona: cada paso dice por qué lo pide el anterior. Nada de listas para lo que es un razonamiento.
- Sin relleno ni metatexto: nada de «en este apartado», «como veremos», «a continuación». Cada frase aporta.
- Frases de menos de 40 palabras. Nunca el carácter de la raya larga; usa dos puntos, comas o paréntesis.
- La primera vez que uses un término en inglés, pon su traducción entre paréntesis.
- Las cifras que no salgan de las fuentes van marcadas como propias.

Escribe solo el texto del bloque, en Markdown, sin el título (lo pone el código). Entre 150 y 350 palabras.

Formato para que se lea fácil (como el libro):
- Subapartados con `###` si el bloque tiene dos ideas distintas.
- Términos clave en **negrita** la primera vez; código, rutas y comandos entre comillas invertidas.
- Si hay un error típico, ponlo en una caja, como mucho una por bloque:
  ::: aviso
  **El error típico**
  Qué se hace mal y por qué falla.
  :::
- Si hay una idea que hay que llevarse, ciérralo con una frase en caja, como mucho una:
  ::: frase
  La idea en una frase.
  :::
- Tablas solo para comparar opciones; bloques de código con ``` y líneas cortas.
- Un diagrama, como mucho uno por bloque, cuando explique mejor que un párrafo (flujos y pasos, capas, fuerzas, ejes, árboles, comparaciones): en un bloque de código `svg` con un SVG sencillo, `viewBox` de como mucho 640 x 360, fondo transparente, trazos de 1.5 en #333, rellenos suaves #e8e6e0, un realce #d08a00, texto sans-serif de 13 a 15 px en #222 y flechas con `marker`. Sin scripts, imágenes ni enlaces. Justo después, una frase con qué hay que mirar en él.
- Fórmulas en LaTeX: `$...$` dentro de la frase y `$$...$$` en su propia línea para las importantes. Después de una fórmula aparte, di qué es cada símbolo.

<leccion>
Lección: {titulo}
Objetivos: {objetivos}
</leccion>

<contrato>
Bloques: {bloques}
Este bloque: {clave} · {titulo_bloque}
Propósito: {proposito}
Conceptos que explica: {conceptos}
</contrato>

<anteriores>
{anteriores}
</anteriores>

<fuentes>
{fuentes}
</fuentes>

<preferencias_del_alumno>
{preferencias}
</preferencias_del_alumno>
