import { describe, expect, it } from 'vitest'
import { formatarDistancia, formatarDuracao } from './formato'

describe('formatarDuracao', () => {
  it.each([
    [786, '13 min'],
    [3600, '1 h'],
    [3900, '1 h 05 min'],
  ])('%i s vira "%s"', (segundos, texto) => {
    expect(formatarDuracao(segundos)).toBe(texto)
  })
})

describe('formatarDistancia', () => {
  it.each([
    [850, '850 m'],
    [1000, '1,0 km'],
    [12799, '12,8 km'],
  ])('%i m vira "%s"', (metros, texto) => {
    expect(formatarDistancia(metros)).toBe(texto)
  })
})
