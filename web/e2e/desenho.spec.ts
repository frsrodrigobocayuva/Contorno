// O desenho da área com o Terra Draw de verdade (teste do usuário, 2026-11-01): o ponto fora da
// região atendida é recusado na hora, e o desenho continua aberto; e, com o desenho já fechado,
// desfazer tira o último ponto.
import { expect, test, type Page } from '@playwright/test'
import { buscar } from './comum.js'

async function ateODesenho(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Começar' }).click()
  await buscar(page, 'Origem', 'UNISINOS')
  await buscar(page, 'Destino', 'Avenida Pedro Adams Filho, Novo Hamburgo')
  await page.getByRole('button', { name: 'Calcular rota' }).click()
  await expect(page.getByText('nenhuma restrição')).toBeVisible()
  await page.getByRole('button', { name: 'Desenhar área' }).click()
  await expect(page.getByText('Desenhar área proibida')).toBeVisible()
  const mapa = await page.getByRole('region', { name: 'Mapa' }).boundingBox()
  if (!mapa) throw new Error('mapa sem caixa')
  return mapa
}

async function tocar(page: Page, x: number, y: number) {
  await page.mouse.click(x, y)
  await page.waitForTimeout(250)
}

test('ponto fora da região é recusado, e o desenho continua', async ({
  page,
}) => {
  const mapa = await ateODesenho(page)
  // Afastado ao máximo, o mapa mostra a região com a folga em volta: o canto fica fora dela.
  for (let i = 0; i < 6; i++) {
    await page.getByRole('button', { name: 'Zoom out' }).click()
    await page.waitForTimeout(300)
  }
  const meio = { x: mapa.x + mapa.width / 2, y: mapa.y + mapa.height / 2 }

  await tocar(page, meio.x - 60, meio.y - 40)
  await tocar(page, meio.x + 60, meio.y - 40)
  await expect(page.getByText('2 pontos marcados')).toBeVisible()

  await tocar(page, mapa.x + 12, mapa.y + 12)
  await expect(page.getByText(/Esse ponto fica fora/)).toBeVisible()
  await expect(page.getByText('2 pontos marcados')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Desfazer ponto' }),
  ).toBeEnabled()

  await tocar(page, meio.x, meio.y + 50)
  await expect(page.getByText('3 pontos marcados')).toBeVisible()
  await expect(page.getByText(/Esse ponto fica fora/)).toBeHidden()
  await page.getByRole('button', { name: 'Concluir área' }).click()
  await expect(page.getByText('Confira a área proibida')).toBeVisible()
})

test('com o desenho fechado, desfazer tira o último ponto', async ({
  page,
}) => {
  const mapa = await ateODesenho(page)
  const meio = { x: mapa.x + mapa.width / 2, y: mapa.y + mapa.height / 2 }
  const cantos = [
    [-60, -60],
    [60, -60],
    [60, 60],
    [-60, 60],
  ]
  for (const [dx, dy] of cantos) await tocar(page, meio.x + dx, meio.y + dy)
  // Tocar de novo no primeiro ponto fecha o desenho e leva à conferência.
  await tocar(page, meio.x + cantos[0][0], meio.y + cantos[0][1])
  await expect(page.getByText('Confira a área proibida')).toBeVisible()

  // Ajustar traz o desenho fechado de volta: o histórico do editor acabou, mas desfazer funciona.
  await page.getByRole('button', { name: 'Ajustar' }).click()
  await expect(page.getByText('4 pontos marcados')).toBeVisible()
  await page.getByRole('button', { name: 'Desfazer ponto' }).click()
  await expect(page.getByText('3 pontos marcados')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Desfazer ponto' }),
  ).toBeDisabled()
  await page.getByRole('button', { name: 'Concluir área' }).click()
  await expect(page.getByText('Confira a área proibida')).toBeVisible()
})
