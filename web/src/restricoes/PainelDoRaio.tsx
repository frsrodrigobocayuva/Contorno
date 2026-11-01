// Raio a partir de endereço (tela 08; UC02, alternativo A): a distância do centro e "Gerar área".
// O centro vem da busca, no campo de cima, ou de um toque no mapa (Realização, UC02 [4]).
import { Aviso } from '../Aviso'
import { formatarDistancia } from '../formato'

// Raio de 100 m a 2 km (plano, D11), em passos de 50 m, começando em 500 m (tela 08).
export const RAIO_MINIMO_M = 100
export const RAIO_MAXIMO_M = 2000
export const RAIO_INICIAL_M = 500

interface Props {
  temCentro: boolean
  metros: number
  gerando: boolean
  erro: string | null
  aoMudarMetros: (metros: number) => void
  aoGerar: () => void
}

export function PainelDoRaio({
  temCentro,
  metros,
  gerando,
  erro,
  aoMudarMetros,
  aoGerar,
}: Props) {
  return (
    <>
      {erro && <Aviso titulo="Não deu para gerar esta área">{erro}</Aviso>}
      <div className="campo">
        <label htmlFor="distancia" className="rotulo-com-valor">
          <span>Distância (100 m a 2 km)</span>
          <strong>{formatarDistancia(metros)}</strong>
        </label>
        <input
          id="distancia"
          type="range"
          min={RAIO_MINIMO_M}
          max={RAIO_MAXIMO_M}
          step={50}
          value={metros}
          onChange={(evento) => aoMudarMetros(Number(evento.target.value))}
        />
      </div>
      {!temCentro && (
        <p className="dica">Escolha o centro pela busca ou tocando no mapa.</p>
      )}
      <div className="linha-botoes rodape-fixo">
        <button
          type="button"
          className="botao-principal"
          disabled={!temCentro || gerando}
          onClick={aoGerar}
        >
          {gerando ? 'Gerando…' : 'Gerar área'}
        </button>
      </div>
    </>
  )
}
