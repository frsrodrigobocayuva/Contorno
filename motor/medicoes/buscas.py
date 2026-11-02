"""Medição [4] do DAS 8 (S5-05): buscas de endereço por sessão, para confirmar a margem em relação
a uma chamada por segundo ao Nominatim (ADR-013) e fechar os valores provisórios dele (plano, A6):
o tempo máximo da chamada, o tamanho e a validade do cache.

Lê o log da API, uma linha JSON por requisição (plano, A9). A sessão é o identificador que o
navegador sorteia a cada abertura da página (cabeçalho X-Sessao); requisições sem sessão ficam de
fora. O texto buscado nunca está no log.

Uso (o log se perde quando o container da API é recriado):
  docker compose logs api --no-log-prefix > buscas.log
  python motor/medicoes/buscas.py buscas.log
"""

import json
import statistics
import sys
from collections import defaultdict
from collections.abc import Iterable, Iterator
from datetime import datetime
from typing import Any

Linha = dict[str, Any]
ESPERA_DE_VERDADE_MS = 10


def requisicoes(texto: Iterable[str]) -> Iterator[Linha]:
    """As linhas de requisição do log; as outras (do uvicorn, de aviso) ficam de fora."""
    for bruta in texto:
        bruta = bruta.strip()
        if not bruta.startswith("{"):
            continue
        try:
            linha = json.loads(bruta)
        except json.JSONDecodeError:
            continue
        if linha.get("evento") == "requisicao":
            yield linha


def momento(linha: Linha) -> datetime:
    return datetime.fromisoformat(linha["momento"])


def p95(valores: list[float]) -> float:
    if len(valores) < 2:
        return max(valores, default=0.0)
    return statistics.quantiles(valores, n=20, method="inclusive")[18]


def resumo(valores: list[float], unidade: str = "") -> str:
    if not valores:
        return "—"
    return (
        f"média {statistics.mean(valores):.1f}{unidade} · mediana "
        f"{statistics.median(valores):.1f}{unidade} · p95 {p95(valores):.1f}{unidade} · "
        f"máx {max(valores):.1f}{unidade}"
    )


def maior_rajada(instantes: list[datetime], janela_s: float) -> int:
    """O maior número de buscas dentro de qualquer janela de `janela_s` segundos."""
    ordenados = sorted(instantes)
    maior, inicio = 0, 0
    for fim, agora in enumerate(ordenados):
        while (agora - ordenados[inicio]).total_seconds() >= janela_s:
            inicio += 1
        maior = max(maior, fim - inicio + 1)
    return maior


def principal(texto: Iterable[str]) -> None:
    todas = list(requisicoes(texto))
    por_sessao: dict[str, list[Linha]] = defaultdict(list)
    for linha in todas:
        if linha.get("sessao"):
            por_sessao[linha["sessao"]].append(linha)
    sem_sessao = sum(1 for linha in todas if not linha.get("sessao"))

    print("[4] Buscas de endereço por sessão (DAS 8)")
    if not por_sessao:
        sys.exit("    nenhuma requisição com sessão no log")
    instantes = [momento(linha) for linha in todas if linha.get("sessao")]
    print(
        f"    {len(por_sessao)} sessões, {len(todas) - sem_sessao} requisições "
        f"({sem_sessao} sem sessão ficaram de fora), de {min(instantes):%d/%m %H:%M} "
        f"a {max(instantes):%d/%m %H:%M}"
    )

    buscas_por_sessao: list[float] = []
    nominatim_por_sessao: list[float] = []
    duracoes_min: list[float] = []
    buscas: list[Linha] = []
    instantes_das_buscas: list[datetime] = []
    print(f"\n    {'sessão':<9} {'buscas':>6} {'Nominatim':>9} {'cache':>5} {'duração':>8}")
    for sessao, linhas in sorted(por_sessao.items(), key=lambda par: momento(par[1][0])):
        desta = [
            (linha, busca)
            for linha in linhas
            if linha.get("caminho") == "/enderecos"
            for busca in linha.get("buscas", [])
        ]
        nominatim = sum(1 for _, busca in desta if busca["origem"] != "cache")
        duracao = (max(map(momento, linhas)) - min(map(momento, linhas))).total_seconds() / 60
        buscas_por_sessao.append(len(desta))
        nominatim_por_sessao.append(nominatim)
        duracoes_min.append(duracao)
        buscas.extend(busca for _, busca in desta)
        instantes_das_buscas.extend(momento(linha) for linha, _ in desta)
        print(
            f"    {sessao[:8]:<9} {len(desta):>6} {nominatim:>9} {len(desta) - nominatim:>5} "
            f"{duracao:>6.1f} min"
        )

    do_cache = [b for b in buscas if b["origem"] == "cache"]
    chamadas = [b for b in buscas if b["origem"] != "cache"]
    erros = [b for b in buscas if b["origem"] == "erro"]
    # Abaixo de 10 ms é só o custo de pegar a trava; esperar a vez (1 por segundo) leva centenas
    # de milissegundos.
    esperas = [b["ms_espera"] for b in buscas if b["ms_espera"] >= ESPERA_DE_VERDADE_MS]
    tempos = [b["ms_nominatim"] for b in chamadas if b["ms_nominatim"] is not None]
    print()
    print(f"    buscas por sessão:            {resumo(buscas_por_sessao)}")
    print(f"    chamadas ao Nominatim/sessão: {resumo(nominatim_por_sessao)}")
    print(f"    duração da sessão:            {resumo(duracoes_min, ' min')}")
    if buscas:
        print(
            f"    cache:                        {len(do_cache)} de {len(buscas)} buscas "
            f"({100 * len(do_cache) / len(buscas):.0f}%)"
        )
        print(
            f"    esperaram a vez (1 por s):    {len(esperas)} de {len(buscas)} buscas; "
            f"espera {resumo(esperas, ' ms')}"
        )
        print(
            f"    rajada:                       até {maior_rajada(instantes_das_buscas, 1)} "
            f"busca(s) em 1 s e {maior_rajada(instantes_das_buscas, 10)} em 10 s"
        )
    print(f"    tempo do Nominatim:           {resumo(tempos, ' ms')}")
    print(f"    erros do Nominatim:           {len(erros)}")


if __name__ == "__main__":
    # No console do Windows, a saída padrão não é UTF-8; os acentos sairiam trocados.
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    if len(sys.argv) > 1:
        with open(sys.argv[1], encoding="utf-8") as arquivo:
            principal(arquivo)
    else:
        principal(sys.stdin)
