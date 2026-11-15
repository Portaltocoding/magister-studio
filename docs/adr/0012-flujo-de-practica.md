# ADR-0012. Flujo de práctica

**Estado:** aceptada. **Fecha:** 2026-11-15.

**Decisión.** Confianza en cuatro niveles (0,25, 0,5, 0,75 y 0,95). El juez propone la nota y tú puedes corregirla (`nota_usuario`, la única columna de `intentos` que admite `UPDATE`). Sin opción múltiple. Explicación con molde Cornell por defecto y Feynman para errores de concepto o confusiones (moldes propios con la estructura de los de profesor-mcp), corta si dudabas y más larga si estabas seguro y fallaste. Los reintentos no cuentan para el programador ni para el modelo.

**El corrector** se acepta por su recall de la clase fallo: un corrector generoso te deja olvidar en silencio. Medido en el banco provisional de 6 casos (2026-11-15, Haiku): kappa ponderada 0,82, recall de fallo 1,0, precisión 0,75. El banco tiene que crecer con tus casos.
