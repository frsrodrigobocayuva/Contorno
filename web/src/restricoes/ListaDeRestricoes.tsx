// Restrições da consulta (tela 07): cada área com redesenhar e remover. Com o diagnóstico só
// informativo, remover a área na mão é o caminho depois de um bloqueio (plano, S5-03); as áreas
// que o diagnóstico apontou levam a etiqueta "bloqueia o trajeto" até o próximo cálculo.
import { useState } from 'react'
import { formatarArea, formatarDistancia } from '../formato'
import { DURACAO, movimentoReduzido } from '../movimento'
import type { AreaDeclarada } from './areas'
import type { preferenciasAtivas } from './classes'

interface Props {
  areas: AreaDeclarada[]
  apontadas?: string[]
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
  apontadas = [],
  classes,
  calculando,
  aoRedesenhar,
  aoRemover,
  aoNovaRestricao,
  aoAlterarClasses,
  aoRecalcular,
}: Props) {
  // A área removida encolhe e some antes de sair da lista (P6).
  const [saindo, setSaindo] = useState<string[]>([])
  function remover(id: string) {
    if (movimentoReduzido()) {
      aoRemover(id)
      return
    }
    setSaindo((atuais) => [...atuais, id])
    setTimeout(() => {
      aoRemover(id)
      setSaindo((atuais) => atuais.filter((s) => s !== id))
    }, DURACAO.saida)
  }

  return (
    <>
      <section className="lista-restricoes" aria-label="Áreas proibidas">
        <h2 className="rotulo">Áreas proibidas ({areas.length})</h2>
        {areas.length === 0 && (
          <p className="dica">Nenhuma área declarada nesta consulta.</p>
        )}
        <ul>
          {areas.map((area) => (
            <li
              key={area.id}
              className={saindo.includes(area.id) ? 'quadro saindo' : 'quadro'}
            >
              <div className="linha-da-area">
                <div className="nome-da-area">
                  <strong>{area.rotulo}</strong>
                  <span className="dica">
                    {area.raio
                      ? `raio de ${formatarDistancia(area.raio.metros)}`
                      : 'desenhada'}{' '}
                    · {formatarArea(area.areaProibidaM2)} proibidos
                  </span>
                </div>
                {apontadas.includes(area.id) && (
                  <span className="etiqueta">bloqueia o trajeto</span>
                )}
              </div>
              <div className="linha-botoes">
                <button
                  type="button"
                  className="botao"
                  onClick={() => aoRedesenhar(area.id)}
                >
                  {area.raio ? 'Ajustar raio' : 'Redesenhar'}
                </button>
                <button
                  type="button"
                  className="botao"
                  aria-label={`Remover ${area.rotulo}`}
                  disabled={saindo.includes(area.id)}
                  onClick={() => remover(area.id)}
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
      <div className="linha-botoes rodape-fixo">
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
