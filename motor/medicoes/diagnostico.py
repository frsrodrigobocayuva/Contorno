"""Medição [5] do DAS 8 (A2): tempo do diagnóstico de inviabilidade com 3 áreas (meta: 4 s, p95) e
com 10 áreas (só registro, D2), com concorrência 1, 2, 4 e 8.

Cenário: o destino (centro de Novo Hamburgo) fica isolado por 3 raios sobrepostos em anel, sem
ficar dentro deles; tirar um dos raios abre o caminho (os dois do sul cobrem juntos as travessias
entre SL e NH, então só eles são candidatos). Com 10 áreas, entram mais 7 raios de 500 m ao longo
da primeira metade da rota, que sozinhos não bloqueiam nada.
Cada execução mede o caminho do UC01 seguido do UC05 (ADR-008):
  1. restrita (sem rota) e irrestrita em paralelo;
  2. uma restrita sem cada área, em paralelo, com concorrência limitada; cada rota é validada.
O tempo inclui montar os contornos (resolução 11) e validar as rotas.

Uso: docker compose run --rm dev python motor/medicoes/diagnostico.py
"""

import asyncio
import math
import sys
from dataclasses import dataclass, field

import httpx
from comum import (
    CENTRO_NOVO_HAMBURGO,
    UNISINOS,
    agora,
    ao_lado_da_linha,
    celulas,
    circulo,
    cliente,
    contem,
    contorno,
    contorno_preparado,
    corpo_irrestrita,
    corpo_restrita,
    modelo_com_areas,
    ms,
    p50,
    p95,
    para_utm,
    ponto_utm,
    rota,
    viola,
)
from shapely.geometry import LineString, Point

RESOLUCAO = 11
# Raio e distância ao destino dos 3 raios do anel; o primeiro par que isola o destino é usado.
ANEIS_M = ((1500, 1650), (2000, 2200))
RAIO_EXTRA_M = 500
CONCORRENCIAS = (1, 2, 4, 8)
AQUECIMENTO = 3
EXECUCOES = 20
META_S = 4.0
AREAS_DA_META = 3


@dataclass
class Medida:
    areas: int
    concorrencia: int
    uc01: list[float] = field(default_factory=list)
    uc05: list[float] = field(default_factory=list)
    total: list[float] = field(default_factory=list)
    candidatas: list[int] = field(default_factory=list)
    violacoes: int = 0


def anel(raio_m: float, distancia_m: float) -> list[set[str]]:
    destino = ponto_utm(CENTRO_NOVO_HAMBURGO)
    centros = [
        Point(
            destino.x + distancia_m * math.cos(math.radians(a)),
            destino.y + distancia_m * math.sin(math.radians(a)),
        )
        for a in (90, 210, 330)
    ]
    return [celulas(circulo(c, raio_m), RESOLUCAO) for c in centros]


async def rota_restrita(
    c: httpx.AsyncClient, areas: list[set[str]]
) -> tuple[dict[str, object] | None, bool]:
    """Restrita com as áreas dadas: (caminho ou None, se a rota encontrada violou o contorno)."""
    poligonos = contorno(set().union(*areas))
    caminho = await rota(
        c, corpo_restrita(UNISINOS, CENTRO_NOVO_HAMBURGO, modelo_com_areas(poligonos))
    )
    return caminho, caminho is not None and viola(caminho, contorno_preparado(poligonos))


async def escolher_anel(c: httpx.AsyncClient) -> list[set[str]]:
    for raio, distancia in ANEIS_M:
        areas = anel(raio, distancia)
        if contem(set().union(*areas), CENTRO_NOVO_HAMBURGO, RESOLUCAO):
            continue
        sem_rota = (await rota_restrita(c, areas))[0] is None
        abre = [(await rota_restrita(c, areas[:i] + areas[i + 1 :]))[0] for i in range(3)]
        if sem_rota and any(caminho is not None for caminho in abre):
            print(f"    anel: 3 raios de {raio} m a {distancia} m do destino")
            return areas
    sys.exit("nenhum anel isolou o destino; ajustar ANEIS_M")


async def diagnosticar(
    c: httpx.AsyncClient, areas: list[set[str]], concorrencia: int
) -> tuple[float, float, list[int], int]:
    t0 = agora()
    _, (restrita, _) = await asyncio.gather(
        rota(c, corpo_irrestrita(UNISINOS, CENTRO_NOVO_HAMBURGO)), rota_restrita(c, areas)
    )
    if restrita is not None:
        sys.exit("o cenário deveria não ter rota restrita")
    t1 = agora()
    limite = asyncio.Semaphore(concorrencia)

    async def sem_a_area(i: int) -> tuple[dict[str, object] | None, bool]:
        async with limite:
            return await rota_restrita(c, areas[:i] + areas[i + 1 :])

    resultados = await asyncio.gather(*(sem_a_area(i) for i in range(len(areas))))
    t2 = agora()
    candidatas = [i for i, (caminho, violou) in enumerate(resultados) if caminho and not violou]
    violacoes = sum(violou for _, violou in resultados)
    return t1 - t0, t2 - t1, candidatas, violacoes


async def principal() -> None:
    print("[5] Diagnóstico de inviabilidade: UNISINOS -> centro de Novo Hamburgo isolado")
    print(f"    {AQUECIMENTO} execuções de aquecimento descartadas; {EXECUCOES} medidas por linha")
    async with cliente() as c:
        base = await rota(c, corpo_irrestrita(UNISINOS, CENTRO_NOVO_HAMBURGO))
        if base is None:
            sys.exit("sem rota irrestrita")
        rota_utm = para_utm(LineString(base["points"]["coordinates"]))
        cenario_3 = await escolher_anel(c)
        extras = [
            celulas(
                circulo(
                    ao_lado_da_linha(rota_utm, 0.08 + 0.07 * i, 250 * (1 if i % 2 == 0 else -1)),
                    RAIO_EXTRA_M,
                ),
                RESOLUCAO,
            )
            for i in range(7)
        ]
        cenario_10 = cenario_3 + extras
        if contem(set().union(*cenario_10), UNISINOS, RESOLUCAO):
            sys.exit("a origem ficou dentro das células")

        print(
            f"\n{'áreas':>5} {'concorr.':>8} {'UC01 p95':>9} {'UC05 p95':>9} {'total p50':>9} "
            f"{'total p95':>9} {'máx':>8} {'candidatas':>10} {'violações':>9}"
        )
        medidas: list[Medida] = []
        for areas in (cenario_3, cenario_10):
            for concorrencia in CONCORRENCIAS:
                m = Medida(len(areas), concorrencia)
                for i in range(AQUECIMENTO + EXECUCOES):
                    uc01, uc05, candidatas, violacoes = await diagnosticar(c, areas, concorrencia)
                    if i < AQUECIMENTO:
                        continue
                    m.uc01.append(uc01)
                    m.uc05.append(uc05)
                    m.total.append(uc01 + uc05)
                    m.candidatas = candidatas
                    m.violacoes += violacoes
                medidas.append(m)
                print(
                    f"{m.areas:>5} {m.concorrencia:>8} {ms(p95(m.uc01)):>9} {ms(p95(m.uc05)):>9} "
                    f"{ms(p50(m.total)):>9} {ms(p95(m.total)):>9} {ms(max(m.total)):>8} "
                    f"{len(m.candidatas):>10} {m.violacoes:>9}"
                )

    meta = [m for m in medidas if m.areas == AREAS_DA_META]
    melhor = min(meta, key=lambda m: p95(m.total))
    cumpre = [m.concorrencia for m in meta if p95(m.total) <= META_S]
    print(
        f"\nA2: com {AREAS_DA_META} áreas, melhor p95 = {ms(p95(melhor.total))} "
        f"(concorrência {melhor.concorrencia}; meta {ms(META_S)}); "
        f"cumprem a meta: concorrência {', '.join(map(str, cumpre)) or 'nenhuma'}"
    )


if __name__ == "__main__":
    asyncio.run(principal())
