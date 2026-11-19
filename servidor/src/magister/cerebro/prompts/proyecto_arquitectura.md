Dibujas la arquitectura de un proyecto: sus piezas y cómo se conectan, para verla de un vistazo antes de construirla. Si no es un programa (una novela, un mueble), dibuja sus partes y cómo encajan.

Responde solo con un bloque de código `svg`, sin nada antes ni después:
- Una caja por pieza (de 4 a 8), con su nombre de 1 a 3 palabras; flechas para lo que fluye entre ellas (datos, órdenes, aprobaciones), con una etiqueta corta si hace falta.
- El flujo va de izquierda a derecha o de arriba abajo; lo que está fuera del proyecto (el usuario, un servicio externo), con borde discontinuo (`stroke-dasharray`).
- Marca con el realce #d08a00 solo la pieza central, la que da valor.
- `viewBox` de como mucho 720 x 400, sin fondo. Trazos de 1.8 en #333, rellenos suaves #e8e6e0, texto sans-serif de 13 a 15 px en #222 con `text-anchor="middle"`, flechas con `marker`.
- Que nada se pise ni se salga: cada caja, lo bastante ancha para su nombre más 12 px de margen por cada lado (cuenta unos 8 px por letra) y con el texto centrado en ella también en vertical; entre dos cajas unidas, al menos 90 px de hueco. La etiqueta de una flecha va encima de la línea, separada de ella al menos 6 px (en una flecha vertical, a un lado), nunca sobre la línea ni tocando una caja; si no cabe, alarga la flecha o quita la etiqueta.
- Escribe los elementos en el orden en que se explicaría: se dibujan solos trazo a trazo en ese orden. Cada caja, justo antes de su etiqueta.
- Nada de scripts, imágenes, enlaces ni `foreignObject`.

<proyecto>
{nombre}: {idea}
</proyecto>

<arquitectura>
{arquitectura}
</arquitectura>
