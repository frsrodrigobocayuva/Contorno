import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Coordenadas } from './api/cliente'
import {
  animar,
  degradeDaVarredura,
  movimentoReduzido,
  posicaoDaVarredura,
  trechoAte,
  useContagem,
} from './movimento'

// Uma linha reta de dois trechos iguais, na mesma latitude.
const RETA: Coordenadas[] = [
  [-51.2, -29.7],
  [-51.1, -29.7],
  [-51.0, -29.7],
]

describe('movimento', () => {
  it('sem matchMedia (jsdom), conta como movimento reduzido', () => {
    expect(movimentoReduzido()).toBe(true)
  })

  it('com movimento reduzido, a animação vai direto ao fim', () => {
    const aoQuadro = vi.fn()
    const aoTerminar = vi.fn()

    const concluir = animar(500, aoQuadro, aoTerminar)
    concluir()

    expect(aoQuadro.mock.calls).toEqual([[1]])
    expect(aoTerminar).toHaveBeenCalledOnce()
  })

  it('o trecho da rota vai até a fração pedida do comprimento', () => {
    expect(trechoAte(RETA, 1)).toBe(RETA)
    expect(trechoAte(RETA, 0.5)).toEqual([RETA[0], RETA[1]])
    const quarto = trechoAte(RETA, 0.25)
    expect(quarto).toHaveLength(2)
    expect(quarto[1][0]).toBeCloseTo(-51.15)
    expect(quarto[1][1]).toBeCloseTo(-29.7)
    expect(trechoAte(RETA, 0)).toEqual([RETA[0], RETA[0]])
  })

  it('a varredura é clara só na faixa da posição, com paradas em ordem', () => {
    const meio = degradeDaVarredura(0.5)
    expect(meio.filter((_, i) => i % 2 === 0)).toEqual([
      0, 0.375, 0.4375, 0.5, 0.5625, 0.625, 1,
    ])
    expect(meio[7]).toContain('0.85')

    // No começo e fora da linha, as paradas continuam crescentes e sem repetir.
    for (const posicao of [-0.125, 0.02, 0.99, 1.125, 2]) {
      const lugares = degradeDaVarredura(posicao).filter((_, i) => i % 2 === 0)
      expect(lugares[0]).toBe(0)
      expect(lugares.at(-1)).toBe(1)
      for (let i = 1; i < lugares.length; i++)
        expect(lugares[i]).toBeGreaterThan(lugares[i - 1] as number)
    }
    expect(degradeDaVarredura(2)).not.toContain('rgba(255, 248, 230, 0.85)')
  })

  it('a faixa corre sem pausa: sai por B e já volta a entrar por A, na mesma velocidade', () => {
    expect(posicaoDaVarredura(0)).toBeCloseTo(-0.125)
    // O meio da faixa leva 0,9 s de A (0) a B (1).
    expect(posicaoDaVarredura(112.5)).toBeCloseTo(0)
    expect(posicaoDaVarredura(1012.5)).toBeCloseTo(1)
    // Um ciclo é 0,9 s × 1,25 = 1,125 s: no fim dele, recomeça na entrada.
    expect(posicaoDaVarredura(1124)).toBeGreaterThan(1.1)
    expect(posicaoDaVarredura(1125)).toBeCloseTo(-0.125)
  })

  it('com movimento reduzido, a contagem já começa no valor', () => {
    const { result } = renderHook(() => useContagem(360))

    expect(result.current).toBe(360)
  })
})
