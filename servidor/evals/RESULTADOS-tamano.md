# Tamaño de los planes (evals/tamano_plan.py)

18-11-2026. Seis peticiones con un rango razonable de horas y lecciones puesto a mano, y un presupuesto amplio a
propósito (2 h al día, 60 días: unas 75 h) para ver si el planificador lo llena. Una pasada por versión.

| Versión | dividir | acimut | usucapión | derivadas | bbdd | delirios (máster) | Dentro |
|---|---|---|---|---|---|---|---|
| Solo un tope de horas (antes) | 7 h | 8 h | 16 h | 32 h | 36 h | 32,5 h | 0/6 |
| Prompt: «el tamaño lo marca lo que pide» + referencias de horas | 9 h | 4 h | 8,5 h | 12 h | 21,5 h | 18 h | 2/6 |
| + `alcance` declarado y topes por alcance en código, holgados | 4 h | 3,2 h | 3,2 h | 13 h | 35 h | 14,5 h | 1/6 |
| + topes justos y, si solo falla eso, recorte proporcional | 3 h | 3 h | 9 h | 12 h | 27 h | 19,5 h | 4/6 |

- Con topes holgados el modelo se va al tope (bbdd: 35 h justas para un tope de 35). Por eso son justos.
- Si tras sus intentos solo se pasa de horas, el código recorta en proporción: antes derivadas se quedaba sin plan.
- Lo que queda: el modelo clasifica al alza para darse horas (dividir como «concepto», usucapión como «tema»).
