import { afterEach, describe, expect, it, vi } from 'vitest'
import { buscarEnderecos, calcularRota, ErroDaApi } from './cliente'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Cliente da API', () => {
  it('pede a rota com origem, destino e nenhuma restrição', async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ tipo: 'ROTAS' })),
    )
    vi.stubGlobal('fetch', fetch)

    await calcularRota([-51.15, -29.79], [-51.14, -29.69])

    expect(fetch).toHaveBeenCalledWith('/rotas/calculo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origem: [-51.15, -29.79],
        destino: [-51.14, -29.69],
        restricoes: [],
      }),
    })
  })

  it('codifica o texto da busca', async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ lugares: [], motivo: null })),
    )
    vi.stubGlobal('fetch', fetch)

    await buscarEnderecos('Rua Independência, São Leopoldo')

    expect(fetch).toHaveBeenCalledWith(
      '/enderecos?q=Rua%20Independ%C3%AAncia%2C%20S%C3%A3o%20Leopoldo',
      undefined,
    )
  })

  it('traduz o erro da API no formato único', async () => {
    const corpo = {
      codigo: 'VALIDACAO',
      mensagem: 'Entrada inválida.',
      detalhes: [{ campo: 'origem', motivo: 'FORA_DA_REGIAO' }],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(corpo), { status: 422 })),
    )

    const erro = await calcularRota([0, 0], [0, 0]).catch((e: unknown) => e)

    expect(erro).toBeInstanceOf(ErroDaApi)
    expect((erro as ErroDaApi).status).toBe(422)
    expect((erro as ErroDaApi).temMotivo('FORA_DA_REGIAO')).toBe(true)
  })

  it('sem resposta nenhuma, o erro é de rede', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )

    const erro = await buscarEnderecos('UNISINOS').catch((e: unknown) => e)

    expect((erro as ErroDaApi).codigo).toBe('REDE')
  })
})
