// Diagnóstico (telas 11 e 12; UC05): por que não há rota e quais áreas. Só informa: quem remove ou
// redesenha a área é o usuário, na lista de restrições (plano, S5-03). Os textos são os das telas
// (canvas v26) e dizem o que a busca mede: tirar uma área por vez. Com uma área só, no singular.
import type { AreaDeclarada } from '../restricoes/areas'

export type CausaDasAreas = 'RESTRICAO_UNICA' | 'COMBINACAO_DE_RESTRICOES'

interface Props {
  causa: CausaDasAreas
  // As áreas apontadas, na ordem em que o servidor as devolveu.
  areas: AreaDeclarada[]
  aoMudarDestino: () => void
  aoEditarRestricoes: () => void
}

function textos(causa: CausaDasAreas, quantas: number) {
  const titulo = 'Não há rota que respeite todas as áreas'
  if (causa === 'COMBINACAO_DE_RESTRICOES')
    return {
      titulo,
      texto:
        'O destino é alcançável sem restrições. Tirar uma área só não abre caminho. As áreas envolvidas:',
      saida: 'Para seguir, remova ou redesenhe mais de uma.',
    }
  if (quantas === 1)
    return {
      titulo,
      texto:
        'O destino é alcançável sem a restrição em vermelho. Tirar esta área abre caminho:',
      saida: 'Para seguir, remova ou redesenhe essa área.',
    }
  return {
    titulo,
    texto:
      'O destino é alcançável sem as restrições em vermelho. Tirar qualquer uma destas áreas abre caminho:',
    saida: 'Para seguir, remova ou redesenhe uma delas.',
  }
}

export function PainelDoDiagnostico({
  causa,
  areas,
  aoMudarDestino,
  aoEditarRestricoes,
}: Props) {
  const { titulo, texto, saida } = textos(causa, areas.length)
  return (
    <section className="diagnostico" aria-labelledby="titulo-do-diagnostico">
      <div className="diagnostico-cabecalho">
        <h2 id="titulo-do-diagnostico">{titulo}</h2>
        <p>{texto}</p>
      </div>
      <ul aria-label="Áreas apontadas">
        {areas.map((area) => (
          <li key={area.id}>
            <span>
              <strong>{area.rotulo}</strong> · área proibida
            </span>
          </li>
        ))}
      </ul>
      <p className="dica">{saida}</p>
      <div className="linha-botoes rodape-fixo">
        <button type="button" className="botao" onClick={aoMudarDestino}>
          Mudar o destino
        </button>
        <button
          type="button"
          className="botao-principal"
          onClick={aoEditarRestricoes}
        >
          Editar restrições
        </button>
      </div>
    </section>
  )
}
