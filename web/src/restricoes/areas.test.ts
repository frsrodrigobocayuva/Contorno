import { describe, expect, it } from 'vitest'
import type { Coordenadas } from '../api/cliente'
import { formatarArea, formatarCusto } from '../formato'
import {
  areaDoDesenho,
  diferencaPercentual,
  novaArea,
  paraRestricoes,
  rotuloPadrao,
  type AreaDeclarada,
} from './areas'
import { verticesDoDesenho } from './editor'

const RESPOSTA = {
  celulas: ['8ba8b4b2c9a5fff'],
  contorno: { type: 'MultiPolygon' as const, coordinates: [] },
  areaDesenhadaM2: 910_000,
  areaProibidaM2: 1_092_000,
  conflitos: [],
}
const DESENHO: Coordenadas[] = [
  [-51.16, -29.8],
  [-51.15, -29.8],
  [-51.15, -29.79],
  [-51.16, -29.79],
]

function area(rotulo: string): AreaDeclarada {
  return novaArea(rotulo, rotulo, 'x', DESENHO, RESPOSTA)
}

describe('áreas da consulta', () => {
  it('sem nome, a área vira "Área N" com o menor N livre', () => {
    expect(rotuloPadrao([])).toBe('Área 1')
    expect(rotuloPadrao([area('Área 1'), area('Área 3')])).toBe('Área 2')
    expect(novaArea('a1', '  ', 'Área 4', DESENHO, RESPOSTA).rotulo).toBe(
      'Área 4',
    )
  })

  it('vai ao cálculo só com o id, o rótulo e as células', () => {
    expect(paraRestricoes([area('Centro')])).toEqual([
      {
        tipo: 'AREA',
        id: 'Centro',
        rotulo: 'Centro',
        celulas: RESPOSTA.celulas,
      },
    ])
  })

  it('a diferença entre o desenho e o proibido sai em porcentagem', () => {
    expect(diferencaPercentual(910_000, 1_092_000)).toBe(20)
    expect(diferencaPercentual(0, 10)).toBe(0)
  })

  it('mede o desenho em metros quadrados', () => {
    // 0,01° × 0,01° na latitude de São Leopoldo: cerca de 1,07 km².
    expect(areaDoDesenho(DESENHO)).toBeCloseTo(1_071_000, -4)
    expect(areaDoDesenho(DESENHO.slice(0, 2))).toBe(0)
  })
})

describe('formato do custo e da área', () => {
  it('o custo leva sinal em tempo e em distância', () => {
    expect(formatarCusto(360, 1_800)).toBe('+6 min · +1,8 km')
    expect(formatarCusto(-60, -300)).toBe('−1 min · −300 m')
  })

  it('a área sai em km² com duas casas', () => {
    expect(formatarArea(910_000)).toBe('0,91 km²')
  })
})

describe('vértices do desenho no Terra Draw', () => {
  const anel: Coordenadas[] = [...DESENHO, [-51.161, -29.789], DESENHO[0]]

  it('do polígono em desenho, só os pontos já confirmados', () => {
    const emDesenho = {
      type: 'Feature' as const,
      geometry: { type: 'Polygon' as const, coordinates: [anel] },
      properties: {
        mode: 'polygon',
        currentlyDrawing: true,
        committedCoordinateCount: 4,
      },
    }

    expect(verticesDoDesenho([emDesenho])).toEqual(DESENHO)
  })

  it('do polígono pronto, todos os pontos sem repetir o primeiro', () => {
    const pronto = {
      type: 'Feature' as const,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[...DESENHO, DESENHO[0]]],
      },
      properties: { mode: 'polygon' },
    }

    expect(verticesDoDesenho([pronto])).toEqual(DESENHO)
    expect(verticesDoDesenho([])).toEqual([])
  })
})
