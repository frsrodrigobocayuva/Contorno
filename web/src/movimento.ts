// Movimento (vault, Contorno-Animacoes; pedido do usuário, 2026-11-02): as durações, o respeito ao
// movimento reduzido do sistema e as peças das animações feitas em código (as de CSS ficam no
// index.css). Com movimento reduzido, tudo vai direto ao estado final.
import { useEffect, useState } from 'react'
import type { Coordenadas } from './api/cliente'

export const DURACAO = {
  // Quanto a janela de cancelar e os itens removidos levam para sair (P6, P8).
  saida: 200,
  // A câmera deslizando até a rota (M4).
  camera: 500,
  // A rota sendo desenhada de A até B (M3).
  rota: 600,
  // Áreas e nomes entrando e saindo do mapa (M5, M9).
  area: 300,
  // O pulso do vermelho das áreas apontadas (M6).
  pulso: 700,
  // Os números do custo contando até o valor (R2).
  contagem: 400,
  // Um ciclo do brilho da rota restrita (M1).
  brilho: 2500,
  // A faixa clara que corre pela restrita (M1b): o meio dela vai de A a B em 0,9 s, sem pausa.
  varredura: 900,
  // O painel lateral deslizando por cima do mapa, no computador: ao começar e ao voltar.
  painelEntra: 220,
  painelSai: 180,
}

// A faixa clara da varredura (M1b; pedido do usuário, 2026-11-02): um branco quente, para não
// destoar do fundo areia, mais forte no meio e suave nas pontas.
const CLARO = 'rgba(255, 248, 230, 0.85)'
const MEIO_CLARO = 'rgba(255, 248, 230, 0.4)'
const SEM_COR = 'rgba(255, 248, 230, 0)'

// A faixa ocupa um quarto da linha: metade dela para cada lado do meio.
const MEIA_FAIXA = 0.125

// Onde está o meio da faixa, `ms` depois de a linha terminar de ser desenhada: ela entra por A, sai
// por B e recomeça em A sem pausa, sempre na mesma velocidade (escolha do usuário, 2026-11-02).
export function posicaoDaVarredura(ms: number, meiaFaixa = MEIA_FAIXA): number {
  const ciclo = DURACAO.varredura * (1 + 2 * meiaFaixa)
  return -meiaFaixa + (((ms % ciclo) + ciclo) % ciclo) / DURACAO.varredura
}

// As paradas do degradê da varredura ao longo da linha (`line-progress`, de 0 a 1): sem cor, meio
// claro, claro em `posicao`, meio claro e sem cor de novo. Fora de 0 a 1, a linha fica sem faixa.
// As paradas saem em ordem crescente e sem repetir, como o MapLibre exige.
export function degradeDaVarredura(
  posicao: number,
  meiaFaixa = MEIA_FAIXA,
): (number | string)[] {
  const pontos: [number, string][] = [
    [0, SEM_COR],
    [posicao - meiaFaixa, SEM_COR],
    [posicao - meiaFaixa / 2, MEIO_CLARO],
    [posicao, CLARO],
    [posicao + meiaFaixa / 2, MEIO_CLARO],
    [posicao + meiaFaixa, SEM_COR],
    [1, SEM_COR],
  ]
  const saida: (number | string)[] = []
  let anterior = -1
  for (const [lugar, cor] of pontos) {
    const dentro = Math.min(1, Math.max(0, lugar))
    if (dentro <= anterior) continue
    saida.push(dentro, cor)
    anterior = dentro
  }
  return saida
}

export function movimentoReduzido(): boolean {
  return (
    typeof window.matchMedia !== 'function' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

// Chama `aoQuadro` com o progresso de 0 a 1 (desacelerando no fim) e `aoTerminar` no fim. Devolve
// como concluir antes da hora: salta para o fim, para nada ficar pela metade quando chega uma
// mudança nova. Com movimento reduzido, vai direto ao fim.
export function animar(
  duracaoMs: number,
  aoQuadro: (progresso: number) => void,
  aoTerminar?: () => void,
): () => void {
  let terminou = false
  const terminar = () => {
    if (terminou) return
    terminou = true
    aoQuadro(1)
    aoTerminar?.()
  }
  if (movimentoReduzido()) {
    terminar()
    return () => {}
  }
  const inicio = performance.now()
  let quadro = 0
  const passo = (agora: number) => {
    if (terminou) return
    const t = Math.min(1, (agora - inicio) / duracaoMs)
    if (t >= 1) {
      terminar()
      return
    }
    aoQuadro(1 - (1 - t) ** 3)
    quadro = requestAnimationFrame(passo)
  }
  quadro = requestAnimationFrame(passo)
  return () => {
    cancelAnimationFrame(quadro)
    terminar()
  }
}

// O começo da linha até a fração pedida do comprimento (M3). As distâncias são planas, com a
// longitude encurtada pela latitude: para desenhar, basta.
export function trechoAte(
  coordenadas: Coordenadas[],
  fracao: number,
): Coordenadas[] {
  if (fracao >= 1 || coordenadas.length < 2) return coordenadas
  const encurta = Math.cos((coordenadas[0][1] * Math.PI) / 180)
  const trechos = coordenadas.slice(1).map((c, i) => {
    const [x0, y0] = coordenadas[i]
    return Math.hypot((c[0] - x0) * encurta, c[1] - y0)
  })
  let falta = trechos.reduce((a, b) => a + b, 0) * Math.max(0, fracao)
  const saida: Coordenadas[] = [coordenadas[0]]
  for (let i = 0; i < trechos.length; i++) {
    const [x0, y0] = coordenadas[i]
    const [x1, y1] = coordenadas[i + 1]
    if (falta >= trechos[i]) {
      saida.push(coordenadas[i + 1])
      falta -= trechos[i]
      if (falta <= 1e-12) break
      continue
    }
    const parte = trechos[i] > 0 ? falta / trechos[i] : 0
    saida.push([x0 + (x1 - x0) * parte, y0 + (y1 - y0) * parte])
    break
  }
  return saida
}

// Um número que conta de 0 até o alvo quando o alvo muda (R2). Com movimento reduzido, é o alvo.
export function useContagem(alvo: number): number {
  const [valor, setValor] = useState(0)
  const reduzido = movimentoReduzido()
  useEffect(() => {
    if (reduzido) return
    return animar(DURACAO.contagem, (p) => setValor(alvo * p))
  }, [alvo, reduzido])
  return reduzido ? alvo : valor
}
