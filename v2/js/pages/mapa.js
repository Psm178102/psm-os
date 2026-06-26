/* PSM-OS v2 — Mapa de Imóveis (Sprint 8.8 + 9.3 Google Earth) */
import { api } from '../api.js';
import { getLinks, saveLinks, canEditLinks, promptLink } from '../links.js';

let _root = null;
let _items = [];
let _filter = 'all';
let _search = '';
let _map = null;
let _markers = [];
let _fonte = 'map';   // qual mapa de empreendimentos está ativo: 'map' (MAP) ou 'conquista' (PSM Conquista). v81.73

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

const DEFAULT_EARTH = 'https://earth.google.com/earth/d/15bCIxsaicJySE2OT0yS8dZO7KqcwyJ8o?usp=sharing';
let _captadosLoaded = false;

// 📍 Geocodificação automática (Nominatim/OpenStreetMap — grátis, sem chave) pra
// qualquer imóvel com endereço/bairro virar pin no satélite. Cache em localStorage
// (cada endereço é geocodificado UMA vez). Respeita ~1 req/s do Nominatim. v81.64
const GEO_CACHE_KEY = 'psm.v2.geocache';
let _geoCache = {};
try { _geoCache = JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || '{}'); } catch (_) { _geoCache = {}; }

async function geocodeAddr(q) {
  const key = (q || '').toLowerCase().trim();
  if (!key) return null;
  if (_geoCache[key]) return _geoCache[key] === 'x' ? null : _geoCache[key];
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=' + encodeURIComponent(q), { headers: { Accept: 'application/json' } }).then(x => x.json());
    const pos = (r && r[0]) ? [+r[0].lat, +r[0].lon] : null;
    _geoCache[key] = pos || 'x';   // 'x' = não achou, pra não retentar
    try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(_geoCache)); } catch (_) {}
    return pos;
  } catch (_) { return null; }
}

// Geocodifica em segundo plano os imóveis sem lat/lng e sem bairro reconhecido;
// quando termina (achou algum), re-plota os marcadores no satélite.
async function geocodeFaltantes() {
  let mudou = false;
  for (const i of _items) {
    if ((i.lat && i.lng) || geocodeBairro(i.bairro)) continue;
    const q = [i.endereco, i.bairro].filter(Boolean).join(', ');
    if (!q || q.length < 4) continue;
    const pos = await geocodeAddr(q + ', São José do Rio Preto, SP, Brasil');
    if (pos) { i.lat = pos[0]; i.lng = pos[1]; mudou = true; }
    await new Promise(r => setTimeout(r, 1100));   // educação com o Nominatim (~1 req/s)
  }
  if (mudou && document.querySelector('#psm-map')) renderContent();
}

export async function pageMapa(ctx, root) {
  _root = root;
  _captadosLoaded = false;
  await render();
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

// 🛰 Camadas de satélite (Esri World Imagery, grátis) + ruas + rótulos + controle.
// Reutilizado pelo mapa de empreendimentos E pelo de imóveis captados. v81.67
function addSatelliteLayers(map) {
  const satelite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagem © Esri, Maxar, Earthstar Geographics' });
  const ruas = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
  const rotulos = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: '© Esri' });
  satelite.addTo(map); rotulos.addTo(map);
  L.control.layers({ '🛰 Satélite': satelite, '🗺 Ruas': ruas }, { 'Rótulos (ruas/bairros)': rotulos }, { position: 'topright', collapsed: true }).addTo(map);
}

// ── EMPREENDIMENTOS (Google My Maps "MAPA Empreendimentos PSM") no satélite ──
// Pega os pins do KML do My Maps (via backend) e plota sobre o satélite Esri. v81.67
let _emp = { pins: [], shapes: [] };
let _empMap = null, _empMarkers = [];

async function loadEmpreendimentos(force) {
  const el = document.getElementById('emp-map');
  const info = document.getElementById('emp-info');
  if (!el) return;
  await loadLeaflet();
  if (info) info.innerHTML = '<span class="spinner"></span> ' + (force ? 'Re-sincronizando do Google My Maps…' : 'Carregando empreendimentos do seu Google My Maps…');
  try {
    const r = await api.request('/api/v3/maps/empreendimentos' + (force ? '?force=1' : ''));
    _emp = { pins: r.pins || [], shapes: r.shapes || [] };
    if (info) info.innerHTML = r.aviso ? `<span style="color:#b45309">${esc(r.aviso)}</span>`
      : `📍 <b>${_emp.pins.length}</b> empreendimentos${_emp.shapes.length ? ' · ' + _emp.shapes.length + ' território(s)' : ''} do seu <b>MAPA Empreendimentos PSM</b>, sobre satélite.`;
  } catch (e) {
    _emp = { pins: [], shapes: [] };
    if (info) info.innerHTML = `<span style="color:#b91c1c">Erro ao carregar empreendimentos: ${esc(e.message)}</span>`;
  }
  initEmpMap();
}

function initEmpMap() {
  if (!window.L) return;
  const el = document.getElementById('emp-map');
  if (!el) return;
  if (_empMap) { try { _empMap.remove(); } catch (_) {} _empMap = null; _empMarkers = []; }
  _empMap = L.map(el, { fadeAnimation: false }).setView([RP_LAT, RP_LNG], 12);
  addSatelliteLayers(_empMap);

  // territórios (polígonos/linhas) desenhados no My Maps
  (_emp.shapes || []).forEach(s => {
    if (!s.coords || s.coords.length < 2) return;
    const style = { color: '#f59e0b', weight: 2, fillColor: '#f59e0b', fillOpacity: .12 };
    const layer = s.tipo === 'poly' ? L.polygon(s.coords, style) : L.polyline(s.coords, { color: '#f59e0b', weight: 3 });
    layer.addTo(_empMap);
    if (s.nome) layer.bindPopup(`<b>${esc(s.nome)}</b>`);
    _empMarkers.push(layer);
  });
  // pins dos empreendimentos
  (_emp.pins || []).forEach(p => {
    if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return;
    const icon = L.divIcon({ className: 'psm-emp-marker', html: `<div style="background:#2563eb;width:16px;height:16px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`, iconSize: [16, 16], iconAnchor: [8, 16] });
    const m = L.marker([p.lat, p.lng], { icon }).addTo(_empMap);
    m.bindPopup(`<div style="font-family:system-ui;font-size:13px;font-weight:700">🏗 ${esc(p.nome || 'Empreendimento')}</div>`);
    _empMarkers.push(m);
  });

  if (_empMarkers.length) {
    try { _empMap.fitBounds(L.featureGroup(_empMarkers).getBounds().pad(0.15)); } catch (_) {}
  }
  setTimeout(() => { try { _empMap && _empMap.invalidateSize(); } catch (_) {} }, 250);
}

async function editEarth() {
  const links = await getLinks();
  const v = promptLink('Link do Google Earth (Mapa dos Imóveis)', links.mapa_earth);
  if (v === null) return;
  try { await saveLinks({ mapa_earth: v }); alert('✅ Link do Google Earth salvo!'); render(); }
  catch (e) { alert('Erro: ' + e.message); }
}

// Carrega o mapa de satélite dos imóveis JÁ na abertura (antes ficava escondido
// atrás de um toggle e usava base de ruas → "inútil"). v81.64
async function ensureCaptadosLoaded() {
  const wrap = document.getElementById('captados-wrap');
  if (!wrap) return;
  if (_captadosLoaded) { renderCaptados(); return; }
  _captadosLoaded = true;
  wrap.innerHTML = '<div class="muted tiny" style="padding:14px"><span class="spinner"></span> Carregando satélite e imóveis…</div>';
  await loadLeaflet();
  try { const r = await api.request('/api/v3/imoveis/list?limit=500').catch(() => ({ imoveis: [] })); _items = r.imoveis || []; }
  catch (_) { _items = []; }
  renderCaptados();
  geocodeFaltantes();   // fire-and-forget: plota no satélite quem só tem endereço/bairro
}

function renderCaptados() {
  const wrap = document.getElementById('captados-wrap');
  if (!wrap) return;
  wrap.innerHTML = `
    <div class="flex gap-2" style="flex-wrap:wrap;align-items:center;margin-bottom:10px">
      <button class="btn ${_filter === 'all' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-filter="all">🌐 Todos</button>
      <button class="btn ${_filter === 'disponivel' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-filter="disponivel">🟢 Disponíveis</button>
      <button class="btn ${_filter === 'vendido' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-filter="vendido">✅ Vendidos</button>
      <input id="map-search" class="input" placeholder="🔍 Buscar imóvel/bairro…" style="flex:1;min-width:220px" value="${esc(_search)}">
    </div>
    <div id="map-stats"></div>
    <div id="map-body" class="mt-3"></div>`;
  wrap.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => { _filter = b.dataset.filter; renderCaptados(); }));
  const s = wrap.querySelector('#map-search');
  if (s) s.addEventListener('input', e => { _search = e.target.value; clearTimeout(window._mapTimer); window._mapTimer = setTimeout(() => renderContent(), 300); });
  renderContent();
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

// Converte link do Google My Maps para a forma embutível (/maps/d/embed?mid=).
// Google Earth Web (earth.google.com) o próprio Google bloqueia em iframe — vai direto.
// Só Google My Maps (/maps/d/) e Maps embed embutem em iframe. Earth Web NÃO (Google bloqueia).
function isEmbeddable(url) { return !!url && /google\.[^/]+\/maps\/(d\/|embed)/.test(url); }
function toEmbed(url) {
  if (!url) return url;
  const mid = (url.match(/[?&]mid=([^&]+)/) || [])[1];
  if (/google\.[^/]+\/maps\/d\//.test(url) && mid) return 'https://www.google.com/maps/d/embed?mid=' + mid;
  return url;
}

async function editMyMaps() {
  const links = await getLinks();
  const isConq = _fonte === 'conquista';
  const key = isConq ? 'mapa_conquista' : 'mapa_mymaps';
  const titulo = isConq
    ? 'Link do Google My Maps da PSM CONQUISTA (empreendimentos Conquista)'
    : 'Link do Google My Maps do MAP (empreendimentos MAP)';
  const v = promptLink(titulo, links[key] || '');
  if (v === null) return;
  try { await saveLinks({ [key]: v }); alert('✅ Link do My Maps (' + (isConq ? 'PSM Conquista' : 'MAP') + ') salvo!'); render(); }
  catch (e) { alert('Erro: ' + e.message); }
}

async function render() {
  let earthUrl = DEFAULT_EARTH, myMaps = '', conquista = '', gkey = '';
  try { const links = await getLinks(); earthUrl = links.mapa_earth || DEFAULT_EARTH; myMaps = links.mapa_mymaps || ''; conquista = links.mapa_conquista || ''; gkey = links.google_maps_key || ''; } catch (_) {}
  const isConq = _fonte === 'conquista';
  const nomeFonte = isConq ? 'PSM Conquista' : 'MAP';
  // link da fonte ativa (Conquista usa só o My Maps da Conquista; MAP cai pro Earth como fallback de embed)
  const fonteUrl = isConq ? conquista : myMaps;
  const embedSrc = isEmbeddable(fonteUrl) ? toEmbed(fonteUrl) : (!isConq && isEmbeddable(earthUrl) ? toEmbed(earthUrl) : null);
  const useGoogle = !!gkey;
  const semFonte = !fonteUrl;   // a fonte ativa ainda não tem My Maps configurado
  // seletor MAP | PSM Conquista
  const seg = (f, ico, lbl) => `<button class="btn ${_fonte === f ? 'btn-primary' : 'btn-ghost'} btn-sm" data-fonte="${f}">${ico} ${lbl}</button>`;
  _root.innerHTML = `
    <div class="card">
      <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div>
          <h2 class="card-title">🗺 Mapa de Empreendimentos — <span style="color:var(--psm-gold)">${nomeFonte}</span></h2>
          <p class="card-sub">${useGoogle
            ? 'Mapa do <b>Google em satélite</b> com os pins do My Maps (nomes, cores, clique pra ver) — dentro do sistema.'
            : 'Seu Google My Maps com todos os pins, nomes e cores — aqui dentro do sistema.'} Dois mapas separados: <b>MAP</b> e <b>PSM Conquista</b>.</p>
        </div>
        <div class="flex gap-2">
          <a class="btn btn-primary" href="${esc(earthUrl)}" target="_blank" rel="noopener" style="background:#1a73e8">🌍 Abrir Earth 3D (tela cheia)</a>
          ${canEditLinks() ? `<button class="btn btn-ghost" id="map-gkey" title="Chave do Google Maps (satélite + pins)">🔑 Chave Maps</button><button class="btn btn-ghost" id="map-mymaps-edit" title="Editar o link do My Maps da fonte ${esc(nomeFonte)}">⚙️ My Maps (${esc(nomeFonte)})</button>` : ''}
        </div>
      </div>

      <!-- Seletor das duas fontes de empreendimentos -->
      <div class="flex gap-2" style="margin-top:12px;flex-wrap:wrap;align-items:center">
        ${seg('map', '🗺️', 'MAP')}
        ${seg('conquista', '🏘️', 'PSM Conquista')}
        <span class="tiny muted" style="margin-left:auto">Mostrando: <b>${esc(nomeFonte)}</b></span>
      </div>

      ${useGoogle ? `
      <!-- GOOGLE MAPS satélite (híbrido) + pins NATIVOS (cor + nome) da fonte ativa -->
      <div id="gmap" style="height:calc(100vh - 330px);min-height:460px;border-radius:12px;background:var(--bg-3);position:relative;margin-top:12px"></div>
      <div id="gmap-info" class="tiny muted mt-2"></div>
      ${embedSrc ? `<details class="mt-3"><summary style="cursor:pointer;font-weight:700;padding:6px 0">🗺 Ver o My Maps original da ${esc(nomeFonte)} (embed)</summary><div class="mt-2" style="position:relative;border-radius:14px;overflow:hidden;border:1px solid var(--border);background:#0b1f3a"><iframe src="${esc(embedSrc)}" style="width:100%;height:calc(100vh - 380px);min-height:420px;border:0;display:block" allowfullscreen loading="lazy"></iframe></div></details>` : ''}
      ` : (embedSrc ? `
      ${canEditLinks() ? '<div class="alert alert-warn mt-3" style="font-size:13px">🔑 Pra ter o <b>mapa do Google em satélite com os pins</b> aqui dentro, cole a <b>chave do Google Maps</b> no botão <b>🔑 Chave Maps</b>. Enquanto isso, abaixo está o My Maps embutido.</div>' : ''}
      <div class="mt-3" style="position:relative;border-radius:14px;overflow:hidden;border:1px solid var(--border);background:#0b1f3a">
        <iframe src="${esc(embedSrc)}" style="width:100%;height:calc(100vh - 350px);min-height:440px;border:0;display:block" allowfullscreen loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>
      </div>
      ` : (canEditLinks() ? `<p class="tiny muted mt-3">💡 A fonte <b>${esc(nomeFonte)}</b> ainda não tem mapa. Cole o link do <b>Google My Maps</b> em <b>⚙️ My Maps (${esc(nomeFonte)})</b>${useGoogle ? '' : ' e a <b>chave do Google Maps</b> em <b>🔑 Chave Maps</b>'}.</p>` : `<p class="tiny muted mt-3">Sem mapa configurado para ${esc(nomeFonte)}.</p>`))}
    </div>
  `;
  _root.querySelectorAll('[data-fonte]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.fonte === _fonte) return;
    _fonte = b.dataset.fonte; render();
  }));
  const gk = document.getElementById('map-gkey'); if (gk) gk.addEventListener('click', editGmapsKey);
  const mm = document.getElementById('map-mymaps-edit'); if (mm) mm.addEventListener('click', editMyMaps);
  if (useGoogle && semFonte) {
    // Fonte ainda sem My Maps: placeholder claro DENTRO da área do mapa (em vez de
    // satélite vazio/cinza ou quadrado branco). Os pins entram quando colar o My Maps.
    const g = document.getElementById('gmap');
    if (g) {
      g.style.display = 'flex';
      g.innerHTML = `<div style="margin:auto;display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center;padding:24px;color:var(--muted)">
        <div style="font-size:42px">🏘️</div>
        <div style="font-size:15px;font-weight:800;color:var(--ink,#0b1f3a)">Mapa da ${esc(nomeFonte)} ainda sem fonte</div>
        <div style="font-size:13px;max-width:470px;line-height:1.55">Cole o link do <b>Google My Maps</b> da <b>${esc(nomeFonte)}</b> que os empreendimentos aparecem aqui no satélite — com nome e cor, igual ao MAP. (O link do Google Earth não serve.)</div>
        ${canEditLinks() ? `<button class="btn btn-primary" id="gmap-add-src" style="margin-top:4px">⚙️ Colar My Maps (${esc(nomeFonte)})</button>` : ''}
      </div>`;
      const add = document.getElementById('gmap-add-src'); if (add) add.addEventListener('click', editMyMaps);
    }
  } else if (useGoogle) {
    await initGoogleMap(gkey);
  }
}

// Carrega a API JS do Google Maps (uma vez) com a chave do sócio.
function loadGoogleMapsApi(key) {
  return new Promise((resolve) => {
    if (window.google && window.google.maps) return resolve(true);
    if (window.__gmapsLoading) {
      const iv = setInterval(() => { if (window.google && window.google.maps) { clearInterval(iv); resolve(true); } }, 200);
      setTimeout(() => { clearInterval(iv); resolve(!!(window.google && window.google.maps)); }, 9000);
      return;
    }
    window.__gmapsLoading = true;
    const s = document.createElement('script');
    s.src = 'https://maps.googleapis.com/maps/api/js?v=quarterly&key=' + encodeURIComponent(key);
    s.async = true; s.defer = true;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

// Pin SVG colorido (cor do My Maps), com a âncora na ponta e o rótulo acima. v81.71
function pinIcon(cor) {
  const c = cor || '#2563eb';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="36" viewBox="0 0 26 36"><path d="M13 0C5.82 0 0 5.82 0 13c0 9.2 13 23 13 23s13-13.8 13-23C26 5.82 20.18 0 13 0z" fill="${c}" stroke="#fff" stroke-width="2"/><circle cx="13" cy="13" r="4.6" fill="#fff"/></svg>`;
  return { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg), scaledSize: new google.maps.Size(26, 36), anchor: new google.maps.Point(13, 36), labelOrigin: new google.maps.Point(13, -10) };
}

// Mapa do Google em satélite (híbrido) + os empreendimentos do My Maps como PINS
// NATIVOS: cada um com a COR e o NOME (fixo, em cima) do seu Google Earth/My Maps. v81.71
async function initGoogleMap(key) {
  const el = document.getElementById('gmap'); const info = document.getElementById('gmap-info');
  if (!el) return;
  if (!document.getElementById('gmap-label-css')) {
    const st = document.createElement('style'); st.id = 'gmap-label-css';
    st.textContent = '.gmap-emp-label{background:rgba(15,23,42,.82);padding:1px 6px;border-radius:5px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.5)}';
    document.head.appendChild(st);
  }
  const ok = await loadGoogleMapsApi(key);
  if (!ok || !(window.google && window.google.maps)) {
    el.innerHTML = '<div style="padding:26px;text-align:center;color:#b91c1c;font-size:13px">⚠ Não consegui carregar o Google Maps.<br>Confira a chave: <b>Maps JavaScript API ativada</b> + <b>faturamento</b> + restrição de referrer <b>https://www.housepsm.com.br/*</b>.</div>';
    return;
  }
  if (info) info.innerHTML = '<span class="spinner"></span> Carregando empreendimentos (' + (_fonte === 'conquista' ? 'PSM Conquista' : 'MAP') + ')…';
  let pins = [], shps = [], aviso = '';
  try { const r = await api.request('/api/v3/maps/empreendimentos?fonte=' + encodeURIComponent(_fonte)); pins = r.pins || []; shps = r.shapes || []; aviso = r.aviso || ''; }
  catch (e) { if (info) info.textContent = 'Erro: ' + e.message; }
  // Garante que o container tenha tamanho REAL antes de criar o mapa. Se for criado
  // com 0px (innerHTML do render / troca de aba ainda sem reflow), o Google calcula
  // viewport vazio e NÃO baixa tile nenhum → satélite cinza. Re-busca o #gmap atual
  // (a troca de aba recria o elemento) e espera o reflow (até ~0,7s). v81.79
  let host = document.getElementById('gmap') || el;
  for (let i = 0; i < 40 && (!host.isConnected || host.getBoundingClientRect().height < 60); i++) {
    await new Promise(r => requestAnimationFrame(r));
    host = document.getElementById('gmap') || host;
  }
  const map = new google.maps.Map(host, {
    center: { lat: RP_LAT, lng: RP_LNG }, zoom: 12, mapTypeId: 'hybrid',
    mapTypeControl: true, streetViewControl: false, fullscreenControl: true, gestureHandling: 'greedy',
  });
  const bounds = new google.maps.LatLngBounds();
  const iw = new google.maps.InfoWindow();
  // territórios (polígonos/linhas) com a cor do My Maps
  shps.forEach(s => {
    if (!s.coords || s.coords.length < 2) return;
    const path = s.coords.map(c => ({ lat: c[0], lng: c[1] }));
    const cor = s.cor || '#f59e0b';
    if (s.tipo === 'poly') new google.maps.Polygon({ paths: path, map, strokeColor: cor, strokeWeight: 2, fillColor: cor, fillOpacity: .1 });
    else new google.maps.Polyline({ path, map, strokeColor: cor, strokeWeight: 3 });
    path.forEach(p => bounds.extend(p));
  });
  // pins coloridos + nome fixo em cima
  pins.forEach(p => {
    if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return;
    const pos = { lat: p.lat, lng: p.lng };
    const m = new google.maps.Marker({
      position: pos, map, icon: pinIcon(p.cor), title: p.nome || '',
      label: p.nome ? { text: p.nome, color: '#fff', fontSize: '11px', fontWeight: '700', className: 'gmap-emp-label' } : undefined,
    });
    m.addListener('click', () => { iw.setContent('<div style="font:700 13px system-ui">🏗 ' + esc(p.nome || 'Empreendimento') + '</div>'); iw.open(map, m); });
    bounds.extend(pos);
  });
  // Aplica a vista E força o Google a recalcular o viewport com o tamanho REAL do
  // container. Se o #gmap foi medido como 0 na criação do mapa (o innerHTML do render
  // ainda não tinha refluído), o Google calcula viewport vazio e NÃO requisita nenhum
  // tile → satélite cinza com só os vetores. Dois resizes (350ms e 1200ms) cobrem o
  // layout lento e forçam o download dos tiles do satélite. v81.78
  const _applyView = () => { try { if (!bounds.isEmpty()) map.fitBounds(bounds, 40); else { map.setCenter({ lat: RP_LAT, lng: RP_LNG }); map.setZoom(12); } } catch (_) {} };
  // "Acorda" o mapa pra reposicionar os tiles do satélite. O resize precoce (v81.78)
  // não bastava — os tiles carregam DEPOIS e ficavam posicionados pro viewport errado
  // (satélite cinza com só os pins). Agora disparamos também QUANDO os tiles terminam
  // ('tilesloaded'/'idle') + um window-resize (que o Google escuta e recalcula tudo).
  // Validado: o window-resize pós-tiles reposiciona o satélite na hora. v81.80
  const _kick = () => { try { google.maps.event.trigger(map, 'resize'); window.dispatchEvent(new Event('resize')); _applyView(); } catch (_) {} };
  _applyView();
  try { google.maps.event.addListenerOnce(map, 'tilesloaded', _kick); google.maps.event.addListenerOnce(map, 'idle', _kick); } catch (_) {}
  [400, 1200, 2500].forEach(ms => setTimeout(_kick, ms));
  const nome = _fonte === 'conquista' ? 'PSM Conquista' : 'MAP';
  if (info) info.innerHTML = aviso
    ? '<span style="color:#b45309">' + esc(aviso) + '</span>'
    : '📍 <b>' + pins.length + '</b> empreendimentos (' + nome + ')' + (shps.length ? ' · ' + shps.length + ' território(s)' : '') + ' — com as <b>cores e nomes</b> do seu My Maps, no satélite do Google.';
}

async function editGmapsKey() {
  let links = {}; try { links = await getLinks(); } catch (_) {}
  const v = prompt('Cole a CHAVE do Google Maps (Maps JavaScript API).\n\nCrie em: console.cloud.google.com → APIs e Serviços → Credenciais → Criar chave de API.\nDepois restrinja por referrer: https://www.housepsm.com.br/*', links.google_maps_key || '');
  if (v === null) return;
  try { await saveLinks({ google_maps_key: (v || '').trim() }); alert('✅ Chave salva! Recarregando o mapa…'); render(); }
  catch (e) { alert('Erro ao salvar a chave: ' + e.message); }
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

  // fadeAnimation:false → os tiles do satélite pintam IMEDIATAMENTE (com fade, a
  // animação travava em opacity:0 quando o mapa era reconstruído → mapa branco). v81.66
  _map = L.map(el, { fadeAnimation: false }).setView([RP_LAT, RP_LNG], 13);
  addSatelliteLayers(_map);

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
  // o container é renderizado já visível; reavalia o tamanho após o layout assentar
  setTimeout(() => { try { _map && _map.invalidateSize(); } catch (_) {} }, 250);
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
