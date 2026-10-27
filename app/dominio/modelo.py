"""Modelo do domínio: o Diagrama de Classes sem perfil e dono (plano do MVP, S4-05).

Os objetos de valor são imutáveis; a única entidade é a AreaExcluida, identificada pelo id gerado
no cliente (plano, A8). Valor fora das regras levanta ValueError: a API valida a entrada antes
(DAS 6.10), então chegar aqui com valor inválido é erro de programação.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, replace
from enum import StrEnum

# Enumerações, com os nomes do contrato da API (DAS 6.1).


class ClasseDeVia(StrEnum):
    SEM_PAVIMENTACAO = "SEM_PAVIMENTACAO"
    RESIDENCIAL = "RESIDENCIAL"
    ARTERIAL = "ARTERIAL"
    RODOVIA = "RODOVIA"


class NivelDeEvitacao(StrEnum):
    INDIFERENTE = "INDIFERENTE"
    EVITAR = "EVITAR"
    EVITAR_FORTEMENTE = "EVITAR_FORTEMENTE"


class TipoDeOrigem(StrEnum):
    POLIGONO_DESENHADO = "POLIGONO_DESENHADO"
    RAIO_SOBRE_ENDERECO = "RAIO_SOBRE_ENDERECO"


class CausaDeInviabilidade(StrEnum):
    DESTINO_INALCANCAVEL = "DESTINO_INALCANCAVEL"
    RESTRICAO_UNICA = "RESTRICAO_UNICA"
    COMBINACAO_DE_RESTRICOES = "COMBINACAO_DE_RESTRICOES"


class MotivoDeBuscaVazia(StrEnum):
    SEM_RESULTADO = "SEM_RESULTADO"
    SERVICO_INDISPONIVEL = "SERVICO_INDISPONIVEL"


# Geometria básica, em WGS 84 e na ordem do GeoJSON: longitude, latitude (DAS 6.1).


@dataclass(frozen=True, slots=True)
class Coordenada:
    longitude: float
    latitude: float

    def __post_init__(self) -> None:
        if not -180 <= self.longitude <= 180:
            raise ValueError(f"longitude fora da faixa: {self.longitude}")
        if not -90 <= self.latitude <= 90:
            raise ValueError(f"latitude fora da faixa: {self.latitude}")


Anel = tuple[Coordenada, ...]


@dataclass(frozen=True, slots=True)
class Poligono:
    """Contorno externo e buracos; o contorno de um conjunto de células pode ter buracos."""

    exterior: Anel
    buracos: tuple[Anel, ...] = ()

    def __post_init__(self) -> None:
        for anel in (self.exterior, *self.buracos):
            if len(set(anel)) < 3:
                raise ValueError("todo anel do polígono precisa de pelo menos 3 vértices distintos")


# Áreas: células H3 (ADR-002, ADR-010) e a origem do desenho (UC02).


def resolucao_do_indice(indice: int) -> int:
    """Resolução gravada no próprio índice H3, nos bits 52 a 55."""
    return (indice >> 52) & 0xF


@dataclass(frozen=True, slots=True)
class ConjuntoDeCelulas:
    """Células H3 de uma resolução só, como inteiros (DAS 6.3). Nunca vazio.

    Compactar fica fora do domínio base: entra com o Indexador Espacial (S5-01, ADR-011).
    """

    resolucao: int
    indices: frozenset[int]

    def __post_init__(self) -> None:
        if not 0 <= self.resolucao <= 15:
            raise ValueError(f"resolução H3 inválida: {self.resolucao}")
        if not self.indices:
            raise ValueError("conjunto de células vazio")
        fora = sum(resolucao_do_indice(i) != self.resolucao for i in self.indices)
        if fora:
            raise ValueError(f"{fora} índice(s) fora da resolução {self.resolucao}")

    def unir(self, outro: ConjuntoDeCelulas) -> ConjuntoDeCelulas:
        """União de conjuntos, sem geometria (RN05)."""
        if outro.resolucao != self.resolucao:
            raise ValueError("só se unem conjuntos da mesma resolução")
        return ConjuntoDeCelulas(self.resolucao, self.indices | outro.indices)

    def contem(self, indice: int) -> bool:
        return indice in self.indices

    def quantidade(self) -> int:
        return len(self.indices)


@dataclass(frozen=True, slots=True)
class OrigemDaArea:
    """De onde a área veio: o polígono desenhado ou o raio sobre um endereço (UC02)."""

    tipo: TipoDeOrigem
    geometria_desenhada: Poligono | None = None
    centro: Coordenada | None = None
    raio_metros: float | None = None

    def __post_init__(self) -> None:
        desenhada = self.geometria_desenhada is not None
        raio = self.centro is not None or self.raio_metros is not None
        if self.tipo is TipoDeOrigem.POLIGONO_DESENHADO and (not desenhada or raio):
            raise ValueError("polígono desenhado leva só a geometria desenhada")
        if self.tipo is TipoDeOrigem.RAIO_SOBRE_ENDERECO and (
            desenhada or self.centro is None or self.raio_metros is None or self.raio_metros <= 0
        ):
            raise ValueError("raio sobre endereço leva só o centro e um raio positivo")

    @classmethod
    def desenhada(cls, poligono: Poligono) -> OrigemDaArea:
        return cls(TipoDeOrigem.POLIGONO_DESENHADO, geometria_desenhada=poligono)

    @classmethod
    def raio(cls, centro: Coordenada, raio_metros: float) -> OrigemDaArea:
        return cls(TipoDeOrigem.RAIO_SOBRE_ENDERECO, centro=centro, raio_metros=raio_metros)


# Restrições: área proíbe, classe de via só penaliza (ADR-003, RN03).


class Restricao(ABC):
    """O que o usuário declara para a rota obedecer."""

    __slots__ = ()

    @abstractmethod
    def eh_exclusao_absoluta(self) -> bool:
        """Verdadeiro só para áreas: é por aqui que o diagnóstico busca só entre as áreas."""


@dataclass(frozen=True, slots=True, eq=False)
class AreaExcluida(Restricao):
    """Área que a rota nunca atravessa (RN01). Entidade: a identidade é o id (plano, A8).

    O rótulo "Área N" de uma área sem nome é montado no cliente.
    """

    id: str
    rotulo: str
    celulas: ConjuntoDeCelulas
    origem: OrigemDaArea

    def __post_init__(self) -> None:
        if not self.id.strip():
            raise ValueError("área sem id")
        if not self.rotulo.strip():
            raise ValueError("área sem rótulo")

    def eh_exclusao_absoluta(self) -> bool:
        return True

    def __eq__(self, outro: object) -> bool:
        return isinstance(outro, AreaExcluida) and outro.id == self.id

    def __hash__(self) -> int:
        return hash(self.id)


@dataclass(frozen=True, slots=True)
class PreferenciaVia(Restricao):
    """Preferência sobre uma classe de via: penaliza, nunca proíbe (RN06)."""

    classe: ClasseDeVia
    nivel: NivelDeEvitacao

    def eh_exclusao_absoluta(self) -> bool:
        return False


# Consulta e resultados.


@dataclass(frozen=True, slots=True)
class ConsultaDeRota:
    origem: Coordenada
    destino: Coordenada
    restricoes: tuple[Restricao, ...] = ()

    def areas(self) -> tuple[AreaExcluida, ...]:
        """As restrições que o diagnóstico pode remover: só as áreas (ADR-008)."""
        return tuple(r for r in self.restricoes if isinstance(r, AreaExcluida))

    def sem_restricao(self, restricao: Restricao) -> ConsultaDeRota:
        """A mesma consulta sem uma restrição: o passo do diagnóstico (UC05)."""
        if restricao not in self.restricoes:
            raise ValueError("a restrição não está na consulta")
        return replace(self, restricoes=tuple(r for r in self.restricoes if r != restricao))


@dataclass(frozen=True, slots=True)
class Rota:
    geometria: tuple[Coordenada, ...]
    duracao_segundos: float
    distancia_metros: float

    def __post_init__(self) -> None:
        if len(self.geometria) < 2:
            raise ValueError("rota com menos de 2 pontos")
        if self.duracao_segundos < 0 or self.distancia_metros < 0:
            raise ValueError("duração e distância não podem ser negativas")


@dataclass(frozen=True, slots=True)
class ResultadoComparativo:
    """A irrestrita como linha de base e, se houver restrições, a restrita validada (UC01).

    Sem restrições, só a irrestrita (UC01, fluxo A). Com restrições e sem rota restrita, a resposta
    é um Diagnostico, e não este objeto (plano, D6).
    """

    irrestrita: Rota
    restrita: Rota | None = None
    restricoes_aplicadas: tuple[Restricao, ...] = ()

    def __post_init__(self) -> None:
        if (self.restrita is None) != (not self.restricoes_aplicadas):
            raise ValueError("a rota restrita existe se, e só se, houver restrições aplicadas")

    def delta_tempo_segundos(self) -> float | None:
        if self.restrita is None:
            return None
        return self.restrita.duracao_segundos - self.irrestrita.duracao_segundos

    def delta_distancia_metros(self) -> float | None:
        if self.restrita is None:
            return None
        return self.restrita.distancia_metros - self.irrestrita.distancia_metros


@dataclass(frozen=True, slots=True)
class Diagnostico:
    """Por que não há rota (UC05), com as áreas candidatas pelo id (plano, D6).

    RN07: sempre com causa. Uma combinação envolve pelo menos 2 áreas: com uma só, removê-la
    deixaria a irrestrita, e sem irrestrita a causa é o destino inalcançável. O texto da mensagem
    entra na S5-03.
    """

    causa: CausaDeInviabilidade
    candidatas: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if len(set(self.candidatas)) != len(self.candidatas):
            raise ValueError("candidata repetida")
        quantas = len(self.candidatas)
        if (
            (self.causa is CausaDeInviabilidade.DESTINO_INALCANCAVEL and quantas > 0)
            or (self.causa is CausaDeInviabilidade.RESTRICAO_UNICA and quantas < 1)
            or (self.causa is CausaDeInviabilidade.COMBINACAO_DE_RESTRICOES and quantas < 2)
        ):
            raise ValueError(f"{self.causa} não admite {quantas} candidata(s)")


@dataclass(frozen=True, slots=True)
class Lugar:
    nome: str
    coordenada: Coordenada


@dataclass(frozen=True, slots=True)
class ResultadoDeBusca:
    """Lugares encontrados ou, com a lista vazia, o motivo (ADR-013): nunca erro HTTP."""

    lugares: tuple[Lugar, ...] = ()
    motivo: MotivoDeBuscaVazia | None = None

    def __post_init__(self) -> None:
        if bool(self.lugares) == (self.motivo is not None):
            raise ValueError("o motivo existe se, e só se, a lista vier vazia")


# Opções de custo: o que o Tradutor de Vocabulário Viário entrega ao motor (UC03).


@dataclass(frozen=True, slots=True)
class RegraDeCusto:
    """As vias com `chave_osm` em `valores_osm` ficam 1/fator vezes mais caras.

    O fator fica entre 0 e 1: nunca zero, porque classe de via não proíbe (RN06), e nunca acima de
    1, porque a rota restrita usa LM, que só admite encarecer (ADR-014).
    """

    chave_osm: str
    valores_osm: frozenset[str]
    fator: float

    def __post_init__(self) -> None:
        if not self.chave_osm.strip() or not self.valores_osm:
            raise ValueError("regra de custo sem chave ou sem valores")
        if not 0 < self.fator < 1:
            raise ValueError(f"fator fora de (0, 1): {self.fator}")


@dataclass(frozen=True, slots=True)
class OpcoesDeCusto:
    """As penalizações de via de uma consulta; vazia na rota irrestrita."""

    regras: tuple[RegraDeCusto, ...] = ()
