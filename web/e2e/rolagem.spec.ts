// A página nunca rola: os painéis rolam por dentro, o mapa fica inteiro no lugar e a ação principal
// fica à vista no rodapé (teste do usuário, 2026-11-01; telas 07 e 09). A tela das classes de via
// é a mais longa que dá para abrir sem desenhar áreas.
import { expect, test, type Page } from '@playwright/test'
import { buscar } from './comum.js'

async function ateAsClasses(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Começar' }).click()
  await buscar(page, 'Origem', 'UNISINOS')
  await buscar(page, 'Destino', 'Avenida Pedro Adams Filho, Novo Hamburgo')
  await page.getByRole('button', { name: 'Calcular rota' }).click()
  await expect(page.getByText('nenhuma restrição')).toBeVisible()
  await page.getByRole('button', { name: /Classes de via a evitar/ }).click()
  await expect(page.getByText(/mas não garante/)).toBeVisible()
}

// No meio da rolagem, o rodapé fixo encosta na borda de baixo do painel, e o ponto logo acima
// dessa borda é do rodapé, não do conteúdo que rola por baixo (teste do usuário, 2026-11-01).
async function rodapeEncostado(page: Page) {
  await page.locator('.base').evaluate((base) => {
    base.scrollTop = (base.scrollHeight - base.clientHeight) / 2
  })
  return page.evaluate(() => {
    const base = document.querySelector('.base')!.getBoundingClientRect()
    const rodape = document.querySelector('.rodape-fixo')!
    const caixa = rodape.getBoundingClientRect()
    const embaixo = document.elementFromPoint(base.left + 20, base.bottom - 2)
    return {
      folga: Math.round(base.bottom - caixa.bottom),
      doRodape: !!embaixo && rodape.contains(embaixo),
    }
  })
}

async function medidas(page: Page) {
  return page.evaluate(() => {
    const base = document.querySelector('.base')!
    const mapa = document.querySelector('.mapa')!.getBoundingClientRect()
    return {
      pagina: document.scrollingElement!.scrollHeight,
      tela: window.innerHeight,
      baseRola: base.scrollHeight > base.clientHeight,
      mapaTopo: mapa.top,
      mapaAltura: mapa.height,
    }
  })
}

test.describe('no celular', () => {
  test.use({ viewport: { width: 390, height: 667 } })

  test('a tela das classes rola por dentro, e o mapa e a ação ficam no lugar', async ({
    page,
  }) => {
    await ateAsClasses(page)

    const m = await medidas(page)
    expect(m.pagina).toBeLessThanOrEqual(m.tela)
    expect(m.baseRola).toBe(true)
    expect(m.mapaAltura).toBeGreaterThanOrEqual(239)
    await expect(
      page.getByRole('button', { name: 'Aplicar e recalcular' }),
    ).toBeInViewport()
    expect(await rodapeEncostado(page)).toEqual({ folga: 0, doRodape: true })

    // Rolar o painel até o fim não mexe no mapa.
    await page.locator('.base').evaluate((base) => {
      base.scrollTop = base.scrollHeight
    })
    expect((await medidas(page)).mapaTopo).toBe(m.mapaTopo)
    await expect(page.getByRole('group', { name: /^Rodovia/ })).toBeInViewport()
  })
})

test.describe('no computador', () => {
  test.use({ viewport: { width: 1280, height: 560 } })

  test('o painel lateral rola por dentro, e o mapa ocupa a altura toda', async ({
    page,
  }) => {
    await ateAsClasses(page)

    const m = await medidas(page)
    expect(m.pagina).toBeLessThanOrEqual(m.tela)
    expect(m.baseRola).toBe(true)
    expect(m.mapaTopo).toBe(0)
    expect(m.mapaAltura).toBe(m.tela)
    await expect(
      page.getByRole('button', { name: 'Aplicar e recalcular' }),
    ).toBeInViewport()
    expect(await rodapeEncostado(page)).toEqual({ folga: 0, doRodape: true })
    await page.locator('.base').evaluate((base) => {
      base.scrollTop = 0
    })

    // A roda do mouse sobre o painel rola o painel, não a página.
    await page.locator('.base').hover()
    await page.mouse.wheel(0, 2000)
    await expect(page.getByRole('group', { name: /^Rodovia/ })).toBeInViewport()
    const depois = await medidas(page)
    expect(depois.mapaTopo).toBe(0)
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
  })
})
