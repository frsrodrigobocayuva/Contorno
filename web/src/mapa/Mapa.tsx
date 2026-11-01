// Mapa Interativo (DAS 7.2): MapLibre com os tiles raster do OpenStreetMap, só os da tela
// atual, com atribuição (ADR-013), nas cores do mapa (tinta.ts), preso à região atendida, sempre em
// 2D com o norte para cima. Por cima: as áreas proibidas, as duas rotas e o editor de áreas.
// No diagnóstico (telas 11 e 12), a área apontada ganha o nome e um contorno mais forte.
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
  type MapOptions,
} from 'maplibre-gl'
import enderecoDoWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import type { Contorno, Coordenadas } from '../api/cliente'
import {
  EditorDeArea,
  type EstadoDoDesenho,
  type RecusaDoDesenho,
} from '../restricoes/editor'
import { REGIAO } from './regiao'
import { registrarTinta, tingido } from './tilesTingidos'

// A região atendida, com folga para o mapa não cortar a borda.
const FOLGA = 0.05
const LIMITES: [Coordenadas, Coordenadas] = [
  [REGIAO[0][0] - FOLGA, REGIAO[0][1] - FOLGA],
  [REGIAO[1][0] + FOLGA, REGIAO[1][1] + FOLGA],
]

// O MapLibre 6 monta o endereço do worker em tempo de execução, e o Vite não leva o arquivo para
// o build: sem isto, o worker dá 404 e as fontes GeoJSON (rotas e áreas) não aparecem. Os tiles e
// os marcadores não dependem dele, por isso o mapa parecia normal (ponta a ponta, 2026-10-31).
setWorkerUrl(enderecoDoWorker)

// Configurável para os testes ponta a ponta usarem o tile em branco (plano, A5).
const TILES =
  (import.meta.env.VITE_TILES_URL as string | undefined) ??
  'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

const ESTILO: NonNullable<MapOptions['style']> = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: [tingido(TILES)],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
}

const VAZIO = { type: 'FeatureCollection' as const, features: [] }

// Área apontada pelo diagnóstico, em vermelho (teste do usuário, 2026-11-01; canvas v27): 4,7:1
// sobre o fundo areia do mapa. As outras áreas seguem em preto.
const TINTA: [number, number, number] = [0x1a, 0x1a, 0x1a]
const BLOQUEIO: [number, number, number] = [0xb3, 0x26, 0x1e]
const hex = (cor: [number, number, number]) =>
  `#${cor.map((c) => c.toString(16).padStart(2, '0')).join('')}`

export interface AreaNoMapa {
  id: string
  contorno: Contorno
  // O nome, só quando o diagnóstico aponta a área (S5-03).
  rotuloApontado?: string
}

// O que a tela pede ao mapa durante o desenho (telas 04 e 05).
export interface ControleDoMapa {
  desfazerArea: () => void
  vertices: () => Coordenadas[]
}

interface Props {
  origem?: Coordenadas | null
  destino?: Coordenadas | null
  // O centro do raio (tela 08).
  centro?: Coordenadas | null
  rota?: Coordenadas[] | null
  rotaRestrita?: Coordenadas[] | null
  areas?: AreaNoMapa[]
  // O desenho do usuário, tracejado sob o contorno das células, na conferência (RN04).
  referencia?: Coordenadas[] | null
  // Com valor, o editor fica ligado; `inicial` traz a área a ajustar.
  desenho?: { inicial?: Coordenadas[] } | null
  aoMudarDesenho?: (estado: EstadoDoDesenho) => void
  aoFecharDesenho?: (vertices: Coordenadas[]) => void
  aoTocar?: (coordenadas: Coordenadas) => void
  // O editor recusou um ponto ou o fechamento do desenho.
  aoRecusarDesenho?: (motivo: RecusaDoDesenho) => void
  // Duplo clique do mouse; no celular, o duplo toque continua dando zoom.
  aoCancelar?: () => void
  ref?: Ref<ControleDoMapa>
}

function marcadorDoCentro(): HTMLElement {
  const elemento = document.createElement('div')
  elemento.className = 'marcador-centro'
  elemento.setAttribute('aria-label', 'Centro do raio')
  return elemento
}

function marcador(letra: string): HTMLElement {
  const elemento = document.createElement('div')
  elemento.className = 'marcador'
  elemento.textContent = letra
  elemento.setAttribute('aria-label', letra === 'A' ? 'Origem' : 'Destino')
  return elemento
}

function linha(coordenadas: Coordenadas[] | null | undefined) {
  return coordenadas
    ? {
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'LineString' as const, coordinates: coordenadas },
      }
    : VAZIO
}

function contornos(areas: AreaNoMapa[] | undefined) {
  return {
    type: 'FeatureCollection' as const,
    features: (areas ?? []).map((a) => ({
      type: 'Feature' as const,
      properties: { id: a.id, apontada: Boolean(a.rotuloApontado) },
      geometry: a.contorno,
    })),
  }
}

// O nome fica logo acima do ponto mais ao norte do contorno: nunca cobre a área nem precisa
// saber onde fica o miolo dela.
function topo(contorno: Contorno): Coordenadas {
  let melhor = contorno.coordinates[0][0][0]
  for (const poligono of contorno.coordinates)
    for (const ponto of poligono[0]) if (ponto[1] > melhor[1]) melhor = ponto
  return [melhor[0], melhor[1]]
}

function rotuloDaArea(texto: string): HTMLElement {
  const elemento = document.createElement('div')
  elemento.className = 'rotulo-da-area'
  elemento.textContent = texto
  return elemento
}

// Hachura diagonal da área proibida, como no protótipo (8 × 8 px): o traço preto a 45%, o
// vermelho a 60%.
function hachura(cor: [number, number, number], opacidade: number) {
  const lado = 8
  const data = new Uint8Array(lado * lado * 4)
  for (let i = 0; i < lado; i++) {
    data.set([...cor, opacidade], (i * lado + (lado - 1 - i)) * 4)
  }
  return { width: lado, height: lado, data }
}

// Atualiza uma fonte assim que ela existe. Não depende de isStyleLoaded(): ele fica falso
// enquanto há tiles carregando, e o evento load não se repete.
function atualizar(
  mapa: MapLibreMap,
  fonte: string,
  dados: Parameters<GeoJSONSource['setData']>[0],
) {
  void mapa.getSource<GeoJSONSource>(fonte)?.setData(dados)
}

function enquadrar(
  mapa: MapLibreMap,
  linhas: (Coordenadas[] | null | undefined)[],
) {
  const pontos = linhas.flatMap((l) => l ?? [])
  if (pontos.length < 2) return
  const lons = pontos.map((c) => c[0])
  const lats = pontos.map((c) => c[1])
  mapa.fitBounds(
    [
      [Math.min(...lons), Math.min(...lats)],
      [Math.max(...lons), Math.max(...lats)],
    ],
    { padding: 48, duration: 0 },
  )
}

export function Mapa({ ref, ...props }: Props) {
  const {
    origem,
    destino,
    centro,
    rota,
    rotaRestrita,
    areas,
    referencia,
    desenho,
  } = props
  const elemento = useRef<HTMLDivElement>(null)
  const mapa = useRef<MapLibreMap | null>(null)
  const editor = useRef<EditorDeArea | null>(null)
  const marcadores = useRef<{ A?: Marker; B?: Marker; centro?: Marker }>({})
  const rotulos = useRef<Marker[]>([])
  // As últimas linhas enquadradas: uma rota que só sai de cena e volta não mexe no enquadramento.
  const enquadradas = useRef<{
    rota?: Coordenadas[]
    restrita?: Coordenadas[]
  }>({})
  // Sempre as props da última renderização: o load e os eventos do mapa leem daqui.
  const atuais = useRef(props)

  useEffect(() => {
    atuais.current = props
  })

  useImperativeHandle(
    ref,
    () => ({
      desfazerArea: () => editor.current?.desfazerArea(),
      vertices: () => editor.current?.vertices() ?? [],
    }),
    [],
  )

  useEffect(() => {
    const container = elemento.current
    if (!container) return
    registrarTinta()
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
      atuais.current.aoTocar?.([evento.lngLat.lng, evento.lngLat.lat])
    })

    // O tipo do último ponteiro separa o duplo clique do mouse do duplo toque.
    let ponteiro = ''
    const aoApontar = (evento: PointerEvent) => {
      ponteiro = evento.pointerType
    }
    container.addEventListener('pointerdown', aoApontar, { capture: true })
    novo.on('dblclick', (evento) => {
      const aoCancelar = atuais.current.aoCancelar
      if (ponteiro !== 'mouse' || !aoCancelar) return
      evento.preventDefault()
      aoCancelar()
    })

    novo.on('load', () => {
      const p = atuais.current
      novo.addImage('hachura', hachura(TINTA, 115))
      novo.addImage('hachura-vermelha', hachura(BLOQUEIO, 153))
      novo.addSource('areas', { type: 'geojson', data: contornos(p.areas) })
      novo.addSource('referencia', {
        type: 'geojson',
        data: linha(p.referencia),
      })
      novo.addSource('rota', { type: 'geojson', data: linha(p.rota) })
      novo.addSource('rota-restrita', {
        type: 'geojson',
        data: linha(p.rotaRestrita),
      })
      novo.addLayer({
        id: 'areas-hachura',
        type: 'fill',
        source: 'areas',
        paint: {
          'fill-pattern': [
            'case',
            ['get', 'apontada'],
            'hachura-vermelha',
            'hachura',
          ],
        },
      })
      novo.addLayer({
        id: 'areas-contorno',
        type: 'line',
        source: 'areas',
        paint: {
          'line-color': [
            'case',
            ['get', 'apontada'],
            hex(BLOQUEIO),
            hex(TINTA),
          ],
          'line-width': ['case', ['get', 'apontada'], 3.5, 1.5],
        },
      })
      novo.addLayer({
        id: 'referencia',
        type: 'line',
        source: 'referencia',
        paint: {
          'line-color': '#3D3D3D',
          'line-width': 1.5,
          'line-dasharray': [3, 2],
        },
      })
      novo.addLayer({
        id: 'rota-irrestrita',
        type: 'line',
        source: 'rota',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#594927',
          'line-width': 4,
          'line-dasharray': [2, 1.5],
        },
      })
      // As duas rotas na cor de destaque (Guia de Estilo): a irrestrita tracejada, porque o cinza
      // se perdia no mapa (teste do usuário, 2026-10-31), e a restrita em linha cheia, por cima.
      novo.addLayer({
        id: 'rota-restrita',
        type: 'line',
        source: 'rota-restrita',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#594927', 'line-width': 5 },
      })
      enquadrar(novo, [p.rota, p.rotaRestrita])
      editor.current = new EditorDeArea(
        novo,
        (estado) => atuais.current.aoMudarDesenho?.(estado),
        (vertices) => atuais.current.aoFecharDesenho?.(vertices),
        (motivo) => atuais.current.aoRecusarDesenho?.(motivo),
      )
      if (p.desenho) editor.current.iniciar(p.desenho.inicial)
    })
    mapa.current = novo
    return () => {
      container.removeEventListener('pointerdown', aoApontar, { capture: true })
      editor.current?.parar()
      editor.current = null
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
    marcadores.current.centro?.remove()
    marcadores.current.centro = centro
      ? new Marker({ element: marcadorDoCentro() })
          .setLngLat(centro)
          .addTo(atual)
      : undefined
  }, [centro])

  // Antes do load, as fontes ainda não existem: quem desenha é o próprio load, com as props atuais.
  // Só uma rota nova enquadra o mapa. Ao desenhar uma área, a restrita sai de cena, e o mapa fica
  // onde o usuário o deixou (S5-03).
  useEffect(() => {
    if (!mapa.current) return
    atualizar(mapa.current, 'rota', linha(rota))
    atualizar(mapa.current, 'rota-restrita', linha(rotaRestrita))
    const vistas = enquadradas.current
    const nova =
      (rota && rota !== vistas.rota) ||
      (rotaRestrita && rotaRestrita !== vistas.restrita)
    if (rota) vistas.rota = rota
    if (rotaRestrita) vistas.restrita = rotaRestrita
    if (nova) enquadrar(mapa.current, [rota, rotaRestrita])
  }, [rota, rotaRestrita])

  useEffect(() => {
    const atual = mapa.current
    if (!atual) return
    atualizar(atual, 'areas', contornos(areas))
    for (const rotulo of rotulos.current) rotulo.remove()
    rotulos.current = (areas ?? []).flatMap((a) =>
      a.rotuloApontado
        ? [
            new Marker({
              element: rotuloDaArea(a.rotuloApontado),
              anchor: 'bottom',
              offset: [0, -4],
            })
              .setLngLat(topo(a.contorno))
              .addTo(atual),
          ]
        : [],
    )
  }, [areas])

  useEffect(() => {
    if (mapa.current) atualizar(mapa.current, 'referencia', linha(referencia))
  }, [referencia])

  // O editor liga com o desenho e desliga sem ele; antes do load, quem liga é o próprio load.
  useEffect(() => {
    if (!editor.current) return
    if (desenho) editor.current.iniciar(desenho.inicial)
    else editor.current.parar()
  }, [desenho])

  return <div ref={elemento} className="mapa" role="region" aria-label="Mapa" />
}
