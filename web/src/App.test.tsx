import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

// O MapLibre precisa de WebGL, que o jsdom não tem: no lugar dele, botões que "tocam no mapa"
// e dão o duplo clique do mouse (este só quando o App passa quem cancela).
vi.mock('./mapa/Mapa', () => ({
  Mapa: ({
    aoTocar,
    aoCancelar,
  }: {
    aoTocar?: (coordenadas: [number, number]) => void
    aoCancelar?: () => void
  }) => (
    <>
      <button type="button" onClick={() => aoTocar?.([-51.15, -29.79])}>
        tocar no mapa
      </button>
      {aoCancelar && (
        <button type="button" onClick={aoCancelar}>
          duplo clique no mapa
        </button>
      )}
    </>
  ),
}))

type Tratador = (opcoes?: RequestInit) => Response

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

function api(rotas: [RegExp, Tratador][]) {
  const falso = vi.fn(async (url: string, opcoes?: RequestInit) => {
    const rota = rotas.find(([padrao]) => padrao.test(url))
    if (!rota) throw new Error(`sem resposta para ${url}`)
    return rota[1](opcoes)
  })
  vi.stubGlobal('fetch', falso)
  return falso
}

const ROTA = {
  tipo: 'ROTAS',
  irrestrita: {
    geometria: {
      type: 'LineString',
      coordinates: [
        [-51.15, -29.79],
        [-51.14, -29.69],
      ],
    },
    duracaoSegundos: 786,
    distanciaMetros: 12799,
  },
  restrita: null,
}

function comecar() {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Começar' }))
}

function marcarOrigemEDestino() {
  fireEvent.click(screen.getByRole('button', { name: 'tocar no mapa' }))
  fireEvent.click(screen.getByRole('button', { name: 'tocar no mapa' }))
}

function buscar(campo: 'Origem' | 'Destino', texto: string) {
  const formulario = screen.getByLabelText(campo).closest('form')!
  fireEvent.change(screen.getByLabelText(campo), { target: { value: texto } })
  fireEvent.click(within(formulario).getByRole('button', { name: 'Buscar' }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('App', () => {
  it('abre só com o mapa e o botão Começar', () => {
    render(<App />)

    expect(screen.getByRole('button', { name: 'Começar' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Origem')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Começar' }))

    expect(screen.getByLabelText('Origem')).toBeInTheDocument()
    expect(screen.getByLabelText('Destino')).toBeInTheDocument()
  })

  it('busca o endereço ao tocar em Buscar e escolhe um resultado', async () => {
    const fetch = api([
      [
        /^\/enderecos/,
        () =>
          json({
            lugares: [
              {
                nome: 'Universidade do Vale do Rio dos Sinos',
                coordenada: [-51.1549545, -29.7954567],
              },
            ],
            motivo: null,
          }),
      ],
    ])
    comecar()

    buscar('Origem', 'UNISINOS')
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Universidade do Vale do Rio dos Sinos',
      }),
    )

    expect(fetch).toHaveBeenCalledWith('/enderecos?q=UNISINOS', undefined)
    expect(screen.getByLabelText('Origem')).toHaveValue(
      'Universidade do Vale do Rio dos Sinos',
    )
  })

  it('avisa quando a busca não encontra nada', async () => {
    api([
      [/^\/enderecos/, () => json({ lugares: [], motivo: 'SEM_RESULTADO' })],
    ])
    comecar()

    buscar('Destino', 'rua dos ipês 1200')

    expect(await screen.findByText('Busca sem resultado')).toBeInTheDocument()
    expect(
      screen.getByText(/Nenhum endereço encontrado para "rua dos ipês 1200"/),
    ).toBeInTheDocument()
  })

  it('avisa quando a busca está fora do ar', async () => {
    api([
      [
        /^\/enderecos/,
        () => json({ lugares: [], motivo: 'SERVICO_INDISPONIVEL' }),
      ],
    ])
    comecar()

    buscar('Origem', 'UNISINOS')

    expect(
      await screen.findByText('Busca de endereço fora do ar'),
    ).toBeInTheDocument()
  })

  it('o toque no mapa marca o campo ativo, começando pela origem', () => {
    comecar()
    const calcular = screen.getByRole('button', { name: 'Calcular rota' })
    expect(calcular).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'tocar no mapa' }))
    expect(screen.getByLabelText('Origem')).toHaveValue('Ponto marcado no mapa')
    expect(screen.getByLabelText('Destino')).toHaveValue('')

    fireEvent.click(screen.getByRole('button', { name: 'tocar no mapa' }))
    expect(screen.getByLabelText('Destino')).toHaveValue(
      'Ponto marcado no mapa',
    )
    expect(calcular).toBeEnabled()
  })

  it('calcula e mostra a rota normal, com as restrições em breve', async () => {
    const fetch = api([[/^\/rotas\/calculo$/, () => json(ROTA)]])
    comecar()
    marcarOrigemEDestino()

    fireEvent.click(screen.getByRole('button', { name: 'Calcular rota' }))

    expect(await screen.findByText('13 min · 12,8 km')).toBeInTheDocument()
    expect(screen.getByText('nenhuma restrição')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Desenhar área/ })).toBeDisabled()
    expect(screen.getAllByText('em breve')).toHaveLength(3)
    const corpo = JSON.parse(fetch.mock.calls[0][1]!.body as string)
    expect(corpo).toEqual({
      origem: [-51.15, -29.79],
      destino: [-51.15, -29.79],
      restricoes: [],
    })
  })

  it('avisa quando um ponto está fora da região atendida', async () => {
    api([
      [
        /^\/rotas\/calculo$/,
        () =>
          json(
            {
              codigo: 'VALIDACAO',
              mensagem: 'Entrada inválida.',
              detalhes: [{ campo: 'destino', motivo: 'FORA_DA_REGIAO' }],
            },
            422,
          ),
      ],
    ])
    comecar()
    marcarOrigemEDestino()

    fireEvent.click(screen.getByRole('button', { name: 'Calcular rota' }))

    expect(
      await screen.findByText('Fora da região atendida'),
    ).toBeInTheDocument()
  })

  it('com o motor fora do ar, oferece tentar de novo', async () => {
    let chamadas = 0
    api([
      [
        /^\/rotas\/calculo$/,
        () =>
          ++chamadas === 1
            ? json(
                { codigo: 'MOTOR_INDISPONIVEL', mensagem: 'x', detalhes: null },
                503,
              )
            : json(ROTA),
      ],
    ])
    comecar()
    marcarOrigemEDestino()

    fireEvent.click(screen.getByRole('button', { name: 'Calcular rota' }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Tentar de novo' }),
    )

    expect(await screen.findByText('13 min · 12,8 km')).toBeInTheDocument()
  })

  it('sem caminho até o destino, mostra a mensagem do diagnóstico', async () => {
    api([
      [
        /^\/rotas\/calculo$/,
        () =>
          json({
            tipo: 'DIAGNOSTICO',
            causa: 'DESTINO_INALCANCAVEL',
            candidatas: [],
            mensagem:
              'Nem sem nenhuma restrição a malha viária chega ao destino.',
          }),
      ],
    ])
    comecar()
    marcarOrigemEDestino()

    fireEvent.click(screen.getByRole('button', { name: 'Calcular rota' }))

    expect(
      await screen.findByText('Não existe caminho até este destino'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Nem sem nenhuma restrição a malha viária chega ao destino.',
      ),
    ).toBeInTheDocument()
  })
  describe('cancelar a rota', () => {
    function deveEstarVazio() {
      expect(screen.getByLabelText('Origem')).toHaveValue('')
      expect(screen.getByLabelText('Destino')).toHaveValue('')
      expect(
        screen.getByRole('button', { name: 'Calcular rota' }),
      ).toBeDisabled()
      expect(
        screen.queryByRole('button', { name: 'Cancelar rota' }),
      ).not.toBeInTheDocument()
    }

    it('o botão aparece com um ponto marcado e apaga tudo', () => {
      comecar()
      expect(
        screen.queryByRole('button', { name: 'Cancelar rota' }),
      ).not.toBeInTheDocument()
      marcarOrigemEDestino()

      fireEvent.click(screen.getByRole('button', { name: 'Cancelar rota' }))

      deveEstarVazio()
      fireEvent.click(screen.getByRole('button', { name: 'tocar no mapa' }))
      expect(screen.getByLabelText('Origem')).toHaveValue(
        'Ponto marcado no mapa',
      )
    })

    it('na rota, o botão do topo volta para origem e destino vazios', async () => {
      api([[/^\/rotas\/calculo$/, () => json(ROTA)]])
      comecar()
      marcarOrigemEDestino()
      fireEvent.click(screen.getByRole('button', { name: 'Calcular rota' }))
      await screen.findByText('13 min · 12,8 km')

      fireEvent.click(screen.getByRole('button', { name: 'Cancelar rota' }))

      expect(screen.queryByText('13 min · 12,8 km')).not.toBeInTheDocument()
      deveEstarVazio()
    })

    it('o Esc cancela, também na rota', async () => {
      api([[/^\/rotas\/calculo$/, () => json(ROTA)]])
      comecar()
      marcarOrigemEDestino()
      fireEvent.click(screen.getByRole('button', { name: 'Calcular rota' }))
      await screen.findByText('13 min · 12,8 km')

      fireEvent.keyDown(window, { key: 'Escape' })

      deveEstarVazio()
    })

    it('o duplo clique no mapa cancela, mas não existe na abertura', () => {
      render(<App />)
      expect(
        screen.queryByRole('button', { name: 'duplo clique no mapa' }),
      ).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Começar' }))
      marcarOrigemEDestino()

      fireEvent.click(
        screen.getByRole('button', { name: 'duplo clique no mapa' }),
      )

      deveEstarVazio()
    })

    it('a rota que chega depois de cancelar é descartada', async () => {
      let responder: (resposta: Response) => void = () => {}
      vi.stubGlobal(
        'fetch',
        vi.fn(
          () =>
            new Promise<Response>((resolver) => {
              responder = resolver
            }),
        ),
      )
      comecar()
      marcarOrigemEDestino()
      fireEvent.click(screen.getByRole('button', { name: 'Calcular rota' }))

      fireEvent.click(screen.getByRole('button', { name: 'Cancelar rota' }))
      await act(async () => {
        responder(json(ROTA))
      })

      expect(screen.queryByText('13 min · 12,8 km')).not.toBeInTheDocument()
      deveEstarVazio()
    })
  })
})
