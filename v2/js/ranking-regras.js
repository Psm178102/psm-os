/* PSM-OS v2 — régua ÚNICA do Ranking de VGV (v88.11)
   Usada pela página Ranking, pelo Ranking HUB e pelo painel 🏅 do 1:1: a mesma lista, a mesma
   ordem e as mesmas exclusões em todas as telas.
   - Base = grid da aba Metas (/metas/atingimento): TODO mundo ativo que pode ter venda no ano.
     Antes a base era o ranking de ATIVIDADE cortado em 30/50 por score — quem vendia mas usava
     pouco o sistema sumia do ranking de VGV.
   - Atividade (score 30d) entra só como desempate / info.
   - Não competem (Dicionário §4): sócio, diretor e gestão por PREFIXO (gerente*, lider*), ocultos. */
export function ehGestao(role) {
  const r = (role || '').toLowerCase();
  return r === 'socio' || r === 'diretor' || r.startsWith('gerente') || r.startsWith('lider') || r === 'líder';
}

export function competidoresVgv(atingimento, activity) {
  const act = {};
  (activity || []).forEach(u => { act[u.id] = u; });
  const out = [];
  ((atingimento || {}).grid || []).forEach(g => {
    const u = g.user || {};
    if (!u.id || ehGestao(u.role) || u.hide_from_ranking || (act[u.id] && act[u.id].hide_from_ranking)) return;
    out.push({ ...(act[u.id] || {}), ...u, score: (act[u.id] || {}).score || 0,
      vgv: g.totals?.atingido_vgv || 0, vendas: g.totals?.vendas_count || 0 });
  });
  return out.sort((a, b) => (b.vgv - a.vgv) || ((b.vendas || 0) - (a.vendas || 0)) || ((b.score || 0) - (a.score || 0)));
}
