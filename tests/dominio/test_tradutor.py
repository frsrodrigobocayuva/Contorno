"""Tradutor de Vocabulário Viário: classe e nível em vocabulário OSM e fator (Realização, UC03)."""

import pytest

from app.dominio.modelo import ClasseDeVia, NivelDeEvitacao, PreferenciaVia, RegraDeCusto
from app.dominio.tradutor import TABELA, opcoes_de_custo

EVITAR = NivelDeEvitacao.EVITAR
FORTEMENTE = NivelDeEvitacao.EVITAR_FORTEMENTE


@pytest.mark.parametrize(
    "classe, nivel, chave, valores, fator",
    [
        (
            ClasseDeVia.SEM_PAVIMENTACAO,
            EVITAR,
            "surface",
            {"unpaved", "dirt", "gravel", "ground", "sand", "grass", "compacted", "fine_gravel"},
            0.3,
        ),
        (ClasseDeVia.SEM_PAVIMENTACAO, FORTEMENTE, "surface", None, 0.05),
        (ClasseDeVia.RESIDENCIAL, EVITAR, "highway", {"residential", "living_street"}, 0.5),
        (ClasseDeVia.RESIDENCIAL, FORTEMENTE, "highway", None, 0.1),
        (ClasseDeVia.ARTERIAL, EVITAR, "highway", {"primary", "secondary"}, 0.5),
        (ClasseDeVia.RODOVIA, FORTEMENTE, "highway", {"motorway", "trunk"}, 0.1),
    ],
)
def test_cada_classe_e_nivel_viram_uma_regra(
    classe: ClasseDeVia,
    nivel: NivelDeEvitacao,
    chave: str,
    valores: set[str] | None,
    fator: float,
) -> None:
    (regra,) = opcoes_de_custo([PreferenciaVia(classe, nivel)]).regras

    assert (regra.chave_osm, regra.fator) == (chave, fator)
    if valores is not None:
        assert regra.valores_osm == valores


def test_indiferente_nao_vira_regra() -> None:
    opcoes = opcoes_de_custo([PreferenciaVia(ClasseDeVia.RODOVIA, NivelDeEvitacao.INDIFERENTE)])

    assert opcoes.regras == ()


def test_varias_classes_saem_na_ordem_do_uc03() -> None:
    opcoes = opcoes_de_custo(
        [
            PreferenciaVia(ClasseDeVia.RODOVIA, EVITAR),
            PreferenciaVia(ClasseDeVia.SEM_PAVIMENTACAO, FORTEMENTE),
        ]
    )

    assert [r.chave_osm for r in opcoes.regras] == ["surface", "highway"]
    assert [r.fator for r in opcoes.regras] == [0.05, 0.5]


def test_classe_repetida_e_erro() -> None:
    with pytest.raises(ValueError, match="repetida"):
        opcoes_de_custo(
            [
                PreferenciaVia(ClasseDeVia.RODOVIA, EVITAR),
                PreferenciaVia(ClasseDeVia.RODOVIA, FORTEMENTE),
            ]
        )


def test_nenhum_fator_e_zero_nem_passa_de_um() -> None:
    """RN06: classe de via só penaliza; zero é reservado às áreas."""
    for chave, valores, evitar, fortemente in TABELA.values():
        for fator in (evitar, fortemente):
            assert isinstance(RegraDeCusto(chave, valores, fator), RegraDeCusto)
        assert 0 < fortemente < evitar < 1
