import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Coordenadas } from './api/cliente'
import { animar, movimentoReduzido, trechoAte, useContagem } from './movimento'

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

  it('com movimento reduzido, a contagem já começa no valor', () => {
    const { result } = renderHook(() => useContagem(360))

    expect(result.current).toBe(360)
  })
})
