// Editor de Restrições (DAS 7.2): o desenho da área com o Terra Draw sobre o MapLibre, em modo
// polígono (Realização, UC02). O resto do app só vê os vértices.
//
// O editor recusa, na hora, o ponto fora da região atendida e o fechamento de um desenho que se
// cruza: o ponto não entra, e o desenho continua aberto (teste do usuário, 2026-11-01). Para
// recomeçar, "Desfazer área" apaga o desenho inteiro; o desfazer ponto saiu (S5-04, pedido do
// usuário).
import type { Map as MapLibreMap } from 'maplibre-gl'
import {
  TerraDraw,
  TerraDrawPolygonMode,
  ValidateNotSelfIntersecting,
  type GeoJSONStoreFeatures,
} from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'
import type { Coordenadas } from '../api/cliente'
import { naRegiao } from '../mapa/regiao'

export interface EstadoDoDesenho {
  vertices: Coordenadas[]
}

export type RecusaDoDesenho = 'FORA_DA_REGIAO' | 'DESENHO_CRUZADO'

// Os vértices marcados: do polígono em desenho, só os já confirmados (sem o ponto que segue o
// cursor); senão, os do polígono pronto, sem repetir o primeiro no fim.
export function verticesDoDesenho(
  features: GeoJSONStoreFeatures[],
): Coordenadas[] {
  const poligonos = features.filter(
    (f) => f.properties.mode === 'polygon' && f.geometry.type === 'Polygon',
  )
  const emDesenho = poligonos.find((f) => f.properties.currentlyDrawing)
  const escolhido = emDesenho ?? poligonos.at(-1)
  if (!escolhido || escolhido.geometry.type !== 'Polygon') return []
  const anel = escolhido.geometry.coordinates[0] as Coordenadas[]
  const confirmados = escolhido.properties.committedCoordinateCount
  if (emDesenho && typeof confirmados === 'number') {
    return anel.slice(0, confirmados)
  }
  return anel.slice(0, -1)
}

// Por que o editor recusa esta mudança, ou null. Nenhum ponto sai da região, nem o que segue o
// cursor ou um vértice arrastado ('provisional'); o cruzamento só conta ao fechar ('finish'),
// porque no meio do desenho a linha de volta ao primeiro ponto ainda pode cruzar.
export function recusaDoDesenho(
  feature: GeoJSONStoreFeatures,
  mudanca: string,
): RecusaDoDesenho | null {
  if (feature.geometry.type !== 'Polygon') return null
  const anel = feature.geometry.coordinates[0] as Coordenadas[]
  if (!anel.every(naRegiao)) return 'FORA_DA_REGIAO'
  if (mudanca === 'finish' && !ValidateNotSelfIntersecting(feature).valid)
    return 'DESENHO_CRUZADO'
  return null
}

export class EditorDeArea {
  private readonly desenho: TerraDraw

  constructor(
    mapa: MapLibreMap,
    aoMudar: (estado: EstadoDoDesenho) => void,
    aoFechar: (vertices: Coordenadas[]) => void,
    aoRecusar: (motivo: RecusaDoDesenho) => void = () => {},
  ) {
    this.desenho = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map: mapa }),
      modes: [
        new TerraDrawPolygonMode({
          editable: true,
          validation: (feature, { updateType }) => {
            const mudanca = String(updateType)
            const motivo = recusaDoDesenho(feature, mudanca)
            // O aviso sai só no toque; passar o cursor fora da região não avisa.
            if (motivo && mudanca !== 'provisional') aoRecusar(motivo)
            return { valid: !motivo, reason: motivo ?? undefined }
          },
          styles: {
            fillColor: '#1A1A1A',
            fillOpacity: 0.06,
            outlineColor: '#1A1A1A',
            outlineWidth: 2,
            closingPointColor: '#FFFFFF',
            closingPointOutlineColor: '#1A1A1A',
            closingPointWidth: 7,
            closingPointOutlineWidth: 2,
          },
        }),
      ],
    })
    this.desenho.on('change', (ids, tipo) => {
      aoMudar(this.estado())
      // O primeiro ponto cria o desenho sem passar pela validação. Fora da região, ele ficava no
      // desenho, e todo ponto seguinte era recusado junto com ele (teste do usuário, 2026-11-01).
      // O descarte espera o toque terminar: no meio dele, o modo ainda guarda o desenho criado.
      if (tipo !== 'create') return
      queueMicrotask(() => {
        const criado = this.desenho
          .getSnapshot()
          .find(
            (f) =>
              ids.includes(f.id as string) &&
              f.properties.currentlyDrawing &&
              recusaDoDesenho(f, 'commit') === 'FORA_DA_REGIAO',
          )
        if (!criado?.id) return
        this.desenho.removeFeatures([criado.id])
        aoRecusar('FORA_DA_REGIAO')
      })
    })
    // Tocar no primeiro ponto fecha a área; arrastar um vértice (Ajustar) não fecha.
    this.desenho.on('finish', (_id, contexto) => {
      if (contexto.action !== 'draw') return
      const vertices = this.vertices()
      if (vertices.length >= 3) aoFechar(vertices)
    })
  }

  // Começa um desenho; com vértices, o da área a ajustar, já pronto para arrastar os pontos.
  iniciar(vertices?: Coordenadas[]) {
    this.desenho.start()
    this.desenho.setMode('polygon')
    if (vertices && vertices.length >= 3) this.carregar(vertices)
  }

  private carregar(vertices: Coordenadas[]) {
    this.desenho.addFeatures([
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[...vertices, vertices[0]]],
        },
        properties: { mode: 'polygon' },
      },
    ])
  }

  vertices(): Coordenadas[] {
    return verticesDoDesenho(this.desenho.getSnapshot())
  }

  estado(): EstadoDoDesenho {
    return { vertices: this.vertices() }
  }

  // "Desfazer área": apaga o desenho inteiro, inclusive a área carregada para ajustar, e recomeça.
  desfazerArea() {
    this.parar()
    this.iniciar()
  }

  parar() {
    if (!this.desenho.enabled) return
    this.desenho.clear()
    this.desenho.stop()
  }
}
