// Editor de Restrições (DAS 7.2): o desenho da área com o Terra Draw sobre o MapLibre, em modo
// polígono, com desfazer ponto (Realização, UC02). O resto do app só vê os vértices.
import type { Map as MapLibreMap } from 'maplibre-gl'
import {
  TerraDraw,
  TerraDrawModeUndoRedo,
  TerraDrawPolygonMode,
  type GeoJSONStoreFeatures,
} from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'
import type { Coordenadas } from '../api/cliente'

export interface EstadoDoDesenho {
  vertices: Coordenadas[]
  podeDesfazer: boolean
}

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

export class EditorDeArea {
  private readonly desenho: TerraDraw

  constructor(
    mapa: MapLibreMap,
    aoMudar: (estado: EstadoDoDesenho) => void,
    aoFechar: (vertices: Coordenadas[]) => void,
  ) {
    this.desenho = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map: mapa }),
      modes: [
        new TerraDrawPolygonMode({
          editable: true,
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
      undoRedo: { modeLevel: new TerraDrawModeUndoRedo() },
    })
    this.desenho.on('change', () => aoMudar(this.estado()))
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
    if (vertices && vertices.length >= 3) {
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
  }

  vertices(): Coordenadas[] {
    return verticesDoDesenho(this.desenho.getSnapshot())
  }

  estado(): EstadoDoDesenho {
    return { vertices: this.vertices(), podeDesfazer: this.desenho.canUndo() }
  }

  desfazer() {
    this.desenho.undo()
  }

  parar() {
    if (!this.desenho.enabled) return
    this.desenho.clear()
    this.desenho.stop()
  }
}
