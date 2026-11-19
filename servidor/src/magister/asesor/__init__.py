"""El asesor que hace cosas: propone cambios cerrados (pasos de un proyecto, su diario, Mis notas, las sesiones y
lecciones del plan activo, tu agenda) y tú los aplicas.

El modelo nunca escribe en la base: solo propone (`agente.preparar`, por `estructurar`). Lo que se puede proponer es
una lista cerrada (`cambios.Accion`), se valida en código contra el proyecto de verdad (`cambios.simular`) y solo se
aplica cuando lo pulsas tú (`arnes.aplicar`), que vuelve a validarlo y guarda cómo deshacerlo. Ver ADR-0017.
"""
