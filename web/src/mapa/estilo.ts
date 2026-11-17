// O mapa base vetorial (#107, ADR-016): os tiles do OpenFreeMap (esquema OpenMapTiles), desenhados
// pelo próprio MapLibre com este estilo. Nítido em qualquer zoom, porque não estica imagens.
// As cores são as do mapa do OSM (OpenStreetMap Carto) passadas pela paleta (tinta.ts), como o
// recolorimento dos tiles raster fazia até a Sprint 5 (escolha do usuário, 2026-11-17). Os nomes
// são escritos em Atkinson Hyperlegible, a fonte da interface, pelos arquivos do próprio projeto.
import latinExtNegrito from '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-ext-700-normal.woff2?url'
import latinExtRegular from '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-ext-400-normal.woff2?url'
import latinNegrito from '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-normal.woff2?url'
import latinRegular from '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff2?url'
import type {
  ExpressionSpecification,
  FontFacesSpecification,
  LayerSpecification,
  StyleSpecification,
} from 'maplibre-gl'
import { naPaleta } from './tinta'

// O TileJSON do OpenFreeMap; configurável para apontar para outro servidor do mesmo esquema.
export const TILES =
  (import.meta.env.VITE_TILES_URL as string | undefined) ??
  'https://tiles.openfreemap.org/planet'

// A do OSM cobre também os dados do motor e da busca (DAS 6.14), então fica sempre no mapa, mesmo
// sem os tiles (Mapa.tsx, customAttribution); com eles, o MapLibre a mostra só dentro da completa.
export const ATRIBUICAO_OSM =
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>'

export const ATRIBUICAO = [
  '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a>',
  '<a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">© OpenMapTiles</a>',
  ATRIBUICAO_OSM,
].join(' ')

// As cores do OpenStreetMap Carto, o mapa padrão do openstreetmap.org (o dos tiles raster).
export const OSM = {
  terra: '#F2EFE9',
  agua: '#AAD3DF',
  residencial: '#E0DFDF',
  comercial: '#F2DAD9',
  varejo: '#FFD6D1',
  industrial: '#EBDBE8',
  cemiterio: '#AACBAF',
  ensino: '#FFFFE5',
  esporte: '#AAE0CB',
  parque: '#C8FACC',
  grama: '#CDEBB0',
  mata: '#ADD19E',
  lavoura: '#EEF0D5',
  areia: '#F5E9C6',
  predio: '#D9D0C9',
  contornoDoPredio: '#C4B6AB',
  limite: '#8D618B',
  ferrovia: '#707070',
  trilha: '#996600',
  caminho: '#FA8072',
  texto: '#000000',
  textoDeRua: '#222222',
  textoDeAgua: '#4D80B3',
  halo: '#FFFFFF',
} as const

// Vias: o miolo e a borda de cada classe do esquema, com as cores do OSM Carto.
export const VIAS = {
  motorway: { miolo: '#E892A2', borda: '#DC2A67' },
  trunk: { miolo: '#F9B29C', borda: '#C84E2F' },
  primary: { miolo: '#FCD6A4', borda: '#A06B00' },
  secondary: { miolo: '#F7FABF', borda: '#707D05' },
  tertiary: { miolo: '#FFFFFF', borda: '#8F8F8F' },
  minor: { miolo: '#FFFFFF', borda: '#BBBBBB' },
  service: { miolo: '#FFFFFF', borda: '#BBBBBB' },
} as const
type Classe = keyof typeof VIAS
const CLASSES = Object.keys(VIAS) as Classe[]

// Largura do miolo (px) por classe, nos zooms 10, 14 e 18; 0 esconde a classe naquele zoom.
const LARGURA: Record<Classe, [number, number, number]> = {
  motorway: [1.6, 6, 22],
  trunk: [1.4, 5.5, 20],
  primary: [1.2, 5, 18],
  secondary: [0.8, 4.5, 16],
  tertiary: [0.5, 4, 15],
  minor: [0, 2.5, 13],
  service: [0, 1, 7],
}

const FONTE_REGULAR = 'Atkinson Hyperlegible Regular'
const FONTE_NEGRITO = 'Atkinson Hyperlegible Bold'

// Os mesmos recortes de caracteres do @fontsource: o latino básico cobre o português.
const LATIN = ['U+0000-00FF', 'U+0131', 'U+0152-0153', 'U+2000-206F', 'U+20AC']
const LATIN_EXT = ['U+0100-02BA', 'U+02BD-02C5', 'U+1E00-1E9F', 'U+1EF2-1EFF']

const absoluto = (url: string) => new URL(url, document.baseURI).href

export function fontes(): FontFacesSpecification {
  return {
    [FONTE_REGULAR]: [
      { url: absoluto(latinRegular), 'unicode-range': LATIN },
      { url: absoluto(latinExtRegular), 'unicode-range': LATIN_EXT },
    ],
    [FONTE_NEGRITO]: [
      { url: absoluto(latinNegrito), 'unicode-range': LATIN },
      { url: absoluto(latinExtNegrito), 'unicode-range': LATIN_EXT },
    ],
  }
}

const classe = ['get', 'class'] as ExpressionSpecification

function porClasse(
  valor: (c: Classe) => string | number,
): ExpressionSpecification {
  return [
    'match',
    classe,
    ...CLASSES.flatMap((c) => [c, valor(c)]),
    valor('service'),
  ] as unknown as ExpressionSpecification
}

// A largura cresce com o zoom; a borda é o miolo com 1 px de cada lado, a partir do zoom 12.
function largura(borda: number): ExpressionSpecification {
  return [
    'interpolate',
    ['exponential', 1.5],
    ['zoom'],
    10,
    porClasse((c) => LARGURA[c][0]),
    14,
    porClasse((c) => (LARGURA[c][1] ? LARGURA[c][1] + borda : 0)),
    18,
    porClasse((c) => LARGURA[c][2] + borda),
  ] as unknown as ExpressionSpecification
}

const ehVia = ['match', classe, CLASSES, true, false] as ExpressionSpecification
const linha = [
  'match',
  ['geometry-type'],
  ['LineString', 'MultiLineString'],
  true,
  false,
] as ExpressionSpecification

const cor = naPaleta

function camadas(): LayerSpecification[] {
  return [
    {
      id: 'fundo',
      type: 'background',
      paint: { 'background-color': cor(OSM.terra) },
    },
    {
      id: 'uso-do-solo',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      filter: [
        'match',
        classe,
        [
          'residential',
          'commercial',
          'retail',
          'industrial',
          'cemetery',
          'school',
          'university',
          'college',
          'kindergarten',
          'hospital',
          'stadium',
          'pitch',
          'playground',
        ],
        true,
        false,
      ],
      paint: {
        'fill-color': [
          'match',
          classe,
          'residential',
          cor(OSM.residencial),
          'commercial',
          cor(OSM.comercial),
          'retail',
          cor(OSM.varejo),
          'industrial',
          cor(OSM.industrial),
          'cemetery',
          cor(OSM.cemiterio),
          ['school', 'university', 'college', 'kindergarten', 'hospital'],
          cor(OSM.ensino),
          ['stadium', 'pitch', 'playground'],
          cor(OSM.esporte),
          cor(OSM.terra),
        ],
      },
    },
    {
      id: 'cobertura',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      // O banhado (wetland) fica de fora: no OSM Carto ele é só um padrão de traços sobre o fundo.
      filter: [
        'match',
        classe,
        ['wood', 'grass', 'farmland', 'sand'],
        true,
        false,
      ],
      paint: {
        'fill-color': [
          'match',
          classe,
          'wood',
          cor(OSM.mata),
          'grass',
          cor(OSM.grama),
          'farmland',
          cor(OSM.lavoura),
          'sand',
          cor(OSM.areia),
          cor(OSM.terra),
        ],
      },
    },
    {
      id: 'parque',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'park',
      paint: { 'fill-color': cor(OSM.parque) },
    },
    {
      id: 'agua',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'water',
      filter: ['!=', ['get', 'brunnel'], 'tunnel'],
      paint: { 'fill-color': cor(OSM.agua) },
    },
    {
      id: 'curso-dagua',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'waterway',
      filter: ['!=', ['get', 'brunnel'], 'tunnel'],
      paint: {
        'line-color': cor(OSM.agua),
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          10,
          ['match', classe, 'river', 1.5, 0.5],
          18,
          ['match', classe, 'river', 12, 4],
        ],
      },
    },
    {
      id: 'predio',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'building',
      minzoom: 13,
      paint: {
        'fill-color': cor(OSM.predio),
        'fill-outline-color': cor(OSM.contornoDoPredio),
      },
    },
    {
      id: 'limite',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'boundary',
      filter: [
        'all',
        ['<=', ['get', 'admin_level'], 8],
        ['!=', ['get', 'maritime'], 1],
      ],
      paint: {
        'line-color': cor(OSM.limite),
        'line-width': 1.2,
        'line-dasharray': [3, 2],
      },
    },
    {
      id: 'via-borda',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', linha, ehVia],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': porClasse((c) => cor(VIAS[c].borda)),
        'line-width': largura(2),
      },
    },
    {
      id: 'via',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', linha, ehVia],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': porClasse((c) => cor(VIAS[c].miolo)),
        'line-width': largura(0),
      },
    },
    {
      id: 'trilha',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom: 14,
      filter: ['all', linha, ['==', classe, 'track']],
      paint: {
        'line-color': cor(OSM.trilha),
        'line-width': 1.2,
        'line-dasharray': [3, 1.5],
      },
    },
    {
      id: 'caminho',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom: 15,
      filter: ['all', linha, ['==', classe, 'path']],
      paint: {
        'line-color': cor(OSM.caminho),
        'line-width': 1,
        'line-dasharray': [2, 1.5],
      },
    },
    {
      id: 'ferrovia',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: [
        'all',
        linha,
        ['match', classe, ['rail', 'transit'], true, false],
      ],
      paint: {
        'line-color': cor(OSM.ferrovia),
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 18, 3],
      },
    },
    {
      id: 'nome-da-agua',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'water_name',
      filter: ['!', linha],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': [FONTE_REGULAR],
        'text-size': 13,
      },
      paint: {
        'text-color': cor(OSM.textoDeAgua),
        'text-halo-color': cor(OSM.halo),
        'text-halo-width': 1.5,
      },
    },
    {
      id: 'nome-do-rio',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'waterway',
      filter: ['==', classe, 'river'],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': [FONTE_REGULAR],
        'text-size': 13,
        'symbol-placement': 'line',
      },
      paint: {
        'text-color': cor(OSM.textoDeAgua),
        'text-halo-color': cor(OSM.halo),
        'text-halo-width': 1.5,
      },
    },
    {
      id: 'nome-da-via',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'transportation_name',
      minzoom: 13,
      filter: ['match', classe, CLASSES, true, false],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': [FONTE_REGULAR],
        'text-size': ['interpolate', ['linear'], ['zoom'], 13, 11, 18, 15],
        'symbol-placement': 'line',
        'text-max-angle': 30,
      },
      paint: {
        'text-color': cor(OSM.textoDeRua),
        'text-halo-color': cor(OSM.halo),
        'text-halo-width': 1.5,
      },
    },
    {
      id: 'nome-do-lugar',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      filter: [
        'match',
        classe,
        [
          'city',
          'town',
          'village',
          'suburb',
          'neighbourhood',
          'quarter',
          'hamlet',
        ],
        true,
        false,
      ],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': [
          'match',
          classe,
          ['city', 'town'],
          ['literal', [FONTE_NEGRITO]],
          ['literal', [FONTE_REGULAR]],
        ],
        'text-size': ['match', classe, ['city', 'town'], 17, 'village', 14, 12],
        'text-max-width': 8,
      },
      paint: {
        'text-color': cor(OSM.texto),
        'text-halo-color': cor(OSM.halo),
        'text-halo-width': 1.5,
      },
    },
  ]
}

export function estilo(): StyleSpecification {
  return {
    version: 8,
    'font-faces': fontes(),
    sources: {
      openmaptiles: { type: 'vector', url: TILES, attribution: ATRIBUICAO },
    },
    layers: camadas(),
  }
}
