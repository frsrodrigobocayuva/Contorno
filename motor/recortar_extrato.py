"""Gera o extrato do OpenStreetMap recortado para São Leopoldo + Novo Hamburgo (plano, D10 e P6a).

Baixa uma vez o extrato Sul datado da Geofabrik, recorta com o osmium (em contêiner) no
retângulo que envolve os dois municípios e grava, ao lado do recorte, um arquivo com fonte,
data e hashes. O recorte é versionado; o extrato bruto fica fora do git (motor/dados/brutos/).

Uso, a partir da raiz do repositório (Docker em execução):
    python motor/recortar_extrato.py [--data AAMMDD]

Regenerar o recorte é decisão explícita: depois de rodar, o grafo do GraphHopper precisa ser
reimportado (apagar o volume graph-cache).
"""

import argparse
import datetime
import hashlib
import json
import subprocess
import urllib.request
from pathlib import Path

DATA_PADRAO = "261025"  # extrato Sul da Geofabrik de 2026-10-25
URL_GEOFABRIK = "https://download.geofabrik.de/south-america/brazil/sul-{data}.osm.pbf"

# Retângulo que envolve os limites oficiais no OSM (min_lon, min_lat, max_lon, max_lat).
# São Leopoldo = relação 242399; Novo Hamburgo = relação 242616. Consultado no Nominatim
# em 2026-10-26, à mão, dentro da política de uso.
RETANGULO = (-51.2100287, -29.8302389, -50.9341246, -29.6377057)

MOTOR = Path(__file__).resolve().parent
DADOS = MOTOR / "dados"
BRUTOS = DADOS / "brutos"
RECORTE = "recorte-sl-nh.osm.pbf"
IMAGEM_OSMIUM = "contorno-osmium"


def sha256(caminho: Path) -> str:
    h = hashlib.sha256()
    with caminho.open("rb") as arquivo:
        for bloco in iter(lambda: arquivo.read(1 << 20), b""):
            h.update(bloco)
    return h.hexdigest()


def md5(caminho: Path) -> str:
    h = hashlib.md5()
    with caminho.open("rb") as arquivo:
        for bloco in iter(lambda: arquivo.read(1 << 20), b""):
            h.update(bloco)
    return h.hexdigest()


def baixar_bruto(data: str) -> tuple[Path, str]:
    url = URL_GEOFABRIK.format(data=data)
    destino = BRUTOS / f"sul-{data}.osm.pbf"
    with urllib.request.urlopen(url + ".md5") as resposta:
        md5_esperado = resposta.read().decode().split()[0]
    if not destino.exists():
        BRUTOS.mkdir(parents=True, exist_ok=True)
        print(f"baixando {url} (uma vez só)")
        urllib.request.urlretrieve(url, destino)
    if md5(destino) != md5_esperado:
        raise SystemExit(f"md5 diferente do publicado pela Geofabrik: {destino}")
    return destino, md5_esperado


def osmium(*args: str, copiar_para_dentro: str | None = None) -> str:
    """Roda o osmium no contêiner, com motor/dados montado em /dados.

    No Docker Desktop (Windows), o osmium não consegue ler arquivos grandes direto da pasta
    montada ("Read failed: Cannot allocate memory"); com copiar_para_dentro, o arquivo é
    copiado para o disco do contêiner e o comando o lê como /tmp/fonte.osm.pbf.
    """
    if copiar_para_dentro:
        script = f'cp "{copiar_para_dentro}" /tmp/fonte.osm.pbf && osmium "$@"'
        comando = ["--entrypoint", "sh", IMAGEM_OSMIUM, "-c", script, "osmium", *args]
    else:
        comando = [IMAGEM_OSMIUM, *args]
    resultado = subprocess.run(
        ["docker", "run", "--rm", "-v", f"{DADOS}:/dados", *comando],
        capture_output=True,
        text=True,
    )
    if resultado.returncode != 0:
        raise SystemExit(f"osmium falhou: {resultado.stderr.strip()}")
    return resultado.stdout.strip()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data", default=DATA_PADRAO, help="data do extrato da Geofabrik (AAMMDD)")
    data = parser.parse_args().data

    bruto, md5_bruto = baixar_bruto(data)
    subprocess.run(
        [
            "docker",
            "build",
            "-q",
            "-t",
            IMAGEM_OSMIUM,
            "-f",
            str(MOTOR / "osmium.Dockerfile"),
            str(MOTOR),
        ],
        check=True,
    )
    retangulo = ",".join(str(c) for c in RETANGULO)
    origem = f"brutos/{bruto.name}"
    osmium(
        "extract",
        "--bbox",
        retangulo,
        "--strategy",
        "complete_ways",
        "--overwrite",
        "-o",
        RECORTE,
        "/tmp/fonte.osm.pbf",
        copiar_para_dentro=origem,
    )
    carimbo = osmium("fileinfo", "-g", "header.option.osmosis_replication_timestamp", origem)

    recorte = DADOS / RECORTE
    metadados = {
        "fonte": URL_GEOFABRIK.format(data=data),
        "md5_fonte": md5_bruto,
        "carimbo_osm": carimbo,
        "retangulo": {
            "min_lon": RETANGULO[0],
            "min_lat": RETANGULO[1],
            "max_lon": RETANGULO[2],
            "max_lat": RETANGULO[3],
            "municipios": {"Sao Leopoldo": "relation/242399", "Novo Hamburgo": "relation/242616"},
        },
        "recorte": RECORTE,
        "sha256": sha256(recorte),
        "bytes": recorte.stat().st_size,
        "estrategia": "osmium extract --strategy complete_ways",
        "gerado_em": datetime.date.today().isoformat(),
        "licenca": "ODbL — © OpenStreetMap contributors",
    }
    (DADOS / "recorte-sl-nh.json").write_text(
        json.dumps(metadados, ensure_ascii=False, indent=2) + "\n", "utf-8"
    )
    print(f"{RECORTE}: {metadados['bytes'] / 1e6:.1f} MB, dados OSM de {carimbo}")


if __name__ == "__main__":
    main()
