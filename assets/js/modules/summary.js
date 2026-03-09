// ═══════════════════════════════════════════════════════
// MÓDULO: Resumen del Plan
// Tabla VLSM completa, estadísticas e IPs reservadas
// ═══════════════════════════════════════════════════════

function renderSummary(){
  const tu=S.results.reduce((s,r)=>s+r.hosts,0);
  const ta=S.results.reduce((s,r)=>s+r.hostsAvail,0);
  const eff=ta>0?Math.round(tu/ta*1000)/10:0;
  const pairs=allowedPairs().length;
  const org=ORG_TYPES.find(o=>o.id===S.orgType);
  const dhcpIp=getDhcpServerIp();

  let h=`<div class="sum-grid">
    <div class="sum-card"><div class="sum-card-title">Infraestructura</div>
      <div class="sum-row"><span class="sum-k">Organización</span><span class="sum-v">${org?.name}</span></div>
      <div class="sum-row"><span class="sum-k">Pisos</span><span class="sum-v">${g('b-floors')}</span></div>
      <div class="sum-row"><span class="sum-k">Core / CPD</span><span class="sum-v">Piso ${g('b-core')}</span></div>
      <div class="sum-row"><span class="sum-k">Redundancia</span><span class="sum-v">${REDUND.find(r=>r.id===S.redund)?.name}</span></div>
      <div class="sum-row"><span class="sum-k">Hosts planificados</span><span class="sum-v">${tu.toLocaleString()}</span></div>
    </div>
    <div class="sum-card"><div class="sum-card-title">Red Base</div>
      <div class="sum-row"><span class="sum-k">Segmento</span><span class="sum-v" style="color:var(--primary)">${S.net}/${S.pfx}</span></div>
      <div class="sum-row"><span class="sum-k">Máscara</span><span class="sum-v">${maskFromPfx(S.pfx)}</span></div>
      <div class="sum-row"><span class="sum-k">Servidor DHCP</span><span class="sum-v" style="color:var(--amber2)">${dhcpIp}</span></div>
      <div class="sum-row"><span class="sum-k">Eficiencia global</span><span class="sum-v">${eff}%</span></div>
      <div class="sum-row"><span class="sum-k">Pares comunicación</span><span class="sum-v">${pairs} permitidos</span></div>
    </div>
  </div>`;

  const hasDomain=document.getElementById('tog-domain').checked;
  const hasDns=document.getElementById('tog-dns').checked;
  const hasNtp=document.getElementById('tog-ntp').checked;
  h+=`<div class="sum-card"><div class="sum-card-title">Servicios</div>
    <div class="g3">
      ${hasDomain?`<div><div style="font-family:var(--mono);font-size:9px;color:var(--text3);margin-bottom:4px">DOMINIO</div><div style="font-family:var(--mono);font-size:11px;color:var(--primary)">${g('svc-domain')||'—'}</div></div>`:'<div style="font-family:var(--mono);font-size:10px;color:var(--text3)">Sin dominio</div>'}
      ${hasDns?`<div><div style="font-family:var(--mono);font-size:9px;color:var(--text3);margin-bottom:4px">DNS GLOBAL</div><div style="font-family:var(--mono);font-size:11px;color:var(--blue)">${g('svc-dns1')} / ${g('svc-dns2')}</div></div>`:'<div style="font-family:var(--mono);font-size:10px;color:var(--text3)">Sin DNS global</div>'}
      ${hasNtp?`<div><div style="font-family:var(--mono);font-size:9px;color:var(--text3);margin-bottom:4px">NTP</div><div style="font-family:var(--mono);font-size:11px;color:var(--amber2)">${g('svc-ntp')}</div></div>`:'<div style="font-family:var(--mono);font-size:10px;color:var(--text3)">Sin NTP</div>'}
    </div>
  </div>`;

  // ── VLSM + IPv6 unified table ──
  const v6on=S.v6Enabled;
  const modeLabel={slaac:'SLAAC',dhcpv6:'DHCPv6',both:'SLAAC+DHCPv6'};
  h+=`<div class="vlsm-section">
    <div class="vlsm-section-header">
      <div>
        <div class="vlsm-section-title">📊 Plan VLSM Completo — ${S.results.length} Subredes</div>
        <div class="vlsm-section-sub">Red base: <strong style="color:var(--primary)">${S.net}/${S.pfx}</strong> · Eficiencia global: <strong>${eff}%</strong> · DHCP desde .2 (solo .1 reservado)</div>
      </div>
      ${v6on?`<span class="v6-badge" style="margin-left:auto">⚡ DUAL-STACK · ${modeLabel[S.v6Mode]}</span>`:''}
    </div>
    <div class="vlsm-table-wrap">
    <table class="vlsm-table">
      <thead>
        <tr>
          <th rowspan="2">VLAN</th>
          <th rowspan="2">Nombre</th>
          <th rowspan="2">Tipo</th>
          <th rowspan="2">Hosts</th>
          <th colspan="5" style="text-align:center;color:var(--primary);border-bottom:2px solid #bfdbfe;background:#eff6ff">🔵 IPv4</th>
          ${v6on?`<th colspan="${S.v6Mode!=='slaac'?4:3}" style="text-align:center;color:var(--cyan2);border-bottom:2px solid #a5f3fc;background:var(--cyan3)">🌐 IPv6 Dual-Stack</th>`:''}
          <th rowspan="2" style="text-align:center">Efic.</th>
        </tr>
        <tr style="background:var(--bg2)">
          <th>Prefijo</th><th>Red</th><th>Máscara</th><th>Gateway</th><th>Pool DHCP</th>
          ${v6on?`<th style="color:var(--cyan2)">Subred /64</th><th style="color:var(--cyan2)">GW (::1)</th>${S.v6Mode!=='slaac'?'<th style="color:var(--cyan2)">Pool DHCPv6</th>':''}<th style="color:var(--cyan2)">Modo</th>`:''}
        </tr>
      </thead>
      <tbody>
      ${S.results.map(r=>{
        const col=TYPE_COLOR[r.type]||'#64748b';
        return`<tr>
          <td class="td-vlan"><span class="vlan-pill" style="background:${col}18;color:${col};border:1px solid ${col}40">VLAN ${r.vlan}</span></td>
          <td style="font-weight:600;color:var(--text)">${r.name}</td>
          <td><span class="tag" style="background:${col}18;color:${col};border:1px solid ${col}35">${r.type}</span></td>
          <td style="color:var(--amber2);font-weight:700">${r.hosts.toLocaleString()}</td>
          <td style="font-weight:800;color:var(--primary2)">/${r.prefix}</td>
          <td class="td-net">${r.network}</td>
          <td style="color:var(--text2)">${r.mask}</td>
          <td class="td-gw">${r.gateway}</td>
          <td class="td-pool" style="white-space:nowrap">${r.poolStart}<br><span style="color:var(--text3)">→ ${r.poolEnd}</span></td>
          ${v6on?`
          <td class="td-v6" style="white-space:nowrap">${r.v6subnet}</td>
          <td class="td-v6gw" style="white-space:nowrap">${r.v6gateway}</td>
          ${S.v6Mode!=='slaac'?`<td style="font-family:var(--mono);font-size:9px;color:var(--text2)">${r.v6poolStart}<br><span style="color:var(--text3)">→ ${r.v6poolEnd}</span></td>`:''}
          <td><span class="v6-row-label">${S.v6Mode.toUpperCase()}</span></td>
          `:''}
          <td class="td-eff">${eff2tag(r.efficiency)}</td>
        </tr>`;
      }).join('')}
      </tbody>
    </table>
    </div>
  </div>`;

  // ── IPs Reservadas card ──
  h+=`<div class="sum-card"><div class="sum-card-title">📌 IPs Reservadas por Subred</div>
    <div class="alert amber" style="margin-bottom:12px">
      <div class="alert-icon">ℹ️</div>
      <div class="alert-body">Con DHCP centralizado solo se reserva la <strong>.1 (Gateway/SVI)</strong>. El servidor DHCP central <strong>${dhcpIp}</strong> gestiona todos los pools desde .2.</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">
    ${S.results.map(r=>{
      const col=TYPE_COLOR[r.type]||'#64748b';
      return`<div style="background:var(--bg2);border:1px solid var(--border);border-radius:9px;overflow:hidden">
        <div style="background:${col}18;padding:8px 12px;border-bottom:1px solid ${col}30;font-family:var(--mono);font-size:10px;font-weight:700;color:${col}">VLAN ${r.vlan} · ${r.name}</div>
        ${[[0,'Network',col],[1,'Gateway / SVI','#16a34a'],['pool','Pool DHCP','#0891b2'],['bc','Broadcast',col]].map(([o,l,c])=>{
          const ip=o==='bc'?r.broadcast:o==='pool'?`${r.poolStart} → ${r.poolEnd}`:intToIp(r.networkInt+(+o));
          const isPool=o==='pool';
          return`<div style="display:flex;justify-content:space-between;padding:5px 12px;border-bottom:1px solid var(--border);font-family:var(--mono);font-size:10px;background:${isPool?'#f0fdf4':'#fff'}">
            <span style="color:var(--text3)">${l}</span>
            <span style="color:${c};font-weight:700">${ip}</span>
          </div>`;
        }).join('')}
      </div>`;
    }).join('')}
    </div>
  </div>`;

  document.getElementById('summary-body').innerHTML=h;
}

const eff2tag=e=>{
  if(e>=75)return`<span class="tag tg">${e}%</span>`;
  if(e>=50)return`<span class="tag ta">${e}%</span>`;
  return`<span style="font-family:var(--mono);font-size:9px;padding:2px 7px;border-radius:4px;background:var(--red3);color:var(--red2);border:1px solid #fecaca;font-weight:700">${e}%</span>`;
};

// ══════════════════════════════════════════════════
// LIVE PREVIEW
// ══════════════════════════════════════════════════

