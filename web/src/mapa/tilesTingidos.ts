// Os tiles raster do OSM, com as cores do mapa (tinta.ts). São os mesmos tiles, pedidos só para
// a tela atual (ADR-013): o protocolo baixa cada um e entrega ao MapLibre já recolorido.
import { addProtocol, type AddProtocolAction } from 'maplibre-gl'
import { tabela, tingir } from './tinta'

const ESQUEMA = 'contorno-tinta'
const CORES = tabela()
let registrado = false

// O endereço que o MapLibre pede: o do tile, precedido do esquema que o recolore.
export function tingido(url: string): string {
  return `${ESQUEMA}://${url}`
}

export const carregarTingido: AddProtocolAction = async (pedido, abortar) => {
  const url = pedido.url.slice(ESQUEMA.length + 3)
  const resposta = await fetch(url, { signal: abortar.signal })
  if (!resposta.ok) throw new Error(`Tile ${url} respondeu ${resposta.status}`)
  const imagem = await createImageBitmap(await resposta.blob())
  const tela = new OffscreenCanvas(imagem.width, imagem.height)
  const contexto = tela.getContext('2d', { willReadFrequently: true })
  if (!contexto) throw new Error('Sem contexto 2D para recolorir o tile')
  contexto.drawImage(imagem, 0, 0)
  const pixels = contexto.getImageData(0, 0, imagem.width, imagem.height)
  tingir(pixels.data, CORES)
  contexto.putImageData(pixels, 0, 0)
  return { data: tela.transferToImageBitmap() }
}

export function registrarTinta() {
  if (registrado) return
  addProtocol(ESQUEMA, carregarTingido)
  registrado = true
}
