// ═══════════════════════════════════════════════════════
// MÓDULO: Análisis de Red Automático
// Motor de selección de red base, prefijo y score
// ═══════════════════════════════════════════════════════

function onBuildChange(){
  const floors=+document.getElementById('b-floors').value||5;
  const hpf=+document.getElementById('b-hpf').value||150;
  const total=floors*hpf;
  const el=document.getElementById('b-total');
  if(el) el.value=total;
  updatePreview();
}

// ══════════════════════════════════════════════════
// STEP NAV
// ══════════════════════════════════════════════════

function runAutoAnalysis(){
  const floors=+document.getElementById('b-floors').value||5;
  const hpf=+document.getElementById('b-hpf').value||150;
  const total=floors*hpf;
  const needed=Math.ceil(total*1.7);
  const pfx=pfxForHosts(needed);

  let ip,rfcClass,reason;
  if(pfx<=16){ip='10.0.0.0';rfcClass='Clase A (10.x.x.x)';reason='Red muy grande · requiere espacio Clase A';}
  else if(pfx<=20){ip='172.16.0.0';rfcClass='Clase B (172.16.x.x)';reason='Red mediana-grande · espacio B es óptimo';}
  else{ip='192.168.0.0';rfcClass='Clase C (192.168.x.x)';reason='Red pequeña-mediana · espacio C es suficiente';}

  const score=Math.min(99,Math.round(65+(hostsFromPfx(pfx)-needed)/needed*30));
  S.net=ip;S.pfx=pfx;S.netScore=score;

  const aeSteps=[
    {title:'Inventario de hosts',detail:`${total.toLocaleString()} hosts × 1.7 overhead = ${needed.toLocaleString()} IPs requeridas`,done:true},
    {title:'Cálculo de prefijo mínimo',detail:`Prefijo /${pfx} cubre ${hostsFromPfx(pfx).toLocaleString()} hosts`,done:true},
    {title:'Selección de rango RFC 1918',detail:`${rfcClass} · ${reason}`,done:true},
    {title:'Verificación de escalabilidad',detail:`Margen: ${(hostsFromPfx(pfx)-needed).toLocaleString()} IPs libres`,done:true},
    {title:'Análisis de segmentación VLSM',detail:`${ORG_TYPES.find(o=>o.id===S.orgType)?.vlans.length||0} subredes de longitud variable`,done:true},
    {title:'Evaluación de redundancia',detail:`Modelo: ${REDUND.find(r=>r.id===S.redund)?.name} — OK`,done:true},
    {title:'Red seleccionada',detail:`${ip}/${pfx} · Máscara: ${maskFromPfx(pfx)} · Score: ${score}/100`,done:true,active:true},
  ];

  document.getElementById('ae-steps').innerHTML=aeSteps.map((s,i)=>`
    <div class="ae-step ${s.active?'active':s.done?'done':'pending'}">
      <div class="ae-step-n">${s.done?'✓':i+1}</div>
      <div class="ae-step-body">
        <div class="ae-step-title">${s.title}</div>
        <div class="ae-step-detail">${s.detail}</div>
      </div>
    </div>`).join('');

  document.getElementById('net-result-box').innerHTML=`
    <div class="net-result" style="margin-bottom:14px">
      <div class="nr-main">
        <div class="nr-addr">${ip}/${pfx}</div>
        <div class="nr-detail">
          Máscara: ${maskFromPfx(pfx)}<br>
          Hosts disponibles: ${hostsFromPfx(pfx).toLocaleString()}<br>
          Broadcast: ${intToIp(bcastInt(ip,pfx))}<br>
          Espacio: ${rfcClass}
        </div>
        <div class="nr-tags">
          <span class="tag tg">✓ Escalable</span>
          <span class="tag tb">RFC 1918 Privado</span>
          <span class="tag tl">Auto-seleccionado</span>
          <span class="tag ta">/${pfx} óptimo</span>
        </div>
      </div>
      <div class="nr-score"><div class="nr-score-val">${score}</div><div class="nr-score-lbl">SCORE/100</div></div>
    </div>`;

  document.getElementById('manual-result').value=`${S.net}/${S.pfx} — ${maskFromPfx(S.pfx)}`;
  updatePreview();updateSideStatus();
}

function toggleManual(){
  const b=document.getElementById('manual-net-box');
  b.style.display=b.style.display==='none'?'block':'none';
}

function onManual(){
  const ip=document.getElementById('manual-ip').value.trim();
  const pfx=+document.getElementById('manual-pfx').value;
  if(/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)){S.net=ip;S.pfx=pfx;}
  document.getElementById('manual-result').value=`${S.net}/${S.pfx} — ${maskFromPfx(S.pfx)}`;
  updatePreview();updateSideStatus();
}

// ══════════════════════════════════════════════════
// SERVICES TOGGLES
// ══════════════════════════════════════════════════

