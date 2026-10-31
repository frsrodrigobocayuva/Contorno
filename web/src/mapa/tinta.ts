// Paleta do mapa (plano, 2026-10-30): o branco dos tiles do OSM vira o fundo areia, as linhas
// cinza viram #BFAF8F e o texto fica num marrom quase preto, legível sobre o fundo. Cada pixel é
// trocado pela cor da paleta na mesma claridade; a rota é desenhada por cima e não passa por aqui.

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

// Troca, no lugar, cada pixel RGBA pela cor da paleta na sua claridade; a transparência fica.
export function tingir(pixels: Uint8ClampedArray, cores: Uint8ClampedArray) {
  for (let i = 0; i < pixels.length; i += 4) {
    const claridade = Math.round(
      0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2],
    )
    pixels[i] = cores[claridade * 3]
    pixels[i + 1] = cores[claridade * 3 + 1]
    pixels[i + 2] = cores[claridade * 3 + 2]
  }
}
