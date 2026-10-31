// O estado de uma consulta fica num ponto só, aqui, e desce para os componentes (DAS 7.2).
// Telas do protótipo aprovado: 01/14 abertura, 02 origem e destino, 03 rota normal, 04 desenhar
// área, 05 contorno das células, 06 rota restrita e custo, 07 restrições, 10 conflito, 13 avisos.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  calcularRota,
  definirArea,
  ErroDaApi,
  type Coordenadas,
  type RespostaArea,
  type Rota,
} from './api/cliente'
import { Aviso } from './Aviso'
import { PainelDaRota } from './comparacao/PainelDaRota'
import { CampoDeEndereco } from './mapa/CampoDeEndereco'
import { Mapa, type AreaNoMapa, type ControleDoMapa } from './mapa/Mapa'
import { PONTO_NO_MAPA, type Campo, type Ponto } from './pontos'
import {
  novaArea,
  paraRestricoes,
  rotuloPadrao,
  type AreaDeclarada,
} from './restricoes/areas'
import type { EstadoDoDesenho } from './restricoes/editor'
import { ListaDeRestricoes } from './restricoes/ListaDeRestricoes'
import {
  PainelDaConferencia,
  PainelDoDesenho,
} from './restricoes/PaineisDaArea'

type Etapa =
  'abertura' | 'pontos' | 'rota' | 'desenhar' | 'conferir' | 'restricoes'

interface AvisoDaRota {
  titulo: string
  texto: string
  tentarDeNovo?: boolean
  verRestricoes?: boolean
}

interface Conferencia {
  desenho: Coordenadas[]
  resposta: RespostaArea
  editando?: string
}

const FORA_DA_REGIAO: AvisoDaRota = {
  titulo: 'Fora da região atendida',
  texto:
    'O Contorno calcula rotas só em São Leopoldo e Novo Hamburgo. Escolha uma origem e um destino dentro dessa região.',
}

const MOTOR_FORA_DO_AR: AvisoDaRota = {
  titulo: 'Cálculo de rota fora do ar',
  texto:
    'Não foi possível calcular a rota agora. O que você marcou continua aqui, do jeito que você deixou.',
  tentarDeNovo: true,
}

const SEM_DESENHO: EstadoDoDesenho = { vertices: [], podeDesfazer: false }

function avisoDoErro(erro: unknown, areas: AreaDeclarada[]): AvisoDaRota {
  if (erro instanceof ErroDaApi && erro.codigo === 'AREA_CONTEM_EXTREMO') {
    const [conflito] = erro.detalhes
    const area = areas.find((a) => a.id === conflito?.area)
    const ponto = conflito?.extremo === 'ORIGEM' ? 'A origem' : 'O destino'
    return {
      titulo: `${ponto} está dentro de ${area?.rotulo ?? 'uma área'}`,
      texto:
        'A rota não pode sair nem chegar dentro de uma área proibida. Redesenhe ou remova a área, ou mude o ponto.',
      verRestricoes: true,
    }
  }
  if (erro instanceof ErroDaApi && erro.temMotivo('FORA_DA_REGIAO'))
    return FORA_DA_REGIAO
  if (
    erro instanceof ErroDaApi &&
    ['MOTOR_INDISPONIVEL', 'REDE'].includes(erro.codigo)
  ) {
    return MOTOR_FORA_DO_AR
  }
  return {
    titulo: 'Não foi possível calcular a rota',
    texto: 'Algo deu errado do nosso lado. Tente de novo.',
    tentarDeNovo: true,
  }
}

function erroDoDesenho(erro: unknown): string {
  if (erro instanceof ErroDaApi && erro.temMotivo('POLIGONO_INVALIDO'))
    return 'O desenho se cruza ou tem pontos repetidos. Desfaça alguns pontos e marque de novo.'
  if (erro instanceof ErroDaApi && erro.temMotivo('FORA_DA_REGIAO'))
    return 'A área passa de São Leopoldo e Novo Hamburgo. Marque os cantos dentro da região atendida.'
  return 'Não foi possível conferir a área agora. Tente de novo.'
}

function App() {
  const [etapa, setEtapa] = useState<Etapa>('abertura')
  const [campoAtivo, setCampoAtivo] = useState<Campo>('origem')
  const [origem, setOrigem] = useState<Ponto | null>(null)
  const [destino, setDestino] = useState<Ponto | null>(null)
  const [rota, setRota] = useState<Rota | null>(null)
  const [restrita, setRestrita] = useState<Rota | null>(null)
  const [areas, setAreas] = useState<AreaDeclarada[]>([])
  const [desenho, setDesenho] = useState<{
    inicial?: Coordenadas[]
    editando?: string
  } | null>(null)
  const [estadoDoDesenho, setEstadoDoDesenho] =
    useState<EstadoDoDesenho>(SEM_DESENHO)
  const [erroDoDesenhoAtual, setErroDoDesenhoAtual] = useState<string | null>(
    null,
  )
  const [conferindo, setConferindo] = useState(false)
  const [conferencia, setConferencia] = useState<Conferencia | null>(null)
  const [nome, setNome] = useState('')
  const [aviso, setAviso] = useState<AvisoDaRota | null>(null)
  const [calculando, setCalculando] = useState(false)
  const mapa = useRef<ControleDoMapa>(null)
  // Cada cancelamento muda a consulta; a resposta de um cálculo de antes dele é descartada.
  const consulta = useRef(0)

  // Cancelar apaga tudo, inclusive as áreas, e volta para origem e destino vazios
  // (plano, 2026-10-29).
  const cancelar = useCallback(() => {
    consulta.current += 1
    setOrigem(null)
    setDestino(null)
    setRota(null)
    setRestrita(null)
    setAreas([])
    setDesenho(null)
    setConferencia(null)
    setAviso(null)
    setCalculando(false)
    setCampoAtivo('origem')
    setEtapa('pontos')
  }, [])

  // Sair do desenho ou da conferência sem aplicar a área.
  const sairDaArea = useCallback(() => {
    setDesenho(null)
    setConferencia(null)
    setErroDoDesenhoAtual(null)
    setEtapa('rota')
  }, [])

  // No desenho e na conferência, o Esc desiste só da área; nas outras telas, cancela a rota.
  useEffect(() => {
    if (etapa === 'abertura') return
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key !== 'Escape') return
      if (etapa === 'desenhar' || etapa === 'conferir') sairDaArea()
      else cancelar()
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [etapa, cancelar, sairDaArea])

  function marcar(campo: Campo, ponto: Ponto) {
    if (campo === 'origem') {
      setOrigem(ponto)
      if (!destino) setCampoAtivo('destino')
    } else {
      setDestino(ponto)
    }
    setRota(null)
    setRestrita(null)
    setAviso(null)
  }

  function tocarNoMapa(coordenadas: Coordenadas) {
    if (etapa === 'pontos')
      marcar(campoAtivo, { nome: PONTO_NO_MAPA, coordenadas })
  }

  async function calcular(comAreas: AreaDeclarada[] = areas) {
    if (!origem || !destino) return
    const esta = consulta.current
    setCalculando(true)
    setAviso(null)
    try {
      const resposta = await calcularRota(
        origem.coordenadas,
        destino.coordenadas,
        paraRestricoes(comAreas),
      )
      if (esta !== consulta.current) return
      if (resposta.tipo === 'ROTAS') {
        setRota(resposta.irrestrita)
        setRestrita(resposta.restrita ?? null)
        setEtapa('rota')
      } else if (resposta.causa === 'AREAS_BLOQUEIAM') {
        // Aviso provisório até o diagnóstico do S5-03 (plano, 2026-10-30).
        setRestrita(null)
        setAviso({
          titulo: 'Nenhum caminho respeita as áreas',
          texto: resposta.mensagem,
          verRestricoes: true,
        })
        setEtapa('rota')
      } else {
        setAviso({
          titulo: 'Não existe caminho até este destino',
          texto: resposta.mensagem,
        })
      }
    } catch (erro) {
      if (esta === consulta.current) setAviso(avisoDoErro(erro, comAreas))
    } finally {
      if (esta === consulta.current) setCalculando(false)
    }
  }

  function desenharArea(editando?: AreaDeclarada) {
    setDesenho(
      editando ? { inicial: editando.desenho, editando: editando.id } : {},
    )
    setEstadoDoDesenho(SEM_DESENHO)
    setErroDoDesenhoAtual(null)
    setAviso(null)
    setEtapa('desenhar')
  }

  async function conferir(vertices: Coordenadas[]) {
    if (vertices.length < 3 || conferindo) return
    setConferindo(true)
    setErroDoDesenhoAtual(null)
    try {
      const resposta = await definirArea(
        vertices,
        origem?.coordenadas,
        destino?.coordenadas,
      )
      const editada = areas.find((a) => a.id === desenho?.editando)
      setConferencia({ desenho: vertices, resposta, editando: editada?.id })
      setNome(
        editada && !editada.rotulo.startsWith('Área ') ? editada.rotulo : '',
      )
      setDesenho(null)
      setEtapa('conferir')
    } catch (erro) {
      setErroDoDesenhoAtual(erroDoDesenho(erro))
    } finally {
      setConferindo(false)
    }
  }

  const outrasAreas = areas.filter((a) => a.id !== conferencia?.editando)

  function confirmarArea() {
    if (!conferencia) return
    const id = conferencia.editando ?? crypto.randomUUID()
    const area = novaArea(
      id,
      nome,
      rotuloPadrao(outrasAreas),
      conferencia.desenho,
      conferencia.resposta,
    )
    const lista = conferencia.editando
      ? areas.map((a) => (a.id === id ? area : a))
      : [...areas, area]
    setAreas(lista)
    setConferencia(null)
    // O resultado, ou o aviso, aparece na tela da rota.
    setRestrita(null)
    setEtapa('rota')
    void calcular(lista)
  }

  function ajustarArea() {
    if (!conferencia) return
    setDesenho({
      inicial: conferencia.desenho,
      editando: conferencia.editando,
    })
    setConferencia(null)
    setEstadoDoDesenho(SEM_DESENHO)
    setEtapa('desenhar')
  }

  function removerArea(id: string) {
    setAreas((atuais) => atuais.filter((a) => a.id !== id))
    setRestrita(null)
  }

  // O mapa mostra as áreas da consulta; no desenho e na conferência de uma área já aplicada, a
  // versão antiga sai de cena, e a nova aparece só depois de conferida.
  const editando = desenho?.editando ?? conferencia?.editando
  const areasNoMapa: AreaNoMapa[] = areas
    .filter((a) => a.id !== editando)
    .map(({ id, contorno }) => ({ id, contorno }))
  if (conferencia && !conferencia.resposta.conflitos.length) {
    areasNoMapa.push({
      id: 'em-conferencia',
      contorno: conferencia.resposta.contorno,
    })
  }
  const comRota = etapa !== 'abertura' && etapa !== 'pontos'

  return (
    <div className={etapa === 'abertura' ? 'app app-abertura' : 'app'}>
      {etapa === 'pontos' && (
        <header className="topo">
          <button
            type="button"
            className="voltar"
            aria-label="Voltar para a abertura"
            onClick={() => setEtapa('abertura')}
          >
            ‹
          </button>
          <span className="nome">Contorno</span>
        </header>
      )}
      {etapa === 'rota' && (
        <header className="topo">
          <button
            type="button"
            className="voltar voltar-texto"
            onClick={() => setEtapa('pontos')}
          >
            ‹ A → B
          </button>
        </header>
      )}
      {(etapa === 'desenhar' || etapa === 'conferir') && (
        <header className="topo">
          <span className="topo-titulo">
            {etapa === 'desenhar'
              ? 'Desenhar área proibida'
              : 'Confira a área proibida'}
          </span>
          <button type="button" className="acao-topo" onClick={sairDaArea}>
            {etapa === 'desenhar' ? 'Cancelar' : 'Descartar'}
          </button>
        </header>
      )}
      {etapa === 'restricoes' && (
        <header className="topo">
          <button
            type="button"
            className="voltar voltar-texto"
            onClick={() => setEtapa('rota')}
          >
            ‹ Rota
          </button>
          <span className="topo-titulo topo-centro">Restrições</span>
        </header>
      )}
      {etapa === 'pontos' && (
        <section className="campos" aria-label="Origem e destino">
          <CampoDeEndereco
            id="origem"
            rotulo="Origem"
            ponto={origem}
            ativo={campoAtivo === 'origem'}
            aoAtivar={() => setCampoAtivo('origem')}
            aoEscolher={(ponto) => marcar('origem', ponto)}
          />
          <CampoDeEndereco
            id="destino"
            rotulo="Destino"
            ponto={destino}
            ativo={campoAtivo === 'destino'}
            aoAtivar={() => setCampoAtivo('destino')}
            aoEscolher={(ponto) => marcar('destino', ponto)}
          />
          <p className="dica">
            A busca sai ao tocar em Buscar e cobre São Leopoldo e Novo Hamburgo.
            Também dá para tocar no mapa para marcar o ponto do campo
            selecionado.
          </p>
        </section>
      )}
      {etapa === 'desenhar' && (
        <p className="campos faixa-dica">
          Toque no mapa para marcar cada canto da área. Toque no primeiro ponto
          para fechar.
        </p>
      )}
      <Mapa
        ref={mapa}
        origem={origem?.coordenadas}
        destino={destino?.coordenadas}
        rota={comRota ? rota?.geometria.coordinates : null}
        rotaRestrita={
          etapa === 'rota' || etapa === 'restricoes'
            ? restrita?.geometria.coordinates
            : null
        }
        areas={areasNoMapa}
        referencia={
          conferencia ? [...conferencia.desenho, conferencia.desenho[0]] : null
        }
        desenho={etapa === 'desenhar' ? desenho : null}
        aoMudarDesenho={setEstadoDoDesenho}
        aoFecharDesenho={(vertices) => void conferir(vertices)}
        aoTocar={tocarNoMapa}
        aoCancelar={
          etapa === 'pontos' || etapa === 'rota' || etapa === 'restricoes'
            ? cancelar
            : undefined
        }
      />
      {etapa === 'abertura' && (
        <>
          <div className="marca">Contorno</div>
          <button
            type="button"
            className="botao-principal comecar"
            onClick={() => setEtapa('pontos')}
          >
            Começar
          </button>
        </>
      )}
      {(etapa === 'pontos' || etapa === 'rota') && (
        <section className="base">
          {aviso && (
            <Aviso
              titulo={aviso.titulo}
              acao={
                (aviso.tentarDeNovo || aviso.verRestricoes) && (
                  <button
                    type="button"
                    className="botao"
                    onClick={() =>
                      aviso.verRestricoes
                        ? setEtapa('restricoes')
                        : void calcular()
                    }
                  >
                    {aviso.verRestricoes ? 'Ver restrições' : 'Tentar de novo'}
                  </button>
                )
              }
            >
              {aviso.texto}
            </Aviso>
          )}
          {etapa === 'pontos' && (
            <button
              type="button"
              className="botao-principal"
              disabled={!origem || !destino || calculando}
              onClick={() => void calcular()}
            >
              {calculando ? 'Calculando…' : 'Calcular rota'}
            </button>
          )}
          {etapa === 'rota' && rota && (
            <PainelDaRota
              rota={rota}
              restrita={restrita}
              quantasRestricoes={areas.length}
              aoDesenharArea={() => desenharArea()}
              aoVerRestricoes={() => setEtapa('restricoes')}
            />
          )}
          {(etapa === 'rota' || origem || destino) && (
            <>
              <button type="button" className="botao" onClick={cancelar}>
                Cancelar rota
              </button>
              <p className="dica atalhos">
                Esc ou duplo clique no mapa também cancelam a rota.
              </p>
            </>
          )}
        </section>
      )}
      {etapa === 'desenhar' && (
        <section className="base">
          <PainelDoDesenho
            vertices={estadoDoDesenho.vertices}
            podeDesfazer={estadoDoDesenho.podeDesfazer}
            conferindo={conferindo}
            erro={erroDoDesenhoAtual}
            aoDesfazer={() => mapa.current?.desfazer()}
            aoConcluir={() => void conferir(mapa.current?.vertices() ?? [])}
          />
        </section>
      )}
      {etapa === 'conferir' && conferencia && (
        <section className="base">
          <PainelDaConferencia
            resposta={conferencia.resposta}
            nome={nome}
            rotuloSemNome={rotuloPadrao(outrasAreas)}
            calculando={calculando}
            aoMudarNome={setNome}
            aoAjustar={ajustarArea}
            aoConfirmar={confirmarArea}
            aoMudarPonto={() => {
              setConferencia(null)
              setEtapa('pontos')
            }}
          />
        </section>
      )}
      {etapa === 'restricoes' && (
        <section className="base">
          <ListaDeRestricoes
            areas={areas}
            calculando={calculando}
            aoRedesenhar={(id) => desenharArea(areas.find((a) => a.id === id))}
            aoRemover={removerArea}
            aoNovaRestricao={() => desenharArea()}
            aoRecalcular={() => {
              setEtapa('rota')
              void calcular()
            }}
          />
        </section>
      )}
    </div>
  )
}

export default App
