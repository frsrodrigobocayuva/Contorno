// Cenário 1 da demonstração (plano, P12; critério de sucesso 1): desenhar uma área sobre a rota e
// receber a rota restrita com o custo. O que os testes com o mapa simulado não veem, este vê: a
// linha da rota restrita desenhada no mapa, na cor de destaque (Guia de Estilo).
import { expect, test } from '@playwright/test'
import { buscar, pixels, type Cor } from './comum.js'

// As duas rotas vão na cor de destaque: a irrestrita tracejada, a restrita em linha cheia.
const DESTAQUE: Cor = [0x59, 0x49, 0x27]

test('desenhar uma área sobre a rota devolve a rota restrita com o custo', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Começar' }).click()
  await buscar(page, 'Origem', 'UNISINOS')
  await buscar(page, 'Destino', 'Avenida Pedro Adams Filho, Novo Hamburgo')
  await page.getByRole('button', { name: 'Calcular rota' }).click()
  await expect(page.getByText('nenhuma restrição')).toBeVisible()

  // A rota normal aparece no mapa: o meio dela é onde a área vai cortar.
  await expect
    .poll(async () => (await pixels(page, DESTAQUE)).length, {
      timeout: 20_000,
    })
    .toBeGreaterThan(150)
  const rota = await pixels(page, DESTAQUE)
  const meio = rota.sort((a, b) => a.y - b.y)[Math.floor(rota.length / 2)]
  const antes = rota.length

  await page.getByRole('button', { name: 'Desenhar área' }).click()
  await expect(page.getByText('Desenhar área proibida')).toBeVisible()
  for (const [dx, dy] of [
    [-35, -35],
    [35, -35],
    [35, 35],
    [-35, 35],
  ]) {
    await page.mouse.click(meio.x + dx, meio.y + dy)
    await page.waitForTimeout(250)
  }
  await expect(page.getByText('4 pontos marcados')).toBeVisible()
  await page.getByRole('button', { name: 'Concluir área' }).click()

  await expect(page.getByText('Confira a área proibida')).toBeVisible()
  await expect(page.getByText(/% maior/)).toBeVisible()
  await page.getByRole('button', { name: 'Confirmar e recalcular' }).click()

  await expect(page.getByText('Custo da restrição')).toBeVisible()
  await expect(page.getByText('1 restrição aplicada')).toBeVisible()
  // O custo tem sinal: a restrita pode sair mais curta, mas nunca mais rápida que a irrestrita.
  await expect(page.getByText(/^\+\d+ min · [+−]/)).toBeVisible()
  // A rota restrita está desenhada no mapa: em linha cheia, ela acrescenta pixels da cor de
  // destaque aos da irrestrita tracejada.
  await expect
    .poll(async () => (await pixels(page, DESTAQUE)).length, {
      timeout: 20_000,
    })
    .toBeGreaterThan(antes + 300)
})
