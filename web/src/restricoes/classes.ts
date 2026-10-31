// Preferências por classe de via (UC03), no estado do cliente: um nível por classe. A tradução
// para o motor fica no servidor (Realização, UC03 [1]).
import type { ClasseDeVia, NivelDeEvitacao, RestricaoVia } from '../api/cliente'

export type Niveis = Record<ClasseDeVia, NivelDeEvitacao>

// Os nomes e exemplos da tela 09 do protótipo do MVP.
export const CLASSES: { id: ClasseDeVia; nome: string; exemplo: string }[] = [
  {
    id: 'SEM_PAVIMENTACAO',
    nome: 'Via sem pavimentação',
    exemplo: 'terra, cascalho, chão batido',
  },
  {
    id: 'RESIDENCIAL',
    nome: 'Rua residencial',
    exemplo: 'ruas internas de bairro',
  },
  {
    id: 'ARTERIAL',
    nome: 'Via arterial',
    exemplo: 'avenidas principais da cidade',
  },
  { id: 'RODOVIA', nome: 'Rodovia', exemplo: 'BR-116 e similares' },
]

export const NIVEIS: { id: NivelDeEvitacao; rotulo: string }[] = [
  { id: 'INDIFERENTE', rotulo: 'Indiferente' },
  { id: 'EVITAR', rotulo: 'Evitar' },
  { id: 'EVITAR_FORTEMENTE', rotulo: 'Evitar fortemente' },
]

export const SEM_PREFERENCIAS: Niveis = {
  SEM_PAVIMENTACAO: 'INDIFERENTE',
  RESIDENCIAL: 'INDIFERENTE',
  ARTERIAL: 'INDIFERENTE',
  RODOVIA: 'INDIFERENTE',
}

// Só as classes que não estão em "indiferente" viram restrição e entram na contagem.
export function preferenciasAtivas(niveis: Niveis) {
  return CLASSES.filter((c) => niveis[c.id] !== 'INDIFERENTE').map((c) => ({
    ...c,
    nivel: niveis[c.id],
    rotuloDoNivel: NIVEIS.find((n) => n.id === niveis[c.id])!.rotulo,
  }))
}

export function paraPreferencias(niveis: Niveis): RestricaoVia[] {
  return preferenciasAtivas(niveis).map((c) => ({
    tipo: 'VIA',
    classe: c.id,
    nivel: c.nivel,
  }))
}
