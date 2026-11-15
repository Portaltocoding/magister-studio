"""Experimentos con el modelo local en Ollama (necesita Ollama y `ollama pull qwen2.5:3b`).

    python afinar/ollama.py tokens fichero1.txt fichero2.txt fichero3.txt
    python afinar/ollama.py decodificar "¿Qué es una clave primaria?"

`tokens` cuenta los tokens de cada texto restando una línea base mínima de `prompt_eval_count`.
`decodificar` manda la misma pregunta con temperatura 0, 0,7 y 1,5, semilla fija, cinco veces
cada una, y cuenta cuántas respuestas distintas salen.
"""

import json
import sys
import urllib.request

URL = "http://127.0.0.1:11434/api/chat"
MODELO = "qwen2.5:3b"


def chat(texto: str, opciones: dict | None = None) -> dict:
    cuerpo = {"model": MODELO, "messages": [{"role": "user", "content": texto}], "stream": False, "options": opciones or {}}
    req = urllib.request.Request(URL, json.dumps(cuerpo).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)


def tokens(ficheros: list[str]) -> None:
    base = chat(".", {"num_predict": 1})["prompt_eval_count"]
    for f in ficheros:
        texto = open(f, encoding="utf-8").read()
        n = chat(texto, {"num_predict": 1})["prompt_eval_count"] - base
        print(f"{f}: {n} tokens · {len(texto.split())} palabras · {n / max(1, len(texto.split())):.2f} tokens por palabra")


def decodificar(pregunta: str) -> None:
    for t in (0, 0.7, 1.5):
        respuestas = {chat(pregunta, {"temperature": t, "seed": 7, "num_predict": 120})["message"]["content"] for _ in range(5)}
        print(f"temperatura {t}: {len(respuestas)} respuestas distintas de 5")


if __name__ == "__main__":
    {"tokens": lambda: tokens(sys.argv[2:]), "decodificar": lambda: decodificar(" ".join(sys.argv[2:]))}[sys.argv[1]]()
