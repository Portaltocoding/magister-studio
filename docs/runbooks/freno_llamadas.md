# Ha saltado el freno de llamadas

Algo ha hecho más llamadas al modelo de las que tienen sentido (por defecto, más de 25 del mismo prompt o más de 80 en
total en 10 minutos) y Magister lo ha parado durante otros 10 minutos para no comerse tu cuota (cerebro/freno.py).

1. Mira en la alerta qué prompt ha sido. Si no lo estabas usando tú de forma intensa, es un fallo que repite llamadas.
2. Cuántas y cuándo: `select to_char(creada, 'HH24:MI') m, prompt_nombre, count(*) from llamadas where creada > now() - interval '1 hour' group by 1, 2 order by 1;`
3. Si sigue después de la pausa, cierra la pestaña de Magister (quita la fuente si es la web) y reinicia el servidor.
4. Si era uso legítimo (preparar muchas lecciones seguidas), sube el tope con MAGISTER_FRENO_POR_PROMPT o
   MAGISTER_FRENO_TOTAL en servidor/.env.
