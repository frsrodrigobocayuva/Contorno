// Raio a partir de endereço (S5-04; UC02, alternativo A; tela 08): o centro pela busca, a
// distância no controle deslizante, a conferência do círculo e a rota que o evita.
import { expect, test } from '@playwright/test'
import { buscar } from './comum.js'

test('um raio de 1 km em volta de um endereço vira área e entra na rota', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Começar' }).click()
  await buscar(page, 'Origem', 'UNISINOS')
  await buscar(page, 'Destino', 'Avenida Pedro Adams Filho, Novo Hamburgo')
  await page.getByRole('button', { name: 'Calcular rota' }).click()
  await expect(page.getByText('nenhuma restrição')).toBeVisible()

  await page.getByRole('button', { name: /Raio a partir de endereço/ }).click()
  await expect(page.getByText('Raio a partir de endereço')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Gerar área' })).toBeDisabled()

  // O mesmo campo de busca de A e B, com as buscas gravadas nos falsos do Nominatim.
  const entrada = page.getByRole('textbox', { name: 'Endereço do centro' })
  await entrada.fill('Rua Independência, São Leopoldo')
  await page
    .locator('form', { has: entrada })
    .getByRole('button', { name: 'Buscar' })
    .click()
  await page
    .getByRole('list', { name: 'Resultados para endereço do centro' })
    .getByRole('button')
    .first()
    .click()
  await expect(page.locator('.marcador-centro')).toHaveCount(1)

  await page.getByLabel(/Distância/).fill('1000')
  await expect(page.getByText('1,0 km')).toBeVisible()
  await page.getByRole('button', { name: 'Gerar área' }).click()

  // A conferência do círculo: área desenhada perto de pi km², e o contorno das células maior.
  await expect(page.getByText('Confira a área proibida')).toBeVisible()
  await expect(page.getByText(/Desenho: 3,1\d km²/)).toBeVisible()
  await expect(page.getByLabel('Nome da área (opcional)')).toHaveAttribute(
    'placeholder',
    'Raio 1',
  )
  await page.getByRole('button', { name: 'Confirmar e recalcular' }).click()

  await expect(page.getByText('1 restrição aplicada')).toBeVisible()
  await page.getByRole('button', { name: /Ver restrições/ }).click()
  await expect(page.getByText('Raio 1')).toBeVisible()
  await expect(page.getByText(/raio de 1,0 km/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ajustar raio' })).toBeVisible()
})
