// Paleta do mapa (plano, 2026-10-30): o branco do mapa do OSM vira o fundo areia, as linhas
// cinza viram #BFAF8F e o texto fica num marrom quase preto, legível sobre o fundo. Cada cor é
// trocada pela cor da paleta na mesma claridade. Até a Sprint 5 isso era feito pixel a pixel nos
// tiles raster; com o mapa vetorial (#107), é feito uma vez, nas cores do estilo (estilo.ts).

type Parada = readonly [claridade: number, cor: string]

export const PARADAS: readonly Parada[] = [
  [0, '#1F1A12'],
  [120, '#5E5240'],
  [190, '#BFAF8F'],
  [232, '#EDD8AF'],
  [255, '#EDD8AF'],
]

function rgb(cor: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(cor.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ]
}

// Para cada claridade de 0 a 255, a cor da paleta (r, g, b), interpolada entre as paradas.
export function tabela(
  paradas: readonly Parada[] = PARADAS,
): Uint8ClampedArray {
  const cores = new Uint8ClampedArray(256 * 3)
  for (let claridade = 0; claridade < 256; claridade++) {
    const fim = paradas.findIndex(([c]) => c >= claridade)
    const [c1, cor1] = paradas[Math.max(fim - 1, 0)]
    const [c2, cor2] = paradas[fim]
    const t = c2 === c1 ? 0 : (claridade - c1) / (c2 - c1)
    const [a, b] = [rgb(cor1), rgb(cor2)]
    for (let canal = 0; canal < 3; canal++) {
      cores[claridade * 3 + canal] = Math.round(
        a[canal] + (b[canal] - a[canal]) * t,
      )
    }
  }
  return cores
}

const CORES = tabela()

// A cor da paleta na claridade da cor pedida (#RRGGBB), em maiúsculas.
export function naPaleta(cor: string, cores: Uint8ClampedArray = CORES) {
  const [r, g, b] = rgb(cor)
  const claridade = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)
  const canais = Array.from(cores.slice(claridade * 3, claridade * 3 + 3))
  return `#${canais.map((c) => c.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}
