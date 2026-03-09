// ═══════════════════════════════════════════════════════
// MÓDULO: Panel de Vista Previa en Vivo
// Panel derecho con resumen reactivo del plan de red
// ═══════════════════════════════════════════════════════

function updatePreview(){
  const floors=+(g('b-floors'))||5;
  const hpf=+(g('b-hpf'))||150;
  const total=floors*hpf;
  const tu=S.results.reduce((s,r)=>s+r.hosts,0);
  const ta=S.results.reduce((s,r)=>s+r.hostsAvail,0);
  const eff=ta>0?Math.round(tu/ta*1000)/10:0;
  const org=ORG_TYPES.find(o=>o.id===S.orgType)||ORG_TYPES[0];

  let h=`<div class="rp-section">
    <div class="rp-title">Infraestructura</div>
    <div class="rp-row"><span class="rp-k">Tipo</span><span class="rp-v lime">${org.icon} ${org.name}</span></div>
    <div class="rp-row"><span class="rp-k">Pisos</span><span class="rp-v">${floors}</span></div>
    <div class="rp-row"><span class="rp-k">Total hosts</span><span class="rp-v amber">${total.toLocaleString()}</span></div>
    <div class="rp-row"><span class="rp-k">Redundancia</span><span class="rp-v">${REDUND.find(r=>r.id===S.redund)?.name.split(' ')[0]||'—'}</span></div>
  </div>
  <div class="rp-section">
    <div class="rp-title">Red & DHCP</div>
    <div class="rp-row"><span class="rp-k">Segmento</span><span class="rp-v lime">${S.net}/${S.pfx}</span></div>
    <div class="rp-row"><span class="rp-k">Máscara</span><span class="rp-v">${maskFromPfx(S.pfx)}</span></div>
    <div class="rp-row"><span class="rp-k">DHCP Server</span><span class="rp-v amber">${getDhcpServerIp()}</span></div>
    <div class="rp-row"><span class="rp-k">Hosts disp.</span><span class="rp-v green">${hostsFromPfx(S.pfx).toLocaleString()}</span></div>
  </div>`;

  if(S.results.length>0){
    const used=S.results.reduce((s,r)=>s+Math.pow(2,32-r.prefix),0);
    const total2=hostsFromPfx(S.pfx)+2;
    const pct=Math.min(100,Math.round(used/total2*100));
    h+=`<div class="rp-section">
      <div class="rp-title">Plan VLSM · ${S.results.length} subredes</div>
      <div class="rp-bar-wrap">
        <div class="rp-bar-lbl"><span>Espacio usado</span><span>${pct}%</span></div>
        <div class="rp-bar"><div class="rp-bar-fill" style="width:${pct}%;background:${pct>85?'#f87171':pct>65?'#fbbf24':'#4ade80'}"></div></div>
      </div>
      <table class="rp-mini-table">
        <thead><tr><th>VLAN</th><th>Nombre</th><th>Subred</th><th>Pool</th></tr></thead>
        <tbody>${S.results.map(r=>`<tr>
          <td style="color:${TYPE_COLOR[r.type]||'#aaa'}">${r.vlan}</td>
          <td>${r.name.substring(0,7)}</td>
          <td style="color:#38bdf8">/${r.prefix}</td>
          <td style="color:#4ade80">.2→BC</td>
        </tr>`).join('')}</tbody>
      </table>
      <div class="rp-row" style="margin-top:6px"><span class="rp-k">Eficiencia</span><span class="rp-v ${eff>=75?'green':eff>=50?'amber':'red'}">${eff}%</span></div>
    </div>`;
    if(S.v6Enabled&&S.results.length>0){
      const site=getV6SitePrefix();
      const mL={slaac:'SLAAC (RA)',dhcpv6:'DHCPv6',both:'SLAAC+DHCPv6'};
      h+=`<div class="rp-section">
        <div class="rp-title" style="color:var(--cyan)">⚡ IPv6 Dual-Stack</div>
        <div class="rp-row"><span class="rp-k">Site /48</span><span class="rp-v cyan" style="font-size:9px">${site}::</span></div>
        <div class="rp-row"><span class="rp-k">Modo</span><span class="rp-v" style="color:var(--indigo)">${mL[S.v6Mode]}</span></div>
        <div class="rp-row"><span class="rp-k">VLANs /64</span><span class="rp-v cyan">${S.results.length}</span></div>
        <table class="rp-mini-table" style="margin-top:4px">
          <thead><tr><th>VLAN</th><th>IPv6 /64</th></tr></thead>
          <tbody>${S.results.slice(0,5).map(r=>`<tr>
            <td style="color:${TYPE_COLOR[r.type]||'#aaa'}">${r.vlan}</td>
            <td style="color:var(--cyan);font-size:8.5px">${r.v6subnet.replace('::/64','…/64')}</td>
          </tr>`).join('')}${S.results.length>5?`<tr><td colspan="2" style="color:var(--text3);font-size:9px">+${S.results.length-5} más…</td></tr>`:''}</tbody>
        </table>
      </div>`;
    }
  }
  document.getElementById('rp-body').innerHTML=h;
}

function updateSideStatus(){
  const tu=S.results.reduce((s,r)=>s+r.hosts,0);
  const ta=S.results.reduce((s,r)=>s+r.hostsAvail,0);
  const eff=ta>0?Math.round(tu/ta*1000)/10:0;
  document.getElementById('ss-net').textContent=`${S.net}/${S.pfx}`;
  document.getElementById('ss-vlans').textContent=S.vlans.length;
  document.getElementById('ss-hosts').textContent=tu.toLocaleString();
  document.getElementById('ss-eff').textContent=eff>0?eff+'%':'—';
  document.getElementById('ss-dhcp').textContent=getDhcpServerIp();
  const v6el=document.getElementById('ss-v6');
  if(v6el){
    if(S.v6Enabled){
      const mL={slaac:'SLAAC',dhcpv6:'DHCPv6',both:'SLAAC+DHCPv6'};
      v6el.textContent=mL[S.v6Mode]||'Activo';
      v6el.style.color='var(--cyan)';
    }else{
      v6el.textContent='Desactivado';
      v6el.style.color='var(--text3)';
    }
  }
  document.getElementById('ss-bar').style.width=eff+'%';
}

// ══════════════════════════════════════════════════
// CONFIG GENERATORS
// ══════════════════════════════════════════════════

