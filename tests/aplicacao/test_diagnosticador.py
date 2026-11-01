"""Diagnosticador de Inviabilidade (UC05): a rota sem cada área, em paralelo, validada."""

import asyncio
import logging
from collections.abc import Callable, Sequence

import pytest
from shapely import Point

from app.aplicacao.diagnosticador import DiagnosticadorDeInviabilidade
from app.dominio import indexador
from app.dominio.excecoes import MotorIndisponivel
from app.dominio.indexador import celulas_de
from app.dominio.modelo import (
    AreaExcluida,
    CausaDeInviabilidade,
    ClasseDeVia,
    ConsultaDeRota,
    Coordenada,
    Diagnostico,
    NivelDeEvitacao,
    OpcoesDeCusto,
    Poligono,
    PreferenciaVia,
    Rota,
)
from app.dominio.tradutor import opcoes_de_custo

pytestmark = pytest.mark.anyio

UNISINOS = Coordenada(-51.1549545, -29.7954567)
CENTRO_NH = Coordenada(-51.1429035, -29.6905705)
# A linha reta da UNISINOS ao centro de NH passa pela área "a1"; o desvio vai por oeste.
RETA = Rota((UNISINOS, CENTRO_NH), 1260, 12_800)
DESVIO = Rota((UNISINOS, Coordenada(-51.175, -29.740), CENTRO_NH), 1500, 14_100)


def quadrado(longitude: float, latitude: float, lado: float = 0.006) -> Poligono:
    meio = lado / 2
    return Poligono(
        (
            Coordenada(longitude - meio, latitude - meio),
            Coordenada(longitude + meio, latitude - meio),
            Coordenada(longitude + meio, latitude + meio),
            Coordenada(longitude - meio, latitude + meio),
        )
    )


# "a1" sobre a reta; as outras a leste, longe da reta e do desvio.
CENTROS = {
    "a1": Coordenada(-51.1485, -29.740),
    "a2": Coordenada(-51.125, -29.740),
    "a3": Coordenada(-51.110, -29.740),
    "a4": Coordenada(-51.095, -29.740),
    "a5": Coordenada(-51.080, -29.740),
}
AREAS = {
    id_: AreaExcluida(id_, f"Área {id_[1]}", celulas_de(quadrado(c.longitude, c.latitude), 11))
    for id_, c in CENTROS.items()
}


def consulta(*ids: str, preferencias: Sequence[PreferenciaVia] = ()) -> ConsultaDeRota:
    return ConsultaDeRota(UNISINOS, CENTRO_NH, (*(AREAS[i] for i in ids), *preferencias))


class MotorDeAreas:
    """Responde conforme as áreas que sobraram no contorno, pelo centro de cada uma."""

    def __init__(
        self,
        rota: Callable[[frozenset[str]], Rota | None],
        erro: Exception | None = None,
    ) -> None:
        self.rota = rota
        self.erro = erro
        self.chamadas: list[tuple[frozenset[str], OpcoesDeCusto]] = []
        self.em_voo = 0
        self.maximo_em_voo = 0

    async def calcular(
        self, consulta: ConsultaDeRota, exclusoes: Sequence[Poligono], opcoes: OpcoesDeCusto
    ) -> Rota | None:
        formas = [indexador.forma_de(p) for p in exclusoes]
        presentes = frozenset(
            id_
            for id_, c in CENTROS.items()
            if any(f.contains(Point(c.longitude, c.latitude)) for f in formas)
        )
        self.chamadas.append((presentes, opcoes))
        self.em_voo += 1
        self.maximo_em_voo = max(self.maximo_em_voo, self.em_voo)
        await asyncio.sleep(0)
        self.em_voo -= 1
        if self.erro:
            raise self.erro
        return self.rota(presentes)


def bloqueia_se(
    condicao: Callable[[frozenset[str]], bool],
) -> Callable[[frozenset[str]], Rota | None]:
    return lambda presentes: None if condicao(presentes) else DESVIO


async def diagnosticar(
    motor: MotorDeAreas, c: ConsultaDeRota, concorrencia: int = 4
) -> Diagnostico:
    opcoes = opcoes_de_custo(r for r in c.restricoes if isinstance(r, PreferenciaVia))
    return await DiagnosticadorDeInviabilidade(motor, concorrencia).diagnosticar(c, opcoes)


async def test_uma_area_so_e_a_candidata_sem_chamar_o_motor() -> None:
    motor = MotorDeAreas(bloqueia_se(lambda p: True))

    resultado = await diagnosticar(motor, consulta("a1"))

    assert resultado == Diagnostico(CausaDeInviabilidade.RESTRICAO_UNICA, ("a1",))
    assert motor.chamadas == []


async def test_cada_remocao_que_abre_caminho_e_candidata() -> None:
    """Tela 11: tirar qualquer uma das duas abre caminho."""
    motor = MotorDeAreas(bloqueia_se(lambda p: {"a2", "a3"} <= p))

    resultado = await diagnosticar(motor, consulta("a2", "a3"))

    assert resultado == Diagnostico(CausaDeInviabilidade.RESTRICAO_UNICA, ("a2", "a3"))
    assert sorted(sorted(p) for p, _ in motor.chamadas) == [["a2"], ["a3"]]


async def test_so_a_area_cuja_remocao_abre_caminho_e_candidata() -> None:
    motor = MotorDeAreas(bloqueia_se(lambda p: "a2" in p and bool({"a3", "a4"} & p)))

    resultado = await diagnosticar(motor, consulta("a2", "a3", "a4"))

    assert resultado == Diagnostico(CausaDeInviabilidade.RESTRICAO_UNICA, ("a2",))


async def test_nenhuma_remocao_isolada_abre_caminho_e_combinacao() -> None:
    """UC05, alternativo A (tela 12): vão todas as áreas, na ordem da consulta."""
    motor = MotorDeAreas(bloqueia_se(lambda p: len(p) >= 2))

    resultado = await diagnosticar(motor, consulta("a4", "a2", "a3"))

    assert resultado == Diagnostico(
        CausaDeInviabilidade.COMBINACAO_DE_RESTRICOES, ("a4", "a2", "a3")
    )


async def test_rota_que_toca_as_outras_areas_nao_abre_caminho(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """RN01: sem "a2" o motor devolve a reta, que cruza "a1"; "a2" não vira candidata."""
    motor = MotorDeAreas(lambda p: None if {"a1", "a2"} <= p else RETA if "a1" in p else DESVIO)

    with caplog.at_level(logging.WARNING, logger="contorno.diagnosticador"):
        resultado = await diagnosticar(motor, consulta("a1", "a2"))

    assert resultado == Diagnostico(CausaDeInviabilidade.RESTRICAO_UNICA, ("a1",))
    assert "sem a área a2 descartada" in caplog.text


async def test_as_chamadas_respeitam_a_concorrencia() -> None:
    motor = MotorDeAreas(bloqueia_se(lambda p: len(p) >= 4))

    await diagnosticar(motor, consulta("a1", "a2", "a3", "a4", "a5"), concorrencia=2)

    assert len(motor.chamadas) == 5
    assert motor.maximo_em_voo == 2


async def test_as_preferencias_vao_em_todas_as_chamadas_mas_nunca_sao_candidatas() -> None:
    """RN03: preferência de via nunca bloqueia, então não entra na busca."""
    evitar = PreferenciaVia(ClasseDeVia.RODOVIA, NivelDeEvitacao.EVITAR_FORTEMENTE)
    motor = MotorDeAreas(bloqueia_se(lambda p: {"a2", "a3"} <= p))

    resultado = await diagnosticar(motor, consulta("a2", "a3", preferencias=(evitar,)))

    assert resultado.candidatas == ("a2", "a3")
    assert all(
        [(r.chave_osm, r.fator) for r in opcoes.regras] == [("highway", 0.1)]
        for _, opcoes in motor.chamadas
    )


async def test_motor_indisponivel_passa_adiante_e_cancela_o_resto() -> None:
    motor = MotorDeAreas(bloqueia_se(lambda p: True), erro=MotorIndisponivel())

    with pytest.raises(MotorIndisponivel):
        await diagnosticar(motor, consulta("a1", "a2", "a3", "a4", "a5"), concorrencia=1)
    for _ in range(10):
        await asyncio.sleep(0)

    # A que já tinha a vez pode sair antes do erro chegar; as que esperavam são canceladas.
    assert len(motor.chamadas) <= 2


async def test_registra_o_tempo_e_a_causa(caplog: pytest.LogCaptureFixture) -> None:
    motor = MotorDeAreas(bloqueia_se(lambda p: len(p) >= 2))

    with caplog.at_level(logging.INFO, logger="contorno.diagnosticador"):
        await diagnosticar(motor, consulta("a2", "a3", "a4"))

    (registro,) = [r for r in caplog.records if r.getMessage() == "diagnostico"]
    dados = registro.__dict__["dados"]
    assert dados["areas"] == 3
    assert dados["chamadas_ao_motor"] == 3
    assert dados["causa"] == "COMBINACAO_DE_RESTRICOES"
    assert dados["candidatas"] == 3
    assert dados["ms"] >= 0


async def test_sem_areas_nao_ha_o_que_diagnosticar() -> None:
    with pytest.raises(ValueError, match="nenhuma"):
        await diagnosticar(MotorDeAreas(bloqueia_se(lambda p: True)), consulta())


def test_concorrencia_precisa_ser_positiva() -> None:
    with pytest.raises(ValueError, match="concorrência"):
        DiagnosticadorDeInviabilidade(MotorDeAreas(bloqueia_se(lambda p: True)), 0)
