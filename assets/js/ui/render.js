// ═══════════════════════════════════════════════════════
// MÓDULO: Renderizado de UI
// Grids de organización, redundancia y vendor NAPALM
// ═══════════════════════════════════════════════════════

function renderOrgs(){
  document.getElementById('org-grid').innerHTML=ORG_TYPES.map(o=>
    `<div class="org-card ${o.id===S.orgType?'selected':''}" onclick="selectOrg('${o.id}')">
      <div class="org-icon">${o.icon}</div>
      <div class="org-name">${o.name}</div>
      <div class="org-desc">${o.desc}</div>
    </div>`).join('');
}

function selectOrg(id){S.orgType=id;renderOrgs();onBuildChange();}

function renderRedund(){
  document.getElementById('redund-grid').innerHTML=REDUND.map(r=>
    `<div class="redund-card ${r.id===S.redund?'selected':''}" onclick="selectRedund('${r.id}')">
      <div class="rc-diagram">${r.icon}</div>
      <div class="rc-name">${r.name}</div>
      <div class="rc-desc">${r.detail}</div>
      <span class="rc-badge ${r.cls}">${r.badge}</span>
    </div>`).join('');
  const r=REDUND.find(x=>x.id===S.redund);
  document.getElementById('redund-explain-text').innerHTML=`<strong>${r.name}</strong>: ${r.desc}`;
}

function selectRedund(id){S.redund=id;renderRedund();}

function renderVendorGrid(){
  document.getElementById('vendor-grid').innerHTML=NAPALM_VENDORS.map(v=>
    `<div class="vendor-btn ${v.id===S.napalmDriver?'selected':''}" onclick="selectNapalmDriver('${v.id}')">
      <div class="vb-icon">${v.icon}</div>
      <div class="vb-name">${v.name}</div>
      <div class="vb-type">${v.driver}</div>
    </div>`).join('');
}

function selectNapalmDriver(id){
  S.napalmDriver=id;
  renderVendorGrid();
  updateNapalmNote();
  renderAllExport();
}

function updateNapalmNote(){
  const el=document.getElementById('py-lib-note');
  if(!el) return;
  const v=NAPALM_VENDORS.find(x=>x.id===S.napalmDriver);
  if(!v) return;
  const isOfficial=['ios','nxos_ssh','junos'].includes(v.id);
  el.innerHTML=`<div class="alert-icon">${isOfficial?'✅':'⚠️'}</div>
    <div class="alert-body">
      <strong>NAPALM driver:</strong> <code style="color:var(--primary)">"${v.driver}"</code> · ${v.name}<br>
      <span style="color:var(--text3)">Instalar: </span><code>pip install nornir nornir-napalm nornir-utils ${v.install}</code><br>
      ${isOfficial
        ? `<span style="color:var(--green2)">✅ Driver oficial NAPALM — soporte completo garantizado</span>`
        : `<span style="color:var(--amber2)">⚠️ Driver de comunidad — verificar compatibilidad con tu versión de firmware</span>`
      }
      <br><span style="color:var(--text3)">${v.note}</span>
    </div>`;
}

// ══════════════════════════════════════════════════
// BUILD CHANGE
// ══════════════════════════════════════════════════

