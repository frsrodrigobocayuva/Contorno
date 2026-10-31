import { afterEach, describe, expect, it, vi } from 'vitest'

const { addProtocol } = vi.hoisted(() => ({ addProtocol: vi.fn() }))
vi.mock('maplibre-gl', () => ({ addProtocol }))

import { carregarTingido, registrarTinta, tingido } from './tilesTingidos'

// O jsdom não tem createImageBitmap nem OffscreenCanvas: falsos de um tile de 2 pixels.
class TelaFalsa {
  static ultima: TelaFalsa
  pixels = new Uint8ClampedArray([255, 255, 255, 255, 190, 190, 190, 255])
  gravados: Uint8ClampedArray | null = null
  constructor(width: number, height: number) {
    expect([width, height]).toEqual([2, 1])
    TelaFalsa.ultima = this
  }
  getContext() {
    return {
      drawImage: vi.fn(),
      getImageData: () => ({ data: this.pixels }),
      putImageData: (imagem: { data: Uint8ClampedArray }) => {
        this.gravados = imagem.data
      },
    }
  }
  transferToImageBitmap() {
    return 'imagem recolorida'
  }
}

function falsos(status = 200) {
  const fetch = vi.fn(async () => new Response(new Blob(['png']), { status }))
  vi.stubGlobal('fetch', fetch)
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 2, height: 1 })),
  )
  vi.stubGlobal('OffscreenCanvas', TelaFalsa)
  return fetch
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('tiles tingidos', () => {
  it('registra o protocolo uma vez só', () => {
    registrarTinta()
    registrarTinta()

    expect(addProtocol).toHaveBeenCalledOnce()
    expect(addProtocol).toHaveBeenCalledWith('contorno-tinta', carregarTingido)
  })

  it('baixa o tile original e devolve a imagem recolorida', async () => {
    const fetch = falsos()
    const abortar = new AbortController()

    const resposta = await carregarTingido(
      { url: tingido('https://tile.openstreetmap.org/12/1/2.png') },
      abortar,
    )

    expect(fetch).toHaveBeenCalledWith(
      'https://tile.openstreetmap.org/12/1/2.png',
      { signal: abortar.signal },
    )
    expect(Array.from(TelaFalsa.ultima.gravados!)).toEqual([
      0xed, 0xd8, 0xaf, 255, 0xbf, 0xaf, 0x8f, 255,
    ])
    expect(resposta.data).toBe('imagem recolorida')
  })

  it('falha quando o servidor de tiles responde com erro', async () => {
    falsos(503)

    await expect(
      carregarTingido(
        { url: tingido('https://tile.openstreetmap.org/12/1/2.png') },
        new AbortController(),
      ),
    ).rejects.toThrow('respondeu 503')
  })
})
