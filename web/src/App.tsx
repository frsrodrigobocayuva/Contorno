// O estado de uma consulta fica num ponto só, aqui, e desce para os componentes (DAS 7.2).
// Telas do protótipo aprovado: 01/14 abertura, 02 origem e destino, 03 rota normal, 04 desenhar
// área, 05 contorno das células, 06 rota restrita e custo, 07 restrições, 08 raio, 09 classes de
// via, 10 conflito, 11 e 12 diagnóstico, 13 avisos, 16 confirmar cancelar.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  calcularRota,
  definirArea,
  ErroDaApi,
  type ClasseDeVia,
  type Coordenadas,
  type NivelDeEvitacao,
  type RespostaArea,
  type Rota,
} from './api/cliente'
import { Aviso } from './Aviso'
import { ConfirmarCancelar } from './ConfirmarCancelar'
import { DURACAO, movimentoReduzido } from './movimento'
import { PainelDaRota } from './comparacao/PainelDaRota'
import {
  PainelDoDiagnostico,
  type CausaDasAreas,
} from './comparacao/PainelDoDiagnostico'
import { CampoDeEndereco } from './mapa/CampoDeEndereco'
import { Mapa, type AreaNoMapa, type ControleDoMapa } from './mapa/Mapa'
import { naRegiao } from './mapa/regiao'
import { PONTO_NO_MAPA, type Campo, type Ponto } from './pontos'
import {
  circuloAproximado,
  novaArea,
  paraRestricoes,
  rotuloPadrao,
  type AreaDeclarada,
  type RaioDaArea,
} from './restricoes/areas'
import {
  paraPreferencias,
  preferenciasAtivas,
  SEM_PREFERENCIAS,
  type Niveis,
} from './restricoes/classes'
import type { EstadoDoDesenho, RecusaDoDesenho } from './restricoes/editor'
import { ListaDeRestricoes } from './restricoes/ListaDeRestricoes'
import {
  PainelDaConferencia,
  PainelDoDesenho,
} from './restricoes/PaineisDaArea'
import { PainelDasClasses } from './restricoes/PainelDasClasses'
import { PainelDoRaio, RAIO_INICIAL_M } from './restricoes/PainelDoRaio'

type Etapa =
  | 'abertura'
  | 'pontos'
  | 'rota'
  | 'desenhar'
  | 'conferir'
  | 'classes'
  | 'raio'
  | 'restricoes'

interface AvisoDaRota {
  titulo: string
  texto: string
  tentarDeNovo?: boolean
  verRestricoes?: boolean
}

// As áreas que o diagnóstico apontou valem até o próximo cálculo (S5-03).
interface DiagnosticoDasAreas {
  causa: CausaDasAreas
  candidatas: string[]
}

interface Conferencia {
  desenho: Coordenadas[]
  resposta: RespostaArea
  editando?: string
  // Só na área de raio: "Ajustar" volta à tela 08, e não ao desenho.
  raio?: RaioDaArea
}

// A tela 08 em andamento: o centro (da busca ou de um toque) e a distância.
interface RascunhoDoRaio {
  centro: Ponto | null
  metros: number
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

const SEM_DESENHO: EstadoDoDesenho = { vertices: [] }

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

// O editor recusa na hora o ponto fora da região e o fechamento que cruza o desenho; o desenho
// continua aberto (teste do usuário, 2026-11-01).
const RECUSAS: Record<RecusaDoDesenho, string> = {
  FORA_DA_REGIAO:
    'Esse ponto fica fora de São Leopoldo e Novo Hamburgo. Marque os cantos dentro da região atendida.',
  DESENHO_CRUZADO:
    'Fechado assim, o desenho se cruza. Mude o último ponto, ou desfaça a área e desenhe de novo.',
}

const CENTRO_FORA_DA_REGIAO =
  'Esse ponto fica fora de São Leopoldo e Novo Hamburgo. Escolha um centro dentro da região atendida.'

function erroDoRaio(erro: unknown): string {
  if (erro instanceof ErroDaApi && erro.temMotivo('FORA_DA_REGIAO'))
    return 'O círculo passa de São Leopoldo e Novo Hamburgo. Diminua a distância ou escolha um centro mais para dentro da região.'
  return 'Não foi possível gerar a área agora. Tente de novo.'
}

function erroDoDesenho(erro: unknown): string {
  if (erro instanceof ErroDaApi && erro.temMotivo('POLIGONO_INVALIDO'))
    return 'O desenho se cruza ou tem pontos repetidos. Desfaça a área e desenhe de novo.'
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
  const [niveis, setNiveis] = useState<Niveis>(SEM_PREFERENCIAS)
  // A tela 09 edita um rascunho; só "Aplicar e recalcular" o torna a preferência da consulta.
  const [rascunhoDeNiveis, setRascunhoDeNiveis] =
    useState<Niveis>(SEM_PREFERENCIAS)
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
  const [raio, setRaio] = useState<RascunhoDoRaio | null>(null)
  const [confirmandoCancelar, setConfirmandoCancelar] = useState(false)
  const [saindoDaJanela, setSaindoDaJanela] = useState(false)
  const [nome, setNome] = useState('')
  const [aviso, setAviso] = useState<AvisoDaRota | null>(null)
  const [diagnostico, setDiagnostico] = useState<DiagnosticoDasAreas | null>(
    null,
  )
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
    setNiveis(SEM_PREFERENCIAS)
    setDesenho(null)
    setConferencia(null)
    setRaio(null)
    setConfirmandoCancelar(false)
    setSaindoDaJanela(false)
    setAviso(null)
    setDiagnostico(null)
    setCalculando(false)
    setCampoAtivo('origem')
    setEtapa('pontos')
  }, [])

  // Sair do desenho, do raio ou da conferência sem aplicar a área.
  const sairDaArea = useCallback(() => {
    setDesenho(null)
    setConferencia(null)
    setRaio(null)
    setErroDoDesenhoAtual(null)
    setEtapa('rota')
  }, [])

  // Os atalhos (Esc e duplo clique no mapa) perguntam antes de apagar uma rota calculada; o botão
  // "Cancelar rota" cancela direto (pedido do usuário, S5-04; tela 16).
  const temRota = rota !== null
  const pedirCancelar = useCallback(() => {
    if (temRota) setConfirmandoCancelar(true)
    else cancelar()
  }, [temRota, cancelar])

  // A janela sai com fade (P8); com movimento reduzido, fecha na hora.
  const fecharJanela = useCallback(() => {
    if (movimentoReduzido()) {
      setConfirmandoCancelar(false)
      return
    }
    setSaindoDaJanela(true)
    setTimeout(() => {
      setConfirmandoCancelar(false)
      setSaindoDaJanela(false)
    }, DURACAO.saida)
  }, [])

  // O Esc desfaz um nível por vez: com a janela de confirmar aberta, fecha a janela; no desenho,
  // no raio e na conferência, desiste só da área; nas outras telas, pede para cancelar a rota;
  // com tudo vazio, volta para a abertura (teste do usuário, 2026-10-31).
  const classesAtivas = preferenciasAtivas(niveis)
  const vazio =
    !origem && !destino && areas.length === 0 && classesAtivas.length === 0
  useEffect(() => {
    if (etapa === 'abertura') return
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key !== 'Escape') return
      if (confirmandoCancelar) fecharJanela()
      else if (
        etapa === 'desenhar' ||
        etapa === 'conferir' ||
        etapa === 'classes' ||
        etapa === 'raio'
      )
        sairDaArea()
      else if (etapa === 'pontos' && vazio) setEtapa('abertura')
      else pedirCancelar()
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [
    etapa,
    vazio,
    confirmandoCancelar,
    fecharJanela,
    pedirCancelar,
    sairDaArea,
  ])

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
    setDiagnostico(null)
  }

  // Na abertura, um toque no mapa (sem arrastar) faz o mesmo que Começar, sem marcar ponto. Fora
  // da região atendida, o toque não marca A nem B, como no desenho da área (2026-11-01).
  function tocarNoMapa(coordenadas: Coordenadas) {
    if (etapa === 'abertura') setEtapa('pontos')
    else if (etapa === 'raio')
      escolherCentro({ nome: PONTO_NO_MAPA, coordenadas })
    else if (etapa !== 'pontos') return
    else if (!naRegiao(coordenadas)) setAviso(FORA_DA_REGIAO)
    else marcar(campoAtivo, { nome: PONTO_NO_MAPA, coordenadas })
  }

  async function calcular(
    comAreas: AreaDeclarada[] = areas,
    comNiveis: Niveis = niveis,
  ) {
    if (!origem || !destino) return
    const esta = consulta.current
    setCalculando(true)
    setAviso(null)
    setDiagnostico(null)
    try {
      const resposta = await calcularRota(
        origem.coordenadas,
        destino.coordenadas,
        [...paraRestricoes(comAreas), ...paraPreferencias(comNiveis)],
      )
      if (esta !== consulta.current) return
      // A resposta leva para a tela da rota só quem ainda estava esperando por ela, em origem e
      // destino. Quem foi para a lista de restrições, o desenho ou as classes enquanto calculava
      // fica onde está, e a rota se atualiza no mapa (CI vermelho depois do PR #20).
      const paraARota = (atual: Etapa) => (atual === 'pontos' ? 'rota' : atual)
      if (resposta.tipo === 'ROTAS') {
        setRota(resposta.irrestrita)
        setRestrita(resposta.restrita ?? null)
        setEtapa(paraARota)
      } else if (resposta.causa === 'DESTINO_INALCANCAVEL') {
        setAviso({
          titulo: 'Não existe caminho até este destino',
          texto: resposta.mensagem,
        })
      } else {
        // UC05: as áreas bloqueiam, e o diagnóstico diz quais (telas 11 e 12).
        setRestrita(null)
        setDiagnostico({
          causa: resposta.causa,
          candidatas: resposta.candidatas,
        })
        setEtapa(paraARota)
      }
    } catch (erro) {
      if (esta === consulta.current) setAviso(avisoDoErro(erro, comAreas))
    } finally {
      if (esta === consulta.current) setCalculando(false)
    }
  }

  // Um ponto a mais ou a menos tira o aviso de um ponto recusado.
  function mudarDesenho(estado: EstadoDoDesenho) {
    if (estado.vertices.length !== estadoDoDesenho.vertices.length)
      setErroDoDesenhoAtual(null)
    setEstadoDoDesenho(estado)
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
        { poligono: vertices },
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

  // Raio a partir de endereço (tela 08; UC02, alternativo A).
  function abrirRaio(editando?: AreaDeclarada) {
    setRaio({
      centro: editando?.raio?.centro ?? null,
      metros: editando?.raio?.metros ?? RAIO_INICIAL_M,
      editando: editando?.id,
    })
    setErroDoDesenhoAtual(null)
    setAviso(null)
    setEtapa('raio')
  }

  // Fora da região, o centro é recusado na hora, como A, B e os cantos do desenho.
  function escolherCentro(centro: Ponto) {
    if (!naRegiao(centro.coordenadas)) {
      setErroDoDesenhoAtual(CENTRO_FORA_DA_REGIAO)
      return
    }
    setErroDoDesenhoAtual(null)
    setRaio((atual) => atual && { ...atual, centro })
  }

  async function gerarArea() {
    if (!raio?.centro || conferindo) return
    const forma: RaioDaArea = { centro: raio.centro, metros: raio.metros }
    setConferindo(true)
    setErroDoDesenhoAtual(null)
    try {
      const resposta = await definirArea(
        { raio: { centro: forma.centro.coordenadas, metros: forma.metros } },
        origem?.coordenadas,
        destino?.coordenadas,
      )
      const editada = areas.find((a) => a.id === raio.editando)
      setConferencia({
        desenho: resposta.desenho,
        resposta,
        editando: editada?.id,
        raio: forma,
      })
      setNome(
        editada && !editada.rotulo.startsWith('Raio ') ? editada.rotulo : '',
      )
      setRaio(null)
      setEtapa('conferir')
    } catch (erro) {
      setErroDoDesenhoAtual(erroDoRaio(erro))
    } finally {
      setConferindo(false)
    }
  }

  const outrasAreas = areas.filter((a) => a.id !== conferencia?.editando)
  const rotuloSemNome = rotuloPadrao(
    outrasAreas,
    conferencia?.raio ? 'Raio' : 'Área',
  )

  function confirmarArea() {
    if (!conferencia) return
    const id = conferencia.editando ?? crypto.randomUUID()
    const area = novaArea(
      id,
      nome,
      rotuloSemNome,
      conferencia.desenho,
      conferencia.resposta,
      conferencia.raio,
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
    if (conferencia.raio) {
      setRaio({ ...conferencia.raio, editando: conferencia.editando })
      setConferencia(null)
      setEtapa('raio')
      return
    }
    setDesenho({
      inicial: conferencia.desenho,
      editando: conferencia.editando,
    })
    setConferencia(null)
    setEstadoDoDesenho(SEM_DESENHO)
    setEtapa('desenhar')
  }

  function abrirClasses() {
    setRascunhoDeNiveis(niveis)
    setAviso(null)
    setEtapa('classes')
  }

  function aplicarClasses() {
    setNiveis(rascunhoDeNiveis)
    setRestrita(null)
    setEtapa('rota')
    void calcular(areas, rascunhoDeNiveis)
  }

  function removerArea(id: string) {
    setAreas((atuais) => atuais.filter((a) => a.id !== id))
    setRestrita(null)
  }

  // O mapa mostra as áreas da consulta; no desenho e na conferência de uma área já aplicada, a
  // versão antiga sai de cena, e a nova aparece só depois de conferida.
  const editando = desenho?.editando ?? raio?.editando ?? conferencia?.editando
  const apontadas = diagnostico?.candidatas ?? []
  const areasNoMapa: AreaNoMapa[] = areas
    .filter((a) => a.id !== editando)
    .map(({ id, contorno, rotulo }) => ({
      id,
      contorno,
      rotuloApontado: apontadas.includes(id) ? rotulo : undefined,
    }))
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
        <header className="topo" key={`topo-${etapa}`}>
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
        <header className="topo" key={`topo-${etapa}`}>
          <button
            type="button"
            className="voltar voltar-texto"
            onClick={() => setEtapa('pontos')}
          >
            ‹ A → B
          </button>
        </header>
      )}
      {(etapa === 'desenhar' ||
        etapa === 'conferir' ||
        etapa === 'classes' ||
        etapa === 'raio') && (
        <header className="topo" key={`topo-${etapa}`}>
          <span className="topo-titulo">
            {etapa === 'desenhar'
              ? 'Desenhar área proibida'
              : etapa === 'conferir'
                ? 'Confira a área proibida'
                : etapa === 'raio'
                  ? 'Raio a partir de endereço'
                  : 'Classes de via'}
          </span>
          <button type="button" className="acao-topo" onClick={sairDaArea}>
            {etapa === 'conferir' ? 'Descartar' : 'Cancelar'}
          </button>
        </header>
      )}
      {etapa === 'restricoes' && (
        <header className="topo" key={`topo-${etapa}`}>
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
        <section
          className="campos"
          key={`campos-${etapa}`}
          aria-label="Origem e destino"
        >
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
      {etapa === 'raio' && raio && (
        <section
          className="campos"
          key={`campos-${etapa}`}
          aria-label="Centro do raio"
        >
          <CampoDeEndereco
            id="centro"
            rotulo="Endereço do centro"
            ponto={raio.centro}
            ativo
            aoAtivar={() => {}}
            aoEscolher={escolherCentro}
          />
          <p className="dica">
            Também dá para tocar no mapa para marcar o centro.
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
        centro={etapa === 'raio' ? raio?.centro?.coordenadas : null}
        rota={comRota ? rota?.geometria.coordinates : null}
        rotaRestrita={
          etapa === 'rota' || etapa === 'restricoes'
            ? restrita?.geometria.coordinates
            : null
        }
        areas={areasNoMapa}
        referencia={fechado(
          conferencia
            ? conferencia.desenho
            : etapa === 'raio' && raio?.centro
              ? circuloAproximado(raio.centro.coordenadas, raio.metros)
              : null,
        )}
        desenho={etapa === 'desenhar' ? desenho : null}
        aoMudarDesenho={mudarDesenho}
        aoRecusarDesenho={(motivo) => setErroDoDesenhoAtual(RECUSAS[motivo])}
        aoFecharDesenho={(vertices) => void conferir(vertices)}
        aoTocar={tocarNoMapa}
        aoCancelar={
          etapa === 'pontos' || etapa === 'rota' || etapa === 'restricoes'
            ? pedirCancelar
            : undefined
        }
      />
      {calculando && (
        <div
          className="progresso"
          role="progressbar"
          aria-label="Calculando a rota"
        />
      )}
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
        <section className="base" key={`base-${etapa}`}>
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
          {etapa === 'rota' && diagnostico && (
            <PainelDoDiagnostico
              causa={diagnostico.causa}
              areas={diagnostico.candidatas.flatMap((id) =>
                areas.filter((a) => a.id === id),
              )}
              aoMudarDestino={() => {
                setCampoAtivo('destino')
                setEtapa('pontos')
              }}
              aoEditarRestricoes={() => setEtapa('restricoes')}
            />
          )}
          {etapa === 'rota' && rota && !diagnostico && (
            <PainelDaRota
              rota={rota}
              restrita={restrita}
              quantasRestricoes={areas.length + classesAtivas.length}
              aoDesenharArea={() => desenharArea()}
              aoRaio={() => abrirRaio()}
              aoClassesDeVia={abrirClasses}
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
        <section className="base" key={`base-${etapa}`}>
          <PainelDoDesenho
            vertices={estadoDoDesenho.vertices}
            conferindo={conferindo}
            erro={erroDoDesenhoAtual}
            aoDesfazer={() => mapa.current?.desfazerArea()}
            aoConcluir={() => void conferir(mapa.current?.vertices() ?? [])}
          />
        </section>
      )}
      {etapa === 'conferir' && conferencia && (
        <section className="base" key={`base-${etapa}`}>
          <PainelDaConferencia
            resposta={conferencia.resposta}
            nome={nome}
            rotuloSemNome={rotuloSemNome}
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
      {etapa === 'raio' && raio && (
        <section className="base" key={`base-${etapa}`}>
          <PainelDoRaio
            temCentro={raio.centro !== null}
            metros={raio.metros}
            gerando={conferindo}
            erro={erroDoDesenhoAtual}
            aoMudarMetros={(metros) =>
              setRaio((atual) => atual && { ...atual, metros })
            }
            aoGerar={() => void gerarArea()}
          />
        </section>
      )}
      {etapa === 'classes' && (
        <section className="base" key={`base-${etapa}`}>
          <PainelDasClasses
            niveis={rascunhoDeNiveis}
            calculando={calculando}
            aoMudar={(classe: ClasseDeVia, nivel: NivelDeEvitacao) =>
              setRascunhoDeNiveis((atual) => ({ ...atual, [classe]: nivel }))
            }
            aoAplicar={aplicarClasses}
          />
        </section>
      )}
      {etapa === 'restricoes' && (
        <section className="base" key={`base-${etapa}`}>
          <ListaDeRestricoes
            areas={areas}
            apontadas={apontadas}
            classes={classesAtivas}
            aoAlterarClasses={abrirClasses}
            calculando={calculando}
            aoRedesenhar={(id) => {
              const area = areas.find((a) => a.id === id)
              if (area?.raio) abrirRaio(area)
              else desenharArea(area)
            }}
            aoRemover={removerArea}
            aoNovaRestricao={() => desenharArea()}
            aoRecalcular={() => {
              setEtapa('rota')
              void calcular()
            }}
          />
        </section>
      )}
      {confirmandoCancelar && (
        <ConfirmarCancelar
          saindo={saindoDaJanela}
          aoContinuar={fecharJanela}
          aoCancelar={cancelar}
        />
      )}
    </div>
  )
}

function fechado(anel: Coordenadas[] | null): Coordenadas[] | null {
  return anel && anel.length ? [...anel, anel[0]] : null
}

export default App
