// ═══════════════════════════════════════════════════════
// MÓDULO: VLANs
// Generación automática, cálculo VLSM y renderizado de tarjetas
// ═══════════════════════════════════════════════════════

function generateVlans(skipProgress){
  const org=ORG_TYPES.find(o=>o.id===S.orgType);
  if(!org) return;
  const floors=Math.max(1,+document.getElementById('b-floors').value||5);
  const hpf=Math.max(1,+document.getElementById('b-hpf').value||150);
  const total=floors*hpf;
  S.vlans=org.vlans.map((v,i)=>{
    const hosts=Math.max(4,Math.round(total*v.pct));
    return{id:10+i*10,name:v.name,type:v.type,hosts,floor:Math.min(v.floor,floors)};
  });
  runVlanCalc(false, `${S.vlans.length} VLANs generadas · perfil ${org.name} · ${total.toLocaleString()} hosts totales`);
}

// Called when user arrives at step 4 or clicks regenerate

function runVlanCalc(regen, customMsg){
  // Always generate vlans if empty or if regen requested
  if(regen || S.vlans.length===0){
    const org=ORG_TYPES.find(o=>o.id===S.orgType);
    if(!org) return;
    const floors=Math.max(1,+document.getElementById('b-floors').value||5);
    const hpf=Math.max(1,+document.getElementById('b-hpf').value||150);
    const total=floors*hpf;
    S.vlans=org.vlans.map((v,i)=>({id:10+i*10,name:v.name,type:v.type,hosts:Math.max(4,Math.round(total*v.pct)),floor:Math.min(v.floor,floors)}));
    customMsg=customMsg||`${S.vlans.length} VLANs generadas · ${total.toLocaleString()} hosts totales`;
  }

  // Show progress, hide content
  const prog=document.getElementById('vlan-calc-progress');
  const cont=document.getElementById('vlan-content');
  prog.style.display='block';
  cont.style.display='none';

  // Reset bar
  const bar=document.getElementById('calc-bar');
  if(bar) bar.style.width='0%';

  const v6=S.v6Enabled;
  const stages=[
    {txt:'Ordenando VLANs por hosts (VLSM)',pct:15},
    {txt:'Calculando subredes IPv4',pct:35},
    {txt:'Asignando gateways y pools DHCP',pct:55},
    ...(v6?[
      {txt:'Generando prefijos IPv6 /64',pct:75},
      {txt:'Mapeando DHCPv6 / SLAAC',pct:90},
    ]:[]),
    {txt:'Renderizando tarjetas de red',pct:100},
  ];

  const titleEl=document.getElementById('calc-title');
  const subEl=document.getElementById('calc-sub');
  const stagesEl=document.getElementById('calc-stages');
  if(!titleEl||!stagesEl) return;

  stagesEl.innerHTML=stages.map((s,i)=>`
    <div class="calc-stage-row" id="csr-${i}">
      <div class="calc-stage-dot" id="csd-${i}"></div>
      <span class="calc-stage-txt" id="cst-${i}">${s.txt}</span>
    </div>`).join('');

  let si=0;
  function nextStage(){
    if(si>0){
      const prevDot=document.getElementById('csd-'+(si-1));
      const prevTxt=document.getElementById('cst-'+(si-1));
      if(prevDot) prevDot.className='calc-stage-dot done';
      if(prevTxt) prevTxt.className='calc-stage-txt done';
    }
    if(si<stages.length){
      const dot=document.getElementById('csd-'+si);
      const txt=document.getElementById('cst-'+si);
      if(dot) dot.className='calc-stage-dot active';
      if(txt) txt.className='calc-stage-txt active';
      if(bar) bar.style.width=stages[si].pct+'%';
      if(titleEl) titleEl.textContent=stages[si].txt+'…';
      if(subEl) subEl.textContent=`Paso ${si+1} de ${stages.length}`;
      si++;
      setTimeout(nextStage, 280);
    } else {
      // Done — run real calc then show content
      calcVLSM();
      if(bar) bar.style.width='100%';
      if(titleEl) titleEl.textContent='¡Cálculo completo!';
      if(subEl) subEl.textContent=v6?'IPv4 + IPv6 Dual-Stack listo':'IPv4 VLSM listo';
      // Mark last stage done
      const lastDot=document.getElementById('csd-'+(si-1));
      const lastTxt=document.getElementById('cst-'+(si-1));
      if(lastDot) lastDot.className='calc-stage-dot done';
      if(lastTxt) lastTxt.className='calc-stage-txt done';
      setTimeout(()=>{
        prog.style.display='none';
        cont.style.display='block';
        renderVlanCards(customMsg);
        updatePreview();
        updateSideStatus();
      },400);
    }
  }
  // Small delay to let DOM update before animation
  setTimeout(nextStage, 50);
}

function renderVlanCards(msg){
  const floors=Math.max(1,+document.getElementById('b-floors')?.value||5);
  const v6=S.v6Enabled;
  document.getElementById('vlan-auto-text').innerHTML=
    `<strong>${S.vlans.length} VLANs</strong> · Pool DHCP desde <strong>.2</strong> (solo .1 reservada para GW)`+(msg?` · ${msg}`:'');
  document.getElementById('vlan-count-lbl').textContent=`${S.results.length} subredes calculadas${v6?' · Dual-Stack':''}`;

  // Dual-Stack banner
  const dsBanner=document.getElementById('vlan-ds-summary');
  if(v6&&S.results.length>0){
    const site=getV6SitePrefix();
    const mL={slaac:'SLAAC',dhcpv6:'DHCPv6 Stateful',both:'SLAAC + DHCPv6 Stateless'};
    dsBanner.style.display='block';
    dsBanner.innerHTML=`<div style="background:linear-gradient(135deg,rgba(34,211,238,.07),rgba(99,102,241,.05));border:1.5px solid rgba(34,211,238,.25);border-radius:var(--r);padding:10px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span style="font-size:18px">🌐</span>
      <div>
        <div style="font-weight:800;font-size:12px;color:var(--cyan)">IPv6 Dual-Stack activo</div>
        <div style="font-family:var(--mono);font-size:9px;color:var(--text3)">Site: <strong style="color:var(--cyan)">${site}::/48</strong> · Modo: <strong style="color:var(--indigo)">${mL[S.v6Mode]}</strong> · ${S.results.length} subredes /64</div>
      </div>
      <span class="v6-badge" style="margin-left:auto">⚡ DUAL-STACK</span>
    </div>`;
  } else {
    dsBanner.style.display='none';
  }

  // Build VLAN cards
  const grid=document.getElementById('vlan-grid');
  if(!grid) return;
  // Map results by vlan id for quick lookup
  const rmap={};
  S.results.forEach(r=>rmap[r.vlan]=r);

  grid.innerHTML=S.vlans.map((v,i)=>{
    const r=rmap[v.id]||{};
    const col=TYPE_COLOR[v.type]||'#94a3b8';
    const eff=r.efficiency||0;
    return `<div class="vlan-card" id="vc-${i}">
      <div class="vlan-card-head" onclick="toggleVlanCard(${i})">
        <div class="vlan-id-badge" style="background:${col}18;color:${col};border:1px solid ${col}40;font-size:12px">${v.id}</div>
        <div>
          <div class="vlan-card-name">${v.name}</div>
          <div class="vlan-card-type">${v.type} · Piso ${v.floor} · ${v.hosts} hosts</div>
        </div>
        <div>
          <div class="vlan-card-net">${r.network||'—'}/${r.prefix||'?'}</div>
          <div class="vlan-card-pfx">${r.mask||''}</div>
        </div>
        ${v6&&r.v6subnet?`<div style="font-family:var(--mono);font-size:9px;color:var(--cyan);text-align:right;line-height:1.6">${r.v6subnet||''}</div>`:'<div></div>'}
        <div style="color:var(--text3);font-size:11px;text-align:center">▾</div>
      </div>
      <div class="vlan-card-body" id="vcb-${i}">
        <div class="vlan-info-grid">
          <!-- IPv4 Block -->
          <div class="vlan-info-block">
            <div class="vib-title v4">🔵 IPv4 — ${r.subnet||'N/A'}</div>
            <div class="vib-row"><span class="vib-k">Red</span><span class="vib-v net">${r.network||'—'}/${r.prefix||''}</span></div>
            <div class="vib-row"><span class="vib-k">Máscara</span><span class="vib-v">${r.mask||'—'}</span></div>
            <div class="vib-row"><span class="vib-k">Gateway</span><span class="vib-v gw">${r.gateway||'—'}</span></div>
            <div class="vib-row"><span class="vib-k">DHCP Pool</span><span class="vib-v pool">${r.poolStart||'—'} → ${r.poolEnd||'—'}</span></div>
            <div class="vib-row"><span class="vib-k">Broadcast</span><span class="vib-v">${r.broadcast||'—'}</span></div>
            <div class="vib-row"><span class="vib-k">Hosts útiles</span><span class="vib-v">${r.hostsAvail||'—'}</span></div>
            <div class="vib-row"><span class="vib-k">Eficiencia</span><span class="vib-v" style="color:${eff>=75?'#4ade80':eff>=40?'#fbbf24':'#f87171'}">${eff}%</span></div>
          </div>
          <!-- IPv6 Block -->
          <div class="vlan-info-block" style="${v6?'':'opacity:.35;pointer-events:none'}">
            <div class="vib-title v6">${v6?'🌐 IPv6 Dual-Stack':'🌐 IPv6 (desactivado)'}</div>
            ${v6&&r.v6subnet?`
            <div class="vib-row"><span class="vib-k">Subred /64</span><span class="vib-v v6net" style="font-size:9px">${r.v6subnet}</span></div>
            <div class="vib-row"><span class="vib-k">Gateway</span><span class="vib-v v6gw" style="font-size:9px">${r.v6gateway||'—'}</span></div>
            ${S.v6Mode!=='slaac'?`<div class="vib-row"><span class="vib-k">Pool DHCPv6</span><span class="vib-v pool" style="font-size:8.5px">${r.v6poolStart||'—'}</span></div>`:''}
            <div class="vib-row"><span class="vib-k">Modo</span><span class="vib-v" style="color:var(--indigo)">${S.v6Mode.toUpperCase()}</span></div>
            <div class="vib-row"><span class="vib-k">Tipo prefijo</span><span class="vib-v">${S.v6PfxType==='ula'?'ULA (fd::/8)':'GUA Personalizado'}</span></div>
            `:`<div style="font-family:var(--mono);font-size:9px;color:var(--text3);padding:8px 0">Activa IPv6 en el Paso 3 para ver la asignación de subredes IPv6.</div>`}
          </div>
        </div>
        <!-- Edit row -->
        <div class="vlan-edit-row">
          <input type="number" min="1" max="4094" value="${v.id}" style="text-align:center;font-family:var(--mono);font-size:11px" onchange="S.vlans[${i}].id=+this.value;calcVLSM();renderVlanCards()" title="VLAN ID">
          <input type="text" value="${v.name}" style="font-size:11px" onchange="S.vlans[${i}].name=this.value;renderVlanCards()" title="Nombre">
          <select style="font-size:10px" onchange="S.vlans[${i}].type=this.value;calcVLSM();renderVlanCards()">
            ${VLAN_TYPES.map(t=>`<option ${t===v.type?'selected':''}>${t}</option>`).join('')}
          </select>
          <input type="number" min="1" value="${v.hosts}" style="font-size:11px;font-family:var(--mono);width:70px" title="Hosts" oninput="S.vlans[${i}].hosts=Math.max(1,+this.value||1);calcVLSM();renderVlanCards()">
          <button class="btn btn-danger" onclick="S.vlans.splice(${i},1);calcVLSM();renderVlanCards()" title="Eliminar VLAN">✕</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function toggleVlanCard(i){
  const body=document.getElementById('vcb-'+i);
  if(!body) return;
  body.classList.toggle('open');
}

function addVlan(){
  const maxId=S.vlans.reduce((m,v)=>Math.max(m,v.id),0);
  S.vlans.push({id:Math.ceil((maxId+10)/10)*10,name:'Nueva VLAN',type:'Usuarios',hosts:20,floor:1});
  calcVLSM();
  renderVlanCards();
  updatePreview();
}

// ══════════════════════════════════════════════════
// VLSM — Simplified reserved IPs (only .1 gateway)
// ══════════════════════════════════════════════════

function calcVLSM(){
  const sorted=[...S.vlans].sort((a,b)=>b.hosts-a.hosts);
  let cur=netInt(S.net,S.pfx);
  S.results=[];
  for(const v of sorted){
    const pfx=pfxForHosts(v.hosts);
    const step=Math.pow(2,32-pfx);
    if(cur%step!==0)cur=(Math.floor(cur/step)+1)*step;
    const net=cur,bc=cur+step-1;
    const netIp=intToIp(net);
    S.results.push({
      vlan:v.id,name:v.name,type:v.type,hosts:v.hosts,floor:v.floor,
      prefix:pfx,mask:maskFromPfx(pfx),wildcard:wildcardFromPfx(pfx),
      network:netIp,networkInt:net,broadcast:intToIp(bc),broadcastInt:bc,
      gateway:intToIp(net+1),
      poolStart:intToIp(net+2),poolEnd:intToIp(bc-1),
      poolSize:(bc-1)-(net+2)+1,hostsAvail:step-2,
      efficiency:Math.round(v.hosts/(step-2)*1000)/10,
      subnet:`${netIp}/${pfx}`,
      // IPv6 Dual-Stack
      v6subnet:   getV6Subnet(v.id),
      v6gateway:  getV6Gateway(v.id),
      v6poolStart:getV6PoolStart(v.id),
      v6poolEnd:  getV6PoolEnd(v.id),
    });
    cur=bc+1;
  }
  if(S.v6Enabled) updateV6Preview();
  updateSideStatus();
}

// ══════════════════════════════════════════════════
// INFRA CALCULATION
// ══════════════════════════════════════════════════

