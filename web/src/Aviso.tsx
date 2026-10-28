import type { ReactNode } from 'react'

// Avisos da tela 13 do protótipo: o que aconteceu e o que dá para fazer.
export function Aviso({
  titulo,
  children,
  acao,
}: {
  titulo: string
  children: ReactNode
  acao?: ReactNode
}) {
  return (
    <div className="aviso" role="status">
      <strong>{titulo}</strong>
      <p>{children}</p>
      {acao}
    </div>
  )
}
