/* PSM-OS v2 — Mapa de Imóveis (Sprint 8.8 + 9.3 Google Earth) */
import { api } from '../api.js';
import { getLinks, saveLinks, canEditLinks, promptLink } from '../links.js';

let _root = null;
let _items = [];
let _filter = 'all';
let _search = '';
let _map = null;
let _markers = [];

// Coordenadas do centro de Rio Preto (default)
const RP_LAT = -20.8202;
const RP_LNG = -49.3786;

// Bairros conhecidos com lat/lng aproximada
const BAIRROS_RP = {
  'centro': [-20.8202, -49.3786],
  'higienopolis': [-20.8000, -49.3700],
  'redentora': [-20.8100, -49.3900],
  'boa vista': [-20.8050, -49.3650],
  'bosque': [-20.8350, -49.4000],
  'damha': [-20.7800, -49.4100],
  'jardim tarraf': [-20.7900, -49.4200],
  'cidade nova': [-20.8500, -49.3500],
  'parque industrial': [-20.7700, -49.3500],
  'eldorado': [-20.8400, -49.3800],
  'iguatemi': [-20.7950, -49.3850],
  'parque estoril': [-20.7950, -49.4050],
  'recanto': [-20.8250, -49.3650],
};

export async function pageMapa(ctx, root) {
  _root = root;
  await loadLeaflet();
  render();
  await load();
}

function loadLeaflet() {
  return new Promise((resolve) => {
    if (window.L) return resolve();
    // CSS
    if (!document.querySelector('link[href*="leaflet"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      link.crossOrigin = '';
      document.head.appendChild(link);
    }
    // JS
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.crossOrigin = '';
    script.onload = resolve;
    script.onerror = () => resolve(); // continua mesmo se falhar
    document.head.appendChild(script);
  });
}

async function load() {
  try {
    const r = await api.request('/api/v3/imoveis/list?limit=500').catch(() => ({ imoveis: [] }));
    _items = r.imoveis || [];
    renderContent();
  } catch (e) {
    document.getElementById('map-body').innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`;
  }
}

function geocodeBairro(bairro) {
  if (!bairro) return null;
  const key = bairro.toLowerCase().trim();
  // Match exato
  if (BAIRROS_RP[key]) return BAIRROS_RP[key];
  // Match parcial
  for (const k of Object.keys(BAIRROS_RP)) {
    if (key.includes(k) || k.includes(key)) return BAIRROS_RP[k];
  }
  return null;
}

function jitter(coord, idx) {
  // Dispersa marcadores no mesmo bairro
  const angle = (idx * 137.508) * Math.PI / 180;
  const radius = 0.003 + (idx % 5) * 0.0005;
  return [coord[0] + Math.cos(angle) * radius, coord[1] + Math.sin(angle) * radius];
}

function render() {
  _root.innerHTML = `
    <div class="card">
      <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div>
          <h2 class="card-title">🗺 Mapa de Imóveis PSM</h2>
          <p class="card-sub">Localização geográfica dos imóveis ativos — São José do Rio Preto/SP</p>
        </div>
        <div class="flex gap-2">
          <button class="btn btn-primary" id="map-earth" style="background:#1a73e8">🌍 Abrir no Google Earth</button>
          ${canEditLinks() ? '<button class="btn btn-ghost" id="map-earth-edit" title="Editar link do Google Earth">⚙️</button>' : ''}
        </div>
      </div>

      <div id="map-stats" class="mt-3"></div>

      <div class="flex gap-2 mt-3" style="flex-wrap:wrap;align-items:center">
        <button class="btn ${_filter === 'all' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-filter="all">🌐 Todos</button>
        <button class="btn ${_filter === 'disponivel' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-filter="disponivel">🟢 Disponíveis</button>
        <button class="btn ${_filter === 'vendido' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-filter="vendido">✅ Vendidos</button>
        <input id="map-search" class="input" placeholder="🔍 Buscar imóvel/bairro…" style="flex:1;min-width:220px" value="${esc(_search)}">
      </div>

      <div id="map-body" class="mt-3"></div>
    </div>
  `;
  _root.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => {
    _filter = b.dataset.filter;
    render();
    renderContent();
  }));
  const s = document.getElementById('map-search');
  if (s) {
    s.addEventListener('input', e => {
      _search = e.target.value;
      clearTimeout(window._mapTimer);
      window._mapTimer = setTimeout(() => renderContent(), 300);
    });
  }
  const earthBtn = document.getElementById('map-earth');
  if (earthBtn) earthBtn.addEventListener('click', async () => {
    const links = await getLinks();
    const url = links.mapa_earth || 'https://earth.google.com/earth/d/15bCIxsaicJySE2OT0yS8dZO7KqcwyJ8o?usp=sharing';
    window.open(url, '_blank', 'noopener');
  });
  const earthEdit = document.getElementById('map-earth-edit');
  if (earthEdit) earthEdit.addEventListener('click', async () => {
    const links = await getLinks();
    const v = promptLink('Link do Google Earth (Mapa dos Imóveis)', links.mapa_earth);
    if (v === null) return;
    try { await saveLinks({ mapa_earth: v }); alert('✅ Link do Google Earth salvo!'); }
    catch (e) { alert('Erro: ' + e.message); }
  });
}

function renderContent() {
  const stats = document.getElementById('map-stats');
  const filtered = applyFilters(_items);

  const total = _items.length;
  const disp = _items.filter(i => i.status === 'disponivel').length;
  const vend = _items.filter(i => i.status === 'vendido').length;
  const proprios = _items.filter(i => (i.origem || '').toLowerCase() === 'proprio').length;

  stats.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:10px">
      ${kpi('🏠 Total', total, '#3b82f6')}
      ${kpi('🟢 Disponíveis', disp, '#22c55e')}
      ${kpi('🏷 Próprios', proprios, 'var(--psm-gold)')}
      ${kpi('✅ Vendidos', vend, '#8b5cf6')}
      ${kpi('🔎 No Filtro', filtered.length, '#f59e0b')}
    </div>
  `;

  const body = document.getElementById('map-body');
  body.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 320px;gap:14px">
      <div id="psm-map" style="height:calc(100vh - 380px);min-height:450px;border-radius:10px;background:var(--bg-3);position:relative">
        ${!window.L ? '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted)">⚠️ Leaflet não carregou. Verifique conexão.</div>' : ''}
      </div>
      <div style="height:calc(100vh - 380px);min-height:450px;overflow-y:auto;background:var(--bg-3);border-radius:10px;padding:10px">
        <div class="tiny muted mb-2" style="font-weight:700">📋 ${filtered.length} imóveis no filtro</div>
        ${filtered.slice(0, 100).map(i => imovelMini(i)).join('')}
      </div>
    </div>
    <div class="alert tiny mt-3" style="background:rgba(99,102,241,.1);color:#6366f1;border:1px solid rgba(99,102,241,.3);padding:8px;border-radius:6px">
      💡 Marcadores são posicionados pelo <b>bairro</b> dos imóveis. Pra geolocalização exata, cadastre lat/lng em cada imóvel.
    </div>
  `;

  initMap(filtered);
}

function applyFilters(items) {
  return items.filter(i => {
    if (_filter === 'disponivel' && i.status !== 'disponivel') return false;
    if (_filter === 'lancamento' && !((i.tipo || '').toLowerCase().includes('lancamento') || (i.origem || '').toLowerCase() === 'lancamento')) return false;
    if (_filter === 'vendido' && i.status !== 'vendido') return false;
    if (_search) {
      const q = _search.toLowerCase();
      const hay = `${i.codigo || ''} ${i.endereco || ''} ${i.bairro || ''} ${i.tipo || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function initMap(items) {
  if (!window.L) return;
  const el = document.getElementById('psm-map');
  if (!el) return;

  // Destrói mapa anterior
  if (_map) { try { _map.remove(); } catch {} _map = null; _markers = []; }

  _map = L.map(el).setView([RP_LAT, RP_LNG], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '© OpenStreetMap'
  }).addTo(_map);

  // Plota marcadores
  const bairroCounts = {};
  items.forEach(i => {
    let lat, lng;
    if (i.lat && i.lng) {
      lat = +i.lat; lng = +i.lng;
    } else {
      const coord = geocodeBairro(i.bairro);
      if (!coord) return;
      const key = (i.bairro || '').toLowerCase();
      bairroCounts[key] = (bairroCounts[key] || 0) + 1;
      const [jLat, jLng] = jitter(coord, bairroCounts[key]);
      lat = jLat; lng = jLng;
    }

    const cor = i.status === 'disponivel' ? '#22c55e' : i.status === 'vendido' ? '#8b5cf6' : '#f59e0b';
    const icon = L.divIcon({
      className: 'psm-marker',
      html: `<div style="background:${cor};width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 2px ${cor}44"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
    const m = L.marker([lat, lng], { icon }).addTo(_map);
    const valor = i.valor ? `R$ ${(+i.valor).toLocaleString('pt-BR')}` : '—';
    m.bindPopup(`
      <div style="font-family:system-ui;font-size:13px">
        <div style="font-weight:800;margin-bottom:4px">${esc(i.codigo || 'Sem código')}</div>
        <div>${esc(i.tipo || '—')} · ${esc(i.bairro || '—')}</div>
        <div style="color:#666;font-size:11px;margin:4px 0">${esc(i.endereco || '')}</div>
        <div style="font-weight:700;color:#0b1f3a">${valor}</div>
        <div style="margin-top:4px"><span style="background:${cor}22;color:${cor};padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700">${i.status || '—'}</span></div>
      </div>
    `);
    _markers.push(m);
  });

  if (_markers.length > 0) {
    const group = L.featureGroup(_markers);
    _map.fitBounds(group.getBounds().pad(0.2));
  }
}

function imovelMini(i) {
  const cor = i.status === 'disponivel' ? '#22c55e' : i.status === 'vendido' ? '#8b5cf6' : '#f59e0b';
  return `
    <div style="background:var(--bg-2);border-left:3px solid ${cor};border-radius:6px;padding:8px;margin-bottom:6px;font-size:12px">
      <div style="font-weight:700">${esc(i.codigo || '—')}</div>
      <div class="tiny muted">${esc(i.bairro || '')} · ${esc(i.tipo || '')}</div>
      <div style="color:var(--psm-gold);font-weight:700;font-size:11px">R$ ${(+i.valor || 0).toLocaleString('pt-BR')}</div>
    </div>
  `;
}

function kpi(label, value, color) {
  return `<div style="background:var(--bg-3);border-left:4px solid ${color};padding:10px;border-radius:6px"><div class="tiny muted">${label}</div><div style="font-size:18px;font-weight:800;color:${color}">${value}</div></div>`;
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
