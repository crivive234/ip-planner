// ═══════════════════════════════════════════════════════
// MÓDULO: Notificaciones y Copiado
// Toast de feedback y función de copiar bloques de código
// ═══════════════════════════════════════════════════════

function showToast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2200);
}

// ── Copy code block ───────────────────────────────

function copyBlock(id,btn){
  const el=document.getElementById(id);
  const text=el?.innerText||el?.textContent||'';
  navigator.clipboard.writeText(text).then(()=>{
    btn.textContent='✅ Copiado'; btn.classList.add('ok');
    setTimeout(()=>{btn.textContent='📋 Copiar';btn.classList.remove('ok');},2200);
    showToast('✅ Copiado al portapapeles');
  });
}


// ══════════════════════════════════════════════════
renderOrgs();
renderRedund();
renderVendorGrid();
updateNapalmNote();
renderStepsNav();
onBuildChange();
updatePreview();

