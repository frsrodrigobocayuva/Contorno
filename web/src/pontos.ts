import type { Coordenadas } from './api/cliente'

// Origem ou destino escolhidos pela busca ou marcados por toque no mapa.
export interface Ponto {
  nome: string
  coordenadas: Coordenadas
}

export type Campo = 'origem' | 'destino'

export const PONTO_NO_MAPA = 'Ponto marcado no mapa'
