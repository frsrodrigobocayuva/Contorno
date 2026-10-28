// O estado de uma consulta fica num ponto só, aqui, e desce para os componentes (DAS 7.2).
// Telas do protótipo aprovado: 01/14 abertura, 02 origem e destino, 03 rota normal, 13 avisos.
import { useState } from 'react'
import {
  calcularRota,
  ErroDaApi,
  type Coordenadas,
  type Rota,
} from './api/cliente'
import { Aviso } from './Aviso'
import { PainelDaRota } from './comparacao/PainelDaRota'
import { CampoDeEndereco } from './mapa/CampoDeEndereco'
import { Mapa } from './mapa/Mapa'
import { PONTO_NO_MAPA, type Campo, type Ponto } from './pontos'

type Etapa = 'abertura' | 'pontos' | 'rota'

interface AvisoDaRota {
  titulo: string
  texto: string
  tentarDeNovo?: boolean
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

function avisoDoErro(erro: unknown): AvisoDaRota {
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

function App() {
  const [etapa, setEtapa] = useState<Etapa>('abertura')
  const [campoAtivo, setCampoAtivo] = useState<Campo>('origem')
  const [origem, setOrigem] = useState<Ponto | null>(null)
  const [destino, setDestino] = useState<Ponto | null>(null)
  const [rota, setRota] = useState<Rota | null>(null)
  const [aviso, setAviso] = useState<AvisoDaRota | null>(null)
  const [calculando, setCalculando] = useState(false)

  function marcar(campo: Campo, ponto: Ponto) {
    if (campo === 'origem') {
      setOrigem(ponto)
      if (!destino) setCampoAtivo('destino')
    } else {
      setDestino(ponto)
    }
    setRota(null)
    setAviso(null)
  }

  function tocarNoMapa(coordenadas: Coordenadas) {
    if (etapa === 'pontos')
      marcar(campoAtivo, { nome: PONTO_NO_MAPA, coordenadas })
  }

  async function calcular() {
    if (!origem || !destino) return
    setCalculando(true)
    setAviso(null)
    try {
      const resposta = await calcularRota(
        origem.coordenadas,
        destino.coordenadas,
      )
      if (resposta.tipo === 'ROTAS') {
        setRota(resposta.irrestrita)
        setEtapa('rota')
      } else {
        setAviso({
          titulo: 'Não existe caminho até este destino',
          texto: resposta.mensagem,
        })
      }
    } catch (erro) {
      setAviso(avisoDoErro(erro))
    } finally {
      setCalculando(false)
    }
  }

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
      <Mapa
        origem={origem?.coordenadas}
        destino={destino?.coordenadas}
        rota={etapa === 'rota' ? rota?.geometria.coordinates : null}
        aoTocar={tocarNoMapa}
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
      {etapa === 'pontos' && (
        <section className="base">
          {aviso && (
            <Aviso
              titulo={aviso.titulo}
              acao={
                aviso.tentarDeNovo && (
                  <button
                    type="button"
                    className="botao"
                    onClick={() => void calcular()}
                  >
                    Tentar de novo
                  </button>
                )
              }
            >
              {aviso.texto}
            </Aviso>
          )}
          <button
            type="button"
            className="botao-principal"
            disabled={!origem || !destino || calculando}
            onClick={() => void calcular()}
          >
            {calculando ? 'Calculando…' : 'Calcular rota'}
          </button>
        </section>
      )}
      {etapa === 'rota' && rota && (
        <section className="base">
          <PainelDaRota rota={rota} />
        </section>
      )}
    </div>
  )
}

export default App
