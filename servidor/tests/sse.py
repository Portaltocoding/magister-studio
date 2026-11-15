"""Lee un cuerpo SSE como lista de (evento, datos)."""


def eventos_sse(texto: str) -> list[tuple[str, dict]]:
    import json

    salida = []
    for bloque in texto.replace("\r\n", "\n").split("\n\n"):
        if not bloque.strip() or bloque.startswith(":"):
            continue
        campos = dict(linea.split(": ", 1) for linea in bloque.splitlines() if ": " in linea)
        if "event" in campos:
            salida.append((campos["event"], json.loads(campos["data"])))
    return salida
