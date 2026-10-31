"""Contrato da API (DAS 6.1): JSON em camelCase, coordenadas [longitude, latitude] (WGS 84)."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.dominio.modelo import (
    CausaDeInviabilidade,
    ClasseDeVia,
    Extremo,
    MotivoDeBuscaVazia,
    NivelDeEvitacao,
)

Longitude = Annotated[float, Field(ge=-180, le=180)]
Latitude = Annotated[float, Field(ge=-90, le=90)]
Ponto = tuple[Longitude, Latitude]


class Modelo(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


# Índice H3 em hexadecimal: o number do JavaScript não guarda 64 bits sem perda (Realização, UC01).
CelulaHex = Annotated[str, Field(pattern=r"^[0-9a-f]{15,16}$")]


class RestricaoArea(Modelo):
    """Área declarada, com as células que o cliente recebeu em /restricoes/area (UC01, [2])."""

    tipo: Literal["AREA"]
    id: str = Field(min_length=1, max_length=64, description="Gerado no cliente (plano, A8).")
    rotulo: str = Field(min_length=1, max_length=80, description='O nome, ou "Área N".')
    celulas: list[CelulaHex] = Field(min_length=1, max_length=20_000)


class RestricaoVia(Modelo):
    """Preferência por classe de via (UC03): penaliza, nunca proíbe (RN06)."""

    tipo: Literal["VIA"]
    classe: ClasseDeVia
    nivel: NivelDeEvitacao


Restricao = Annotated[RestricaoArea | RestricaoVia, Field(discriminator="tipo")]


class PedidoDeRota(Modelo):
    origem: Ponto
    destino: Ponto
    restricoes: list[Restricao] = Field(
        default_factory=list,
        description="Áreas declaradas e preferências por classe de via, uma por classe.",
    )


class LinhaGeoJSON(Modelo):
    type: Literal["LineString"] = "LineString"
    coordinates: list[Ponto]


class RotaDTO(Modelo):
    geometria: LinhaGeoJSON
    duracao_segundos: float
    distancia_metros: float


class RespostaRotas(Modelo):
    tipo: Literal["ROTAS"] = "ROTAS"
    irrestrita: RotaDTO
    restrita: RotaDTO | None = None


class RespostaDiagnostico(Modelo):
    """Inviabilidade: 200 com um objeto só de diagnóstico (plano, D6)."""

    tipo: Literal["DIAGNOSTICO"] = "DIAGNOSTICO"
    causa: CausaDeInviabilidade
    candidatas: list[str]
    mensagem: str


RespostaCalculo = Annotated[RespostaRotas | RespostaDiagnostico, Field(discriminator="tipo")]


class PedidoDeArea(Modelo):
    """Desenho do usuário (UC02) e, se já escolhidos, a origem e o destino da consulta."""

    poligono: list[Ponto] = Field(
        min_length=3,
        max_length=500,
        description="Vértices do desenho, em ordem, sem repetir o primeiro no fim.",
    )
    origem: Ponto | None = None
    destino: Ponto | None = None


class MultiPoligonoGeoJSON(Modelo):
    type: Literal["MultiPolygon"] = "MultiPolygon"
    coordinates: list[list[list[Ponto]]]


class RespostaArea(Modelo):
    """A área proibida para o usuário conferir (UC02; RN04)."""

    celulas: list[str] = Field(description="Células H3 compactadas, em hexadecimal (ADR-011).")
    contorno: MultiPoligonoGeoJSON
    area_desenhada_m2: float
    area_proibida_m2: float
    conflitos: list[Extremo] = Field(description="Extremos que caem dentro da área (UC02, B).")


class LugarDTO(Modelo):
    nome: str
    coordenada: Ponto


class RespostaEnderecos(Modelo):
    lugares: list[LugarDTO]
    motivo: MotivoDeBuscaVazia | None = None


class Erro(Modelo):
    """Formato único de erro (DAS 6.9)."""

    codigo: str
    mensagem: str
    detalhes: list[dict[str, str]] | None = None
