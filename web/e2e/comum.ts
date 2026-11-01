// O que os cenários ponta a ponta usam em comum.
import type { Page } from '@playwright/test'

// As buscas gravadas nos falsos do Nominatim: no CI, a API fala com eles.
export async function buscar(
  page: Page,
  campo: 'Origem' | 'Destino',
  texto: string,
) {
  const entrada = page.getByRole('textbox', { name: campo, exact: true })
  const formulario = page.locator('form', { has: entrada })
  await entrada.fill(texto)
  await formulario.getByRole('button', { name: 'Buscar' }).click()
  await page
    .getByRole('list', { name: `Resultados para ${campo.toLowerCase()}` })
    .getByRole('button')
    .first()
    .click()
}

export type Cor = [number, number, number]
// Os pixels do mapa com a cor pedida, em coordenadas da página. A captura é lida no próprio
// navegador, sem biblioteca de imagem.
export async function pixels(page: Page, cor: Cor) {
  const mapa = page.getByRole('region', { name: 'Mapa' })
  const caixa = await mapa.boundingBox()
  if (!caixa) throw new Error('mapa sem caixa')
  const base64 = (await mapa.screenshot()).toString('base64')
  const achados = await page.evaluate(
    async ({ base64, cor }) => {
      const imagem = new Image()
      imagem.src = `data:image/png;base64,${base64}`
      await imagem.decode()
      const tela = document.createElement('canvas')
      tela.width = imagem.width
      tela.height = imagem.height
      const contexto = tela.getContext('2d')
      if (!contexto) return []
      contexto.drawImage(imagem, 0, 0)
      const { data } = contexto.getImageData(0, 0, tela.width, tela.height)
      const lista: { x: number; y: number }[] = []
      for (let i = 0; i < data.length; i += 4) {
        const perto = [0, 1, 2].every(
          (c) => Math.abs(data[i + c] - cor[c]) <= 6,
        )
        if (perto) {
          lista.push({
            x: (i / 4) % tela.width,
            y: Math.floor(i / 4 / tela.width),
          })
        }
      }
      return lista
    },
    { base64, cor },
  )
  return achados.map((p) => ({ x: caixa.x + p.x, y: caixa.y + p.y }))
}
