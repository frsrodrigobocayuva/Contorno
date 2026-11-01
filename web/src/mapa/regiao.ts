// Retângulo de São Leopoldo + Novo Hamburgo (plano, D10): o mesmo do servidor (AREA_BBOX).
import type { Coordenadas } from '../api/cliente'

export const REGIAO: [Coordenadas, Coordenadas] = [
  [-51.2100287, -29.8302389],
  [-50.9341246, -29.6377057],
]

export function naRegiao([longitude, latitude]: Coordenadas): boolean {
  const [[minLon, minLat], [maxLon, maxLat]] = REGIAO
  return (
    longitude >= minLon &&
    longitude <= maxLon &&
    latitude >= minLat &&
    latitude <= maxLat
  )
}
