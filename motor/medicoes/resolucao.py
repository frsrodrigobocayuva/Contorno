"""Medição [1] do DAS 8 (A1): tempo da rota restrita com 1, 3, 5 e 10 raios de 500 m, nas resoluções
11 e 10, de UNISINOS ao centro de Novo Hamburgo.

Os raios ficam espalhados ao longo da rota irrestrita, alternando os lados, para que cada um corte a
rota e force desvio sem fechar o caminho. Cada execução mede o caminho do UC01: montar o contorno a
partir das células compactadas (ADR-011), chamar a restrita (LM) com a irrestrita (CH) em paralelo e
validar a restrita contra o contorno (ADR-012).

Decisão (A1): a resolução 11 fica se 3 raios tiverem p95 de até 2 s em 20 execuções; senão cai
para 10. Os tempos com 5 e 10 raios são só registrados (D2: sem limite de áreas).

Uso: docker compose run --rm dev python motor/medicoes/resolucao.py
"""

import asyncio
import sys
from dataclasses import dataclass, field

import h3
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
    rota,
    vertices,
    viola,
)
from shapely.geometry import LineString

QUANTIDADES = (1, 3, 5, 10)
RESOLUCOES = (11, 10)
RAIO_M = 500
DESLOCAMENTO_M = 250  # para os lados da rota, alternando
AQUECIMENTO = 3
EXECUCOES = 20
ORCAMENTO_S = 2.0
AREAS_DA_DECISAO = 3


@dataclass
class Medida:
    resolucao: int
    areas: int
    celulas: int = 0
    vertices: int = 0
    preparo: list[float] = field(default_factory=list)
    motor: list[float] = field(default_factory=list)
    validacao: list[float] = field(default_factory=list)
    total: list[float] = field(default_factory=list)
    restrita_km: float = 0.0
    irrestrita_km: float = 0.0
    violacoes: int = 0
    sem_rota: int = 0


async def medir(rota_utm: LineString, resolucao: int, n: int) -> Medida:
    centros = [
        ao_lado_da_linha(rota_utm, (i + 1) / (n + 1), DESLOCAMENTO_M * (1 if i % 2 == 0 else -1))
        for i in range(n)
    ]
    # Cada área chega ao servidor como as células compactadas (ADR-011).
    por_area = [celulas(circulo(c, RAIO_M), resolucao) for c in centros]
    compactadas = [h3.compact_cells(list(cs)) for cs in por_area]
    todas = set().union(*por_area)
    for extremo in (UNISINOS, CENTRO_NOVO_HAMBURGO):
        if contem(todas, extremo, resolucao):
            sys.exit(f"res {resolucao}, {n} áreas: um extremo ficou dentro das células")

    medida = Medida(resolucao, n, celulas=len(todas))
    async with cliente() as c:
        for i in range(AQUECIMENTO + EXECUCOES):
            t0 = agora()
            uniao: set[str] = set()
            for comp in compactadas:
                uniao |= set(h3.uncompact_cells(comp, resolucao))
            poligonos = contorno(uniao)
            preparado = contorno_preparado(poligonos)
            modelo = modelo_com_areas(poligonos)
            t1 = agora()
            irrestrita, restrita = await asyncio.gather(
                rota(c, corpo_irrestrita(UNISINOS, CENTRO_NOVO_HAMBURGO)),
                rota(c, corpo_restrita(UNISINOS, CENTRO_NOVO_HAMBURGO, modelo)),
            )
            t2 = agora()
            violou = restrita is not None and viola(restrita, preparado)
            t3 = agora()
            if i < AQUECIMENTO:
                continue
            medida.preparo.append(t1 - t0)
            medida.motor.append(t2 - t1)
            medida.validacao.append(t3 - t2)
            medida.total.append(t3 - t0)
            medida.violacoes += violou
            medida.vertices = vertices(poligonos)
            if restrita is None:
                medida.sem_rota += 1
            else:
                medida.restrita_km = restrita["distance"] / 1000
            if irrestrita is not None:
                medida.irrestrita_km = irrestrita["distance"] / 1000
    return medida


async def principal() -> None:
    async with cliente() as c:
        base = await rota(c, corpo_irrestrita(UNISINOS, CENTRO_NOVO_HAMBURGO))
    if base is None:
        sys.exit("sem rota irrestrita entre UNISINOS e o centro de Novo Hamburgo")
    rota_utm = para_utm(LineString(base["points"]["coordinates"]))

    print("[1] Rota restrita com raios de 500 m: UNISINOS -> centro de Novo Hamburgo")
    print(f"    {AQUECIMENTO} execuções de aquecimento descartadas; {EXECUCOES} medidas por linha")
    print(f"    irrestrita: {base['distance'] / 1000:.1f} km\n")
    cabecalho = (
        f"{'res':>3} {'áreas':>5} {'células':>7} {'vértices':>8} {'preparo p95':>11} "
        f"{'motor p95':>9} {'valid. p95':>10} {'total p50':>9} {'total p95':>9} {'máx':>8} "
        f"{'restrita':>8} {'violações':>9} {'sem rota':>8}"
    )
    print(cabecalho)
    medidas: list[Medida] = []
    for resolucao in RESOLUCOES:
        for n in QUANTIDADES:
            m = await medir(rota_utm, resolucao, n)
            medidas.append(m)
            print(
                f"{m.resolucao:>3} {m.areas:>5} {m.celulas:>7} {m.vertices:>8} "
                f"{ms(p95(m.preparo)):>11} {ms(p95(m.motor)):>9} {ms(p95(m.validacao)):>10} "
                f"{ms(p50(m.total)):>9} {ms(p95(m.total)):>9} {ms(max(m.total)):>8} "
                f"{m.restrita_km:>6.1f} km {m.violacoes:>9} {m.sem_rota:>8}"
            )

    decisiva = next(m for m in medidas if m.resolucao == 11 and m.areas == AREAS_DA_DECISAO)
    tempo = p95(decisiva.total)
    fica = tempo <= ORCAMENTO_S and decisiva.sem_rota == 0 and decisiva.violacoes == 0
    print(
        f"\nA1: com {AREAS_DA_DECISAO} raios na resolução 11, p95 = {ms(tempo)} "
        f"(orçamento {ms(ORCAMENTO_S)}) -> {'a resolução 11 fica' if fica else 'cai para 10'}"
    )
    print(f"Pior p95 de uma chamada ao motor: {ms(max(p95(m.motor) for m in medidas))}")


if __name__ == "__main__":
    asyncio.run(principal())
