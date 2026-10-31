// Mapa Interativo (DAS 7.2): MapLibre com os tiles raster do OpenStreetMap, só os da tela
// atual, com atribuição (ADR-013), preso à região atendida, sempre em 2D com o norte para cima.
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

// Atenuado até o desenho do mapa vir com a identidade visual (plano, 2026-10-29): sem cor e um
// pouco mais claro, para a rota e os marcadores se destacarem. O contraste fica o do OSM, para as
// ruas e os nomes continuarem legíveis (teste do usuário, 2026-10-30).
const ATENUADO = {
  'raster-saturation': -1,
  'raster-brightness-min': 0.15,
  'raster-contrast': 0,
}

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
  layers: [{ id: 'osm', type: 'raster', source: 'osm', paint: ATENUADO }],
}

const SEM_ROTA = { type: 'FeatureCollection' as const, features: [] }

interface Props {
  origem?: Coordenadas | null
  destino?: Coordenadas | null
  rota?: Coordenadas[] | null
  aoTocar?: (coordenadas: Coordenadas) => void
  // Duplo clique do mouse; no celular, o duplo toque continua dando zoom.
  aoCancelar?: () => void
}

function marcador(letra: string): HTMLElement {
  const elemento = document.createElement('div')
  elemento.className = 'marcador'
  elemento.textContent = letra
  elemento.setAttribute('aria-label', letra === 'A' ? 'Origem' : 'Destino')
  return elemento
}

// Desenha assim que a fonte da rota existe. Não depende de isStyleLoaded(): ele fica falso
// enquanto há tiles carregando, e o evento load não se repete.
function desenharRota(
  mapa: MapLibreMap,
  rota: Coordenadas[] | null | undefined,
) {
  const fonte = mapa.getSource<GeoJSONSource>('rota')
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
    mapa.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: 48, duration: 0 },
    )
  }
}

export function Mapa({ origem, destino, rota, aoTocar, aoCancelar }: Props) {
  const elemento = useRef<HTMLDivElement>(null)
  const mapa = useRef<MapLibreMap | null>(null)
  const marcadores = useRef<{ A?: Marker; B?: Marker }>({})
  const aoTocarAtual = useRef(aoTocar)
  const aoCancelarAtual = useRef(aoCancelar)
  const rotaAtual = useRef(rota)

  useEffect(() => {
    aoTocarAtual.current = aoTocar
    aoCancelarAtual.current = aoCancelar
  })

  useEffect(() => {
    const container = elemento.current
    if (!container) return
    const novo = new MapLibreMap({
      container,
      style: ESTILO,
      bounds: REGIAO,
      maxBounds: LIMITES,
      attributionControl: { compact: false },
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      rollEnabled: false,
      maxPitch: 0,
    })
    novo.touchZoomRotate.disableRotation()
    novo.keyboard.disableRotation()
    novo.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    novo.on('click', (evento) => {
      aoTocarAtual.current?.([evento.lngLat.lng, evento.lngLat.lat])
    })

    // O tipo do último ponteiro separa o duplo clique do mouse do duplo toque.
    let ponteiro = ''
    const aoApontar = (evento: PointerEvent) => {
      ponteiro = evento.pointerType
    }
    container.addEventListener('pointerdown', aoApontar, { capture: true })
    novo.on('dblclick', (evento) => {
      if (ponteiro !== 'mouse' || !aoCancelarAtual.current) return
      evento.preventDefault()
      aoCancelarAtual.current()
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
      desenharRota(novo, rotaAtual.current)
    })
    mapa.current = novo
    return () => {
      container.removeEventListener('pointerdown', aoApontar, { capture: true })
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

  // Antes do load, a fonte ainda não existe: quem desenha é o próprio load, com a rota guardada.
  useEffect(() => {
    rotaAtual.current = rota
    if (mapa.current) desenharRota(mapa.current, rota)
  }, [rota])

  return <div ref={elemento} className="mapa" role="region" aria-label="Mapa" />
}
