// ═══════════════════════════════════════════════════════
// MÓDULO: IPv6 Math
// Funciones de cálculo para dual-stack IPv6
// ═══════════════════════════════════════════════════════

function getV6SitePrefix(){
  if(S.v6PfxType==='gua'){
    const v=g('svc-v6pfx').trim();
    if(v) return v.replace(/\/\d+$/,'').replace(/::$/,'').replace(/:$/,'');
  }
  const parts=S.net.split('.').map(Number);
  const h1=parts[0].toString(16).padStart(2,'0');
  const h2=parts[1].toString(16).padStart(2,'0');
  const h3=parts[2].toString(16).padStart(2,'0');
  const h4=parts[3].toString(16).padStart(2,'0');
  return `fd${h1}:${h2}${h3}:${h4}00`;
}

// Get /64 subnet for a VLAN: site::[vlanHex]::/64

function getV6Subnet(vlanId){
  const site=getV6SitePrefix();
  const vHex=vlanId.toString(16).padStart(4,'0');
  return `${site}:${vHex}::/64`;
}

// Gateway (::1) for a VLAN

function getV6Gateway(vlanId){
  const site=getV6SitePrefix();
  const vHex=vlanId.toString(16).padStart(4,'0');
  return `${site}:${vHex}::1`;
}

// DHCPv6 pool start/end (::2 → ::ffff)

function getV6PoolStart(vlanId){return getV6Gateway(vlanId).replace('::1','::2');}

function getV6PoolEnd(vlanId){
  const site=getV6SitePrefix();
  const vHex=vlanId.toString(16).padStart(4,'0');
  return `${site}:${vHex}::ffff`;
}

// Compact IPv6 for display

function compactV6(addr){
  try{
    // Simple compression: replace longest run of :0000: with ::
    return addr.replace(/(:0{1,4}){2,}/,'::')||addr;
  }catch(e){return addr;}
}

// Get DNS server for DHCPv6

function getV6Dns(){
  if(S.v6PfxType!=='ula') return null;
  const site=getV6SitePrefix();
  return `${site}:0001::35`; // fd...::35 maps to .53 (DNS)
}

