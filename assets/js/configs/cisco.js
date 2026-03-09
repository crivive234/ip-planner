// ═══════════════════════════════════════════════════════
// MÓDULO: Generador Cisco IOS/XE
// Configs para Core, Distribución y Acceso (Cisco)
// ═══════════════════════════════════════════════════════

function ciscoCore(){
  const dom=getDomain(),d1=getDns1(),d2=getDns2(),ntp=getNtp(),pairs=allowedPairs();
  const dhcpSrv=getDhcpServerIp();
  const dnsInt=getDnsInt();
  let o=C(`! ══════ CISCO IOS/XE — CORE SWITCH L3 ══════\n`);
  o+=K('hostname')+' '+V('CORE-SW-01\n');
  o+=K('ip domain-name')+' '+V(dom+'\n');
  o+=K('ip name-server')+' '+V(d1)+' '+V(d2+'\n');
  if(document.getElementById('tog-ntp')?.checked) o+=K('ntp server')+' '+V(ntp+'\n');
  if(S.v6Enabled){
    o+='\n'+C(`! ── IPv6 Global ──\n`);
    o+=K('ipv6 unicast-routing\n');
    o+=K('ipv6 cef\n');
    if(S.v6Mode!=='slaac') o+=K('ipv6 dhcp binding track ppp ignore\n');
  }
  o+='\n'+C(`! ── VLANs ──\n`);
  S.results.forEach(r=>{o+=K('vlan')+' '+N(r.vlan+'\n')+`  ${K('name')} ${V(r.name.replace(/ /g,'_')+'\n')}`;});
  o+='\n'+C(`! ── SVIs L3 Dual-Stack — relay DHCP central ${dhcpSrv} ──\n`);
  S.results.forEach(r=>{
    o+=K('interface')+` Vlan${N(r.vlan+'\n')}`;
    o+=`  ${K('description')} ${V(r.type+'_'+r.name.replace(/ /g,'_')+'\n')}`;
    o+=`  ${K('ip address')} ${V(r.gateway)} ${V(r.mask+'\n')}`;
    o+=`  ${K('ip helper-address')} ${V(dhcpSrv+'\n')}`;
    if(S.v6Enabled){
      o+=`  ${K('ipv6 address')} ${V(r.v6gateway+'/64\n')}`;
      o+=`  ${K('ipv6 enable')}\n`;
      if(S.v6Mode==='slaac'||S.v6Mode==='both'){
        o+=`  ${K('ipv6 nd ra interval')} 30\n`;
        o+=`  ${K('no ipv6 nd ra suppress')}\n`;
      }
      if(S.v6Mode==='dhcpv6'||S.v6Mode==='both'){
        o+=`  ${K('ipv6 dhcp server')} ${V(`POOL_V6_${r.vlan}`)}\n`;
        if(S.v6Mode==='both') o+=`  ${K('ipv6 nd managed-config-flag')}\n`;
      }
    }
    o+=`  ${K('no shutdown')}\n${K('exit')}\n`;
  });
  o+='\n'+C(`! ── DHCP IPv4 Central — todos los pools ──\n`);
  S.results.forEach(r=>{
    o+=K('ip dhcp excluded-address')+' '+V(r.network)+' '+V(r.gateway+'\n');
  });
  o+='\n';
  S.results.forEach(r=>{
    o+=K('ip dhcp pool')+' '+V(`POOL_VLAN${r.vlan}_${r.name.replace(/ /g,'_')}\n`);
    o+=`  ${K('network')} ${V(r.network)} ${V(r.mask+'\n')}`;
    o+=`  ${K('default-router')} ${V(r.gateway+'\n')}`;
    const dnsStr=dnsInt?`${dnsInt} ${d1}`:d1+' '+d2;
    o+=`  ${K('dns-server')} ${V(dnsStr+'\n')}`;
    if(document.getElementById('tog-domain')?.checked)o+=`  ${K('domain-name')} ${V(dom+'\n')}`;
    o+=`  ${K('lease')} 0 8\n${K('exit')}\n`;
  });
  if(S.v6Enabled&&(S.v6Mode==='dhcpv6'||S.v6Mode==='both')){
    o+='\n'+C(`! ── DHCPv6 Pools ──\n`);
    S.results.forEach(r=>{
      o+=K('ipv6 dhcp pool')+' '+V(`POOL_V6_${r.vlan}\n`);
      o+=`  ${K('address prefix')} ${V(r.v6subnet.replace('::/64','') + '/64 lifetime 86400 43200\n')}`;
      o+=`  ${K('dns-server')} ${V(r.v6gateway+'\n')}`;
      if(document.getElementById('tog-domain')?.checked)o+=`  ${K('domain-name')} ${V(dom+'\n')}`;
      o+=K('exit')+'\n';
    });
  }
  o+='\n'+C(`! ── ACLs Inter-VLAN IPv4 ──\n`);
  pairs.forEach(([a,b])=>{
    o+=K('ip access-list extended')+' '+V(`PERMIT_V${a.vlan}_V${b.vlan}\n`);
    o+=`  ${K('permit ip')} ${V(a.network)} ${V(a.wildcard)} ${V(b.network)} ${V(b.wildcard+'\n')}`;
    o+=`  ${K('permit ip')} ${V(b.network)} ${V(b.wildcard)} ${V(a.network)} ${V(a.wildcard+'\n')}${K('exit')}\n`;
  });
  if(S.v6Enabled){
    o+='\n'+C(`! ── ACLs Inter-VLAN IPv6 ──\n`);
    pairs.forEach(([a,b])=>{
      o+=K('ipv6 access-list')+' '+V(`PERMIT_V6_${a.vlan}_${b.vlan}\n`);
      o+=`  ${K('permit ipv6')} ${V(a.v6subnet)} ${V(b.v6subnet+'\n')}`;
      o+=`  ${K('permit ipv6')} ${V(b.v6subnet)} ${V(a.v6subnet+'\n')}`;
    });
  }
  return o;
}

function ciscoFloor(f){
  const dist=f.devices.find(d=>d.type==='dist');
  const accs=f.devices.filter(d=>d.type==='acc');
  const vl=f.vlans.join(',');
  let o=C(`! ══════ ${f.label} — CISCO DIST SW ══════\n`);
  o+=K('hostname')+' '+V((dist?.hostname||'DIST-SW')+'\n\n');
  o+=K('vlan batch ')+N(f.vlans.join(' ')+'\n\n');
  o+=K('interface GigabitEthernet1/0/1\n');
  o+=`  ${K('description')} ${V('UPLINK_CORE-SW-01\n')}  ${K('switchport mode trunk')}\n  ${K('switchport trunk allowed vlan')} ${V(vl+'\n')}  ${K('no shutdown')}\n${K('exit')}\n\n`;
  accs.forEach((sw,i)=>{
    o+=K('interface')+` GigabitEthernet1/0/${i+2}\n`;
    o+=`  ${K('description')} ${V('DOWNLINK_'+sw.hostname+'\n')}  ${K('switchport mode trunk')}\n  ${K('switchport trunk allowed vlan')} ${V(vl+'\n')}  ${K('no shutdown')}\n${K('exit')}\n`;
  });
  return o;
}

function ciscoAccess(f,acc){
  const pv=(S.vlans.filter(v=>v.floor===f.floor)[0])||S.vlans[0];
  const dist=f.devices.find(d=>d.type==='dist');
  let o=C(`! ══════ ${acc.hostname} — CISCO ACCESS SW ══════\n`);
  o+=K('hostname')+' '+V(acc.hostname+'\n\n');
  o+=K('vlan batch ')+N(f.vlans.join(' ')+'\n\n');
  o+=K('interface GigabitEthernet0/1\n');
  o+=`  ${K('description')} ${V('UPLINK_'+dist?.hostname+'\n')}  ${K('switchport mode trunk')}\n  ${K('switchport trunk allowed vlan')} ${V(f.vlans.join(',')+'\n')}  ${K('no shutdown')}\n${K('exit')}\n\n`;
  if(pv){
    o+=K('interface range GigabitEthernet0/2 - 0/48\n');
    o+=`  ${K('switchport mode access')}\n  ${K('switchport access vlan')} ${N(pv.id+'\n')}  ${K('spanning-tree portfast')}\n  ${K('no shutdown')}\n${K('exit')}\n`;
  }
  return o;
}

// ─── HUAWEI (Single DHCP + IPv6) ──────────────────

