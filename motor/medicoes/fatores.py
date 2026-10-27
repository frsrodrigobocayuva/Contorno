"""Medição [3] do DAS 8 (A3): calibração dos fatores 0,5 (evitar) e 0,1 (evitar fortemente).

30 pares origem/destino sorteados no recorte com semente fixa (encaixe na via de até 300 m e rota de
pelo menos 2 km). Para cada classe do UC03, entram os pares cuja rota no nível indiferente passa por
pelo menos 200 m da classe; cada par roda nos três níveis, e os metros na classe vêm dos details do
GraphHopper.

Critério (A3): na mediana dos pares, os metros na classe caem pelo menos 25% de indiferente para
evitar e de evitar para evitar fortemente. Se o par já zerou a classe em evitar, a queda seguinte
conta 100%. Se uma classe não passar, a medição para e os números vão para o usuário (decisão de
2026-10-27).

Uso: docker compose run --rm dev python motor/medicoes/fatores.py
"""

import asyncio
import random
import statistics
import sys
from typing import Any

import httpx
from comum import RETANGULO, cliente, corpo_irrestrita, corpo_restrita, metros, rota

SEMENTE = 2026
PARES = 30
DISTANCIA_MINIMA_M = 2000
ENCAIXE_MAXIMO_M = 300
MINIMO_NA_CLASSE_M = 200
QUEDA_MINIMA = 0.25
NIVEIS = (("evitar", "0.5"), ("evitar fortemente", "0.1"))

# Tabela do UC03: (path detail, valores do detail, condição do custom_model).
SEM_PAVIMENTACAO = (
    "unpaved",
    "dirt",
    "gravel",
    "ground",
    "sand",
    "grass",
    "compacted",
    "fine_gravel",
)
CLASSES = {
    "via sem pavimentação": (
        "surface",
        set(SEM_PAVIMENTACAO),
        " || ".join(f"surface == {v.upper()}" for v in SEM_PAVIMENTACAO),
    ),
    "rua residencial": (
        "road_class",
        {"residential", "living_street"},
        "road_class == RESIDENTIAL || road_class == LIVING_STREET",
    ),
    "via arterial": (
        "road_class",
        {"primary", "secondary"},
        "road_class == PRIMARY || road_class == SECONDARY",
    ),
    "rodovia": (
        "road_class",
        {"motorway", "trunk"},
        "road_class == MOTORWAY || road_class == TRUNK",
    ),
}


def metros_na_classe(caminho: dict[str, Any], detalhe: str, valores: set[str]) -> float:
    pontos = caminho["points"]["coordinates"]
    return sum(
        metros(pontos[inicio : fim + 1])
        for inicio, fim, valor in caminho["details"][detalhe]
        if str(valor).lower() in valores
    )


async def sortear_pares(c: httpx.AsyncClient) -> list[tuple[list[float], list[float]]]:
    sorteio = random.Random(SEMENTE)
    min_lon, min_lat, max_lon, max_lat = RETANGULO
    pares: list[tuple[list[float], list[float]]] = []
    for _ in range(2000):
        if len(pares) == PARES:
            return pares
        par = [
            [sorteio.uniform(min_lon, max_lon), sorteio.uniform(min_lat, max_lat)] for _ in range(2)
        ]
        resposta = await c.post("/route", json=corpo_irrestrita(par[0], par[1]))
        if resposta.status_code != 200:
            continue
        caminho = resposta.json()["paths"][0]
        encaixes = caminho["snapped_waypoints"]["coordinates"]
        longe = any(metros([p, e]) > ENCAIXE_MAXIMO_M for p, e in zip(par, encaixes, strict=True))
        if not longe and caminho["distance"] >= DISTANCIA_MINIMA_M:
            pares.append((par[0], par[1]))
    sys.exit(f"só {len(pares)} pares válidos em 2000 sorteios")


async def principal() -> None:
    print("[3] Calibração dos fatores de via: 0,5 (evitar) e 0,1 (evitar fortemente)")
    async with cliente() as c:
        pares = await sortear_pares(c)
        print(f"    {len(pares)} pares sorteados (semente {SEMENTE})\n")
        print(
            f"{'classe':<22} {'pares':>5} {'m na classe (mediana)':>24} "
            f"{'queda 1 (mediana)':>17} {'queda 2 (mediana)':>17} {'+distância':>10}  A3"
        )
        reprovadas = []
        for classe, (detalhe, valores, condicao) in CLASSES.items():
            linhas = []
            for origem, destino in pares:
                indiferente = await rota(c, corpo_restrita(origem, destino, {}, [detalhe]))
                if indiferente is None:
                    continue
                m0 = metros_na_classe(indiferente, detalhe, valores)
                if m0 < MINIMO_NA_CLASSE_M:
                    continue
                niveis = []
                for _, fator in NIVEIS:
                    modelo = {"priority": [{"if": condicao, "multiply_by": fator}]}
                    caminho = await rota(c, corpo_restrita(origem, destino, modelo, [detalhe]))
                    assert caminho is not None  # fator maior que zero nunca bloqueia
                    niveis.append(caminho)
                m1, m2 = (metros_na_classe(n, detalhe, valores) for n in niveis)
                acrescimo = niveis[1]["distance"] / indiferente["distance"] - 1
                linhas.append(
                    (m0, m1, m2, (m0 - m1) / m0, (m1 - m2) / m1 if m1 else 1.0, acrescimo)
                )
            if not linhas:
                print(f"{classe:<22} {0:>5}  nenhum par passa por {MINIMO_NA_CLASSE_M} m da classe")
                reprovadas.append(classe)
                continue
            medianas = [statistics.median(coluna) for coluna in zip(*linhas, strict=True)]
            m0, m1, m2, queda1, queda2, acrescimo = medianas
            passa = queda1 >= QUEDA_MINIMA and queda2 >= QUEDA_MINIMA
            if not passa:
                reprovadas.append(classe)
            print(
                f"{classe:<22} {len(linhas):>5} {m0:>7.0f} / {m1:>6.0f} / {m2:>6.0f} m "
                f"{queda1:>16.0%} {queda2:>17.0%} {acrescimo:>+10.1%}  "
                f"{'passa' if passa else 'NÃO'}"
            )

    print(
        "\n    m na classe: indiferente / evitar / evitar fortemente"
        "\n    queda 1: indiferente -> evitar; queda 2: evitar -> evitar fortemente"
        "\n    +distância: rota em evitar fortemente contra a indiferente"
    )
    if reprovadas:
        print(f"\nA3: não passaram: {', '.join(reprovadas)}. Parar e levar os números ao usuário.")
    else:
        print("\nA3: os fatores 0,5 e 0,1 passam em todas as classes.")


if __name__ == "__main__":
    asyncio.run(principal())
