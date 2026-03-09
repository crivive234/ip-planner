// ═══════════════════════════════════════════════════════
// MÓDULO: Wizard de pasos
// Navegación entre pasos, barra de progreso y menú móvil
// ═══════════════════════════════════════════════════════

function toggleMobileMenu(){
  const sb=document.getElementById('sidebar');
  const ov=document.getElementById('sidebar-overlay');
  sb.classList.toggle('mobile-open');
  ov.classList.toggle('show');
}

function closeMobileMenu(){
  document.getElementById('sidebar').classList.remove('mobile-open');
  document.getElementById('sidebar-overlay').classList.remove('show');
}

// ══════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════

function renderStepsNav(){
  const cont=document.getElementById('steps-list');
  let h='';
  STEPS.forEach((st,i)=>{
    const done=st.n<S.step,active=st.n===S.step;
    const locked=st.n>S.maxStep+1;
    const cls=active?'active':done?'done':locked?'locked':'';
    h+=`<div class="si ${cls}" onclick="go(${st.n});closeMobileMenu()">
      <div class="si-num">${(st.n<=S.maxStep&&!active)?'✓':st.icon}</div>
      <div class="si-info">
        <div class="si-label">${st.label}</div>
        <div class="si-sub">${st.sub}</div>
      </div>
    </div>`;
    if(i<STEPS.length-1) h+=`<div class="si-conn ${st.n<S.step?'done':''}"></div>`;
  });
  cont.innerHTML=h;
  document.getElementById('prog').style.width=((S.maxStep-1)/6*100)+'%';
}

function go(n){
  if(n<1||n>7) return;
  if(n>S.maxStep+1) return;
  S.step=n;
  S.maxStep=Math.max(S.maxStep,n);
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('page-'+n).classList.add('active');
  renderStepsNav();
  if(n===2) runAutoAnalysis();
  if(n===4) runVlanCalc(S.vlans.length===0);  // always show progress bar
  if(n===5){calcVLSM();initComm();renderCommMatrix();renderPolicyRules();}
  if(n===6){calcVLSM();calcInfra();renderSummary();}
  if(n===7){calcVLSM();calcInfra();renderAllExport();}
  updatePreview();
  document.getElementById('content').scrollTop=0;
}

// ══════════════════════════════════════════════════
// AUTO NETWORK ANALYSIS
// ══════════════════════════════════════════════════

