"""Contar los parámetros de un modelo desde su config.json (solo biblioteca estándar).

    python afinar/contar.py ruta/al/config.json

Imprime cada término por separado: embeddings, atención por bloque (con GQA), feed-forward
por bloque (SwiGLU), total, memoria en bf16 y en 4 bits, y la caché KV por token en fp16.
"""

import json
import sys


def contar(c: dict) -> dict:
    d = c["hidden_size"]
    capas = c["num_hidden_layers"]
    vocab = c["vocab_size"]
    cabezas = c["num_attention_heads"]
    kv = c.get("num_key_value_heads", cabezas)
    dim_cabeza = c.get("head_dim", d // cabezas)
    ff = c["intermediate_size"]
    atado = c.get("tie_word_embeddings", False)
    sesgo_qkv = 1 if c.get("model_type", "").startswith("qwen2") else 0
    embeddings = vocab * d * (1 if atado else 2)
    q = d * cabezas * dim_cabeza + sesgo_qkv * cabezas * dim_cabeza
    k = v = d * kv * dim_cabeza + sesgo_qkv * kv * dim_cabeza
    o = cabezas * dim_cabeza * d
    atencion = q + k + v + o
    feed_forward = 3 * d * ff  # SwiGLU: puerta, subida y bajada
    normas = 2 * d
    por_bloque = atencion + feed_forward + normas
    total = embeddings + capas * por_bloque + d
    return {
        "embeddings": embeddings, "atencion_por_bloque": atencion, "feed_forward_por_bloque": feed_forward,
        "por_bloque": por_bloque, "bloques": capas, "total": total,
        "memoria_bf16_gb": total * 2 / 1e9, "memoria_4bit_gb": total * 0.5 / 1e9,
        "kv_por_token_fp16_kb": 2 * capas * kv * dim_cabeza * 2 / 1024,
    }


if __name__ == "__main__":
    datos = contar(json.load(open(sys.argv[1], encoding="utf-8")))
    for k, v in datos.items():
        print(f"{k:<26} {v:,.2f}" if isinstance(v, float) else f"{k:<26} {v:,}")
