# ADR-0019. Lo que encuentra el research entra solo

**Estado:** aceptada. **Fecha:** 2026-11-19. Corrige a ADR-0008 en una frase: «Nada se ingiere sin tu aprobación».

**Contexto.** ADR-0008 dejaba cada propuesta del research esperando a que la aprobaras una a una. En la práctica nadie las aprobaba: en tu base había 96 propuestas pendientes (20 lecciones del plan 2, 96 URL distintas) y ninguna había entrado. Las lecciones seguían «sin material» y el research había gastado su cuota para nada. Aprobar a mano no era un filtro: era un cuello de botella.

**Decisión.**

1. Con `MAGISTER_RESEARCH_INCORPORAR=true` (el valor por defecto, declarado en `config.py`), al acabar una tarea de research sus propuestas entran solas en tus fuentes por el trabajo «incorporar» de la cola (`trabajos/incorporar.py`). No llama al modelo. Las que ya estaban pendientes entran con «Incorporar todas» en la Biblioteca (`POST /api/incorporar`).
2. El filtro es el del research: el juez puntúa cada página y solo se propone lo que pasa `MAGISTER_RESEARCH_JUEZ_MIN` (ADR-0008). Después, la ingesta entera: cada salto de la descarga (también tras una redirección) pasa por `comprobar_url`, con un tope de 20 MB; solo entra HTML, texto o PDF, y se extrae y valida como cualquier documento. Lo que no pasa la validación se queda en cuarentena y la propuesta sigue pendiente, con su porqué anotado en el trabajo.
3. El texto entra siempre marcado como no confiable. Todo va a la fuente «Propuestas del research», de tipo `web` y confianza 1, y cada fragmento web (o con una URI http) llega a los prompts del chat, de los apuntes y del corrector dentro de `marcar_externo`, con su aviso, y con el título neutralizado en el atributo.
4. Se ve de dónde vino y se puede quitar. Cada versión guarda en sus metadatos `origen=research`, `automatica`, `propuesta_id`, `plan_id` y `leccion_clave`. La Biblioteca enseña lo que entró solo y para qué lección, con un × que lo borra. Borrar la fuente «Propuestas del research» lo quita todo de una vez.
5. Con `MAGISTER_RESEARCH_INCORPORAR=false`, todo vuelve a ser como en ADR-0008: las propuestas esperan tu aprobación.

**Consecuencias.**

- Entra texto de la web que no has leído. El riesgo es una inyección en el prompt y la mitigación es el punto 3. También puede entrar una página floja que el juez dio por buena: la quitas desde la Biblioteca.
- Las lecciones ganan apoyo sin que hagas nada, pero solo con los fragmentos que pasan la puerta del apoyo (coseno o reranker, ADR-0018). Lo que no llega no se guarda en `lecciones_fragmentos`.
- Un trabajo de 96 descargas ocupa el trabajador unos minutos, de uno en uno, y lo que encoles detrás (apuntes, vídeo) espera.
- Nuevas dependencias entre módulos: `trabajos` importa de `fuentes` y `seguridad`, y `research` importa de `trabajos` (CLAUDE.md, «Módulos y dependencias»).
