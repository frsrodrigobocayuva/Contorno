import { describe, expect, it } from 'vitest'
import { naPaleta, tabela } from './tinta'

function cor(cores: Uint8ClampedArray, claridade: number) {
  return Array.from(cores.slice(claridade * 3, claridade * 3 + 3))
}

describe('tinta do mapa', () => {
  it('o branco vira o fundo areia e o cinza das linhas vira #BFAF8F', () => {
    const cores = tabela()

    expect(cor(cores, 255)).toEqual([0xed, 0xd8, 0xaf])
    expect(cor(cores, 232)).toEqual([0xed, 0xd8, 0xaf])
    expect(cor(cores, 190)).toEqual([0xbf, 0xaf, 0x8f])
    expect(cor(cores, 0)).toEqual([0x1f, 0x1a, 0x12])
  })

  it('entre duas paradas, a cor é interpolada', () => {
    const cores = tabela([
      [0, '#000000'],
      [255, '#FF0000'],
    ])

    expect(cor(cores, 51)).toEqual([51, 0, 0])
  })

  it('troca cada cor pela cor da paleta na mesma claridade', () => {
    expect(naPaleta('#FFFFFF')).toBe('#EDD8AF')
    expect(naPaleta('#BEBEBE')).toBe('#BFAF8F')
    expect(naPaleta('#000000')).toBe('#1F1A12')
  })

  it('a claridade pesa o verde mais que o vermelho e o azul', () => {
    expect(naPaleta('#00FF00')).not.toBe(naPaleta('#0000FF'))
    expect(parseInt(naPaleta('#00FF00').slice(1, 3), 16)).toBeGreaterThan(
      parseInt(naPaleta('#0000FF').slice(1, 3), 16),
    )
  })
})
