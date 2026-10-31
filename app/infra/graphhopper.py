"""Adaptador GraphHopper: implementa a porta MotorDeRotas (ADR-009; DAS 6.4)."""

import time
from collections.abc import Sequence
from typing import Any

import httpx

from app.dominio.excecoes import MotorIndisponivel
from app.dominio.modelo import (
    ConsultaDeRota,
    Coordenada,
    OpcoesDeCusto,
    Poligono,
    RegraDeCusto,
    Rota,
)
from app.infra import medicao

# Respostas 400 do GraphHopper que significam "rota vazia", e não erro (DAS 6.4).
_SEM_ROTA = ("ConnectionNotFoundException", "PointNotFoundException")


def _anel(pontos: Sequence[Coordenada]) -> list[list[float]]:
    """Anel GeoJSON: [longitude, latitude], fechado no primeiro ponto."""
    coordenadas = [[c.longitude, c.latitude] for c in pontos]
    return coordenadas if coordenadas[0] == coordenadas[-1] else [*coordenadas, coordenadas[0]]


# O GraphHopper só testa uma via contra a área se o retângulo das duas pontas da via cruzar o
# retângulo da área. Uma via longa que entra na área numa curva, com as pontas do lado de fora,
# escapava e era usada (conjunto D16, nível 3, 2026-10-31: uma via de 2,97 km atravessando 537 m de
# uma área). Dois triângulos minúsculos a mais de 100 km de São Leopoldo e Novo Hamburgo, onde o
# grafo não tem via, alargam o retângulo da área para o recorte inteiro: toda via passa pelo teste
# exato, e o que é proibido não muda. Custo medido: de 38 para 51 ms na rota do caso.
_FORA_DO_RECORTE = (
    [[[-52.5, -31.0], [-52.499, -31.0], [-52.5, -30.999], [-52.5, -31.0]]],
    [[[-49.5, -28.5], [-49.499, -28.5], [-49.5, -28.499], [-49.5, -28.5]]],
)


def modelo_com_exclusoes(exclusoes: Sequence[Poligono]) -> dict[str, Any]:
    """custom_model da restrita: uma feature por polígono, prioridade 0 em cada (RN03, DAS 6.4)."""
    features = [
        {
            "type": "Feature",
            "id": f"area{i}",
            "properties": {},
            "geometry": {
                "type": "MultiPolygon",
                "coordinates": [
                    [_anel(p.exterior), *(_anel(b) for b in p.buracos)],
                    *_FORA_DO_RECORTE,
                ],
            },
        }
        for i, p in enumerate(exclusoes)
    ]
    return {
        "areas": {"type": "FeatureCollection", "features": features},
        "priority": [{"if": f"in_area{i}", "multiply_by": "0"} for i in range(len(exclusoes))],
    }


# O vocabulário OpenStreetMap do Tradutor nos valores codificados do GraphHopper (DAS 6.5).
_VALOR_CODIFICADO = {"highway": "road_class", "surface": "surface"}


def _condicao(regra: RegraDeCusto) -> dict[str, str]:
    """Regra de via na sintaxe do custom_model: encarece por um fator entre 0 e 1 (RN06)."""
    valor = _VALOR_CODIFICADO[regra.chave_osm]
    casos = " || ".join(f"{valor} == {v.upper()}" for v in sorted(regra.valores_osm))
    return {"if": casos, "multiply_by": str(regra.fator)}


def corpo_da_rota(
    consulta: ConsultaDeRota, exclusoes: Sequence[Poligono], opcoes: OpcoesDeCusto
) -> dict[str, Any]:
    """O pedido ao /route: irrestrita no CH; com áreas ou regras, restrita no LM (ADR-014)."""
    corpo: dict[str, Any] = {
        "profile": "car",
        "points": [
            [consulta.origem.longitude, consulta.origem.latitude],
            [consulta.destino.longitude, consulta.destino.latitude],
        ],
        "points_encoded": False,
    }
    if exclusoes or opcoes.regras:
        modelo: dict[str, Any] = modelo_com_exclusoes(exclusoes) if exclusoes else {"priority": []}
        modelo["priority"] += [_condicao(r) for r in opcoes.regras]
        corpo["ch.disable"] = True
        corpo["custom_model"] = modelo
    return corpo


class AdaptadorGraphHopper:
    def __init__(self, cliente: httpx.AsyncClient, url: str, tempo_maximo_s: float) -> None:
        self._cliente = cliente
        self._url = url.rstrip("/")
        self._tempo_maximo_s = tempo_maximo_s

    async def calcular(
        self, consulta: ConsultaDeRota, exclusoes: Sequence[Poligono], opcoes: OpcoesDeCusto
    ) -> Rota | None:
        corpo = corpo_da_rota(consulta, exclusoes, opcoes)
        inicio = time.perf_counter()
        try:
            resposta = await self._cliente.post(
                f"{self._url}/route", json=corpo, timeout=self._tempo_maximo_s
            )
        except httpx.HTTPError as erro:
            raise MotorIndisponivel(str(erro)) from erro
        finally:
            medicao.registrar(time.perf_counter() - inicio)

        if resposta.status_code == 400 and any(e in resposta.text for e in _SEM_ROTA):
            return None
        if resposta.status_code >= 500:
            raise MotorIndisponivel(f"GraphHopper respondeu {resposta.status_code}")
        resposta.raise_for_status()
        caminho = resposta.json()["paths"][0]
        return Rota(
            geometria=tuple(Coordenada(c[0], c[1]) for c in caminho["points"]["coordinates"]),
            duracao_segundos=caminho["time"] / 1000,
            distancia_metros=caminho["distance"],
        )
