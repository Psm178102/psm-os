/* PSM-OS v2 — Hub Central de Agentes IA (Sprint 8.2) */
import { auth } from '../auth.js';

const AGENTS = [
  { id: 'vera',         name: 'Vera',          line: 'PSM Assessoria Imobiliária', ico: '💜', color: '#8b5cf6',
    desc: 'Atendimento de leads, qualificação, nutrição e captação para assessoria imobiliária',
    channels: ['WhatsApp', 'Instagram DM'], status: 'config', page: '/agente-vera' },
  { id: 'sol',          name: 'Sol',           line: 'PSM Conquista',              ico: '☀️', color: '#f59e0b',
    desc: 'Prospecção, atendimento e nutrição de leads para incorporação e loteamento',
    channels: ['WhatsApp', 'Instagram DM'], status: 'pending', page: '/agente-sol' },
  { id: 'performance',  name: 'Sr. Performance', line: 'Mentor de Corretores',     ico: '🤖', color: '#0f172a',
    desc: 'Treina corretores do zero ao nível expert com dados reais do CRM',
    channels: ['House PSM Chat'], status: 'active', page: '/sr-performance' },
  { id: 'gerencia',     name: 'Sr. Gerência',  line: 'Gestão Operacional',         ico: '👔', color: '#0891b2',
    desc: 'Organiza operação, corrige e orienta corretores com foco em resultados',
    channels: ['House PSM Chat'], status: 'pending', page: '/sr-gerencia' },
  { id: 'intelligence', name: 'Sr. Intelligence', line: 'Inteligência Estratégica', ico: '🔍', color: '#059669',
    desc: 'Audita, analisa concorrentes e orienta sócios e diretores com dados',
    channels: ['House PSM Chat'], status: 'pending', page: null },
];

const STATUS_MAP = { active: '🟢 Ativo', config: '🟡 Configurando', pending: '⚪ Aguardando' };

const ARCH = [
  { ico: '🧠', t: 'Motor IA',     d: 'Claude/Gemini/OpenAI fallback — raciocínio para vendas consultivas' },
  { ico: '📱', t: 'WhatsApp',     d: 'Evolution API — atendimento via WhatsApp Business' },
  { ico: '📸', t: 'Instagram DM', d: 'Meta Graph API — respostas automáticas via Direct' },
  { ico: '🔗', t: 'CRM',          d: 'RD Station — criação e atualização automática de leads' },
  { ico: '🌐', t: 'Deploy',       d: 'Vercel Serverless — escalável sem servidor' },
  { ico: '🔒', t: 'Segurança',    d: 'Tokens em env vars, CORS, webhook verification' },
];

export async function pageAgentes(ctx, root) {
  const ativos = AGENTS.filter(a => a.status === 'active').length;
  const config = AGENTS.filter(a => a.status === 'config').length;

  root.innerHTML = `
    <div class="card" style="background:#0f172a;color:#e2e8f0;border-radius:14px;padding:24px">
      <h2 style="margin:0;font-size:22px;color:#fff">🧠 Central de Agentes PSM</h2>
      <p style="margin:6px 0 18px;color:#94a3b8">Inteligência artificial a serviço da sua operação imobiliária</p>

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(160px, 1fr));gap:12px;margin-bottom:24px">
        ${kpi('🧠', 'Agentes Totais', AGENTS.length, '#8b5cf6')}
        ${kpi('🟢', 'Ativos', ativos, '#22c55e')}
        ${kpi('🟡', 'Configurando', config, '#f59e0b')}
        ${kpi('💬', 'Conversas Ativas', '—', '#3b82f6')}
        ${kpi('📡', 'Canais Conectados', 1, '#06b6d4')}
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:14px">
        ${AGENTS.map(a => agentCard(a)).join('')}
      </div>

      <div style="margin-top:24px;background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px">
        <div style="font-weight:800;color:#fff;margin-bottom:12px">⚡ Arquitetura dos Agentes</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:12px">
          ${ARCH.map(a => `
            <div style="background:#0f172a;border-radius:10px;padding:12px">
              <div style="font-size:18px;margin-bottom:6px">${a.ico}</div>
              <div style="font-weight:700;color:#fff;font-size:12px;margin-bottom:4px">${a.t}</div>
              <div style="font-size:11px;color:#64748b;line-height:1.5">${a.d}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  root.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => {
    location.hash = b.dataset.nav;
  }));
}

function kpi(ico, label, value, color) {
  return `
    <div style="background:#1e293b;border-radius:12px;padding:14px;border-left:4px solid ${color}">
      <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">${ico} ${label}</div>
      <div style="font-size:24px;font-weight:800;color:${color}">${value}</div>
    </div>
  `;
}

function agentCard(a) {
  const status = STATUS_MAP[a.status] || '⚪ —';
  const statusColor = a.status === 'active' ? '#22c55e' : a.status === 'config' ? '#f59e0b' : '#64748b';
  return `
    <div style="background:#1e293b;border-radius:14px;padding:20px;border:1px solid ${a.color}33">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
        <div style="width:50px;height:50px;border-radius:12px;background:${a.color}22;display:flex;align-items:center;justify-content:center;font-size:24px">${a.ico}</div>
        <div style="flex:1">
          <div style="font-size:16px;font-weight:800;color:#fff">${a.name}</div>
          <div style="font-size:11px;color:${a.color};font-weight:600">${a.line}</div>
        </div>
        <span style="font-size:10px;font-weight:700;padding:4px 10px;border-radius:20px;background:${statusColor}22;color:${statusColor}">${status}</span>
      </div>
      <p style="color:#94a3b8;font-size:12px;line-height:1.5;margin:0 0 12px">${a.desc}</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
        ${a.channels.map(ch => `<span style="font-size:10px;padding:3px 8px;border-radius:6px;background:#0f172a;color:#94a3b8;border:1px solid #334155">${ch}</span>`).join('')}
      </div>
      ${a.page
        ? `<button data-nav="${a.page}" style="width:100%;padding:10px;background:${a.color};color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">${a.status === 'active' ? 'Abrir Painel' : 'Configurar'} →</button>`
        : `<button disabled style="width:100%;padding:10px;background:#334155;color:#64748b;border:none;border-radius:8px;font-size:12px;cursor:not-allowed">Em breve</button>`
      }
    </div>
  `;
}
