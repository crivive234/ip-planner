// ═══════════════════════════════════════════════════════
// MÓDULO: State
// Estado global de la aplicación y helpers de acceso al DOM
// ═══════════════════════════════════════════════════════

let S={
  step:1,maxStep:1,orgType:'corp',redund:'dual',
  net:'172.16.0.0',pfx:20,
  vlans:[],results:[],infra:[],comm:{},
  netScore:0,
  napalmDriver:'ios',        // NAPALM driver id (ios | nxos_ssh | ce | fortios | junos)
  // IPv6 Dual-Stack
  v6Enabled:false,
  v6Mode:'slaac',            // slaac | dhcpv6 | both
  v6PfxType:'ula',           // ula | gua
  v6SitePfx:'',              // custom /48 base when gua selected
};

// ══════════════════════════════════════════════════
// STEPS
// ══════════════════════════════════════════════════

const g=id=>document.getElementById(id)?.value||'';

function getDhcpServerIp(){
  const val=g('svc-dhcp').trim();
  if(!val||val==='auto'){
    const mgmt=S.results.find(r=>r.type==='Gestión')||S.results[0];
    return mgmt?intToIp(mgmt.networkInt+2):'10.0.0.2';
  }
  return val;
}

function getDns1(){return document.getElementById('tog-dns')?.checked?g('svc-dns1'):'8.8.8.8';}

function getDns2(){return document.getElementById('tog-dns')?.checked?g('svc-dns2'):'8.8.4.4';}

function getDomain(){return document.getElementById('tog-domain')?.checked?(g('svc-domain')||'corp.local'):'corp.local';}

function getNtp(){return document.getElementById('tog-ntp')?.checked?g('svc-ntp'):'pool.ntp.org';}

function getDnsInt(){const v=g('svc-dnsint');return v&&v.trim()?v.trim():null;}

// ══════════════════════════════════════════════════
// INIT RENDERS
// ══════════════════════════════════════════════════

