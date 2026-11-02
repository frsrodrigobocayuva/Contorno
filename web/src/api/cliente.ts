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
export type RespostaArea = Esquemas['RespostaArea']
export type RestricaoArea = Esquemas['RestricaoArea']
export type RestricaoVia = Esquemas['RestricaoVia']
export type ClasseDeVia = Esquemas['ClasseDeVia']
export type NivelDeEvitacao = Esquemas['NivelDeEvitacao']
export type Contorno = Esquemas['MultiPoligonoGeoJSON']

// Validação: campo e motivo; área com extremo dentro (AREA_CONTEM_EXTREMO): área e extremo.
export interface DetalheDeErro {
  campo?: string
  motivo?: string
  area?: string
  extremo?: string
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

// A sessão da medição [4] do DAS 8 (S5-05): sorteada a cada abertura da página, só na memória, e
// mandada em cada pedido para o log separar as sessões. Recarregar começa outra, como as restrições.
export const SESSAO = crypto.randomUUID()

async function pedir<T>(caminho: string, opcoes?: RequestInit): Promise<T> {
  let resposta: Response
  try {
    resposta = await fetch(caminho, {
      ...opcoes,
      headers: {
        ...(opcoes?.headers as Record<string, string> | undefined),
        'X-Sessao': SESSAO,
      },
    })
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
  restricoes: (RestricaoArea | RestricaoVia)[] = [],
): Promise<RespostaCalculo> {
  return pedir('/rotas/calculo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origem, destino, restricoes }),
  })
}

// UC02: o desenho vira a área proibida, com as células, o contorno e os conflitos.
// O desenho do usuário ou o raio sobre um ponto, um dos dois (UC02 e alternativo A).
export type FormaDaArea =
  | { poligono: Coordenadas[] }
  | { raio: { centro: Coordenadas; metros: number } }

export function definirArea(
  forma: FormaDaArea,
  origem?: Coordenadas,
  destino?: Coordenadas,
): Promise<RespostaArea> {
  return pedir('/restricoes/area', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...forma, origem, destino }),
  })
}

export function buscarEnderecos(texto: string): Promise<RespostaEnderecos> {
  return pedir(`/enderecos?q=${encodeURIComponent(texto)}`)
}
