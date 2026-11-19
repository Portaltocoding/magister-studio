| Sistema | Éxito | pass^3 | Pasos | Llamadas | Tiempo | Acciones rechazadas | Banco |
|---|---|---|---|---|---|---|---|
| fijo | 75% | 75% | 9.6 | 2.0 | 8.2 s | 0 | 132bd637becb |
| agente | 100% | 100% | 8.0 | 8.0 | 25.2 s | 0 | 132bd637becb |
| fijo (eco) | 100% | 100% | 11.6 | 2.0 | 0.1 s | 0 | cced9007b816 |

Las dos primeras filas son el fijo de antes (3 consultas, nota de 0 a 3) con el modelo real y el banco de 8 lecciones de un
objetivo. Desde ADR-0020 el fijo va por objetivos y el banco tiene 10 lecciones (r9 y r10, de 4 objetivos, con copias de
MDN, un espejo, una página comercial y una portada); el verificador del fijo pide cobertura de objetivos de al menos el
75 %, como mucho 2 por dominio y nada malo. La fila «(eco)» mide solo lo que decide el código (filtros, elegir por
cobertura, tope por dominio): las consultas y las notas salen del banco, sin modelo. No es comparable con las de arriba.

Para comparar con el modelo real sin volver a buscar: `uv run python -m evals.research_rejugar --tareas <ids> --solo-elegir`
(0 llamadas) o `--juez` (1 llamada por lección). Las 21 tareas de antes (ids 11 a 31) no guardaron notas ni crudo_sha: no se
pueden rejugar, y su línea base es la lectura a mano del informe del 19-11-2026 (unos 9 de 20 objetivos cubiertos en L1,
L3, L10, L13 y L15 y unas 4 o 5 páginas malas de 22).
