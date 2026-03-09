// ═══════════════════════════════════════════════════════
// MÓDULO: Exportación
// Configs por vendor, JSON estructurado, descarga
// ═══════════════════════════════════════════════════════

function renderAllExport(){
  // Cisco IOS/XE
  let ch=makeCfgBlock('CORE / CPD','CORE-SW-01','🔵 Cisco IOS/XE — Core L3',ciscoCore());
  S.infra.filter(f=>!f.isCore).forEach(f=>{
    const dist=f.devices.find(d=>d.type==='dist');
    ch+=makeCfgBlock(f.label,dist?.hostname||'DIST-SW','🔵 Cisco — Distribución',ciscoFloor(f));
    f.devices.filter(d=>d.type==='acc').forEach(acc=>{
      ch+=makeCfgBlock(f.label,acc.hostname,'🔵 Cisco — Acceso',ciscoAccess(f,acc));
    });
  });
  document.getElementById('vp-cisco').innerHTML=ch;

  // Huawei VRP
  let hh=makeCfgBlock('CORE / CPD','CORE-SW-01','🔴 Huawei VRP — Core',huaweiCore());
  S.infra.filter(f=>!f.isCore).forEach(f=>{
    const dist=f.devices.find(d=>d.type==='dist');
    hh+=makeCfgBlock(f.label,dist?.hostname||'DIST-SW','🔴 Huawei — Distribución',huaweiFloor(f));
    f.devices.filter(d=>d.type==='acc').forEach(acc=>{
      hh+=makeCfgBlock(f.label,acc.hostname,'🔴 Huawei — Acceso',huaweiAccess(f,acc));
    });
  });
  document.getElementById('vp-huawei').innerHTML=hh;

  // Fortinet
  document.getElementById('vp-fortinet').innerHTML=makeCfgBlock('FortiGate — Config Completa','FW-CORE-01','🟠 Fortinet FortiOS',fortiCore());

  // Nornir + NAPALM
  const vObj=NAPALM_VENDORS.find(v=>v.id===S.napalmDriver)||NAPALM_VENDORS[0];
  document.getElementById('vp-nornir').innerHTML=makeCfgBlock(
    `Script Nornir+NAPALM — ${vObj.name}`,`deploy_network.py`,
    `🐍 Python 3 · Nornir 3.x + NAPALM 4.x · SSH · driver: ${vObj.driver}`,
    nornirScript()
  );

  // JSON export preview
  const jsonData=buildExportJSON();
  const jsonEl=document.getElementById('json-preview');
  if(jsonEl) jsonEl.textContent=JSON.stringify(jsonData,null,2);
  const kb=Math.round(JSON.stringify(jsonData).length/1024*10)/10;
  const lbl=document.getElementById('json-size-lbl');
  if(lbl) lbl.textContent=`~${kb} KB · ${S.results.length} VLANs · ${Object.keys(jsonData.devices||{}).length} dispositivos`;
}

function setVendor(n){
  document.querySelectorAll('.vpanel').forEach(e=>e.classList.remove('active'));
  document.querySelectorAll('.vtab').forEach(e=>e.classList.remove('active'));
  document.getElementById('vp-'+n)?.classList.add('active');
  document.querySelector('.vtab.'+n)?.classList.add('active');
  const nornirCfg=document.getElementById('py-cfg-section');
  const jsonCfg=document.getElementById('json-cfg-section');
  const dlBtn=document.getElementById('btn-dl-json');
  if(nornirCfg) nornirCfg.style.display=n==='nornir'?'block':'none';
  if(jsonCfg)   jsonCfg.style.display=n==='jsonexp'?'block':'none';
  if(dlBtn)     dlBtn.style.display=n==='jsonexp'?'inline-flex':'none';
}

// ── JSON Export ───────────────────────────────────

function buildExportJSON(){
  const dhcpSrv=getDhcpServerIp();
  const d1=getDns1(),d2=getDns2(),dom=getDomain();
  const vObj=NAPALM_VENDORS.find(v=>v.id===S.napalmDriver)||NAPALM_VENDORS[0];
  const pairs=allowedPairs().map(([a,b])=>[a.vlan,b.vlan]);
  const org=ORG_TYPES.find(o=>o.id===S.orgType);
  const devices={};
  S.infra.forEach(f=>f.devices.forEach(d=>{
    if(!d.mgmt) return;
    devices[d.hostname]={
      hostname:d.hostname, management_ip:d.mgmt,
      role:d.role, layer:d.type, location:f.isCore?'Core/CPD':'Piso '+f.floor,
      napalm_driver:vObj.driver, ssh_port:22,
      groups:['network', d.type==='core'?'core':d.type==='dist'?'distribution':'access']
    };
  }));
  return {
    meta:{
      schema_version:'1.0', tool:'NetPlan Pro', tool_version:'3.0',
      generated_at:new Date().toISOString(),
      napalm_driver:vObj.driver, napalm_vendor:vObj.name,
      description:'Consumir con deploy_network.py (Nornir 3.x + NAPALM 4.x). Campo dry_run_by_default controla modo de ejecución.'
    },
    network:{
      base_network:S.net, prefix:S.pfx, mask:maskFromPfx(S.pfx), dhcp_server:dhcpSrv
    },
    organization:{
      type:S.orgType, name:org?.name||S.orgType,
      floors:+(document.getElementById('b-floors')?.value)||5,
      core_floor:+(document.getElementById('b-core')?.value)||1,
      redundancy:S.redund,
      hosts_per_floor:+(document.getElementById('b-hpf')?.value)||150
    },
    services:{
      dns_primary:d1, dns_secondary:d2,
      ntp:document.getElementById('tog-ntp')?.checked?(document.getElementById('svc-ntp')?.value||null):null,
      domain:document.getElementById('tog-domain')?.checked?dom:null
    },
    ipv6:{
      enabled:S.v6Enabled,
      mode:S.v6Enabled?S.v6Mode:null,
      site_prefix:S.v6Enabled?(getV6SitePrefix()+'::/48'):null
    },
    vlans:S.results.map(r=>({
      id:r.vlan, name:r.name, type:r.type, hosts_required:r.hosts,
      ipv4:{
        prefix_length:r.prefix, network:r.network, mask:r.mask, wildcard:r.wildcard,
        gateway:r.gateway, pool_start:r.poolStart, pool_end:r.poolEnd,
        broadcast:r.broadcast, hosts_available:r.hostsAvail, efficiency_pct:r.efficiency
      },
      ipv6:S.v6Enabled?{
        subnet:r.v6subnet, gateway:r.v6gateway,
        pool_start:r.v6poolStart, pool_end:r.v6poolEnd, mode:S.v6Mode
      }:null
    })),
    policies:{
      mode:'whitelist',
      allowed_pairs:pairs,
      description:'Solo pares listados se comunican entre VLANs. Todo lo demás bloqueado.'
    },
    devices,
    nornir:{
      runner:'threaded', num_workers:10, ssh_port:22,
      timeout:60, dry_run_by_default:true,
      note:'Producción: python deploy_network.py --deploy'
    }
  };
}

function downloadJSON(){
  const data=buildExportJSON();
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=`netplan_export_${new Date().toISOString().slice(0,10)}.json`;
  a.click(); URL.revokeObjectURL(url);
  showToast('✅ JSON descargado correctamente');
}

function copyJSON(){
  navigator.clipboard.writeText(JSON.stringify(buildExportJSON(),null,2))
    .then(()=>showToast('✅ JSON copiado al portapapeles'));
}

