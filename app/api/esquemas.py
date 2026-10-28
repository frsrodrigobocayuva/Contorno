"""Contrato da API (DAS 6.1): JSON em camelCase, coordenadas [longitude, latitude] (WGS 84)."""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.dominio.modelo import CausaDeInviabilidade, MotivoDeBuscaVazia

Longitude = Annotated[float, Field(ge=-180, le=180)]
Latitude = Annotated[float, Field(ge=-90, le=90)]
Ponto = tuple[Longitude, Latitude]


class Modelo(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class PedidoDeRota(Modelo):
    origem: Ponto
    destino: Ponto
    restricoes: list[dict[str, Any]] = Field(
        default_factory=list,
        max_length=0,
        description="Áreas e preferências de via; entram na Sprint 5, por ora só lista vazia.",
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
