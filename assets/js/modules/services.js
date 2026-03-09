// ═══════════════════════════════════════════════════════
// MÓDULO: Servicios de Red
// Toggles DNS, NTP, dominio e IPv6 Dual-Stack
// ═══════════════════════════════════════════════════════

function toggleSvc(id){
  const on=document.getElementById('tog-'+id).checked;
  document.getElementById('cfg-'+id).classList.toggle('show',on);
  updatePreview();
}

// ══════════════════════════════════════════════════
// AUTO VLAN GENERATION + PROGRESS BAR
// ══════════════════════════════════════════════════

function toggleIPv6(){
  S.v6Enabled=document.getElementById('tog-v6').checked;
  document.getElementById('cfg-v6').style.display=S.v6Enabled?'block':'none';
  const badge=document.getElementById('ds-topbadge');
  badge.style.display=S.v6Enabled?'flex':'none';
  updateV6Preview();
  updatePreview();
  updateSideStatus();
}

function selectV6Mode(mode){
  S.v6Mode=mode;
  ['slaac','dhcpv6','both'].forEach(m=>{
    document.getElementById('mc-'+m).classList.toggle('selected',m===mode);
  });
  updateV6Preview();
}

function selectV6PfxType(type){
  S.v6PfxType=type;
  document.getElementById('pfx-ula').classList.toggle('selected',type==='ula');
  document.getElementById('pfx-gua').classList.toggle('selected',type==='gua');
  document.getElementById('cfg-v6-custom').style.display=type==='gua'?'block':'none';
  updateV6Preview();
  updatePreview();
}

function updateV6Preview(){
  const box=document.getElementById('v6-preview-box');
  if(!box||!S.v6Enabled){return;}
  const site=getV6SitePrefix();
  const modeLabel={slaac:'SLAAC (RA)',dhcpv6:'DHCPv6 Stateful',both:'SLAAC + DHCPv6 Stateless'};
  let h=`<div style="color:var(--cyan);margin-bottom:6px">🌐 Prefijo Site: <strong>${site}::/48</strong></div>`;
  h+=`<div style="color:var(--text3);margin-bottom:8px">Modo: <span style="color:var(--indigo)">${modeLabel[S.v6Mode]}</span></div>`;
  if(S.vlans.length>0){
    h+=`<div style="color:var(--text3);margin-bottom:4px">Ejemplo VLAN ${S.vlans[0].id} (${S.vlans[0].name}):</div>`;
    const sub=getV6Subnet(S.vlans[0].id);
    const gw=getV6Gateway(S.vlans[0].id);
    h+=`<div>Subred: <span style="color:var(--cyan)">${sub}</span></div>`;
    h+=`<div>Gateway: <span style="color:var(--indigo)">${gw}</span></div>`;
    if(S.v6Mode!=='slaac') h+=`<div>Pool: <span style="color:var(--green)">${getV6PoolStart(S.vlans[0].id)} → ${getV6PoolEnd(S.vlans[0].id)}</span></div>`;
    h+=`<div style="color:var(--text3);margin-top:4px">Total VLANs con /64: <strong style="color:var(--primary)">${S.vlans.length}</strong></div>`;
  } else {
    h+=`<div style="color:var(--text3)">Completa el paso de VLANs para ver la asignación completa.</div>`;
  }
  box.innerHTML=h;
};

// ══════════════════════════════════════════════════
// DATA
// ══════════════════════════════════════════════════

