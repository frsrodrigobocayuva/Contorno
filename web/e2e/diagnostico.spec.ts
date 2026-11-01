// Cenário 2 da demonstração (plano, P12; critério de sucesso 2): isolar o destino com áreas e ver
// o sistema apontar as áreas que bloquearam (UC05, telas 11 e 07).
//
// Uma área só não fecha o destino: o desenho não tem furo. Por isso são duas, em forma de C, uma
// aberta para leste e outra para oeste. Sozinha, cada uma deixa passar; juntas, fecham um anel em
// volta do destino. Tirar qualquer uma abre caminho, então as duas são apontadas.
import { expect, test, type Page } from '@playwright/test'
import { buscar } from './comum.js'

// Raios do C em pixels. O primeiro e o último ponto, e cada par de pontos seguidos, ficam a mais de
// 40 px um do outro, a distância em que o editor fecha o desenho sozinho.
const RAIO_DE_FORA = 100
const RAIO_DE_DENTRO = 40

// O C de `inicio` a `fim` graus (0 = leste, 90 = norte), em volta de (x, y): o arco de fora num
// sentido e o de dentro na volta.
function pontosDoC(x: number, y: number, inicio: number, fim: number) {
  const ponto = (raio: number, graus: number) => {
    const angulo = (graus * Math.PI) / 180
    return {
      x: x + raio * Math.cos(angulo),
      y: y - raio * Math.sin(angulo),
    }
  }
  const fora = []
  for (let graus = inicio; graus <= fim; graus += 40)
    fora.push(ponto(RAIO_DE_FORA, graus))
  const dentro = []
  for (let graus = fim; graus >= inicio; graus -= 80)
    dentro.push(ponto(RAIO_DE_DENTRO, graus))
  return [...fora, ...dentro]
}

async function centroDoDestino(page: Page) {
  const caixa = await page
    .locator('.marcador[aria-label="Destino"]')
    .boundingBox()
  if (!caixa) throw new Error('destino sem marcador')
  return { x: caixa.x + caixa.width / 2, y: caixa.y + caixa.height / 2 }
}

// Leva o destino para o meio do mapa, para o anel caber inteiro, e aproxima um nível: com a rota
// inteira na tela, 100 px passam de 1,8 km, e um C desse tamanho deixa cada cálculo restrito perto
// do limite de 2 s do motor. O arrasto sai de um ponto ao lado do marcador: em cima dele, o mapa
// não se move.
async function centrarNoDestino(page: Page) {
  const mapa = await page.getByRole('region', { name: 'Mapa' }).boundingBox()
  if (!mapa) throw new Error('mapa sem caixa')
  const meio = { x: mapa.x + mapa.width / 2, y: mapa.y + mapa.height / 2 }
  const destino = await centroDoDestino(page)
  await page.mouse.move(destino.x + 60, destino.y + 60)
  await page.mouse.down()
  await page.mouse.move(meio.x + 60, meio.y + 60, { steps: 10 })
  await page.mouse.up()
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await page.waitForTimeout(800)
  const centrado = await centroDoDestino(page)
  expect(Math.abs(centrado.x - meio.x)).toBeLessThan(60)
  expect(Math.abs(centrado.y - meio.y)).toBeLessThan(60)
  return centrado
}

async function desenharC(
  page: Page,
  nome: string,
  inicio: number,
  fim: number,
) {
  await page.getByRole('button', { name: 'Desenhar área' }).click()
  await expect(page.getByText('Desenhar área proibida')).toBeVisible()
  // Ao entrar no desenho, o mapa volta a enquadrar a rota: o destino é centrado só agora.
  const destino = await centrarNoDestino(page)
  const pontos = pontosDoC(destino.x, destino.y, inicio, fim)
  for (const { x, y } of pontos) {
    await page.mouse.click(x, y)
    await page.waitForTimeout(250)
  }
  await expect(page.getByText(`${pontos.length} pontos marcados`)).toBeVisible()
  await page.getByRole('button', { name: 'Concluir área' }).click()
  await expect(page.getByText('Confira a área proibida')).toBeVisible()
  await page.getByLabel('Nome da área (opcional)').fill(nome)
  await page.getByRole('button', { name: 'Confirmar e recalcular' }).click()
}

test('isolar o destino com áreas aponta as áreas que bloqueiam', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Começar' }).click()
  await buscar(page, 'Origem', 'UNISINOS')
  await buscar(page, 'Destino', 'Avenida Pedro Adams Filho, Novo Hamburgo')
  await page.getByRole('button', { name: 'Calcular rota' }).click()
  await expect(page.getByText('nenhuma restrição')).toBeVisible()

  // Aberto para leste: sozinho, deixa passar, e a rota restrita sai com o custo.
  await desenharC(page, 'Oeste', 60, 300)
  await expect(page.getByText('Custo da restrição')).toBeVisible()

  // Aberto para oeste: com o primeiro, fecha o anel.
  await page.getByRole('button', { name: '+ Restrição' }).click()
  await desenharC(page, 'Leste', 240, 480)

  await expect(
    page.getByRole('heading', {
      name: 'Não há rota que respeite todas as áreas',
    }),
  ).toBeVisible()
  const apontadas = page.getByRole('list', { name: 'Áreas apontadas' })
  await expect(apontadas.getByRole('listitem')).toHaveText([/Oeste/, /Leste/])
  // No mapa, o nome das duas.
  await expect(page.locator('.rotulo-da-area')).toHaveText(['Oeste', 'Leste'])

  // Na lista de restrições, as duas levam a etiqueta.
  await page.getByRole('button', { name: 'Editar restrições' }).click()
  await expect(page.getByText('bloqueia o trajeto')).toHaveCount(2)
})
