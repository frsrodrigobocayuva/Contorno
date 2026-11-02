// Mapa Interativo (DAS 7.2): MapLibre com os tiles raster do OpenStreetMap, só os da tela
// atual, com atribuição (ADR-013), nas cores do mapa (tinta.ts), preso à região atendida, sempre em
// 2D com o norte para cima. Por cima: as áreas proibidas, as duas rotas e o editor de áreas.
// No diagnóstico (telas 11 e 12), a área apontada ganha o nome e um contorno mais forte.
// Movimento (vault, Contorno-Animacoes): a restrita tem um brilho que pulsa (M1); a rota chega
// sendo desenhada de A a B (M3), com a câmera deslizando (M4); áreas entram e saem com fade (M5,
// M9); o vermelho das apontadas pulsa uma vez (M6); as linhas somem com fade (M9).
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type MapOptions,
} from 'maplibre-gl'
import enderecoDoWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import type { Contorno, Coordenadas } from '../api/cliente'
import {
  animar,
  degradeDaVarredura,
  DURACAO,
  movimentoReduzido,
  trechoAte,
} from '../movimento'
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

// O brilho da restrita parado: com movimento reduzido, e o ponto de partida do pulso (M1).
const BRILHO = { largura: 14, opacidade: 0.35 }

// A varredura clara na posição pedida da linha (M1b); 2 deixa a linha sem traço.
function varredura(posicao: number): ExpressionSpecification {
  return [
    'interpolate',
    ['linear'],
    ['line-progress'],
    ...degradeDaVarredura(posicao),
  ] as unknown as ExpressionSpecification
}

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

// O MapLibre posiciona o marcador pelo transform do elemento de fora; o de dentro é o desenho, e
// é ele que "cai" no lugar (M7), sem brigar com o posicionamento.
function comCorpo(classe: string, rotulo: string, texto = ''): HTMLElement {
  const elemento = document.createElement('div')
  elemento.className = classe
  elemento.setAttribute('aria-label', rotulo)
  const corpo = document.createElement('span')
  corpo.className = 'marcador-corpo'
  corpo.textContent = texto
  elemento.append(corpo)
  return elemento
}

function marcadorDoCentro(): HTMLElement {
  return comCorpo('marcador-centro', 'Centro do raio')
}

function marcador(letra: string): HTMLElement {
  return comCorpo('marcador', letra === 'A' ? 'Origem' : 'Destino', letra)
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
    { padding: 48, duration: movimentoReduzido() ? 0 : DURACAO.camera },
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
  const pontosMarcados = useRef<{
    A?: Coordenadas | null
    B?: Coordenadas | null
  }>({})
  // O que cada linha mostra agora, e como concluir a animação dela (M3, M9).
  const exibidas = useRef<{
    rota?: Coordenadas[] | null
    restrita?: Coordenadas[] | null
  }>({})
  const concluirLinha = useRef<{ rota?: () => void; restrita?: () => void }>({})
  const areasVistas = useRef(new Map<string, AreaNoMapa>())
  const concluirAreas = useRef<(() => void)[]>([])
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
      // O id da área vira o id da feição, para o fade e o pulso por área (feature-state).
      novo.addSource('areas', {
        type: 'geojson',
        data: contornos(p.areas),
        promoteId: 'id',
      })
      areasVistas.current = new Map((p.areas ?? []).map((a) => [a.id, a]))
      novo.addSource('referencia', {
        type: 'geojson',
        data: linha(p.referencia),
      })
      novo.addSource('rota', { type: 'geojson', data: linha(p.rota) })
      // `lineMetrics` dá o `line-progress` que a varredura usa para correr de A a B.
      novo.addSource('rota-restrita', {
        type: 'geojson',
        data: linha(p.rotaRestrita),
        lineMetrics: true,
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
          'fill-opacity': ['coalesce', ['feature-state', 'opacidade'], 1],
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
          'line-width': [
            'case',
            ['get', 'apontada'],
            ['+', 3.5, ['*', 4, ['coalesce', ['feature-state', 'pulso'], 0]]],
            1.5,
          ],
          'line-opacity': ['coalesce', ['feature-state', 'opacidade'], 1],
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
      // se perdia no mapa (teste do usuário, 2026-10-31), e a restrita em linha cheia, por cima,
      // com um brilho que pulsa por baixo dela (M1; pedido do usuário, 2026-11-02).
      novo.addLayer({
        id: 'rota-restrita-brilho',
        type: 'line',
        source: 'rota-restrita',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#594927',
          'line-width': BRILHO.largura,
          'line-blur': 6,
          'line-opacity': BRILHO.opacidade,
          'line-width-transition': { duration: 0 },
          'line-opacity-transition': { duration: 0 },
        },
      })
      novo.addLayer({
        id: 'rota-restrita',
        type: 'line',
        source: 'rota-restrita',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#594927',
          'line-width': 5,
          'line-opacity-transition': { duration: 0 },
        },
      })
      // Por cima da restrita, o traço claro que corre de A a B, como se ela carregasse (M1b).
      novo.addLayer({
        id: 'rota-restrita-varredura',
        type: 'line',
        source: 'rota-restrita',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': 5,
          'line-gradient': varredura(2),
          'line-opacity-transition': { duration: 0 },
        },
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

  // Só o marcador que mudou é recriado: é ele que cai no lugar (M7); o outro fica parado.
  useEffect(() => {
    const atual = mapa.current
    if (!atual) return
    for (const [letra, ponto] of [
      ['A', origem],
      ['B', destino],
    ] as const) {
      if (pontosMarcados.current[letra] === ponto) continue
      pontosMarcados.current[letra] = ponto
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
  // Só uma rota nova enquadra o mapa e é desenhada de A a B (M3, M4); a que só saiu de cena e voltou
  // aparece pronta. Ao desenhar uma área, a restrita sai de cena com fade (M9), e o mapa fica onde o
  // usuário o deixou (S5-03).
  useEffect(() => {
    const atual = mapa.current
    if (!atual) return
    const vistas = enquadradas.current
    const novaRota = !!rota && rota !== vistas.rota
    const novaRestrita = !!rotaRestrita && rotaRestrita !== vistas.restrita
    if (rota) vistas.rota = rota
    if (rotaRestrita) vistas.restrita = rotaRestrita

    function trocar(
      chave: 'rota' | 'restrita',
      fonte: string,
      camadas: [string, number][],
      coordenadas: Coordenadas[] | null | undefined,
      nova: boolean,
    ) {
      const mapaAtual = atual!
      const opacidade = (fator: number) => {
        for (const [camada, base] of camadas)
          if (mapaAtual.getLayer(camada))
            mapaAtual.setPaintProperty(camada, 'line-opacity', base * fator)
      }
      concluirLinha.current[chave]?.()
      const antes = exibidas.current[chave]
      exibidas.current[chave] = coordenadas ?? null
      if (coordenadas && nova) {
        concluirLinha.current[chave] = animar(DURACAO.rota, (p) =>
          atualizar(mapaAtual, fonte, linha(trechoAte(coordenadas, p))),
        )
      } else if (!coordenadas && antes) {
        concluirLinha.current[chave] = animar(
          DURACAO.saida,
          (p) => opacidade(1 - p),
          () => {
            atualizar(mapaAtual, fonte, VAZIO)
            opacidade(1)
          },
        )
      } else {
        atualizar(mapaAtual, fonte, linha(coordenadas))
      }
    }

    trocar('rota', 'rota', [['rota-irrestrita', 1]], rota, novaRota)
    trocar(
      'restrita',
      'rota-restrita',
      [
        ['rota-restrita', 1],
        ['rota-restrita-brilho', BRILHO.opacidade],
        ['rota-restrita-varredura', 1],
      ],
      rotaRestrita,
      novaRestrita,
    )
    if (novaRota || novaRestrita) enquadrar(atual, [rota, rotaRestrita])
  }, [rota, rotaRestrita])

  // O brilho da restrita pulsa enquanto ela está no mapa (M1), e um traço claro corre de A a B a
  // cada 3 s, começando depois que a linha termina de ser desenhada (M1b), a uns 30 quadros por
  // segundo. Com movimento reduzido, o brilho fica parado e não há traço.
  useEffect(() => {
    const atual = mapa.current
    if (!atual || !rotaRestrita || movimentoReduzido()) return
    const inicio = performance.now()
    let ultimo = 0
    let ultimaPosicao = 2
    let quadro = 0
    const passo = (agora: number) => {
      if (agora - ultimo >= 33 && atual.getLayer('rota-restrita-brilho')) {
        ultimo = agora
        const desdeODesenho = agora - inicio - DURACAO.rota
        const fase =
          desdeODesenho < 0 ? -1 : desdeODesenho % DURACAO.cicloDaVarredura
        const posicao =
          fase >= 0 && fase < DURACAO.varredura
            ? -0.08 + 1.16 * (fase / DURACAO.varredura)
            : 2
        if (posicao !== 2 || ultimaPosicao !== 2) {
          atual.setPaintProperty(
            'rota-restrita-varredura',
            'line-gradient',
            varredura(posicao),
          )
          ultimaPosicao = posicao
        }
        const onda =
          (1 - Math.cos((2 * Math.PI * (agora - inicio)) / DURACAO.brilho)) / 2
        atual.setPaintProperty(
          'rota-restrita-brilho',
          'line-opacity',
          0.15 + 0.35 * onda,
        )
        atual.setPaintProperty(
          'rota-restrita-brilho',
          'line-width',
          BRILHO.largura - 2 + 6 * onda,
        )
      }
      quadro = requestAnimationFrame(passo)
    }
    quadro = requestAnimationFrame(passo)
    return () => cancelAnimationFrame(quadro)
  }, [rotaRestrita])

  // Áreas novas entram com fade (M5) e as que saem somem com fade (M9); a área que acabou de ser
  // conferida já estava na tela e não pisca. A que passa a ser apontada pulsa uma vez (M6).
  useEffect(() => {
    const atual = mapa.current
    if (!atual) return
    for (const concluir of concluirAreas.current) concluir()
    const lista = areas ?? []
    const antes = areasVistas.current
    const ids = new Set(lista.map((a) => a.id))
    const conferida = antes.has('em-conferencia') && !ids.has('em-conferencia')
    const saindo = conferida
      ? []
      : [...antes.values()].filter((a) => !ids.has(a.id))
    const entrando = conferida ? [] : lista.filter((a) => !antes.has(a.id))
    const apontadas = lista.filter(
      (a) => a.rotuloApontado && !antes.get(a.id)?.rotuloApontado,
    )
    areasVistas.current = new Map(lista.map((a) => [a.id, a]))
    const estado = (id: string, valores: Record<string, number>) => {
      if (atual.getSource('areas'))
        atual.setFeatureState({ source: 'areas', id }, valores)
    }
    for (const a of entrando) estado(a.id, { opacidade: 0 })
    concluirAreas.current = [
      ...(saindo.length
        ? [
            animar(
              DURACAO.area,
              (p) => saindo.forEach((a) => estado(a.id, { opacidade: 1 - p })),
              () => atualizar(atual, 'areas', contornos(lista)),
            ),
          ]
        : []),
      ...entrando.map((a) =>
        animar(DURACAO.area, (p) => estado(a.id, { opacidade: p })),
      ),
      ...apontadas.map((a) =>
        animar(
          DURACAO.pulso,
          (p) => estado(a.id, { pulso: Math.sin(Math.PI * p) }),
          () => estado(a.id, { pulso: 0 }),
        ),
      ),
    ]
    if (!saindo.length || movimentoReduzido())
      atualizar(atual, 'areas', contornos(lista))
    else atualizar(atual, 'areas', contornos([...lista, ...saindo]))
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
