"""Medição [3] do DAS 8 (A3): calibração dos fatores de via, por classe.

30 pares origem/destino sorteados no recorte com semente fixa (encaixe na via de até 300 m e rota de
pelo menos 2 km). Para cada classe do UC03, entram os pares cuja rota no nível indiferente passa por
pelo menos 200 m da classe; cada par roda nos três níveis e com um fator quase zero (0,001), e os
metros na classe vêm dos details do GraphHopper.

Critério (A3, revisado em 2026-10-27): a queda é medida só sobre o trecho evitável, o que some com o
fator quase zero; o que sobra não tem alternativa. Na mediana dos pares, o trecho evitável cai pelo
menos 25% de indiferente para evitar e de evitar para evitar fortemente. Pares com menos de 50 m
evitáveis ficam fora da conta; se evitar já tirou todo o evitável, a queda seguinte conta 100%.

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
MINIMO_EVITAVEL_M = 50
QUEDA_MINIMA = 0.25
QUASE_ZERO = "0.001"

# Tabela do UC03: (path detail, valores do detail, condição do custom_model,
# fatores de evitar e de evitar fortemente). Nenhum fator é zero (RN06).
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
        ("0.3", "0.05"),
    ),
    "rua residencial": (
        "road_class",
        {"residential", "living_street"},
        "road_class == RESIDENTIAL || road_class == LIVING_STREET",
        ("0.5", "0.1"),
    ),
    "via arterial": (
        "road_class",
        {"primary", "secondary"},
        "road_class == PRIMARY || road_class == SECONDARY",
        ("0.5", "0.1"),
    ),
    "rodovia": (
        "road_class",
        {"motorway", "trunk"},
        "road_class == MOTORWAY || road_class == TRUNK",
        ("0.5", "0.1"),
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


async def com_fator(
    c: httpx.AsyncClient,
    par: tuple[list[float], list[float]],
    detalhe: str,
    condicao: str,
    fator: str,
) -> dict[str, Any]:
    modelo = {"priority": [{"if": condicao, "multiply_by": fator}]}
    caminho = await rota(c, corpo_restrita(*par, modelo, [detalhe]))
    assert caminho is not None  # fator maior que zero nunca bloqueia
    return caminho


async def principal() -> None:
    print("[3] Calibração dos fatores de via, por classe (A3 sobre o trecho evitável)")
    async with cliente() as c:
        pares = await sortear_pares(c)
        print(f"    {len(pares)} pares sorteados (semente {SEMENTE})\n")
        print(
            f"{'classe':<22} {'fatores':>11} {'pares':>7} {'sem alternativa':>15} "
            f"{'queda 1':>7} {'queda 2':>7} {'+distância':>10} {'pior':>6}  A3"
        )
        reprovadas = []
        for classe, (detalhe, valores, condicao, fatores) in CLASSES.items():
            linhas = []
            for par in pares:
                indiferente = await rota(c, corpo_restrita(*par, {}, [detalhe]))
                if indiferente is None:
                    continue
                m0 = metros_na_classe(indiferente, detalhe, valores)
                if m0 < MINIMO_NA_CLASSE_M:
                    continue
                quase_zero = await com_fator(c, par, detalhe, condicao, QUASE_ZERO)
                minimo = metros_na_classe(quase_zero, detalhe, valores)
                evitar, forte = [await com_fator(c, par, detalhe, condicao, f) for f in fatores]
                m1, m2 = (metros_na_classe(n, detalhe, valores) for n in (evitar, forte))
                acrescimo = forte["distance"] / indiferente["distance"] - 1
                linhas.append((m0, minimo, m1, m2, acrescimo))
            evitaveis = [linha for linha in linhas if linha[0] - linha[1] >= MINIMO_EVITAVEL_M]
            if not evitaveis:
                print(f"{classe:<22}  nenhum par com trecho evitável")
                reprovadas.append(classe)
                continue
            sem_alternativa = statistics.median(mn / m0 for m0, mn, *_ in linhas)
            queda1 = statistics.median((m0 - m1) / (m0 - mn) for m0, mn, m1, _, _ in evitaveis)
            queda2 = statistics.median(
                (m1 - m2) / (m1 - mn) if m1 - mn > 1 else 1.0 for _, mn, m1, m2, _ in evitaveis
            )
            acrescimos = [linha[4] for linha in linhas]
            passa = queda1 >= QUEDA_MINIMA and queda2 >= QUEDA_MINIMA
            if not passa:
                reprovadas.append(classe)
            print(
                f"{classe:<22} {' / '.join(fatores):>11} {len(evitaveis):>3}/{len(linhas):<3} "
                f"{sem_alternativa:>15.0%} {queda1:>7.0%} {queda2:>7.0%} "
                f"{statistics.median(acrescimos):>+10.1%} {max(acrescimos):>+6.0%}  "
                f"{'passa' if passa else 'NÃO'}"
            )

    print(
        "\n    pares: com trecho evitável / com a classe na rota indiferente"
        "\n    sem alternativa: parte dos metros que fica mesmo com fator 0,001 (mediana)"
        "\n    queda 1: indiferente -> evitar; queda 2: evitar -> evitar fortemente (no evitável)"
        "\n    +distância e pior: rota em evitar fortemente contra a indiferente (mediana e máx.)"
    )
    if reprovadas:
        print(f"\nA3: não passaram: {', '.join(reprovadas)}. Parar e levar os números ao usuário.")
    else:
        print("\nA3: os fatores passam em todas as classes.")


if __name__ == "__main__":
    asyncio.run(principal())
