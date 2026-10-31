// Tempo, distância e área como o painel mostra: "13 min · 12,8 km", "+6 min · +1,8 km", "0,91 km²".

export function formatarDuracao(segundos: number): string {
  const minutos = Math.round(segundos / 60)
  if (minutos < 60) return `${minutos} min`
  const horas = Math.floor(minutos / 60)
  const resto = minutos % 60
  return resto
    ? `${horas} h ${String(resto).padStart(2, '0')} min`
    : `${horas} h`
}

export function formatarDistancia(metros: number): string {
  if (metros < 1000) return `${Math.round(metros)} m`
  const km = (metros / 1000).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
  return `${km} km`
}

// O custo da restrição contra a irrestrita (RN02), sempre com sinal.
export function formatarCusto(segundos: number, metros: number): string {
  const minutos = Math.round(segundos / 60)
  const sinal = (n: number) => (n < 0 ? '−' : '+')
  return `${sinal(minutos)}${formatarDuracao(Math.abs(minutos) * 60)} · ${sinal(metros)}${formatarDistancia(Math.abs(metros))}`
}

export function formatarArea(metrosQuadrados: number): string {
  const km2 = (metrosQuadrados / 1_000_000).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `${km2} km²`
}
