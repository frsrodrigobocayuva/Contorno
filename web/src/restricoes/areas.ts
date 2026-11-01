// As áreas da consulta, no estado do cliente (plano, A8): id gerado aqui, nome opcional e as
// células que o servidor devolveu no UC02, enviadas de volta a cada cálculo (Realização, UC01).
import type {
  Contorno,
  Coordenadas,
  RespostaArea,
  RestricaoArea,
} from '../api/cliente'
import type { Ponto } from '../pontos'

// A área de raio guarda o centro e a distância, para "Ajustar raio" voltar à tela 08.
export interface RaioDaArea {
  centro: Ponto
  metros: number
}

export interface AreaDeclarada {
  id: string
  rotulo: string
  desenho: Coordenadas[]
  raio?: RaioDaArea
  celulas: string[]
  contorno: Contorno
  areaDesenhadaM2: number
  areaProibidaM2: number
}

// Sem nome, a área vira "Área N", com o menor N livre (plano, A8); a de raio, "Raio N", com
// numeração própria (escolha do usuário, S5-04).
export function rotuloPadrao(
  areas: AreaDeclarada[],
  prefixo: 'Área' | 'Raio' = 'Área',
): string {
  const usados = new Set(areas.map((a) => a.rotulo))
  let n = 1
  while (usados.has(`${prefixo} ${n}`)) n++
  return `${prefixo} ${n}`
}

export function novaArea(
  id: string,
  nome: string,
  rotuloSemNome: string,
  desenho: Coordenadas[],
  resposta: RespostaArea,
  raio?: RaioDaArea,
): AreaDeclarada {
  return {
    id,
    rotulo: nome.trim() || rotuloSemNome,
    desenho,
    raio,
    celulas: resposta.celulas,
    contorno: resposta.contorno,
    areaDesenhadaM2: resposta.areaDesenhadaM2,
    areaProibidaM2: resposta.areaProibidaM2,
  }
}

export function paraRestricoes(areas: AreaDeclarada[]): RestricaoArea[] {
  return areas.map(({ id, rotulo, celulas }) => ({
    tipo: 'AREA',
    id,
    rotulo,
    celulas,
  }))
}

// Quanto a área proibida passou do desenho, em % (RN04): o erro de aproximação aparece em número.
export function diferencaPercentual(desenhadaM2: number, proibidaM2: number) {
  return desenhadaM2 > 0
    ? Math.round(((proibidaM2 - desenhadaM2) / desenhadaM2) * 100)
    : 0
}

// Área do desenho em m², enquanto ele é feito (fórmula do excesso esférico, como no GeoJSON).
const RAIO_DA_TERRA_M = 6_378_137

export function areaDoDesenho(vertices: Coordenadas[]): number {
  if (vertices.length < 3) return 0
  const rad = Math.PI / 180
  let soma = 0
  for (let i = 0; i < vertices.length; i++) {
    const [lon1, lat1] = vertices[i]
    const [lon2, lat2] = vertices[(i + 1) % vertices.length]
    soma +=
      (lon2 - lon1) * rad * (2 + Math.sin(lat1 * rad) + Math.sin(lat2 * rad))
  }
  return Math.abs((soma * RAIO_DA_TERRA_M * RAIO_DA_TERRA_M) / 2)
}

// Prévia do círculo enquanto o raio é ajustado (tela 08), num plano local em metros. A área que
// vale é a do servidor, construída na UTM 22S (Realização, UC02); a diferença não chega a 1 m.
export function circuloAproximado(
  [longitude, latitude]: Coordenadas,
  metros: number,
  lados = 64,
): Coordenadas[] {
  const porGrauDeLatitude = (Math.PI / 180) * RAIO_DA_TERRA_M
  const porGrauDeLongitude =
    porGrauDeLatitude * Math.cos((latitude * Math.PI) / 180)
  return Array.from({ length: lados }, (_, i) => {
    const angulo = (2 * Math.PI * i) / lados
    return [
      longitude + (metros * Math.cos(angulo)) / porGrauDeLongitude,
      latitude + (metros * Math.sin(angulo)) / porGrauDeLatitude,
    ]
  })
}
