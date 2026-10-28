// Mapa Interativo (DAS 7.2): MapLibre com os tiles raster do OpenStreetMap, só os da tela
// atual, com atribuição (ADR-013), preso à região atendida.
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  type GeoJSONSource,
  type MapOptions,
} from 'maplibre-gl'
import { useEffect, useRef } from 'react'
import type { Coordenadas } from '../api/cliente'

// Retângulo de São Leopoldo + Novo Hamburgo (plano, D10), com folga para o mapa não cortar a borda.
const REGIAO: [Coordenadas, Coordenadas] = [
  [-51.2100287, -29.8302389],
  [-50.9341246, -29.6377057],
]
const FOLGA = 0.05
const LIMITES: [Coordenadas, Coordenadas] = [
  [REGIAO[0][0] - FOLGA, REGIAO[0][1] - FOLGA],
  [REGIAO[1][0] + FOLGA, REGIAO[1][1] + FOLGA],
]

// Configurável para os testes ponta a ponta usarem o tile em branco (plano, A5).
const TILES =
  (import.meta.env.VITE_TILES_URL as string | undefined) ??
  'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

const ESTILO: NonNullable<MapOptions['style']> = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: [TILES],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
}

const SEM_ROTA = { type: 'FeatureCollection' as const, features: [] }

interface Props {
  origem?: Coordenadas | null
  destino?: Coordenadas | null
  rota?: Coordenadas[] | null
  aoTocar?: (coordenadas: Coordenadas) => void
}

function marcador(letra: string): HTMLElement {
  const elemento = document.createElement('div')
  elemento.className = 'marcador'
  elemento.textContent = letra
  elemento.setAttribute('aria-label', letra === 'A' ? 'Origem' : 'Destino')
  return elemento
}

function quandoCarregado(mapa: MapLibreMap, fazer: () => void): void {
  if (mapa.isStyleLoaded()) fazer()
  else mapa.once('load', fazer)
}

export function Mapa({ origem, destino, rota, aoTocar }: Props) {
  const elemento = useRef<HTMLDivElement>(null)
  const mapa = useRef<MapLibreMap | null>(null)
  const marcadores = useRef<{ A?: Marker; B?: Marker }>({})
  const aoTocarAtual = useRef(aoTocar)

  useEffect(() => {
    aoTocarAtual.current = aoTocar
  })

  useEffect(() => {
    if (!elemento.current) return
    const novo = new MapLibreMap({
      container: elemento.current,
      style: ESTILO,
      bounds: REGIAO,
      maxBounds: LIMITES,
      attributionControl: { compact: false },
    })
    novo.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    novo.on('click', (evento) => {
      aoTocarAtual.current?.([evento.lngLat.lng, evento.lngLat.lat])
    })
    novo.on('load', () => {
      novo.addSource('rota', { type: 'geojson', data: SEM_ROTA })
      novo.addLayer({
        id: 'rota-irrestrita',
        type: 'line',
        source: 'rota',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#6E6E6E',
          'line-width': 4,
          'line-dasharray': [2, 1.5],
        },
      })
    })
    mapa.current = novo
    return () => {
      novo.remove()
      mapa.current = null
    }
  }, [])

  useEffect(() => {
    const atual = mapa.current
    if (!atual) return
    for (const [letra, ponto] of [
      ['A', origem],
      ['B', destino],
    ] as const) {
      marcadores.current[letra]?.remove()
      marcadores.current[letra] = ponto
        ? new Marker({ element: marcador(letra) }).setLngLat(ponto).addTo(atual)
        : undefined
    }
  }, [origem, destino])

  useEffect(() => {
    const atual = mapa.current
    if (!atual) return
    quandoCarregado(atual, () => {
      const fonte = atual.getSource<GeoJSONSource>('rota')
      if (!fonte) return
      void fonte.setData(
        rota
          ? {
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: rota },
            }
          : SEM_ROTA,
      )
      if (rota && rota.length > 1) {
        const lons = rota.map((c) => c[0])
        const lats = rota.map((c) => c[1])
        atual.fitBounds(
          [
            [Math.min(...lons), Math.min(...lats)],
            [Math.max(...lons), Math.max(...lats)],
          ],
          { padding: 48, duration: 0 },
        )
      }
    })
  }, [rota])

  return <div ref={elemento} className="mapa" role="region" aria-label="Mapa" />
}
