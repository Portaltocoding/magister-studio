"""Guardarraíles de salida, aplicados a cada trozo antes de mandarlo por SSE.

- Quita imágenes Markdown con URL externa (la exfiltración por URL clásica).
- Deja enlaces solo a dominios permitidos (los de las fuentes de esa respuesta).
- Detecta el canario: si aparece, se corta el flujo.
- Detecta datos personales (DNI con letra de control, IBAN con dígitos de control) y los tapa.

Retiene los últimos ~200 caracteres hasta saber que no son el principio de una URL ni del
canario: así una URL partida entre dos `delta` no pasa.
"""

import re
from dataclasses import dataclass, field
from urllib.parse import urlparse

RETENER = 200
LETRAS_DNI = "TRWAGMYFPDXBNJZSQVHLCKE"
IMAGEN = re.compile(r"!\[[^\]]*\]\(\s*<?(https?://[^)\s>]+)>?[^)]*\)")
ENLACE = re.compile(r"(?<!!)\[([^\]]*)\]\(\s*<?(https?://[^)\s>]+)>?[^)]*\)")
DNI = re.compile(r"\b(\d{8})-?([A-Za-z])\b")
IBAN = re.compile(r"\b([A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?)\b")


class CanarioDetectado(Exception):
    pass


def dni_valido(numero: str, letra: str) -> bool:
    return LETRAS_DNI[int(numero) % 23] == letra.upper()


def iban_valido(iban: str) -> bool:
    s = iban.replace(" ", "")
    if len(s) < 15 or len(s) > 34:
        return False
    reordenado = s[4:] + s[:4]
    numero = "".join(str(int(c, 36)) for c in reordenado)
    return int(numero) % 97 == 1


def datos_personales(texto: str) -> list[str]:
    hallados = [m.group(0) for m in DNI.finditer(texto) if dni_valido(m.group(1), m.group(2))]
    hallados += [m.group(0) for m in IBAN.finditer(texto) if iban_valido(m.group(1))]
    return hallados


def _dominio(url: str) -> str:
    return urlparse(url).netloc.lower().removeprefix("www.")


@dataclass
class FiltroSalida:
    canario: str = ""
    dominios: set[str] = field(default_factory=set)
    bufer: str = ""
    retirados: list[str] = field(default_factory=list)

    def limpiar(self, texto: str) -> str:
        if self.canario and self.canario in texto:
            raise CanarioDetectado()
        texto = IMAGEN.sub(lambda m: self._retirar(f"imagen {m.group(1)}", "[imagen externa retirada]"), texto)
        texto = ENLACE.sub(lambda m: m.group(0) if _dominio(m.group(2)) in self.dominios
                           else self._retirar(f"enlace {m.group(2)}", m.group(1)), texto)
        for dato in datos_personales(texto):
            texto = texto.replace(dato, self._retirar("dato personal", "[dato personal]"))
        return texto

    def _retirar(self, que: str, por: str) -> str:
        self.retirados.append(que)
        return por

    def trozo(self, t: str) -> str:
        """Devuelve lo que ya es seguro mandar; retiene el final por si es el principio de algo."""
        self.bufer += t
        if len(self.bufer) <= RETENER:
            return ""
        corte = len(self.bufer) - RETENER
        # No cortar dentro de un posible enlace o imagen abiertos.
        abierto = max(self.bufer.rfind("![", 0, corte), self.bufer.rfind("[", 0, corte))
        if abierto != -1 and ")" not in self.bufer[abierto:corte]:
            corte = abierto
        listo = self.limpiar(self.bufer[:corte]) if corte > 0 else ""
        self.bufer = self.bufer[corte:]
        return listo

    def final(self) -> str:
        resto, self.bufer = self.bufer, ""
        return self.limpiar(resto)
