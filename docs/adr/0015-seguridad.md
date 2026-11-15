# ADR-0015. Seguridad: lo determinista bloquea, lo heurístico marca

**Estado:** aceptada. **Fecha:** 2026-11-15.

**Decisión.** Entrada: canonicalizar, quitar lo oculto del HTML, marcar lo externo (`<fuente_externa>` con spotlighting) y marcar sospechas sin bloquear. Salida, trozo a trozo con un búfer de 200 caracteres: quitar imágenes con URL externa, dejar enlaces solo a dominios permitidos, tapar DNI e IBAN válidos y cortar si aparece el canario (generado al instalar y metido en el prompt de sistema). Research con mínimo privilegio: solo URLs salidas de la búsqueda y nunca direcciones internas. CSP en la API y JSON obligatorio en las rutas que escriben.

**Medido (eco, 7 originales y 5 variantes cada uno).** Imagen, SSRF y fuga paradas siempre; la detección de sospechas la esquivan las variantes ofuscadas (base64, mayúsculas espaciadas): por eso marca y no bloquea.
