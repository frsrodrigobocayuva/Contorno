"""Medição [2] do DAS 8 (D13): classes de via e preenchimento de surface no extrato do recorte.

1. /info do GraphHopper: os valores de road_class e surface da tabela do UC03 existem no motor.
2. Preenchimento de surface nas vias do carro, sem highway=service (decisão de 2026-10-27), por
   número de vias e por extensão. "Via sem pavimentação" fica só se as duas contas chegarem a 30%.
3. As 10 vias com nome mais extensas de cada classe do UC03, para conferir contra ruas conhecidas.

Vias do carro: os valores de highway que o GraphHopper aceita para carro (sem service), sem acesso
proibido ou privado e sem track de tracktype grade4 ou grade5.

Uso: docker compose run --rm dev python motor/medicoes/vias.py
"""

import asyncio
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import osmium
from comum import cliente

EXTRATO = Path(__file__).resolve().parents[1] / "dados" / "recorte-sl-nh.osm.pbf"

VIAS_DO_CARRO = {
    "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link",
    "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified",
    "residential", "living_street", "road", "track",
}  # fmt: skip
ACESSO_FECHADO = {"no", "private"}
TRACKTYPE_FECHADO = {"grade4", "grade5"}

# Tabela do UC03 (Realização de Casos de Uso): vocabulário OSM de cada classe.
SEM_PAVIMENTACAO = {
    "unpaved", "dirt", "gravel", "ground", "sand", "grass", "compacted", "fine_gravel",
}  # fmt: skip
CLASSES_UC03 = {
    "rodovia": {"motorway", "motorway_link", "trunk", "trunk_link"},
    "via arterial": {"primary", "primary_link", "secondary", "secondary_link"},
    "rua residencial": {"residential", "living_street"},
}
VALORES_UC03 = {
    "road_class": {"MOTORWAY", "TRUNK", "PRIMARY", "SECONDARY", "RESIDENTIAL", "LIVING_STREET"},
    "surface": {v.upper() for v in SEM_PAVIMENTACAO},
}
MINIMO_D13 = 0.30


@dataclass
class Contagem:
    vias: int = 0
    metros: float = 0.0

    def soma(self, metros: float) -> None:
        self.vias += 1
        self.metros += metros


class Leitor(osmium.SimpleHandler):  # type: ignore[misc]
    def __init__(self) -> None:
        super().__init__()
        self.todas = Contagem()
        self.com_surface = Contagem()
        self.sem_pavimentacao = Contagem()
        # highway -> [todas, com surface]
        self.por_highway: dict[str, list[Contagem]] = defaultdict(lambda: [Contagem(), Contagem()])
        # classe do UC03 -> nome da via -> metros
        self.nomes: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
        self.sem_geometria = 0

    def way(self, w: osmium.osm.Way) -> None:
        tags = w.tags
        highway = tags.get("highway")
        if highway not in VIAS_DO_CARRO:
            return
        if any(tags.get(t) in ACESSO_FECHADO for t in ("access", "motor_vehicle", "motorcar")):
            return
        if highway == "track" and tags.get("tracktype") in TRACKTYPE_FECHADO:
            return
        try:
            metros = osmium.geom.haversine_distance(w.nodes)
        except osmium.InvalidLocationError:
            self.sem_geometria += 1
            return
        surface = tags.get("surface")
        self.todas.soma(metros)
        total, com = self.por_highway[highway]
        total.soma(metros)
        if surface:
            self.com_surface.soma(metros)
            com.soma(metros)
        nome = tags.get("name") or tags.get("ref")
        if surface in SEM_PAVIMENTACAO:
            self.sem_pavimentacao.soma(metros)
            if nome:
                self.nomes["via sem pavimentação"][f"{nome} ({highway}, {surface})"] += metros
        for classe, valores in CLASSES_UC03.items():
            if highway in valores and nome:
                self.nomes[classe][nome] += metros


def pct(parte: float, todo: float) -> str:
    return f"{100 * parte / todo:.1f}%" if todo else "-"


async def conferir_info() -> None:
    async with cliente() as c:
        valores = (await c.get("/info")).json()["encoded_values"]
    print("1. /info do GraphHopper: valores da tabela do UC03")
    for chave, esperados in VALORES_UC03.items():
        faltando = sorted(esperados - set(valores.get(chave, [])))
        situacao = "faltando " + ", ".join(faltando) if faltando else "todos presentes"
        print(f"   {chave}: {situacao}")


def main() -> None:
    print("[2] Classes de via e preenchimento de surface no extrato do recorte\n")
    asyncio.run(conferir_info())

    leitor = Leitor()
    leitor.apply_file(str(EXTRATO), locations=True)
    t, s, u = leitor.todas, leitor.com_surface, leitor.sem_pavimentacao
    print("\n2. Vias do carro, sem service")
    print(f"   total:            {t.vias:>6} vias  {t.metros / 1000:>8.1f} km")
    print(
        f"   com surface:      {s.vias:>6} vias ({pct(s.vias, t.vias)})  "
        f"{s.metros / 1000:>8.1f} km ({pct(s.metros, t.metros)})"
    )
    print(
        f"   sem pavimentação: {u.vias:>6} vias ({pct(u.vias, t.vias)})  "
        f"{u.metros / 1000:>8.1f} km ({pct(u.metros, t.metros)})"
    )
    if leitor.sem_geometria:
        print(f"   ({leitor.sem_geometria} vias sem todos os nós no extrato ficaram de fora)")
    print("\n   por highway (vias com surface / total, por extensão):")
    for highway, (total, com) in sorted(leitor.por_highway.items(), key=lambda i: -i[1][0].metros):
        print(
            f"   {highway:<15} {total.metros / 1000:>7.1f} km  "
            f"surface em {pct(com.metros, total.metros):>6} da extensão, "
            f"{pct(com.vias, total.vias):>6} das vias"
        )
    fica = s.vias / t.vias >= MINIMO_D13 and s.metros / t.metros >= MINIMO_D13
    print(
        f"\nD13: surface em {pct(s.vias, t.vias)} das vias e {pct(s.metros, t.metros)} da extensão "
        f'(mínimo 30% nas duas) -> "via sem pavimentação" {"fica" if fica else "sai do MVP"}'
    )

    print("\n3. As 10 vias com nome mais extensas de cada classe do UC03")
    for classe in (*CLASSES_UC03, "via sem pavimentação"):
        print(f"   {classe}:")
        maiores = sorted(leitor.nomes[classe].items(), key=lambda i: -i[1])[:10]
        for nome, metros in maiores:
            print(f"     {metros / 1000:>5.1f} km  {nome}")


if __name__ == "__main__":
    main()
