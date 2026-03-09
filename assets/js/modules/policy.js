// ═══════════════════════════════════════════════════════
// MÓDULO: Políticas inter-VLAN
// Matriz de comunicación, ACLs y reglas de seguridad
// ═══════════════════════════════════════════════════════

function calcInfra(){
  const floors=+document.getElementById('b-floors').value||5;
  const coreF=+document.getElementById('b-core').value||1;
  const hpf=+document.getElementById('b-hpf').value||150;
  const ports=+document.getElementById('b-ports').value||48;
  const mgmt=S.results.find(r=>r.type==='Gestión')||S.results[0];
  S.infra=[];
  S.infra.push({floor:coreF,label:`Piso ${coreF} — CORE/CPD`,isCore:true,devices:[
    {type:'fw',  icon:'🛡️',hostname:'FW-CORE-01',    role:'Firewall',      mgmt:mgmt?intToIp(mgmt.networkInt+3):null},
    {type:'rtr', icon:'🔀',hostname:'ROUTER-CORE-01',role:'Router Core',   mgmt:mgmt?intToIp(mgmt.networkInt+4):null},
    {type:'csw1',icon:'🔵',hostname:'CORE-SW-01',    role:'Core SW 1',     mgmt:mgmt?intToIp(mgmt.networkInt+5):null},
    {type:'csw2',icon:'🔵',hostname:'CORE-SW-02',    role:'Core SW 2',     mgmt:mgmt?intToIp(mgmt.networkInt+6):null},
    {type:'srv', icon:'🖥️',hostname:'DHCP-SRV-01',   role:'DHCP/DNS Srv',  mgmt:mgmt?intToIp(mgmt.networkInt+2):null},
  ],vlans:S.vlans.map(v=>v.id)});
  for(let f=1;f<=floors;f++){
    if(f===coreF)continue;
    const acc=Math.max(1,Math.ceil(hpf/ports));
    const devs=[{type:'dist',icon:'🔷',hostname:`DIST-SW-P${f}-01`,role:'Distribución',mgmt:mgmt?intToIp(mgmt.networkInt+f*10):null}];
    for(let a=1;a<=acc;a++)devs.push({type:'acc',icon:'🟦',hostname:`ACC-SW-P${f}-0${a}`,role:`Acceso #${a}`,mgmt:mgmt?intToIp(mgmt.networkInt+f*10+a):null});
    S.infra.push({floor:f,label:`Piso ${f}`,isCore:false,devices:devs,vlans:S.vlans.map(v=>v.id),acc});
  }
}

// ══════════════════════════════════════════════════
// COMM MATRIX
// ══════════════════════════════════════════════════

function initComm(){
  S.vlans.forEach(a=>S.vlans.forEach(b=>{
    if(a.id===b.id)return;
    const k=`${a.id}_${b.id}`;
    if(S.comm[k]===undefined)S.comm[k]=defaultComm(a,b);
  }));
}

function setDefaultComm(){S.vlans.forEach(a=>S.vlans.forEach(b=>{if(a.id!==b.id)S.comm[`${a.id}_${b.id}`]=defaultComm(a,b);}));renderCommMatrix();renderPolicyRules();}

function setAllComm(v){S.vlans.forEach(a=>S.vlans.forEach(b=>{if(a.id!==b.id)S.comm[`${a.id}_${b.id}`]=v;}));renderCommMatrix();renderPolicyRules();}

function renderCommMatrix(){
  const vl=S.vlans;
  let h=`<thead><tr><th>↕</th>${vl.map(v=>`<th title="${v.name}" style="color:${TYPE_COLOR[v.type]||'#aaa'}">${v.id}<br><span style="font-size:8px;opacity:.6">${v.name.substring(0,5)}</span></th>`).join('')}</tr></thead><tbody>`;
  vl.forEach(a=>{
    h+=`<tr><th style="color:${TYPE_COLOR[a.type]||'#aaa'}">VLAN ${a.id}<br><span style="font-size:8px">${a.name.substring(0,7)}</span></th>`;
    vl.forEach(b=>{
      if(a.id===b.id){h+=`<td class="self">—</td>`;return;}
      const k=`${a.id}_${b.id}`;
      const ok=S.comm[k];
      h+=`<td class="${ok?'allow':'block'}"><input type="checkbox" ${ok?'checked':''} onchange="S.comm['${k}']=this.checked;renderCommMatrix();renderPolicyRules()"></td>`;
    });
    h+=`</tr>`;
  });
  h+='</tbody>';
  document.getElementById('comm-table').innerHTML=h;
}

function renderPolicyRules(){
  const rules=[];
  const shown=new Set();
  S.vlans.forEach(a=>S.vlans.forEach(b=>{
    if(a.id>=b.id)return;
    const fwd=S.comm[`${a.id}_${b.id}`],rev=S.comm[`${b.id}_${a.id}`];
    const key=`${a.id}-${b.id}`;
    if(!shown.has(key)){
      shown.add(key);
      if(fwd||rev){rules.push({allow:true,text:`VLAN ${a.id} ↔ VLAN ${b.id}`});}
      else{rules.push({allow:false,text:`VLAN ${a.id} ✕ VLAN ${b.id}`});}
    }
  }));
  const el=document.getElementById('policy-rules');
  if(!el)return;
  document.getElementById('policy-auto-text').innerHTML=
    `<strong>${rules.filter(r=>r.allow).length} pares permitidos</strong>, <strong>${rules.filter(r=>!r.allow).length} bloqueados</strong>. Políticas generadas según perfil de seguridad.`;
  el.innerHTML=`<div style="font-family:var(--mono);font-size:9px;color:var(--text3);letter-spacing:1px;margin-bottom:6px;text-transform:uppercase">Pares de comunicación</div>`+
    rules.slice(0,12).map(r=>`<div class="pr-item ${r.allow?'allow':'block'}">${r.allow?'✅':'🚫'} ${r.text}</div>`).join('')+
    (rules.length>12?`<div style="font-family:var(--mono);font-size:9px;color:var(--text3);padding:4px 8px">+${rules.length-12} más…</div>`:'');
}

function allowedPairs(){
  const p=[];
  S.results.forEach(a=>S.results.forEach(b=>{
    if(a.vlan>=b.vlan)return;
    if(S.comm[`${a.vlan}_${b.vlan}`])p.push([a,b]);
  }));
  return p;
}

// ══════════════════════════════════════════════════
// SUMMARY
// ══════════════════════════════════════════════════

