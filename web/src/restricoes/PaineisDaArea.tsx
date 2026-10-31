// Os painéis do UC02 (protótipo do MVP): desenhar (tela 04), conferir o contorno das células (tela 05)
// e o conflito com a origem ou o destino (tela 10; UC02, exceção B).
import type { Coordenadas, RespostaArea } from '../api/cliente'
import { Aviso } from '../Aviso'
import { formatarArea } from '../formato'
import { areaDoDesenho, diferencaPercentual } from './areas'

interface PainelDoDesenhoProps {
  vertices: Coordenadas[]
  podeDesfazer: boolean
  conferindo: boolean
  erro: string | null
  aoDesfazer: () => void
  aoConcluir: () => void
}

export function PainelDoDesenho({
  vertices,
  podeDesfazer,
  conferindo,
  erro,
  aoDesfazer,
  aoConcluir,
}: PainelDoDesenhoProps) {
  const pontos = vertices.length
  return (
    <>
      {erro && <Aviso titulo="Não deu para usar este desenho">{erro}</Aviso>}
      <div className="linha-informacoes">
        <span>
          {pontos === 1 ? '1 ponto marcado' : `${pontos} pontos marcados`}
        </span>
        {pontos >= 3 && (
          <span>área desenhada: {formatarArea(areaDoDesenho(vertices))}</span>
        )}
      </div>
      <div className="linha-botoes">
        <button
          type="button"
          className="botao"
          disabled={!podeDesfazer || conferindo}
          onClick={aoDesfazer}
        >
          Desfazer ponto
        </button>
        <button
          type="button"
          className="botao-principal"
          disabled={pontos < 3 || conferindo}
          onClick={aoConcluir}
        >
          {conferindo ? 'Conferindo…' : 'Concluir área'}
        </button>
      </div>
    </>
  )
}

interface PainelDaConferenciaProps {
  resposta: RespostaArea
  nome: string
  rotuloSemNome: string
  calculando: boolean
  aoMudarNome: (nome: string) => void
  aoAjustar: () => void
  aoConfirmar: () => void
  aoMudarPonto: () => void
}

export function PainelDaConferencia({
  resposta,
  nome,
  rotuloSemNome,
  calculando,
  aoMudarNome,
  aoAjustar,
  aoConfirmar,
  aoMudarPonto,
}: PainelDaConferenciaProps) {
  if (resposta.conflitos.length) {
    const ponto = resposta.conflitos.includes('ORIGEM')
      ? resposta.conflitos.includes('DESTINO')
        ? 'a origem e o destino'
        : 'a origem'
      : 'o destino'
    return (
      <Aviso
        titulo={`A área cobre ${ponto}`}
        acao={
          <div className="linha-botoes">
            <button type="button" className="botao" onClick={aoMudarPonto}>
              Mudar o ponto
            </button>
            <button type="button" className="botao" onClick={aoAjustar}>
              Ajustar a área
            </button>
          </div>
        }
      >
        A rota não pode sair nem chegar dentro de uma área proibida. Ajuste a
        área para deixar {ponto} de fora, ou mude o ponto. Enquanto isso, a área
        não é aplicada.
      </Aviso>
    )
  }

  const diferenca = diferencaPercentual(
    resposta.areaDesenhadaM2,
    resposta.areaProibidaM2,
  )
  return (
    <>
      <div className="campo">
        <label htmlFor="nome-da-area">Nome da área (opcional)</label>
        <input
          id="nome-da-area"
          type="text"
          value={nome}
          placeholder={rotuloSemNome}
          maxLength={80}
          onChange={(evento) => aoMudarNome(evento.target.value)}
        />
      </div>
      <div className="quadro">
        <div className="linha-informacoes">
          <span>
            Desenho: <strong>{formatarArea(resposta.areaDesenhadaM2)}</strong>
          </span>
          <span>
            Proibido: <strong>{formatarArea(resposta.areaProibidaM2)}</strong>
          </span>
        </div>
        <p>
          A área proibida ficou <strong>{diferenca}% maior</strong> que o
          desenho. A rota vai evitar o contorno serrilhado, que cobre todo o seu
          desenho.
        </p>
      </div>
      <div className="linha-botoes">
        <button type="button" className="botao" onClick={aoAjustar}>
          Ajustar
        </button>
        <button
          type="button"
          className="botao-principal"
          disabled={calculando}
          onClick={aoConfirmar}
        >
          {calculando ? 'Calculando…' : 'Confirmar e recalcular'}
        </button>
      </div>
    </>
  )
}
