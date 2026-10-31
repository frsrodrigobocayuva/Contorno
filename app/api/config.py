"""Configuração lida uma vez na subida (DAS 6.11), das variáveis de ambiente (.env.example)."""

import os
from collections.abc import Mapping
from dataclasses import dataclass

# Retângulo de São Leopoldo + Novo Hamburgo (plano, D10): min_lon, min_lat, max_lon, max_lat.
RETANGULO_PADRAO = "-51.2100287,-29.8302389,-50.9341246,-29.6377057"


@dataclass(frozen=True)
class Configuracao:
    graphhopper_url: str
    tempo_maximo_motor_s: float
    nominatim_url: str
    nominatim_user_agent: str
    tempo_maximo_geocodificador_s: float
    cache_tamanho: int
    cache_validade_s: float
    retangulo: tuple[float, float, float, float]
    resolucao_h3: int = 11

    @classmethod
    def do_ambiente(cls, ambiente: Mapping[str, str] = os.environ) -> "Configuracao":
        def exigir(nome: str) -> str:
            valor = ambiente.get(nome, "").strip()
            if not valor:
                raise RuntimeError(f"variável de ambiente obrigatória ausente: {nome}")
            return valor

        user_agent = exigir("NOMINATIM_USER_AGENT")
        if "preencher" in user_agent:
            raise RuntimeError("NOMINATIM_USER_AGENT precisa de um contato (política do Nominatim)")
        retangulo = tuple(float(v) for v in ambiente.get("AREA_BBOX", RETANGULO_PADRAO).split(","))
        if len(retangulo) != 4:
            raise RuntimeError("AREA_BBOX precisa de 4 números: min_lon,min_lat,max_lon,max_lat")
        return cls(
            graphhopper_url=exigir("GRAPHHOPPER_URL"),
            tempo_maximo_motor_s=float(ambiente.get("ENGINE_TIMEOUT_S", "2")),
            nominatim_url=ambiente.get("NOMINATIM_URL", "https://nominatim.openstreetmap.org"),
            nominatim_user_agent=user_agent,
            tempo_maximo_geocodificador_s=float(ambiente.get("GEOCODER_TIMEOUT_S", "10")),
            cache_tamanho=int(ambiente.get("GEOCODER_CACHE_SIZE", "256")),
            cache_validade_s=float(ambiente.get("GEOCODER_CACHE_TTL_S", "3600")),
            retangulo=(retangulo[0], retangulo[1], retangulo[2], retangulo[3]),
            resolucao_h3=int(ambiente.get("H3_RESOLUTION", "11")),
        )

    def no_recorte(self, longitude: float, latitude: float) -> bool:
        min_lon, min_lat, max_lon, max_lat = self.retangulo
        return min_lon <= longitude <= max_lon and min_lat <= latitude <= max_lat
