// Confirmar cancelar (tela 16): com uma rota calculada, o Esc e o duplo clique no mapa perguntam
// antes de apagar a consulta; o botão "Cancelar rota" cancela direto (pedido do usuário, S5-04).
import { useEffect, useRef } from 'react'

interface Props {
  // Saindo: a janela some com fade antes de fechar (P8).
  saindo?: boolean
  aoContinuar: () => void
  aoCancelar: () => void
}

export function ConfirmarCancelar({
  saindo = false,
  aoContinuar,
  aoCancelar,
}: Props) {
  const continuar = useRef<HTMLButtonElement>(null)

  // O foco vai para a opção que não perde nada; o Esc fecha a janela (App).
  useEffect(() => {
    continuar.current?.focus()
  }, [])

  return (
    <div
      className={saindo ? 'fundo-escuro saindo' : 'fundo-escuro'}
      onClick={(evento) => {
        if (evento.target === evento.currentTarget) aoContinuar()
      }}
    >
      <div
        className="janela"
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-cancelar"
      >
        <h2 id="titulo-cancelar">Cancelar a rota?</h2>
        <p>
          Você perde a rota e as restrições desta consulta: as áreas e as
          classes de via.
        </p>
        <div className="linha-botoes">
          <button type="button" className="botao" onClick={aoCancelar}>
            Cancelar rota
          </button>
          <button
            ref={continuar}
            type="button"
            className="botao-principal"
            onClick={aoContinuar}
          >
            Continuar aqui
          </button>
        </div>
      </div>
    </div>
  )
}
