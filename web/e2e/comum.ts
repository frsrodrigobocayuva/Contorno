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
