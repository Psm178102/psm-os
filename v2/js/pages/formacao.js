/* PSM-OS v2 — Formação PSM (Sprint 8.1) */
import { auth } from '../auth.js';

const KIWIFY_URL = 'https://members.kiwify.com/?club=ccdc35d2-08c0-47cd-8268-4bf2c30ca597';
const MODULOS = [
  { nome: 'ONBOARDING PSM',                          aulas: 2,  desc: 'Introdução e boas-vindas' },
  { nome: 'TUTORIAIS PSM',                            aulas: 4,  desc: 'Guias e treinamentos rápidos' },
  { nome: 'Aulas - MERCADO BÁSICO',                  aulas: 17, desc: 'Fundamentos do mercado imobiliário' },
  { nome: 'Mentoria - Paulo',                         aulas: 4,  desc: 'Sessões de mentoria com Paulo' },
  { nome: 'Mercado de Lançamentos/Empreendimentos',  aulas: 3,  desc: 'Novos empreendimentos' },
  { nome: 'MCMV + FINANCIAMENTOS',                    aulas: 1,  desc: 'Programas de financiamento' },
  { nome: 'Paulo Cuenca - Branding - Reels',         aulas: 1,  desc: 'Estratégia de branding e conteúdo' },
];

export async function pageFormacao(ctx, root) {
  const totalM = MODULOS.length;
  const totalA = MODULOS.reduce((a, m) => a + m.aulas, 0);
  root.innerHTML = `
    <div class="card">
      <h2 class="card-title">📚 Formação PSM</h2>
      <p class="card-sub">Comunidade PSM — plataforma de educação Kiwify com ${totalM} módulos e ${totalA} aulas</p>

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:10px;margin:14px 0">
        <div class="kpi"><div class="muted tiny">MÓDULOS</div><div style="font-size:24px;font-weight:800">${totalM}</div></div>
        <div class="kpi"><div class="muted tiny">AULAS</div><div style="font-size:24px;font-weight:800">${totalA}</div></div>
        <div class="kpi"><div class="muted tiny">KIWIFY</div><div style="font-size:14px;font-weight:800;color:#22c55e">🟢 Ativo</div></div>
      </div>

      <div style="text-align:center;padding:36px 24px;background:linear-gradient(135deg,#0f172a,#1e293b);border-radius:14px;margin:14px 0;position:relative;overflow:hidden">
        <div style="position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#d4a843,#e8c263,#d4a843)"></div>
        <div style="font-size:44px;margin-bottom:14px">🎓</div>
        <h3 style="color:#fff;margin:0 0 8px;font-size:20px">Comunidade PSM</h3>
        <p style="color:#cbd5e1;margin:0 0 20px;max-width:460px;display:inline-block">Acesse a plataforma de aulas, acompanhe seu progresso e se desenvolva como corretor PSM.</p>
        <a href="${KIWIFY_URL}" target="_blank" rel="noopener" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#d4a843,#e8c263);color:#0f172a;border-radius:10px;font-weight:800;font-size:15px;text-decoration:none">Acessar Aulas →</a>
      </div>

      <h3 class="card-title mt-4">📚 Módulos Disponíveis</h3>
      <div style="display:grid;gap:8px">
        ${MODULOS.map((m, i) => `
          <div style="background:var(--bg-3);border-left:4px solid var(--psm-gold);border-radius:10px;padding:14px;display:flex;align-items:center;gap:12px">
            <div style="flex:1">
              <div style="font-weight:800">${i+1}. ${esc(m.nome)}</div>
              <div class="tiny muted mt-1">${esc(m.desc)}</div>
            </div>
            <span style="background:var(--psm-gold);color:var(--bg-1);font-weight:800;padding:4px 12px;border-radius:20px;font-size:12px;white-space:nowrap">${m.aulas} aulas</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
