// Campo de origem ou destino: a busca só sai ao acionar Buscar, sem autocompletar (ADR-013).
import { useState, type FormEvent } from 'react'
import { buscarEnderecos, type Lugar } from '../api/cliente'
import { Aviso } from '../Aviso'
import type { Ponto } from '../pontos'

interface Props {
  id: string
  rotulo: string
  ponto: Ponto | null
  ativo: boolean
  aoAtivar: () => void
  aoEscolher: (ponto: Ponto) => void
}

interface Busca {
  sobre: Ponto | null
  lugares: Lugar[]
  aviso: { titulo: string; texto: string } | null
}

const BUSCA_FORA_DO_AR = {
  titulo: 'Busca de endereço fora do ar',
  texto:
    'A busca de endereços não respondeu. Dá para continuar: toque no mapa para marcar origem ou destino.',
}

function semResultado(texto: string) {
  return {
    titulo: 'Busca sem resultado',
    texto: `Nenhum endereço encontrado para "${texto}". Confira a grafia, ou marque o ponto direto no mapa.`,
  }
}

export function CampoDeEndereco({
  id,
  rotulo,
  ponto,
  ativo,
  aoAtivar,
  aoEscolher,
}: Props) {
  // O rascunho e a busca valem só enquanto o ponto não muda (por exemplo, por um toque no mapa).
  const [rascunho, setRascunho] = useState<{
    texto: string
    sobre: Ponto | null
  } | null>(null)
  const [busca, setBusca] = useState<Busca | null>(null)
  const [buscando, setBuscando] = useState(false)

  const valor =
    rascunho && rascunho.sobre === ponto ? rascunho.texto : (ponto?.nome ?? '')
  const buscaAtual = busca && busca.sobre === ponto ? busca : null

  async function buscar(evento: FormEvent) {
    evento.preventDefault()
    const texto = valor.trim()
    if (!texto) return
    setBuscando(true)
    try {
      const resposta = await buscarEnderecos(texto)
      setBusca({
        sobre: ponto,
        lugares: resposta.lugares,
        aviso: resposta.lugares.length
          ? null
          : resposta.motivo === 'SERVICO_INDISPONIVEL'
            ? BUSCA_FORA_DO_AR
            : semResultado(texto),
      })
    } catch {
      setBusca({ sobre: ponto, lugares: [], aviso: BUSCA_FORA_DO_AR })
    } finally {
      setBuscando(false)
    }
  }

  function escolher(lugar: Lugar) {
    setRascunho(null)
    setBusca(null)
    aoEscolher({ nome: lugar.nome, coordenadas: lugar.coordenada })
  }

  return (
    <form className={ativo ? 'campo campo-ativo' : 'campo'} onSubmit={buscar}>
      <label htmlFor={id}>{rotulo}</label>
      <div className="campo-linha">
        <input
          id={id}
          type="text"
          value={valor}
          placeholder="Endereço ou toque no mapa"
          onFocus={aoAtivar}
          onChange={(evento) =>
            setRascunho({ texto: evento.target.value, sobre: ponto })
          }
        />
        <button type="submit" className="botao" disabled={buscando}>
          {buscando ? 'Buscando…' : 'Buscar'}
        </button>
      </div>
      {buscaAtual && buscaAtual.lugares.length > 0 && (
        <ul
          className="resultados"
          aria-label={`Resultados para ${rotulo.toLowerCase()}`}
        >
          {buscaAtual.lugares.map((lugar) => (
            <li
              key={`${lugar.coordenada[0]},${lugar.coordenada[1]},${lugar.nome}`}
            >
              <button type="button" onClick={() => escolher(lugar)}>
                {lugar.nome}
              </button>
            </li>
          ))}
        </ul>
      )}
      {buscaAtual?.aviso && (
        <Aviso titulo={buscaAtual.aviso.titulo}>{buscaAtual.aviso.texto}</Aviso>
      )}
    </form>
  )
}
