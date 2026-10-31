// Classes de via (tela 09; UC03): um nível por classe e o aviso da RN06. Nada vai ao servidor até
// "Aplicar e recalcular" (Realização, UC03 [1]).
import type { ClasseDeVia, NivelDeEvitacao } from '../api/cliente'
import { CLASSES, NIVEIS, type Niveis } from './classes'

interface Props {
  niveis: Niveis
  calculando: boolean
  aoMudar: (classe: ClasseDeVia, nivel: NivelDeEvitacao) => void
  aoAplicar: () => void
}

export function PainelDasClasses({
  niveis,
  calculando,
  aoMudar,
  aoAplicar,
}: Props) {
  return (
    <>
      <p className="dica">
        Escolha o quanto evitar cada tipo de via. O Contorno{' '}
        <strong>evita</strong>, mas não garante <strong>eliminar</strong>: às
        vezes um tipo de via é o único caminho até o lugar.
      </p>
      {CLASSES.map((classe) => (
        <fieldset key={classe.id} className="classe-de-via">
          <legend>
            {classe.nome}
            <small>{classe.exemplo}</small>
          </legend>
          <div className="segmentado">
            {NIVEIS.map((nivel) => (
              <label key={nivel.id}>
                <input
                  type="radio"
                  name={classe.id}
                  value={nivel.id}
                  checked={niveis[classe.id] === nivel.id}
                  onChange={() => aoMudar(classe.id, nivel.id)}
                />
                <span>{nivel.rotulo}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <p className="dica">
        Via sem pavimentação depende do que está registrado no mapa. Via sem
        registro de superfície não é penalizada.
      </p>
      <button
        type="button"
        className="botao-principal"
        disabled={calculando}
        onClick={aoAplicar}
      >
        {calculando ? 'Calculando…' : 'Aplicar e recalcular'}
      </button>
    </>
  )
}
