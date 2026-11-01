import { createRef } from 'react'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Coordenadas } from '../api/cliente'
import { Mapa, type ControleDoMapa } from './Mapa'

// O MapLibre precisa de WebGL, que o jsdom não tem: um falso guarda as opções e os eventos e
// deixa o teste dizer quando o estilo terminou de carregar.
type Tratador = (evento: Record<string, unknown>) => void

class MapaFalso {
  static ultimo: MapaFalso
  opcoes: Record<string, unknown>
  tratadores: Record<string, Tratador[]> = {}
  fontes: Record<
    string,
    { setData: ReturnType<typeof vi.fn>; inicial: unknown }
  > = {}
  camadas: Record<string, unknown>[] = []
  estiloCarregado = false
  fitBounds = vi.fn()
  touchZoomRotate = { disableRotation: vi.fn() }
  keyboard = { disableRotation: vi.fn() }

  constructor(opcoes: Record<string, unknown>) {
    this.opcoes = opcoes
    MapaFalso.ultimo = this
  }
  on(evento: string, tratador: Tratador) {
    ;(this.tratadores[evento] ??= []).push(tratador)
    return this
  }
  once(evento: string, tratador: Tratador) {
    return this.on(evento, tratador)
  }
  disparar(evento: string, dados: Record<string, unknown> = {}) {
    for (const tratador of this.tratadores[evento] ?? []) tratador(dados)
  }
  addControl() {
    return this
  }
  addImage = vi.fn()
  addSource(id: string, fonte: { data?: unknown }) {
    this.fontes[id] = { setData: vi.fn(), inicial: fonte.data }
  }
  addLayer(camada: Record<string, unknown>) {
    this.camadas.push(camada)
  }
  getSource(id: string) {
    return this.fontes[id]
  }
  isStyleLoaded() {
    return this.estiloCarregado
  }
  remove() {}
}

// O Terra Draw precisa do mapa de verdade: no lugar dele, um editor falso que registra os pedidos.
const { editores, marcadores, recusas } = vi.hoisted(() => ({
  recusas: [] as ((motivo: string) => void)[],
  marcadores: [] as {
    opcoes: { element?: HTMLElement; anchor?: string }
    lngLat?: [number, number]
    removido: boolean
  }[],
  editores: [] as {
    iniciar: ReturnType<typeof vi.fn>
    parar: ReturnType<typeof vi.fn>
    desfazer: ReturnType<typeof vi.fn>
    vertices: ReturnType<typeof vi.fn>
  }[],
}))
vi.mock('../restricoes/editor', () => ({
  EditorDeArea: function (
    _mapa: unknown,
    _aoMudar: unknown,
    _aoFechar: unknown,
    aoRecusar: (motivo: string) => void,
  ) {
    recusas.push(aoRecusar)
    const editor = {
      iniciar: vi.fn(),
      parar: vi.fn(),
      desfazer: vi.fn(),
      vertices: vi.fn(() => [[-51.15, -29.76]]),
    }
    editores.push(editor)
    return editor
  },
}))

vi.mock('maplibre-gl', () => ({
  Map: function (opcoes: Record<string, unknown>) {
    return new MapaFalso(opcoes)
  },
  Marker: class {
    registro: (typeof marcadores)[number]
    constructor(opcoes: (typeof marcadores)[number]['opcoes']) {
      this.registro = { opcoes, removido: false }
      marcadores.push(this.registro)
    }
    setLngLat(lngLat: [number, number]) {
      this.registro.lngLat = lngLat
      return this
    }
    addTo() {
      return this
    }
    remove() {
      this.registro.removido = true
    }
  },
  NavigationControl: class {},
  addProtocol: vi.fn(),
  setWorkerUrl: vi.fn(),
}))

const ROTA: Coordenadas[] = [
  [-51.15, -29.79],
  [-51.14, -29.69],
]

// Carrega o estilo e, logo depois, começa a buscar tiles: é o que acontece quando a tela muda
// de etapa e o mapa muda de tamanho.
function carregarEDepoisBuscarTiles(mapa: MapaFalso) {
  mapa.estiloCarregado = true
  mapa.disparar('load')
  mapa.estiloCarregado = false
}

function apontar(elemento: Element, tipo: string) {
  const evento = new Event('pointerdown', { bubbles: true })
  Object.defineProperty(evento, 'pointerType', { value: tipo })
  elemento.dispatchEvent(evento)
}

beforeEach(() => {
  vi.clearAllMocks()
  editores.length = 0
  marcadores.length = 0
  recusas.length = 0
})

describe('Mapa', () => {
  it('desenha a rota que chega enquanto o mapa ainda busca tiles', () => {
    const { rerender } = render(<Mapa rota={null} />)
    const mapa = MapaFalso.ultimo
    carregarEDepoisBuscarTiles(mapa)

    rerender(<Mapa rota={ROTA} />)

    expect(mapa.fontes.rota.setData).toHaveBeenLastCalledWith({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: ROTA },
    })
    expect(mapa.fitBounds).toHaveBeenCalled()
  })

  it('desenha no load a rota que chegou antes dele', () => {
    render(<Mapa rota={ROTA} />)
    const mapa = MapaFalso.ultimo

    mapa.disparar('load')

    expect(mapa.fontes.rota.inicial).toEqual(
      expect.objectContaining({
        geometry: { type: 'LineString', coordinates: ROTA },
      }),
    )
    expect(mapa.fitBounds).toHaveBeenCalled()
  })

  it('apaga a linha quando a rota sai', () => {
    const { rerender } = render(<Mapa rota={ROTA} />)
    const mapa = MapaFalso.ultimo
    carregarEDepoisBuscarTiles(mapa)

    rerender(<Mapa rota={null} />)

    expect(mapa.fontes.rota.setData).toHaveBeenLastCalledWith({
      type: 'FeatureCollection',
      features: [],
    })
  })

  it('só uma rota nova enquadra o mapa; a que sai de cena e volta, não', () => {
    const restrita: Coordenadas[] = [
      [-51.16, -29.79],
      [-51.14, -29.69],
    ]
    const { rerender } = render(<Mapa rota={ROTA} rotaRestrita={restrita} />)
    const mapa = MapaFalso.ultimo
    carregarEDepoisBuscarTiles(mapa)
    mapa.fitBounds.mockClear()

    // No desenho, a restrita sai do mapa; depois, volta a mesma.
    rerender(<Mapa rota={ROTA} rotaRestrita={null} />)
    rerender(<Mapa rota={ROTA} rotaRestrita={restrita} />)
    expect(mapa.fitBounds).not.toHaveBeenCalled()

    rerender(<Mapa rota={ROTA} rotaRestrita={[...restrita]} />)
    expect(mapa.fitBounds).toHaveBeenCalledOnce()
  })

  it('fica em 2D, com o norte para cima, sem girar nem inclinar', () => {
    render(<Mapa />)
    const mapa = MapaFalso.ultimo

    expect(mapa.opcoes).toMatchObject({
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      rollEnabled: false,
      maxPitch: 0,
    })
    expect(mapa.touchZoomRotate.disableRotation).toHaveBeenCalled()
    expect(mapa.keyboard.disableRotation).toHaveBeenCalled()
  })

  it('pede os tiles do OSM pelo protocolo que os recolore', () => {
    render(<Mapa />)
    const estilo = MapaFalso.ultimo.opcoes.style as {
      sources: { osm: { tiles: string[] } }
    }

    expect(estilo.sources.osm.tiles).toEqual([
      'contorno-tinta://https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    ])
  })

  it('o duplo clique do mouse cancela e não dá zoom', () => {
    const aoCancelar = vi.fn()
    const { container } = render(<Mapa aoCancelar={aoCancelar} />)
    const preventDefault = vi.fn()

    apontar(container.firstChild as Element, 'mouse')
    MapaFalso.ultimo.disparar('dblclick', { preventDefault })

    expect(aoCancelar).toHaveBeenCalledOnce()
    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it('o duplo toque no celular continua dando zoom e não cancela', () => {
    const aoCancelar = vi.fn()
    const { container } = render(<Mapa aoCancelar={aoCancelar} />)
    const preventDefault = vi.fn()

    apontar(container.firstChild as Element, 'touch')
    MapaFalso.ultimo.disparar('dblclick', { preventDefault })

    expect(aoCancelar).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('sem quem cancele (na abertura), o duplo clique dá zoom', () => {
    const { container } = render(<Mapa />)
    const preventDefault = vi.fn()

    apontar(container.firstChild as Element, 'mouse')
    MapaFalso.ultimo.disparar('dblclick', { preventDefault })

    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('desenha a rota restrita e as áreas nas fontes delas', () => {
    const contorno = {
      type: 'MultiPolygon' as const,
      coordinates: [
        [
          [
            [-51.15, -29.76],
            [-51.14, -29.76],
            [-51.14, -29.75],
            [-51.15, -29.76],
          ] as [number, number][],
        ],
      ],
    }
    const { rerender } = render(<Mapa rota={ROTA} />)
    const mapa = MapaFalso.ultimo
    carregarEDepoisBuscarTiles(mapa)

    rerender(
      <Mapa rota={ROTA} rotaRestrita={ROTA} areas={[{ id: 'a1', contorno }]} />,
    )

    expect(mapa.fontes['rota-restrita'].setData).toHaveBeenLastCalledWith(
      expect.objectContaining({
        geometry: { type: 'LineString', coordinates: ROTA },
      }),
    )
    expect(mapa.fontes.areas.setData).toHaveBeenLastCalledWith({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { id: 'a1', apontada: false },
          geometry: contorno,
        },
      ],
    })
    expect(mapa.addImage).toHaveBeenCalledWith(
      'hachura',
      expect.objectContaining({ width: 8, height: 8 }),
    )
  })

  it('a área apontada pelo diagnóstico ganha o nome e um contorno mais forte', () => {
    const contorno = {
      type: 'MultiPolygon' as const,
      coordinates: [
        [
          [
            [-51.15, -29.76],
            [-51.14, -29.76],
            [-51.145, -29.74],
            [-51.15, -29.76],
          ] as [number, number][],
        ],
      ],
    }
    const { rerender } = render(<Mapa />)
    const mapa = MapaFalso.ultimo
    carregarEDepoisBuscarTiles(mapa)

    rerender(
      <Mapa
        areas={[
          { id: 'a1', contorno, rotuloApontado: 'Centro' },
          { id: 'a2', contorno },
        ]}
      />,
    )

    const nomes = marcadores.filter((m) => !m.removido)
    expect(nomes).toHaveLength(1)
    expect(nomes[0].opcoes.element?.textContent).toBe('Centro')
    expect(nomes[0].opcoes.anchor).toBe('bottom')
    expect(nomes[0].lngLat).toEqual([-51.145, -29.74])
    expect(
      mapa.fontes.areas.setData.mock.lastCall?.[0].features.map(
        (f: { properties: object }) => f.properties,
      ),
    ).toEqual([
      { id: 'a1', apontada: true },
      { id: 'a2', apontada: false },
    ])
    const camada = (id: string) => mapa.camadas.find((c) => c.id === id)
    expect(camada('areas-contorno')).toMatchObject({
      paint: {
        'line-color': ['case', ['get', 'apontada'], '#b3261e', '#1a1a1a'],
        'line-width': ['case', ['get', 'apontada'], 3.5, 1.5],
      },
    })
    expect(camada('areas-hachura')).toMatchObject({
      paint: {
        'fill-pattern': [
          'case',
          ['get', 'apontada'],
          'hachura-vermelha',
          'hachura',
        ],
      },
    })
    expect(mapa.addImage).toHaveBeenCalledWith(
      'hachura-vermelha',
      expect.objectContaining({ width: 8, height: 8 }),
    )

    rerender(<Mapa areas={[{ id: 'a1', contorno }]} />)
    expect(marcadores.filter((m) => !m.removido)).toHaveLength(0)
  })

  it('repassa a recusa do editor para quem desenha', () => {
    const aoRecusarDesenho = vi.fn()
    render(<Mapa aoRecusarDesenho={aoRecusarDesenho} />)
    MapaFalso.ultimo.disparar('load')

    recusas[0]('FORA_DA_REGIAO')

    expect(aoRecusarDesenho).toHaveBeenCalledWith('FORA_DA_REGIAO')
  })

  it('liga o editor com o desenho e desliga sem ele', () => {
    const inicial: Coordenadas[] = [
      [-51.15, -29.76],
      [-51.14, -29.76],
      [-51.14, -29.75],
    ]
    const { rerender } = render(<Mapa desenho={{ inicial }} />)
    MapaFalso.ultimo.disparar('load')
    const [editor] = editores

    expect(editor.iniciar).toHaveBeenCalledWith(inicial)

    rerender(<Mapa desenho={null} />)
    expect(editor.parar).toHaveBeenCalled()
  })

  it('o controle do mapa passa o desfazer e os vértices para o editor', () => {
    const controle = createRef<ControleDoMapa>()
    render(<Mapa ref={controle} />)
    MapaFalso.ultimo.disparar('load')

    controle.current!.desfazer()

    expect(editores[0].desfazer).toHaveBeenCalled()
    expect(controle.current!.vertices()).toEqual([[-51.15, -29.76]])
  })
})
