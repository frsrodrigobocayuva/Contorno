// Cliente da API (DAS 7.2): o único caminho do front até o servidor, tipado pelo contrato
// gerado do OpenAPI (schema.ts).
import type { components } from './schema'

type Esquemas = components['schemas']

export type Coordenadas = [number, number]
export type Rota = Esquemas['RotaDTO']
export type RespostaCalculo =
  Esquemas['RespostaRotas'] | Esquemas['RespostaDiagnostico']
export type RespostaEnderecos = Esquemas['RespostaEnderecos']
export type Lugar = Esquemas['LugarDTO']

export interface DetalheDeErro {
  campo: string
  motivo: string
}

// Erro no formato único da API (DAS 6.9); REDE quando a resposta nem chegou.
export class ErroDaApi extends Error {
  readonly status: number
  readonly codigo: string
  readonly detalhes: DetalheDeErro[]

  constructor(status: number, codigo: string, detalhes: DetalheDeErro[] = []) {
    super(codigo)
    this.status = status
    this.codigo = codigo
    this.detalhes = detalhes
  }

  temMotivo(motivo: string): boolean {
    return this.detalhes.some((d) => d.motivo === motivo)
  }
}

async function pedir<T>(caminho: string, opcoes?: RequestInit): Promise<T> {
  let resposta: Response
  try {
    resposta = await fetch(caminho, opcoes)
  } catch {
    throw new ErroDaApi(0, 'REDE')
  }
  if (!resposta.ok) {
    const corpo = (await resposta.json().catch(() => null)) as Partial<
      Esquemas['Erro']
    > | null
    throw new ErroDaApi(
      resposta.status,
      corpo?.codigo ?? 'ERRO',
      (corpo?.detalhes as DetalheDeErro[] | null | undefined) ?? [],
    )
  }
  return (await resposta.json()) as T
}

export function calcularRota(
  origem: Coordenadas,
  destino: Coordenadas,
): Promise<RespostaCalculo> {
  return pedir('/rotas/calculo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origem, destino, restricoes: [] }),
  })
}

export function buscarEnderecos(texto: string): Promise<RespostaEnderecos> {
  return pedir(`/enderecos?q=${encodeURIComponent(texto)}`)
}
