"""Tradutor de Vocabulário Viário (DAS 6.5; Realização, UC03): classe e nível viram vocabulário do
OpenStreetMap e fator. A sintaxe do motor fica no adaptador; aqui só se fala OpenStreetMap.

Os fatores foram calibrados na S4-04 e variam por classe (plano, A3 revisada). Nenhum é zero
(RN06): classe de via só penaliza. Via sem informação de superfície não é penalizada, porque não
casa com nenhum valor de `surface`.
"""

from collections.abc import Iterable

from app.dominio.modelo import (
    ClasseDeVia,
    NivelDeEvitacao,
    OpcoesDeCusto,
    PreferenciaVia,
    RegraDeCusto,
)

# classe -> (chave OSM, valores OSM, fator de "evitar", fator de "evitar fortemente")
TABELA: dict[ClasseDeVia, tuple[str, frozenset[str], float, float]] = {
    ClasseDeVia.SEM_PAVIMENTACAO: (
        "surface",
        frozenset(
            {"unpaved", "dirt", "gravel", "ground", "sand", "grass", "compacted", "fine_gravel"}
        ),
        0.3,
        0.05,
    ),
    ClasseDeVia.RESIDENCIAL: ("highway", frozenset({"residential", "living_street"}), 0.5, 0.1),
    ClasseDeVia.ARTERIAL: ("highway", frozenset({"primary", "secondary"}), 0.5, 0.1),
    ClasseDeVia.RODOVIA: ("highway", frozenset({"motorway", "trunk"}), 0.5, 0.1),
}


def opcoes_de_custo(preferencias: Iterable[PreferenciaVia]) -> OpcoesDeCusto:
    """Uma regra por classe que não é indiferente, na ordem das classes do UC03."""
    por_classe: dict[ClasseDeVia, NivelDeEvitacao] = {}
    for preferencia in preferencias:
        if preferencia.classe in por_classe:
            raise ValueError(f"classe de via repetida: {preferencia.classe}")
        por_classe[preferencia.classe] = preferencia.nivel
    regras = []
    for classe, (chave, valores, evitar, fortemente) in TABELA.items():
        nivel = por_classe.get(classe, NivelDeEvitacao.INDIFERENTE)
        if nivel is NivelDeEvitacao.INDIFERENTE:
            continue
        fator = evitar if nivel is NivelDeEvitacao.EVITAR else fortemente
        regras.append(RegraDeCusto(chave, valores, fator))
    return OpcoesDeCusto(tuple(regras))
