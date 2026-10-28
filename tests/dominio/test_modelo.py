"""Regras dos objetos do domínio (Diagrama de Classes, sem perfil e dono)."""

import pytest

from app.dominio.modelo import (
    AreaExcluida,
    CausaDeInviabilidade,
    ClasseDeVia,
    ConjuntoDeCelulas,
    ConsultaDeRota,
    Coordenada,
    Diagnostico,
    Lugar,
    MotivoDeBuscaVazia,
    NivelDeEvitacao,
    OpcoesDeCusto,
    OrigemDaArea,
    Poligono,
    PreferenciaVia,
    RegraDeCusto,
    ResultadoComparativo,
    ResultadoDeBusca,
    Rota,
    TipoDeOrigem,
    resolucao_do_indice,
)

# Índices H3 reais: a célula da UNISINOS na resolução 11, uma vizinha e a mãe na resolução 10.
UNISINOS_11 = 0x8BA90E802CAAFFF
VIZINHA_11 = 0x8BA90E802C81FFF
UNISINOS_10 = 0x8AA90E802CAFFFF

UNISINOS = Coordenada(-51.1549545, -29.7954567)
CENTRO_NH = Coordenada(-51.1429035, -29.6905705)
QUADRADO = Poligono(
    (
        Coordenada(-51.16, -29.80),
        Coordenada(-51.15, -29.80),
        Coordenada(-51.15, -29.79),
        Coordenada(-51.16, -29.79),
        Coordenada(-51.16, -29.80),
    )
)


def area(id_: str = "a1", rotulo: str = "Área 1") -> AreaExcluida:
    return AreaExcluida(
        id_,
        rotulo,
        ConjuntoDeCelulas(11, frozenset({UNISINOS_11})),
        OrigemDaArea.desenhada(QUADRADO),
    )


def rota(duracao: float = 600, distancia: float = 12_800) -> Rota:
    return Rota((UNISINOS, CENTRO_NH), duracao, distancia)


# Geometria


@pytest.mark.parametrize("longitude, latitude", [(-181, 0), (181, 0), (0, -91), (0, 91)])
def test_coordenada_fora_da_faixa(longitude: float, latitude: float) -> None:
    with pytest.raises(ValueError):
        Coordenada(longitude, latitude)


def test_coordenada_nan() -> None:
    with pytest.raises(ValueError):
        Coordenada(float("nan"), 0)


def test_poligono_com_buraco() -> None:
    buraco = (
        Coordenada(-51.157, -29.797),
        Coordenada(-51.153, -29.797),
        Coordenada(-51.155, -29.793),
    )
    assert Poligono(QUADRADO.exterior, (buraco,)).buracos == (buraco,)


def test_poligono_precisa_de_3_vertices_distintos() -> None:
    a, b = Coordenada(0, 0), Coordenada(1, 1)
    with pytest.raises(ValueError):
        Poligono((a, b, a))


def test_buraco_tambem_precisa_de_3_vertices() -> None:
    with pytest.raises(ValueError):
        Poligono(QUADRADO.exterior, ((Coordenada(0, 0), Coordenada(1, 1)),))


# Células


def test_resolucao_lida_do_indice() -> None:
    assert resolucao_do_indice(UNISINOS_11) == 11
    assert resolucao_do_indice(UNISINOS_10) == 10


def test_conjunto_une_contem_e_conta() -> None:
    um = ConjuntoDeCelulas(11, frozenset({UNISINOS_11}))
    outro = ConjuntoDeCelulas(11, frozenset({UNISINOS_11, VIZINHA_11}))

    uniao = um.unir(outro)

    assert uniao.quantidade() == 2
    assert uniao.contem(VIZINHA_11)
    assert not um.contem(VIZINHA_11)


def test_conjunto_nao_une_resolucoes_diferentes() -> None:
    um = ConjuntoDeCelulas(11, frozenset({UNISINOS_11}))
    with pytest.raises(ValueError):
        um.unir(ConjuntoDeCelulas(10, frozenset({UNISINOS_10})))


@pytest.mark.parametrize(
    "resolucao, indices",
    [
        (16, frozenset({UNISINOS_11})),
        (-1, frozenset({UNISINOS_11})),
        (11, frozenset()),
        (11, frozenset({UNISINOS_11, UNISINOS_10})),
    ],
)
def test_conjunto_invalido(resolucao: int, indices: frozenset[int]) -> None:
    with pytest.raises(ValueError):
        ConjuntoDeCelulas(resolucao, indices)


# Origem da área


def test_origem_desenhada_e_raio() -> None:
    desenhada = OrigemDaArea.desenhada(QUADRADO)
    raio = OrigemDaArea.raio(UNISINOS, 500)

    assert desenhada.tipo is TipoDeOrigem.POLIGONO_DESENHADO
    assert raio.tipo is TipoDeOrigem.RAIO_SOBRE_ENDERECO
    assert raio.raio_metros == 500


@pytest.mark.parametrize(
    "tipo, geometria, centro, raio",
    [
        (TipoDeOrigem.POLIGONO_DESENHADO, None, None, None),
        (TipoDeOrigem.POLIGONO_DESENHADO, QUADRADO, UNISINOS, None),
        (TipoDeOrigem.POLIGONO_DESENHADO, QUADRADO, None, 500),
        (TipoDeOrigem.RAIO_SOBRE_ENDERECO, None, None, 500),
        (TipoDeOrigem.RAIO_SOBRE_ENDERECO, None, UNISINOS, None),
        (TipoDeOrigem.RAIO_SOBRE_ENDERECO, None, UNISINOS, 0),
        (TipoDeOrigem.RAIO_SOBRE_ENDERECO, QUADRADO, UNISINOS, 500),
    ],
)
def test_origem_com_campos_do_outro_tipo(
    tipo: TipoDeOrigem,
    geometria: Poligono | None,
    centro: Coordenada | None,
    raio: float | None,
) -> None:
    with pytest.raises(ValueError):
        OrigemDaArea(tipo, geometria, centro, raio)


# Restrições


def test_area_proibe_e_preferencia_so_penaliza() -> None:
    assert area().eh_exclusao_absoluta()
    assert not PreferenciaVia(
        ClasseDeVia.RESIDENCIAL, NivelDeEvitacao.EVITAR
    ).eh_exclusao_absoluta()


def test_area_e_entidade_pelo_id() -> None:
    assert area("a1", "Casa") == area("a1", "Trabalho")
    assert area("a1") != area("a2")
    assert len({area("a1", "Casa"), area("a1", "Trabalho")}) == 1
    assert area() != "a1"


@pytest.mark.parametrize("id_, rotulo", [("", "Área 1"), ("a1", "  ")])
def test_area_precisa_de_id_e_rotulo(id_: str, rotulo: str) -> None:
    with pytest.raises(ValueError):
        area(id_, rotulo)


def test_preferencia_e_valor() -> None:
    assert PreferenciaVia(ClasseDeVia.RODOVIA, NivelDeEvitacao.EVITAR) == PreferenciaVia(
        ClasseDeVia.RODOVIA, NivelDeEvitacao.EVITAR
    )


# Consulta


def test_consulta_separa_as_areas() -> None:
    preferencia = PreferenciaVia(ClasseDeVia.ARTERIAL, NivelDeEvitacao.EVITAR_FORTEMENTE)
    consulta = ConsultaDeRota(UNISINOS, CENTRO_NH, (area("a1"), preferencia, area("a2")))

    assert [a.id for a in consulta.areas()] == ["a1", "a2"]


def test_consulta_sem_uma_restricao() -> None:
    preferencia = PreferenciaVia(ClasseDeVia.ARTERIAL, NivelDeEvitacao.EVITAR)
    consulta = ConsultaDeRota(UNISINOS, CENTRO_NH, (area("a1"), preferencia, area("a2")))

    sem_a1 = consulta.sem_restricao(area("a1"))

    assert sem_a1.restricoes == (preferencia, area("a2"))
    assert consulta.restricoes == (area("a1"), preferencia, area("a2"))


def test_consulta_sem_restricao_que_nao_esta_nela() -> None:
    with pytest.raises(ValueError):
        ConsultaDeRota(UNISINOS, CENTRO_NH, (area("a1"),)).sem_restricao(area("a2"))


# Rota e resultado


@pytest.mark.parametrize(
    "geometria, duracao, distancia",
    [((UNISINOS,), 1, 1), ((UNISINOS, CENTRO_NH), -1, 1), ((UNISINOS, CENTRO_NH), 1, -1)],
)
def test_rota_invalida(geometria: tuple[Coordenada, ...], duracao: float, distancia: float) -> None:
    with pytest.raises(ValueError):
        Rota(geometria, duracao, distancia)


def test_resultado_com_restrita_tem_deltas() -> None:
    resultado = ResultadoComparativo(rota(600, 12_800), rota(780, 15_000), (area(),))

    assert resultado.delta_tempo_segundos() == 180
    assert resultado.delta_distancia_metros() == 2_200


def test_resultado_so_com_a_irrestrita() -> None:
    resultado = ResultadoComparativo(rota())

    assert resultado.delta_tempo_segundos() is None
    assert resultado.delta_distancia_metros() is None


def test_resultado_restrita_se_e_so_se_houver_restricoes() -> None:
    with pytest.raises(ValueError):
        ResultadoComparativo(rota(), rota())
    with pytest.raises(ValueError):
        ResultadoComparativo(rota(), None, (area(),))


# Diagnóstico


@pytest.mark.parametrize(
    "causa, candidatas",
    [
        (CausaDeInviabilidade.DESTINO_INALCANCAVEL, ()),
        (CausaDeInviabilidade.RESTRICAO_UNICA, ("a1",)),
        (CausaDeInviabilidade.RESTRICAO_UNICA, ("a1", "a2")),
        (CausaDeInviabilidade.COMBINACAO_DE_RESTRICOES, ("a1", "a2")),
    ],
)
def test_diagnostico_valido(causa: CausaDeInviabilidade, candidatas: tuple[str, ...]) -> None:
    assert Diagnostico(causa, candidatas).candidatas == candidatas


@pytest.mark.parametrize(
    "causa, candidatas",
    [
        (CausaDeInviabilidade.DESTINO_INALCANCAVEL, ("a1",)),
        (CausaDeInviabilidade.RESTRICAO_UNICA, ()),
        (CausaDeInviabilidade.COMBINACAO_DE_RESTRICOES, ("a1",)),
        (CausaDeInviabilidade.RESTRICAO_UNICA, ("a1", "a1")),
    ],
)
def test_diagnostico_invalido(causa: CausaDeInviabilidade, candidatas: tuple[str, ...]) -> None:
    with pytest.raises(ValueError):
        Diagnostico(causa, candidatas)


# Busca


def test_busca_com_lugares_ou_com_motivo() -> None:
    lugar = Lugar("Universidade do Vale do Rio dos Sinos", UNISINOS)

    assert ResultadoDeBusca((lugar,)).motivo is None
    assert ResultadoDeBusca((), MotivoDeBuscaVazia.SEM_RESULTADO).lugares == ()


def test_busca_motivo_se_e_so_se_vazia() -> None:
    lugar = Lugar("UNISINOS", UNISINOS)
    with pytest.raises(ValueError):
        ResultadoDeBusca((lugar,), MotivoDeBuscaVazia.SEM_RESULTADO)
    with pytest.raises(ValueError):
        ResultadoDeBusca()


# Opções de custo


def test_regra_de_custo_valida() -> None:
    regra = RegraDeCusto("surface", frozenset({"unpaved", "dirt"}), 0.3)

    assert OpcoesDeCusto((regra,)).regras == (regra,)
    assert OpcoesDeCusto().regras == ()


@pytest.mark.parametrize(
    "chave, valores, fator",
    [
        ("surface", frozenset({"dirt"}), 0),
        ("surface", frozenset({"dirt"}), 1),
        ("surface", frozenset({"dirt"}), 1.5),
        ("surface", frozenset({"dirt"}), -0.1),
        ("", frozenset({"dirt"}), 0.5),
        ("surface", frozenset(), 0.5),
    ],
)
def test_regra_de_custo_invalida(chave: str, valores: frozenset[str], fator: float) -> None:
    with pytest.raises(ValueError):
        RegraDeCusto(chave, valores, fator)


@pytest.mark.parametrize(
    "causa, candidatas",
    [
        (CausaDeInviabilidade.DESTINO_INALCANCAVEL, ()),
        (CausaDeInviabilidade.RESTRICAO_UNICA, ("a1",)),
        (CausaDeInviabilidade.COMBINACAO_DE_RESTRICOES, ("a1", "a2")),
    ],
)
def test_diagnostico_tem_mensagem_para_cada_causa(
    causa: CausaDeInviabilidade, candidatas: tuple[str, ...]
) -> None:
    assert Diagnostico(causa, candidatas).mensagem()


def test_destino_inalcancavel_diz_que_a_causa_nao_sao_as_restricoes() -> None:
    mensagem = Diagnostico(CausaDeInviabilidade.DESTINO_INALCANCAVEL).mensagem()

    assert "não são as áreas nem as preferências" in mensagem
