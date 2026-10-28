// Painel Comparativo, por ora só com a linha de base: a rota irrestrita (UC01, fluxo A).
import type { Rota } from '../api/cliente'
import { formatarDistancia, formatarDuracao } from '../formato'

// As restrições entram na Sprint 5; até lá os botões aparecem desativados (decisão de 2026-10-27).
const RESTRICOES = [
  'Desenhar área',
  'Raio a partir de endereço',
  'Classes de via a evitar',
]

export function PainelDaRota({ rota }: { rota: Rota }) {
  return (
    <div className="painel-rota">
      <div className="resumo">
        <div className="resumo-valores">
          <span className="rotulo">Rota irrestrita</span>
          <span className="valor">
            {formatarDuracao(rota.duracaoSegundos)} ·{' '}
            {formatarDistancia(rota.distanciaMetros)}
          </span>
        </div>
        <span className="selo">nenhuma restrição</span>
      </div>
      <div className="restricoes">
        <span className="rotulo">Aplicar restrições</span>
        <div className="restricoes-grade">
          {RESTRICOES.map((nome) => (
            <button
              key={nome}
              type="button"
              className="botao botao-restricao"
              disabled
            >
              {nome}
              <small>em breve</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
