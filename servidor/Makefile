# Desde servidor/ (en Windows, con make de Git Bash o `uv run python -m evals.suite` directamente).
.PHONY: pruebas evals ataques

pruebas:
	MAGISTER_MOTOR=eco uv run pytest -q

ataques:
	MAGISTER_MOTOR=eco uv run python -m evals.ataques --salir-si-falla

evals:
	PYTHONUTF8=1 uv run python -m evals.suite
	PYTHONUTF8=1 uv run python -m evals.ataques
