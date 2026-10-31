// Painel Comparativo (UC01): a rota irrestrita como linha de base (tela 03) e, com áreas, o custo da
// restrição contra ela (tela 06; RN02), com a legenda dos dois traços.
import { useState } from 'react'
import type { Rota } from '../api/cliente'
import { formatarCusto, formatarDistancia, formatarDuracao } from '../formato'

interface Props {
  rota: Rota
  restrita: Rota | null
  quantasRestricoes: number
  aoDesenharArea: () => void
  aoVerRestricoes: () => void
}

function valores(rota: Rota) {
  return `${formatarDuracao(rota.duracaoSegundos)} · ${formatarDistancia(rota.distanciaMetros)}`
}

function restricoes(n: number) {
  return n === 1 ? '1 restrição aplicada' : `${n} restrições aplicadas`
}

// Raio e classes de via entram na S5-04 e na S5-02; até lá, desativados com "em breve".
function AplicarRestricoes({ aoDesenharArea }: { aoDesenharArea: () => void }) {
  return (
    <div className="restricoes">
      <span className="rotulo">Aplicar restrições</span>
      <div className="restricoes-grade">
        <button
          type="button"
          className="botao botao-restricao"
          onClick={aoDesenharArea}
        >
          Desenhar área
        </button>
        {['Raio a partir de endereço', 'Classes de via a evitar'].map(
          (nome) => (
            <button
              key={nome}
              type="button"
              className="botao botao-restricao"
              disabled
            >
              {nome}
              <small>em breve</small>
            </button>
          ),
        )}
      </div>
    </div>
  )
}

export function PainelDaRota({
  rota,
  restrita,
  quantasRestricoes,
  aoDesenharArea,
  aoVerRestricoes,
}: Props) {
  const [escolhendo, setEscolhendo] = useState(false)

  if (!restrita) {
    return (
      <div className="painel-rota">
        <div className="resumo">
          <div className="resumo-valores">
            <span className="rotulo">Rota irrestrita</span>
            <span className="valor">{valores(rota)}</span>
          </div>
          <span className="selo">
            {quantasRestricoes
              ? restricoes(quantasRestricoes)
              : 'nenhuma restrição'}
          </span>
        </div>
        {quantasRestricoes > 0 && (
          <button type="button" className="botao" onClick={aoVerRestricoes}>
            Ver restrições ({quantasRestricoes})
          </button>
        )}
        <AplicarRestricoes aoDesenharArea={aoDesenharArea} />
      </div>
    )
  }

  return (
    <div className="painel-rota">
      <div className="resumo-valores">
        <span className="rotulo">Custo da restrição</span>
        <span className="valor valor-custo">
          {formatarCusto(
            restrita.duracaoSegundos - rota.duracaoSegundos,
            restrita.distanciaMetros - rota.distanciaMetros,
          )}
        </span>
        <span className="dica">{restricoes(quantasRestricoes)}</span>
      </div>
      <ul className="legenda" aria-label="Legenda das rotas">
        <li>
          <svg width="28" height="8" viewBox="0 0 28 8" aria-hidden="true">
            <path
              d="M2,4 L26,4"
              stroke="#594927"
              strokeWidth="5"
              strokeLinecap="round"
            />
          </svg>
          <span>
            Restrita <strong>{valores(restrita)}</strong>
          </span>
        </li>
        <li>
          <svg width="28" height="8" viewBox="0 0 28 8" aria-hidden="true">
            <path
              d="M2,4 L26,4"
              stroke="#594927"
              strokeWidth="3"
              strokeDasharray="6 4"
            />
          </svg>
          <span>
            Irrestrita <strong>{valores(rota)}</strong>
          </span>
        </li>
      </ul>
      <div className="linha-botoes">
        <button type="button" className="botao" onClick={aoVerRestricoes}>
          Ver restrições ({quantasRestricoes})
        </button>
        <button
          type="button"
          className="botao"
          aria-expanded={escolhendo}
          onClick={() => setEscolhendo((atual) => !atual)}
        >
          + Restrição
        </button>
      </div>
      {escolhendo && <AplicarRestricoes aoDesenharArea={aoDesenharArea} />}
    </div>
  )
}
