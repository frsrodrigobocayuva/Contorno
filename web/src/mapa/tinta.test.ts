import { describe, expect, it } from 'vitest'
import { tabela, tingir } from './tinta'

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

  it('troca cada pixel pela cor da sua claridade e mantém a transparência', () => {
    const pixels = new Uint8ClampedArray([
      255, 255, 255, 255, 190, 190, 190, 128, 0, 0, 0, 0,
    ])

    tingir(pixels, tabela())

    expect(Array.from(pixels)).toEqual([
      0xed, 0xd8, 0xaf, 255, 0xbf, 0xaf, 0x8f, 128, 0x1f, 0x1a, 0x12, 0,
    ])
  })

  it('a claridade pesa o verde mais que o vermelho e o azul', () => {
    const verde = new Uint8ClampedArray([0, 255, 0, 255])
    const azul = new Uint8ClampedArray([0, 0, 255, 255])

    tingir(verde, tabela())
    tingir(azul, tabela())

    expect(verde[0]).toBeGreaterThan(azul[0])
  })
})
