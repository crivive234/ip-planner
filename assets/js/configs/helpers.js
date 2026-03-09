// ═══════════════════════════════════════════════════════
// MÓDULO: Config Helpers
// Resaltado de sintaxis y constructor de bloques de config
// ═══════════════════════════════════════════════════════

const K=t=>`<span class="k">${t}</span>`;

const V=t=>`<span class="v">${t}</span>`;

const C=t=>`<span class="c">${t}</span>`;

const N=t=>`<span class="n">${t}</span>`;

const Py=t=>`<span class="py">${t}</span>`;

const St=t=>`<span class="st">${t}</span>`;

function makeCfgBlock(floor,hostname,role,code){
  const id='cb-'+Math.random().toString(36).substr(2,5);
  return`<div class="cfg-block">
    <div class="cfg-hdr">
      <div><div class="cfg-hdr-label">📦 ${floor}</div><div class="cfg-hdr-dev">${role} · ${hostname}</div></div>
      <button class="btn-copy" onclick="copyBlock('${id}',this)">📋 Copiar</button>
    </div>
    <div class="code-area" id="${id}">${code}</div>
  </div>`;
}

// ─── CISCO (Single DHCP server relay + IPv6) ──────

