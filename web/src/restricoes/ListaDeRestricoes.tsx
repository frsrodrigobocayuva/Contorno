// Restrições da consulta (tela 07): cada área com redesenhar e remover. Com o diagnóstico só
// informativo, remover a área na mão é o caminho depois de um bloqueio (plano, S5-03).
import { formatarArea } from '../formato'
import type { AreaDeclarada } from './areas'
import type { preferenciasAtivas } from './classes'

interface Props {
  areas: AreaDeclarada[]
  classes: ReturnType<typeof preferenciasAtivas>
  calculando: boolean
  aoRedesenhar: (id: string) => void
  aoRemover: (id: string) => void
  aoNovaRestricao: () => void
  aoAlterarClasses: () => void
  aoRecalcular: () => void
}

export function ListaDeRestricoes({
  areas,
  classes,
  calculando,
  aoRedesenhar,
  aoRemover,
  aoNovaRestricao,
  aoAlterarClasses,
  aoRecalcular,
}: Props) {
  return (
    <>
      <section className="lista-restricoes" aria-label="Áreas proibidas">
        <h2 className="rotulo">Áreas proibidas ({areas.length})</h2>
        {areas.length === 0 && (
          <p className="dica">Nenhuma área declarada nesta consulta.</p>
        )}
        <ul>
          {areas.map((area) => (
            <li key={area.id} className="quadro">
              <strong>{area.rotulo}</strong>
              <span className="dica">
                desenhada · {formatarArea(area.areaProibidaM2)} proibidos
              </span>
              <div className="linha-botoes">
                <button
                  type="button"
                  className="botao"
                  onClick={() => aoRedesenhar(area.id)}
                >
                  Redesenhar
                </button>
                <button
                  type="button"
                  className="botao"
                  aria-label={`Remover ${area.rotulo}`}
                  onClick={() => aoRemover(area.id)}
                >
                  Remover
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="lista-restricoes" aria-label="Classes de via">
        <h2 className="rotulo">Classes de via</h2>
        {classes.length === 0 ? (
          <p className="dica">Nenhuma classe de via evitada.</p>
        ) : (
          <ul className="quadro">
            {classes.map((c) => (
              <li key={c.id} className="linha-informacoes">
                <span>{c.nome}</span>
                <strong>{c.rotuloDoNivel.toLowerCase()}</strong>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="botao" onClick={aoAlterarClasses}>
          Alterar classes de via
        </button>
      </section>
      <p className="faixa-dica">
        As restrições valem só nesta página, sem cadastro. Recarregar ou fechar
        a página apaga tudo.
      </p>
      <div className="linha-botoes">
        <button type="button" className="botao" onClick={aoNovaRestricao}>
          + Restrição
        </button>
        <button
          type="button"
          className="botao-principal"
          disabled={calculando}
          onClick={aoRecalcular}
        >
          {calculando ? 'Calculando…' : 'Recalcular rota'}
        </button>
      </div>
    </>
  )
}
