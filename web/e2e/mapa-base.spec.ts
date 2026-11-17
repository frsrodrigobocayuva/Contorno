// Mapa base vetorial (#107, ADR-016): o estilo próprio desenha o fundo areia da paleta e mostra a
// atribuição, e os tiles raster do OSM não são mais pedidos. No CI os tiles do OpenFreeMap ficam
// bloqueados (bloquear-osm.sh): sobram o fundo do estilo e a atribuição do OSM, que cobre também os
// dados do motor e da busca. Com os tiles, aparece também o crédito do OpenFreeMap.
import { expect, test, type Page } from '@playwright/test'

// Quantos pixels de um recorte de 200 x 200 px estão na cor do fundo (#EDD8AF). Conta no próprio
// navegador, sem montar a lista de pontos: no mapa inteiro, o pixels() de comum.ts leva ~40 s.
async function areiaNoRecorte(page: Page, x: number, y: number) {
  const base64 = (
    await page.screenshot({ clip: { x, y, width: 200, height: 200 } })
  ).toString('base64')
  return page.evaluate(async (base64) => {
    const imagem = new Image()
    imagem.src = `data:image/png;base64,${base64}`
    await imagem.decode()
    const tela = document.createElement('canvas')
    tela.width = imagem.width
    tela.height = imagem.height
    const contexto = tela.getContext('2d')
    if (!contexto) return 0
    contexto.drawImage(imagem, 0, 0)
    const { data } = contexto.getImageData(0, 0, tela.width, tela.height)
    let total = 0
    for (let i = 0; i < data.length; i += 4) {
      const perto = [0xed, 0xd8, 0xaf].every(
        (cor, c) => Math.abs(data[i + c] - cor) <= 6,
      )
      if (perto) total++
    }
    return total
  }, base64)
}

test('o mapa base vetorial desenha o fundo areia, com a atribuição', async ({
  page,
}) => {
  const raster: string[] = []
  page.on('request', (pedido) => {
    if (pedido.url().includes('tile.openstreetmap.org'))
      raster.push(pedido.url())
  })

  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Começar' })).toBeVisible()

  // Um recorte da área rural a leste, longe dos botões: quase todo no fundo areia.
  await expect
    .poll(() => areiaNoRecorte(page, 900, 380), { timeout: 15_000 })
    .toBeGreaterThan(20_000)
  await expect(page.getByText('© OpenStreetMap contributors')).toBeVisible()
  expect(raster).toEqual([])
})
