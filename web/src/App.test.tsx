import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

// O MapLibre precisa de WebGL, que o jsdom não tem: no lugar dele, botões que "tocam no mapa",
// dão o duplo clique do mouse (só quando o App passa quem cancela) e desenham uma área.
const { VERTICES } = vi.hoisted(() => ({
  VERTICES: [
    [-51.15, -29.76],
    [-51.14, -29.76],
    [-51.14, -29.75],
  ] as [number, number][],
}))
vi.mock('./mapa/Mapa', async () => {
  const { useImperativeHandle } = await import('react')
  return {
    Mapa: ({
      aoTocar,
      aoCancelar,
      desenho,
      aoMudarDesenho,
      aoFecharDesenho,
      ref,
    }: {
      aoTocar?: (coordenadas: [number, number]) => void
      aoCancelar?: () => void
      desenho?: object | null
      aoMudarDesenho?: (estado: {
        vertices: [number, number][]
        podeDesfazer: boolean
      }) => void
      aoFecharDesenho?: (vertices: [number, number][]) => void
      ref?: import('react').Ref<{
        desfazer: () => void
        vertices: () => [number, number][]
      }>
    }) => {
      useImperativeHandle(
        ref,
        () => ({ desfazer: () => {}, vertices: () => VERTICES }),
        [],
      )
      return (
        <>
          <button type="button" onClick={() => aoTocar?.([-51.15, -29.79])}>
            tocar no mapa
          </button>
          {aoCancelar && (
            <button type="button" onClick={aoCancelar}>
              duplo clique no mapa
            </button>
          )}
          {desenho && (
            <>
              <button
                type="button"
                onClick={() =>
                  aoMudarDesenho?.({ vertices: VERTICES, podeDesfazer: true })
                }
              >
                marcar cantos
              </button>
              <button type="button" onClick={() => aoFecharDesenho?.(VERTICES)}>
                fechar desenho
              </button>
            </>
          )}
        </>
      )
    },
  }
})

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

  it('calcula e mostra a rota normal, com só o raio em breve', async () => {
    const fetch = api([[/^\/rotas\/calculo$/, () => json(ROTA)]])
    comecar()
    marcarOrigemEDestino()

    fireEvent.click(screen.getByRole('button', { name: 'Calcular rota' }))

    expect(await screen.findByText('13 min · 12,8 km')).toBeInTheDocument()
    expect(screen.getByText('nenhuma restrição')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Desenhar área/ })).toBeEnabled()
    expect(
      screen.getByRole('button', { name: /Classes de via a evitar/ }),
    ).toBeEnabled()
    expect(screen.getAllByText('em breve')).toHaveLength(1)
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

    it('na rota, o botão fica abaixo das restrições e volta para origem e destino vazios', async () => {
      api([[/^\/rotas\/calculo$/, () => json(ROTA)]])
      comecar()
      marcarOrigemEDestino()
      fireEvent.click(screen.getByRole('button', { name: 'Calcular rota' }))
      await screen.findByText('13 min · 12,8 km')
      const cancelar = screen.getByRole('button', { name: 'Cancelar rota' })
      expect(
        within(screen.getByRole('banner')).queryByRole('button', {
          name: 'Cancelar rota',
        }),
      ).not.toBeInTheDocument()
      expect(
        screen
          .getByRole('button', { name: /Classes de via/ })
          .compareDocumentPosition(cancelar) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()

      fireEvent.click(cancelar)

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

  describe('áreas proibidas', () => {
    const CONTORNO = {
      type: 'MultiPolygon',
      coordinates: [[[...VERTICES, VERTICES[0]]]],
    }
    const AREA = {
      celulas: ['8ba8b4b2c9a5fff'],
      contorno: CONTORNO,
      areaDesenhadaM2: 910_000,
      areaProibidaM2: 1_092_000,
      conflitos: [] as string[],
    }
    const RESTRITA = {
      ...ROTA,
      restrita: {
        ...ROTA.irrestrita,
        duracaoSegundos: 786 + 360,
        distanciaMetros: 12_799 + 1_800,
      },
    }

    type Corpo = { restricoes?: { id: string; rotulo: string }[] }
    const corpo = (opcoes?: RequestInit) =>
      JSON.parse(opcoes!.body as string) as Corpo

    async function ateODesenho(rotas: [RegExp, Tratador][]) {
      const fetch = api(rotas)
      comecar()
      marcarOrigemEDestino()
      fireEvent.click(screen.getByRole('button', { name: 'Calcular rota' }))
      fireEvent.click(
        await screen.findByRole('button', { name: /Desenhar área/ }),
      )
      fireEvent.click(screen.getByRole('button', { name: 'marcar cantos' }))
      return fetch
    }

    it('desenha, confere o contorno e recebe a rota restrita com o custo', async () => {
      const fetch = await ateODesenho([
        [/^\/restricoes\/area$/, () => json(AREA)],
        [
          /^\/rotas\/calculo$/,
          (opcoes) => json(corpo(opcoes).restricoes?.length ? RESTRITA : ROTA),
        ],
      ])
      expect(screen.getByText('Desenhar área proibida')).toBeInTheDocument()
      expect(screen.getByText('3 pontos marcados')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Concluir área' }))

      expect(
        await screen.findByText('Confira a área proibida'),
      ).toBeInTheDocument()
      expect(screen.getByText(/20% maior/)).toBeInTheDocument()
      const pedidoDaArea = JSON.parse(
        fetch.mock.calls.find(([url]) => url === '/restricoes/area')![1]!
          .body as string,
      )
      expect(pedidoDaArea).toEqual({
        poligono: VERTICES,
        origem: [-51.15, -29.79],
        destino: [-51.15, -29.79],
      })
      const nome = screen.getByLabelText('Nome da área (opcional)')
      expect(nome).toHaveAttribute('placeholder', 'Área 1')
      fireEvent.change(nome, { target: { value: 'Centro' } })

      fireEvent.click(
        screen.getByRole('button', { name: 'Confirmar e recalcular' }),
      )

      expect(await screen.findByText('Custo da restrição')).toBeInTheDocument()
      expect(screen.getByText('+6 min · +1,8 km')).toBeInTheDocument()
      expect(screen.getByText('1 restrição aplicada')).toBeInTheDocument()
      expect(corpo(fetch.mock.calls.at(-1)![1]).restricoes).toEqual([
        expect.objectContaining({
          tipo: 'AREA',
          rotulo: 'Centro',
          celulas: AREA.celulas,
        }),
      ])
    })

    it('área que cobre o destino avisa e volta ao desenho para ajustar', async () => {
      await ateODesenho([
        [
          /^\/restricoes\/area$/,
          () => json({ ...AREA, conflitos: ['DESTINO'] }),
        ],
        [/^\/rotas\/calculo$/, () => json(ROTA)],
      ])

      fireEvent.click(screen.getByRole('button', { name: 'fechar desenho' }))

      expect(
        await screen.findByText('A área cobre o destino'),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Confirmar e recalcular' }),
      ).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Ajustar a área' }))
      expect(screen.getByText('Desenhar área proibida')).toBeInTheDocument()
    })

    it('quando as áreas bloqueiam, avisa e leva às restrições para remover', async () => {
      const fetch = await ateODesenho([
        [/^\/restricoes\/area$/, () => json(AREA)],
        [
          /^\/rotas\/calculo$/,
          (opcoes) =>
            corpo(opcoes).restricoes?.length
              ? json({
                  tipo: 'DIAGNOSTICO',
                  causa: 'AREAS_BLOQUEIAM',
                  candidatas: [],
                  mensagem: 'Não existe caminho que respeite as áreas.',
                })
              : json(ROTA),
        ],
      ])
      fireEvent.click(screen.getByRole('button', { name: 'Concluir área' }))
      fireEvent.click(
        await screen.findByRole('button', { name: 'Confirmar e recalcular' }),
      )

      expect(
        await screen.findByText('Nenhum caminho respeita as áreas'),
      ).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Ver restrições' }))
      expect(screen.getByText('Áreas proibidas (1)')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Remover Área 1' }))
      fireEvent.click(screen.getByRole('button', { name: 'Recalcular rota' }))

      expect(await screen.findByText('nenhuma restrição')).toBeInTheDocument()
      expect(corpo(fetch.mock.calls.at(-1)![1]).restricoes).toEqual([])
    })

    it('com a origem dentro de uma área, o cálculo avisa qual área', async () => {
      await ateODesenho([
        [/^\/restricoes\/area$/, () => json(AREA)],
        [
          /^\/rotas\/calculo$/,
          (opcoes) => {
            const [area] = corpo(opcoes).restricoes ?? []
            return area
              ? json(
                  {
                    codigo: 'AREA_CONTEM_EXTREMO',
                    mensagem: 'x',
                    detalhes: [{ area: area.id, extremo: 'ORIGEM' }],
                  },
                  422,
                )
              : json(ROTA)
          },
        ],
      ])
      fireEvent.click(screen.getByRole('button', { name: 'Concluir área' }))
      fireEvent.click(
        await screen.findByRole('button', { name: 'Confirmar e recalcular' }),
      )

      expect(
        await screen.findByText('A origem está dentro de Área 1'),
      ).toBeInTheDocument()
    })

    it('desenho que se cruza é recusado com aviso, sem sair do desenho', async () => {
      await ateODesenho([
        [
          /^\/restricoes\/area$/,
          () =>
            json(
              {
                codigo: 'VALIDACAO',
                mensagem: 'x',
                detalhes: [{ campo: 'poligono', motivo: 'POLIGONO_INVALIDO' }],
              },
              422,
            ),
        ],
        [/^\/rotas\/calculo$/, () => json(ROTA)],
      ])

      fireEvent.click(screen.getByRole('button', { name: 'Concluir área' }))

      expect(await screen.findByText(/O desenho se cruza/)).toBeInTheDocument()
      expect(screen.getByText('Desenhar área proibida')).toBeInTheDocument()
    })

    it('o Esc no desenho desiste só da área, sem cancelar a rota', async () => {
      await ateODesenho([[/^\/rotas\/calculo$/, () => json(ROTA)]])

      fireEvent.keyDown(window, { key: 'Escape' })

      expect(screen.getByText('nenhuma restrição')).toBeInTheDocument()
      expect(
        screen.queryByText('Desenhar área proibida'),
      ).not.toBeInTheDocument()
    })
  })

  describe('voltar para a abertura (teste do S5-01)', () => {
    it('com tudo vazio, o Esc volta para a abertura', () => {
      comecar()

      fireEvent.keyDown(window, { key: 'Escape' })

      expect(
        screen.getByRole('button', { name: 'Começar' }),
      ).toBeInTheDocument()
      expect(screen.queryByLabelText('Origem')).not.toBeInTheDocument()
    })

    it('o primeiro Esc cancela a rota; o segundo volta para a abertura', () => {
      comecar()
      marcarOrigemEDestino()

      fireEvent.keyDown(window, { key: 'Escape' })
      expect(screen.getByLabelText('Origem')).toHaveValue('')

      fireEvent.keyDown(window, { key: 'Escape' })
      expect(
        screen.getByRole('button', { name: 'Começar' }),
      ).toBeInTheDocument()
    })

    it('tocar no mapa na abertura começa, sem marcar ponto', () => {
      render(<App />)

      fireEvent.click(screen.getByRole('button', { name: 'tocar no mapa' }))

      expect(screen.getByLabelText('Origem')).toHaveValue('')
      expect(screen.getByLabelText('Destino')).toHaveValue('')
      expect(
        screen.queryByRole('button', { name: 'Começar' }),
      ).not.toBeInTheDocument()
    })
  })

  describe('classes de via (S5-02)', () => {
    const RESTRITA = {
      ...ROTA,
      restrita: {
        ...ROTA.irrestrita,
        duracaoSegundos: 786 + 120,
        distanciaMetros: 12_799 + 900,
      },
    }
    type Corpo = { restricoes?: object[] }
    const corpo = (opcoes?: RequestInit) =>
      JSON.parse(opcoes!.body as string) as Corpo

    async function ateAsClasses() {
      const fetch = api([
        [
          /^\/rotas\/calculo$/,
          (opcoes) => json(corpo(opcoes).restricoes?.length ? RESTRITA : ROTA),
        ],
      ])
      comecar()
      marcarOrigemEDestino()
      fireEvent.click(screen.getByRole('button', { name: 'Calcular rota' }))
      fireEvent.click(
        await screen.findByRole('button', { name: /Classes de via a evitar/ }),
      )
      return fetch
    }

    function escolher(classe: RegExp, nivel: string) {
      fireEvent.click(
        within(screen.getByRole('group', { name: classe })).getByRole('radio', {
          name: nivel,
        }),
      )
    }

    it('aplica as classes, recalcula e conta como restrição', async () => {
      const fetch = await ateAsClasses()
      expect(screen.getByText(/mas não garante/)).toBeInTheDocument()

      escolher(/^Rodovia/, 'Evitar fortemente')
      fireEvent.click(
        screen.getByRole('button', { name: 'Aplicar e recalcular' }),
      )

      expect(await screen.findByText('Custo da restrição')).toBeInTheDocument()
      expect(screen.getByText('1 restrição aplicada')).toBeInTheDocument()
      expect(corpo(fetch.mock.calls.at(-1)![1]).restricoes).toEqual([
        { tipo: 'VIA', classe: 'RODOVIA', nivel: 'EVITAR_FORTEMENTE' },
      ])

      fireEvent.click(screen.getByRole('button', { name: /Ver restrições/ }))
      const lista = screen.getByRole('region', { name: 'Classes de via' })
      expect(within(lista).getByText('Rodovia')).toBeInTheDocument()
      expect(within(lista).getByText('evitar fortemente')).toBeInTheDocument()
    })

    it('cancelar na tela das classes descarta o que foi escolhido', async () => {
      const fetch = await ateAsClasses()
      escolher(/^Rua residencial/, 'Evitar')

      fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

      expect(screen.getByText('nenhuma restrição')).toBeInTheDocument()
      expect(fetch).toHaveBeenCalledTimes(1)
      fireEvent.click(
        screen.getByRole('button', { name: /Classes de via a evitar/ }),
      )
      expect(
        within(
          screen.getByRole('group', { name: /^Rua residencial/ }),
        ).getByRole('radio', { name: 'Indiferente' }),
      ).toBeChecked()
    })
  })
})
