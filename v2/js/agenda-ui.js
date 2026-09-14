/* ============================================================================
   PSM-OS v2 — 📅 Agenda & Tarefas · peças visuais compartilhadas (v87.81)
   Estilo único da tela (claro e escuro), toast com "desfazer", modal leve.
   A cor identifica o TIPO só como barra/ponto — o texto fica sempre na cor de
   leitura do tema (cor saturada em cima do fundo escuro não passa contraste).
============================================================================ */

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const CORES = {
  tarefa: '#3b82f6', reuniao: '#8b5cf6', visita: '#16a34a', plantao: '#0ea5e9', evento: '#e11d48',
  outro: '#64748b', treino: '#14b8a6', academy: '#f97316', projeto: '#f59e0b', captacao: '#ca8a04',
  criativo: '#d946ef', conteudo: '#a855f7', oneonone: '#ec4899',
};

const CSS = `
.at-wrap{display:flex;flex-direction:column;gap:14px;max-width:1500px;margin:0 auto}
.at-wrap button{font-family:inherit}
.at-wrap :focus-visible{outline:2px solid var(--info);outline-offset:2px}
.at-card{background:var(--bg-2);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow-sm)}
.at-muted{color:var(--ink-muted)}
.at-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}

/* topo: saudação + números do dia + adicionar rápido */
.at-top{padding:18px 20px 16px}
.at-top-l{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;flex-wrap:wrap}
.at-hello{font-family:var(--font-display);font-size:22px;font-weight:700;line-height:1.15;margin:0}
.at-date{font-size:13px;color:var(--ink-muted);margin-top:3px}
.at-kpis{display:flex;gap:8px;flex-wrap:wrap}
.at-kpi{display:flex;align-items:baseline;gap:6px;padding:8px 12px;border-radius:10px;border:1px solid var(--border);background:var(--bg-3);color:var(--ink);cursor:pointer;font-size:12px;font-weight:600;transition:border-color .15s,transform .1s}
.at-kpi b{font-size:18px;font-weight:800;line-height:1}
.at-kpi:hover{border-color:var(--border-2)}
.at-kpi:active{transform:translateY(1px)}
.at-kpi.err b{color:var(--err)} .at-kpi.ok b{color:var(--ok)} .at-kpi.info b{color:var(--info)} .at-kpi.warn b{color:var(--warn)}
.at-kpi.err{border-color:color-mix(in srgb,var(--err) 40%,var(--border))}
.at-quick{display:flex;gap:8px;margin-top:14px;align-items:stretch;flex-wrap:wrap}
.at-quick-in{flex:1;min-width:240px;position:relative;display:flex}
.at-quick-in input{flex:1;height:44px;padding:0 14px 0 40px;border-radius:11px;border:1.5px solid var(--border-2);background:var(--bg);color:var(--ink);font-size:14.5px}
.at-quick-in input:focus{outline:none;border-color:var(--info);box-shadow:0 0 0 3px color-mix(in srgb,var(--info) 22%,transparent)}
.at-quick-in .at-plus{position:absolute;left:13px;top:50%;transform:translateY(-50%);font-size:18px;color:var(--ink-muted);pointer-events:none}
.at-quick .btn{height:44px;border-radius:11px;padding:0 16px}
.at-seg{display:inline-flex;background:var(--bg-3);border:1px solid var(--border);border-radius:11px;padding:3px;gap:2px}
.at-seg button{border:0;background:transparent;color:var(--ink-muted);font-weight:700;font-size:12.5px;padding:0 12px;border-radius:8px;cursor:pointer;white-space:nowrap;min-height:30px}
.at-seg button.on{background:var(--bg-2);color:var(--ink);box-shadow:var(--shadow-sm)}
.at-quick .at-seg{height:44px}
.at-preview{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;min-height:22px;align-items:center;font-size:12px}
.at-pv{display:inline-flex;align-items:center;gap:4px;padding:2px 9px;border-radius:999px;background:var(--bg-3);border:1px solid var(--border);font-weight:600}
.at-pv.dica{background:transparent;border-style:dashed;color:var(--ink-muted);font-weight:500}

/* convites */
.at-conv{padding:12px 16px;border-left:4px solid var(--info)}
.at-conv-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--border)}
.at-conv-row:first-of-type{border-top:0}

/* grade principal */
.at-grid{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:14px;align-items:start}
.at-main{padding:14px 16px 16px;min-width:0}
.at-side{display:flex;flex-direction:column;gap:14px;min-width:0}
@media (max-width:1180px){.at-grid{grid-template-columns:minmax(0,1fr)}.at-side{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}}

/* barra de ferramentas */
.at-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.at-nav{display:flex;align-items:center;gap:4px}
.at-ib{width:32px;height:32px;border-radius:8px;border:1px solid var(--border);background:var(--bg-2);color:var(--ink);cursor:pointer;font-size:15px;display:inline-flex;align-items:center;justify-content:center}
.at-ib:hover{background:var(--bg-3)}
.at-tb{height:32px;padding:0 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg-2);color:var(--ink);cursor:pointer;font-weight:700;font-size:12.5px}
.at-tb:hover{background:var(--bg-3)}
.at-tb.on{background:var(--psm-navy);border-color:var(--psm-navy);color:var(--psm-cream)}
.at-period{font-weight:800;font-size:15px;margin-left:6px;white-space:nowrap}
.at-sp{flex:1}
.at-search{position:relative}
.at-search input{height:32px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--ink);padding:0 10px 0 28px;width:190px;font-size:12.5px}
.at-search span{position:absolute;left:9px;top:50%;transform:translateY(-50%);font-size:12px;opacity:.6}
.at-sel{height:32px;border-radius:8px;border:1px solid var(--border);background:var(--bg-2);color:var(--ink);padding:0 8px;font-size:12.5px;max-width:180px}
.at-chips{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 2px;align-items:center}
.at-fchip{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 11px;border-radius:999px;border:1px solid var(--border);background:transparent;color:var(--ink-2);font-size:12px;font-weight:700;cursor:pointer}
.at-fchip i{width:8px;height:8px;border-radius:50%;background:var(--c,#64748b);display:inline-block}
.at-fchip em{font-style:normal;color:var(--ink-muted);font-weight:600}
.at-fchip.on{background:var(--bg-3);border-color:var(--ink-muted);color:var(--ink)}
.at-check-lbl{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--ink-muted);cursor:pointer;margin-left:auto}
.at-view{margin-top:12px;min-height:280px;position:relative}
.at-loading{position:absolute;top:-8px;right:0;font-size:11px;color:var(--ink-muted)}

/* item (linha) */
.at-sec{display:flex;align-items:center;gap:8px;margin:16px 0 6px;font-size:11.5px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--ink-muted)}
.at-sec:first-child{margin-top:2px}
.at-sec b{color:var(--sc,var(--ink-muted))}
.at-sec em{font-style:normal;font-weight:700;background:var(--bg-3);border-radius:999px;padding:0 7px;letter-spacing:0}
.at-sec .at-sec-a{margin-left:auto;text-transform:none;letter-spacing:0}
.at-list{display:flex;flex-direction:column;gap:4px}
.at-item{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;padding:9px 10px 9px 12px;border-radius:10px;background:var(--bg-2);border:1px solid var(--border);border-left:4px solid var(--c);cursor:pointer;transition:background .12s,border-color .12s;position:relative}
.at-item:hover{background:var(--bg-3)}
.at-item.done .at-t{text-decoration:line-through;color:var(--ink-muted)}
.at-item.late{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--err) 35%,transparent)}
.at-ck{width:22px;height:22px;border-radius:50%;border:2px solid var(--c);background:transparent;color:transparent;cursor:pointer;font-size:12px;font-weight:900;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;padding:0;transition:all .12s}
.at-ck:hover{background:color-mix(in srgb,var(--c) 22%,transparent);color:var(--ink)}
.at-ck.on{background:var(--c);color:#fff}
.at-ck.off{border-style:dashed;opacity:.35;cursor:default}
.at-ico{font-size:17px;width:22px;text-align:center}
.at-t{font-weight:700;font-size:13.5px;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.at-m{display:flex;gap:4px 10px;flex-wrap:wrap;font-size:11.5px;color:var(--ink-muted);margin-top:2px;align-items:center}
.at-m .late{color:var(--err);font-weight:700}
.at-tag{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:var(--ink-2);white-space:nowrap}
.at-tag i{width:7px;height:7px;border-radius:50%;background:var(--c);display:inline-block}
.at-prio{font-size:10px;font-weight:800;padding:1px 7px;border-radius:999px;text-transform:uppercase;letter-spacing:.4px;margin-left:6px;vertical-align:1px}
.at-prio.alta{background:color-mix(in srgb,var(--err) 18%,transparent);color:var(--err)}
.at-prio.critica{background:var(--err);color:#fff}
.at-acts{display:flex;gap:4px;align-items:center;opacity:.75}
.at-item:hover .at-acts{opacity:1}
.at-mini-b{height:28px;min-width:28px;padding:0 8px;border-radius:7px;border:1px solid var(--border);background:var(--bg-2);color:var(--ink);cursor:pointer;font-size:12px;font-weight:700;white-space:nowrap}
.at-mini-b:hover{background:var(--bg-3);border-color:var(--border-2)}
.at-empty{padding:34px 16px;text-align:center;color:var(--ink-muted);border:1px dashed var(--border-2);border-radius:12px}
.at-empty b{display:block;font-size:26px;margin-bottom:4px}

/* dia */
.at-dayhead{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px}
.at-slot{display:grid;grid-template-columns:62px minmax(0,1fr);gap:10px;align-items:start}
.at-hr{font-size:12px;font-weight:800;color:var(--ink-2);padding-top:11px;text-align:right;font-variant-numeric:tabular-nums}
.at-hr small{display:block;font-weight:600;color:var(--ink-muted)}
.at-now{display:grid;grid-template-columns:62px 1fr;gap:10px;align-items:center;margin:4px 0}
.at-now span{font-size:11px;font-weight:800;color:var(--err);text-align:right}
.at-now i{height:2px;background:var(--err);border-radius:2px;position:relative}
.at-now i:before{content:'';position:absolute;left:-5px;top:-4px;width:10px;height:10px;border-radius:50%;background:var(--err)}
.at-free{display:grid;grid-template-columns:62px minmax(0,1fr);gap:10px}
.at-free button{border:1px dashed var(--border-2);background:transparent;color:var(--ink-muted);border-radius:10px;padding:7px 12px;text-align:left;font-size:12px;cursor:pointer}
.at-free button:hover{color:var(--ink);border-color:var(--info);background:color-mix(in srgb,var(--info) 7%,transparent)}

/* semana */
.at-week{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}
.at-wcol{background:var(--bg-3);border-radius:10px;min-height:340px;display:flex;flex-direction:column;border:1px solid transparent}
.at-wcol.today{border-color:var(--info)}
.at-wcol.past{opacity:.78}
.at-whead{padding:8px 8px 6px;display:flex;align-items:baseline;gap:6px;cursor:pointer;border-radius:10px 10px 0 0}
.at-whead:hover{background:color-mix(in srgb,var(--info) 8%,transparent)}
.at-whead b{font-size:18px;font-weight:800}
.at-whead span{font-size:11px;font-weight:800;text-transform:uppercase;color:var(--ink-muted)}
.at-wcol.today .at-whead b{color:var(--info)}
.at-whead .at-add{margin-left:auto;opacity:0;border:0;background:transparent;color:var(--ink-muted);font-size:18px;cursor:pointer;line-height:1}
.at-wcol:hover .at-add{opacity:1}
.at-wbody{padding:0 5px 8px;display:flex;flex-direction:column;gap:4px;flex:1}
.at-mc{background:var(--bg-2);border:1px solid var(--border);border-left:3px solid var(--c);border-radius:7px;padding:5px 7px;cursor:pointer;font-size:11.5px;line-height:1.25;touch-action:none}
.at-mc:hover{border-color:var(--border-2)}
.at-mc b{display:block;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.at-mc small{color:var(--ink-muted);font-weight:700;font-variant-numeric:tabular-nums}
.at-mc.done b{text-decoration:line-through;color:var(--ink-muted)}
.at-dg{cursor:grab}

/* mês */
.at-mhead{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px;margin-bottom:4px}
.at-mhead div{text-align:center;font-size:11px;font-weight:800;text-transform:uppercase;color:var(--ink-muted)}
.at-month{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
.at-mcell{min-height:108px;background:var(--bg-3);border-radius:9px;padding:4px 4px 5px;display:flex;flex-direction:column;gap:2px;cursor:pointer;border:1px solid transparent;min-width:0}
.at-mcell:hover{border-color:var(--border-2)}
.at-mcell.out{opacity:.45}
.at-mcell.today{border-color:var(--info)}
.at-mnum{font-size:12px;font-weight:800;padding:1px 4px;display:flex;align-items:center}
.at-mcell.today .at-mnum b{background:var(--info);color:#fff;border-radius:999px;padding:0 6px}
.at-mchip{font-size:10.5px;font-weight:600;padding:2px 5px;border-radius:5px;background:var(--bg-2);border-left:3px solid var(--c);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;touch-action:none}
.at-mchip.done{text-decoration:line-through;opacity:.6}
.at-more{font-size:10.5px;font-weight:800;color:var(--ink-muted);padding-left:4px}
.at-dots{display:none;gap:2px;flex-wrap:wrap;padding:0 3px}
.at-dots i{width:6px;height:6px;border-radius:50%;background:var(--c)}

/* quadro */
.at-board{display:flex;gap:10px;overflow-x:auto;padding-bottom:6px;align-items:flex-start}
.at-bcol{flex:0 0 262px;background:var(--bg-3);border-radius:12px;padding:9px;min-height:200px}
.at-bcol-h{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:800;margin-bottom:8px;color:var(--sc)}
.at-bcol-h em{margin-left:auto;font-style:normal;background:var(--bg-2);color:var(--ink-muted);border-radius:999px;padding:0 8px;font-size:11px}
.at-bcol .at-list{gap:6px}
.at-bcol .at-item{grid-template-columns:auto minmax(0,1fr);padding:8px 9px}
.at-bcol .at-acts{display:none}
.at-bcol .at-t{white-space:normal}

/* lateral */
.at-side .at-card{padding:12px 14px}
.at-side h4{margin:0 0 8px;font-size:13px;font-weight:800;display:flex;align-items:center;gap:6px}
.at-mini-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
.at-mini-g{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center}
.at-mini-g span{font-size:10px;font-weight:800;color:var(--ink-muted);padding:2px 0}
.at-mini-g button{border:0;background:transparent;color:var(--ink);font-size:12px;height:30px;border-radius:8px;cursor:pointer;position:relative;font-variant-numeric:tabular-nums}
.at-mini-g button:hover{background:var(--bg-3)}
.at-mini-g button.out{color:var(--ink-muted);opacity:.5}
.at-mini-g button.today{color:var(--info);font-weight:900}
.at-mini-g button.sel{background:var(--psm-navy);color:var(--psm-cream)}
.at-mini-g button.has:after{content:'';position:absolute;bottom:4px;left:50%;transform:translateX(-50%);width:4px;height:4px;border-radius:50%;background:var(--info)}
.at-mini-g button.late:after{background:var(--err)}
.at-cx-row{display:grid;grid-template-columns:26px minmax(0,1fr);gap:8px;padding:10px 0;border-top:1px solid var(--border)}
.at-cx-row:first-of-type{border-top:0;padding-top:2px}
.at-cx-ico{font-size:17px;line-height:1.2}
.at-cx-t b{display:block;font-size:12.5px}
.at-cx-t small{display:block;font-size:11.5px;color:var(--ink-muted);line-height:1.35;margin-top:1px}
.at-cx-t .ok{color:var(--ok);font-weight:700}
.at-cx-t .err{color:var(--err);font-weight:700}
.at-cx-bts{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}
.at-cx-f{display:grid;grid-template-columns:1fr auto;gap:6px 8px;align-items:center;margin-top:8px;font-size:12px}
.at-cx-f select{height:28px;border-radius:7px;border:1px solid var(--border);background:var(--bg);color:var(--ink);font-size:12px;padding:0 6px}
.at-cx-url{display:flex;gap:6px;margin-top:7px}
.at-cx-url input{flex:1;min-width:0;height:28px;border-radius:7px;border:1px solid var(--border);background:var(--bg);color:var(--ink-2);font-size:11px;padding:0 8px;font-family:var(--font-mono)}
.at-help{font-size:11.5px;color:var(--ink-muted);margin-top:6px;line-height:1.45}
.at-help summary{cursor:pointer;font-weight:700;color:var(--ink-2)}
.at-help ol{margin:6px 0 0;padding-left:18px}

/* painel lateral de detalhes (drawer) */
.at-dr-bg{position:fixed;inset:0;background:rgba(5,8,15,.45);z-index:9500;animation:atFade .15s ease}
.at-dr{position:fixed;top:0;right:0;bottom:0;width:440px;max-width:100vw;background:var(--bg-2);border-left:1px solid var(--border);z-index:9501;display:flex;flex-direction:column;box-shadow:var(--shadow-lg);animation:atIn .2s ease}
.at-dr-h{padding:14px 16px 12px;border-bottom:1px solid var(--border);border-top:5px solid var(--c)}
.at-dr-k{display:flex;align-items:center;gap:8px;font-size:11.5px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--ink-muted)}
.at-dr-k .at-ib{margin-left:auto}
.at-dr-t{font-family:var(--font-display);font-size:20px;font-weight:700;margin:8px 0 0;line-height:1.25;word-break:break-word}
.at-dr-b{padding:14px 16px;overflow-y:auto;flex:1}
.at-dl{display:grid;grid-template-columns:24px minmax(0,1fr);gap:9px 8px;font-size:13px;margin:0}
.at-dl dt{font-size:15px;text-align:center}
.at-dl dd{margin:0;line-height:1.4;word-break:break-word}
.at-dl dd small{display:block;color:var(--ink-muted);font-size:11.5px}
.at-dr-desc{white-space:pre-wrap;font-size:13px;background:var(--bg-3);border-radius:10px;padding:10px 12px;margin-top:12px;line-height:1.5;word-break:break-word}
.at-dr-a{display:flex;gap:6px;flex-wrap:wrap;padding:12px 16px;border-top:1px solid var(--border);background:var(--bg-2)}
.at-dr-a .btn{border-radius:9px}
.at-pill{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:800;padding:2px 9px;border-radius:999px;background:var(--bg-3);color:var(--ink-2)}
@keyframes atIn{from{transform:translateX(24px);opacity:0}to{transform:none;opacity:1}}
@keyframes atFade{from{opacity:0}to{opacity:1}}
@keyframes atUp{from{transform:translateY(30px);opacity:0}to{transform:none;opacity:1}}

/* modal */
.at-mo-bg{position:fixed;inset:0;background:rgba(5,8,15,.55);z-index:9600;display:flex;align-items:flex-start;justify-content:center;padding:6vh 14px 14px;overflow:auto;animation:atFade .15s ease}
.at-mo{background:var(--bg-2);border:1px solid var(--border);border-radius:16px;width:100%;max-width:580px;box-shadow:var(--shadow-lg);animation:atUp .18s ease}
.at-mo-h{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--border)}
.at-mo-h h3{margin:0;font-size:16px;flex:1;font-family:var(--font-display)}
.at-mo-b{padding:14px 18px}
.at-mo-f{display:flex;gap:8px;align-items:center;padding:12px 18px;border-top:1px solid var(--border)}
.at-f{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px 10px}
.at-f .c6{grid-column:span 6}.at-f .c3{grid-column:span 3}.at-f .c2{grid-column:span 2}.at-f .c4{grid-column:span 4}
.at-f label{display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:800;color:var(--ink-muted);text-transform:uppercase;letter-spacing:.4px}
.at-f input,.at-f select,.at-f textarea{height:38px;border-radius:9px;border:1px solid var(--border-2);background:var(--bg);color:var(--ink);padding:0 10px;font-size:13.5px;font-weight:500;text-transform:none;letter-spacing:0;width:100%}
.at-f textarea{height:auto;padding:8px 10px;resize:vertical;min-height:62px;line-height:1.45}
.at-f input:focus,.at-f select:focus,.at-f textarea:focus{outline:none;border-color:var(--info);box-shadow:0 0 0 3px color-mix(in srgb,var(--info) 20%,transparent)}
.at-f .at-title-in{height:46px;font-size:16px;font-weight:700}
.at-f .inline{flex-direction:row;align-items:center;gap:7px;text-transform:none;font-size:12.5px;color:var(--ink-2);letter-spacing:0;font-weight:600}
.at-f .inline input{width:auto;height:auto}
.at-pchips{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px}
.at-pchip{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:600;padding:3px 4px 3px 9px;border-radius:999px;background:var(--bg-3);border:1px solid var(--border);text-transform:none;letter-spacing:0;color:var(--ink)}
.at-pchip button{border:0;background:transparent;color:var(--ink-muted);cursor:pointer;font-size:13px;line-height:1;padding:0 4px}
.at-err{color:var(--err);font-size:12.5px;font-weight:600}
.at-mo-f .at-sp{flex:1}

/* toast + popover */
.at-toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);background:#0f172a;color:#f8fafc;padding:10px 12px 10px 16px;border-radius:12px;font-size:13px;font-weight:600;z-index:9900;display:flex;gap:12px;align-items:center;box-shadow:0 10px 30px rgba(0,0,0,.35);max-width:92vw;animation:atUp .18s ease}
.at-toast button{border:0;background:rgba(255,255,255,.12);color:#fff;font-weight:800;border-radius:8px;padding:6px 10px;cursor:pointer}
.at-pop{position:fixed;z-index:9800;background:var(--bg-2);border:1px solid var(--border-2);border-radius:12px;box-shadow:var(--shadow-lg);padding:6px;min-width:210px;animation:atFade .12s ease}
.at-pop button{display:flex;width:100%;align-items:center;gap:8px;border:0;background:transparent;color:var(--ink);padding:8px 10px;border-radius:8px;cursor:pointer;font-size:13px;text-align:left}
.at-pop button:hover{background:var(--bg-3)}
.at-pop button small{margin-left:auto;color:var(--ink-muted);font-size:11.5px}
.at-pop input{width:100%;height:34px;border-radius:8px;border:1px solid var(--border-2);background:var(--bg);color:var(--ink);padding:0 8px;margin-top:4px}
.at-pop hr{border:0;border-top:1px solid var(--border);margin:4px 0}

/* indicadores */
.at-ind-h{display:flex;align-items:center;gap:10px;width:100%;padding:12px 16px;border:0;background:transparent;color:var(--ink);cursor:pointer;font-size:14px;font-weight:800;text-align:left;font-family:var(--font-display)}
.at-ind-h span{margin-left:auto;font-family:var(--font-sans);font-size:12px;color:var(--ink-muted);font-weight:700}
.at-ind-b{padding:0 16px 16px}
.at-ind-b .card{box-shadow:none}

/* celular */
@media (max-width:760px){
  .at-top{padding:14px 14px 12px}
  .at-hello{font-size:19px}
  .at-quick .at-seg{order:-1;width:100%;height:38px}
  .at-quick .at-seg button{flex:1}
  .at-quick-in{min-width:100%}
  .at-quick .btn{flex:1}
  .at-main{padding:12px 10px 12px}
  .at-search input{width:100%}
  .at-search{flex:1;min-width:140px}
  .at-bar .at-seg{width:100%;overflow-x:auto}
  .at-bar .at-seg button{flex:1;padding:0 8px}
  .at-item{grid-template-columns:auto minmax(0,1fr)}
  .at-item .at-acts{display:none}
  .at-slot,.at-now,.at-free{grid-template-columns:46px minmax(0,1fr);gap:8px}
  .at-mcell{min-height:56px}
  .at-mcell .at-mchip,.at-mcell .at-more{display:none}
  .at-dots{display:flex}
  .at-dr{top:auto;height:92vh;width:100%;border-left:0;border-top:1px solid var(--border);border-radius:18px 18px 0 0;animation:atUp .2s ease}
  .at-dr-h{border-radius:18px 18px 0 0}
  .at-f .c3,.at-f .c2,.at-f .c4{grid-column:span 6}
  .at-f .c2.keep{grid-column:span 3}
  .at-mo-bg{padding:0;align-items:flex-end}
  .at-mo{border-radius:18px 18px 0 0;max-height:94vh;overflow-y:auto}
  .at-check-lbl{margin-left:0}
}
`;

export function injetarCss() {
  if (document.getElementById('at-css')) return;
  const st = document.createElement('style');
  st.id = 'at-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}

let _toastEl = null, _toastTimer = null;
/** toast('Salvo') · toast('Concluída', { acao: 'Desfazer', onAcao: fn }) */
export function toast(msg, { acao, onAcao, ms } = {}) {
  try {
    if (_toastEl) _toastEl.remove();
    clearTimeout(_toastTimer);
    const el = document.createElement('div');
    el.className = 'at-toast';
    el.setAttribute('role', 'status');
    el.innerHTML = `<span>${esc(msg)}</span>${acao ? `<button type="button">${esc(acao)}</button>` : ''}`;
    if (acao) el.querySelector('button').onclick = () => { el.remove(); _toastEl = null; try { onAcao && onAcao(); } catch (_) {} };
    document.body.appendChild(el);
    _toastEl = el;
    _toastTimer = setTimeout(() => { el.remove(); if (_toastEl === el) _toastEl = null; }, ms || (acao ? 7000 : 3800));
  } catch (_) { /* noop */ }
}

/** Modal leve: devolve { el, fechar }. Esc e clique fora fecham. */
export function abrirModal({ titulo, corpo, rodape, largura }) {
  fecharModal();
  const bg = document.createElement('div');
  bg.className = 'at-mo-bg';
  bg.id = 'at-modal';
  bg.innerHTML = `<div class="at-mo" role="dialog" aria-modal="true" aria-label="${esc(titulo)}" ${largura ? `style="max-width:${largura}px"` : ''}>
      <div class="at-mo-h"><h3>${esc(titulo)}</h3><button type="button" class="at-ib" data-mo-x aria-label="Fechar">✕</button></div>
      <div class="at-mo-b">${corpo || ''}</div>
      ${rodape ? `<div class="at-mo-f">${rodape}</div>` : ''}
    </div>`;
  document.body.appendChild(bg);
  const fechar = () => { bg.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); fechar(); } };
  document.addEventListener('keydown', onKey, true);
  bg.addEventListener('mousedown', e => { if (e.target === bg) fechar(); });
  bg.querySelector('[data-mo-x]').onclick = fechar;
  bg._fechar = fechar;
  return { el: bg, fechar };
}
export function fecharModal() {
  const m = document.getElementById('at-modal');
  if (m && m._fechar) m._fechar(); else if (m) m.remove();
}

/** Popover ancorado num elemento. itens: [{lbl, dica, on}] | {html, montar(el)} */
export function abrirPop(ancora, itens, { html, montar } = {}) {
  fecharPop();
  const pop = document.createElement('div');
  pop.className = 'at-pop';
  pop.id = 'at-pop';
  pop.innerHTML = html || itens.map((it, i) => it === '-' ? '<hr>' : `<button type="button" data-i="${i}">${esc(it.lbl)}${it.dica ? `<small>${esc(it.dica)}</small>` : ''}</button>`).join('');
  document.body.appendChild(pop);
  const r = ancora.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  let left = Math.min(r.left, window.innerWidth - w - 10);
  let top = r.bottom + 6;
  if (top + h > window.innerHeight - 10) top = Math.max(10, r.top - h - 6);
  pop.style.left = Math.max(10, left) + 'px';
  pop.style.top = top + 'px';
  if (!html) pop.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { fecharPop(); itens[+b.dataset.i].on(); });
  if (montar) montar(pop);
  setTimeout(() => {
    const fora = e => { if (!pop.contains(e.target)) { fecharPop(); } };
    const tecla = e => { if (e.key === 'Escape') fecharPop(); };
    document.addEventListener('mousedown', fora, true);
    document.addEventListener('keydown', tecla, true);
    pop._limpa = () => { document.removeEventListener('mousedown', fora, true); document.removeEventListener('keydown', tecla, true); };
  }, 0);
  return pop;
}
export function fecharPop() {
  const p = document.getElementById('at-pop');
  if (p) { if (p._limpa) p._limpa(); p.remove(); }
}
