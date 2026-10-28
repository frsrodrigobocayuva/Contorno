// Tempo e distância como o painel mostra: "13 min · 12,8 km".

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
