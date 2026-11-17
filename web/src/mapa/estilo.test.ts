import type { LayerSpecification } from 'maplibre-gl'
import { describe, expect, it } from 'vitest'
import { ATRIBUICAO, estilo, OSM, VIAS } from './estilo'
import { naPaleta } from './tinta'

function camada(id: string): LayerSpecification {
  const achada = estilo().layers.find((c) => c.id === id)
  if (!achada) throw new Error(`sem a camada ${id}`)
  return achada
}

describe('estilo do mapa base vetorial', () => {
  it('o fundo é a areia da paleta e as cores vêm do OSM pela paleta', () => {
    expect(camada('fundo')).toMatchObject({
      paint: { 'background-color': '#EDD8AF' },
    })
    expect(camada('agua')).toMatchObject({
      paint: { 'fill-color': naPaleta(OSM.agua) },
    })
    expect(camada('nome-do-lugar')).toMatchObject({
      paint: { 'text-color': '#1F1A12', 'text-halo-color': '#EDD8AF' },
    })
  })

  it('todas as cores do estilo são cores do OSM passadas pela paleta', () => {
    const doOsm = [
      ...Object.values(OSM),
      ...Object.values(VIAS).flatMap(({ miolo, borda }) => [miolo, borda]),
    ]
    const paleta = new Set(doOsm.map((cor) => naPaleta(cor)))
    const cores = JSON.stringify(estilo().layers).match(/#[0-9A-F]{6}/gi) ?? []

    expect(cores.length).toBeGreaterThan(10)
    for (const cor of cores) expect(paleta).toContain(cor)
  })

  it('usa os tiles do OpenFreeMap com a atribuição do OSM', () => {
    expect(estilo().sources.openmaptiles).toEqual({
      type: 'vector',
      url: 'https://tiles.openfreemap.org/planet',
      attribution: ATRIBUICAO,
    })
    expect(ATRIBUICAO).toContain('© OpenStreetMap contributors')
    expect(ATRIBUICAO).toContain('OpenFreeMap')
  })

  it('escreve os nomes em Atkinson Hyperlegible, com os arquivos do projeto', () => {
    const { 'font-faces': fontes, layers } = estilo()
    const nomes = layers.filter((c) => c.type === 'symbol')

    expect(Object.keys(fontes ?? {})).toEqual([
      'Atkinson Hyperlegible Regular',
      'Atkinson Hyperlegible Bold',
    ])
    expect(JSON.stringify(fontes)).toMatch(
      /atkinson-hyperlegible-latin-400-normal/,
    )
    expect(nomes.length).toBeGreaterThan(0)
    for (const nome of nomes) {
      expect(JSON.stringify(nome.layout)).toContain('Atkinson Hyperlegible')
    }
  })
})
