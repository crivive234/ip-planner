// ═══════════════════════════════════════════════════════
// MÓDULO: Generador Huawei VRP
// Configs para Core, Distribución y Acceso (Huawei)
// ═══════════════════════════════════════════════════════

function huaweiCore(){
  const dom=getDomain(),d1=getDns1(),d2=getDns2(),pairs=allowedPairs();
  const dhcpSrv=getDhcpServerIp();
  const dnsInt=getDnsInt();
  let o=C(`# ══════ HUAWEI VRP — CORE SWITCH ══════\n`);
  o+=K('sysname CORE-SW-01\n')+K('dns resolve\n');
  o+=K('dns server')+' '+V(d1+'\n')+K('dns server')+' '+V(d2+'\n\n');
  if(S.v6Enabled){
    o+=C(`# ── IPv6 Global ──\n`);
    o+=K('ipv6\n');
    if(S.v6Mode!=='slaac') o+=K('dhcpv6 enable\n');
  }
  o+=K('vlan batch')+' '+N(S.results.map(r=>r.vlan).join(' ')+'\n');
  S.results.forEach(r=>{o+=K('vlan')+' '+N(r.vlan+'\n')+`  ${K('description')} ${V(r.name.replace(/ /g,'_')+'\n')}`;});
  o+='\n'+C(`# ── SVIs Dual-Stack — relay DHCP central ${dhcpSrv} ──\n`);
  S.results.forEach(r=>{
    o+=K('interface Vlanif')+N(r.vlan+'\n');
    o+=`  ${K('description')} ${V(r.type+'_'+r.name.replace(/ /g,'_')+'\n')}`;
    o+=`  ${K('ip address')} ${V(r.gateway)} ${V(r.mask+'\n')}`;
    o+=`  ${K('dhcp select relay')}\n  ${K('dhcp relay server-ip')} ${V(dhcpSrv+'\n')}`;
    if(S.v6Enabled){
      o+=`  ${K('ipv6 enable')}\n`;
      o+=`  ${K('ipv6 address')} ${V(r.v6gateway+'/64\n')}`;
      if(S.v6Mode==='slaac'||S.v6Mode==='both'){
        o+=`  ${K('undo ipv6 nd ra halt')}\n`;
        o+=`  ${K('ipv6 nd ra interval 30')}\n`;
      }
      if(S.v6Mode==='dhcpv6'||S.v6Mode==='both'){
        o+=`  ${K('dhcpv6 server POOL_V6_'+r.vlan)}\n`;
      }
    }
    o+=K('quit')+'\n';
  });
  o+='\n'+C(`# ── DHCP IPv4 Central — todos los pools ──\n`);
  o+=K('dhcp enable\n');
  S.results.forEach(r=>{
    o+=K('ip pool')+` VLAN${N(r.vlan+'_'+r.name.replace(/ /g,'_')+'\n')}`;
    o+=`  ${K('gateway-list')} ${V(r.gateway+'\n')}  ${K('network')} ${V(r.network)} ${K('mask')} ${V(r.mask+'\n')}`;
    const dnsStr=dnsInt?`${dnsInt} ${d1}`:d1+' '+d2;
    o+=`  ${K('dns-list')} ${V(dnsStr+'\n')}`;
    if(document.getElementById('tog-domain')?.checked)o+=`  ${K('domain-name')} ${V(dom+'\n')}`;
    o+=`  ${K('excluded-ip-address')} ${V(r.network)} ${V(r.gateway+'\n')}`;
    o+=`  ${K('lease day 0 hour 8')}\n${K('quit')}\n`;
  });
  if(S.v6Enabled&&(S.v6Mode==='dhcpv6'||S.v6Mode==='both')){
    o+='\n'+C(`# ── DHCPv6 Pools ──\n`);
    S.results.forEach(r=>{
      o+=K('dhcpv6 pool POOL_V6_'+r.vlan+'\n');
      o+=`  ${K('address prefix')} ${V(r.v6subnet+'\n')}`;
      o+=`  ${K('dns-server')} ${V(r.v6gateway+'\n')}`;
      if(document.getElementById('tog-domain')?.checked)o+=`  ${K('domain-name')} ${V(dom+'\n')}`;
      o+=K('quit')+'\n';
    });
  }
  o+='\n'+C(`# ── ACL Inter-VLAN IPv4 ──\n`);
  pairs.forEach(([a,b],i)=>{
    o+=K('acl number')+' '+N(3000+i+'\n');
    o+=`  ${K('rule 5 permit ip source')} ${V(a.network)} ${V(a.wildcard)} ${K('destination')} ${V(b.network)} ${V(b.wildcard+'\n')}`;
    o+=`  ${K('rule 10 permit ip source')} ${V(b.network)} ${V(b.wildcard)} ${K('destination')} ${V(a.network)} ${V(a.wildcard+'\n')}${K('quit')}\n`;
  });
  if(S.v6Enabled){
    o+='\n'+C(`# ── ACL Inter-VLAN IPv6 ──\n`);
    pairs.forEach(([a,b],i)=>{
      o+=K('acl ipv6 number')+' '+N(2000+i+'\n');
      o+=`  ${K('rule 5 permit ipv6 source')} ${V(a.v6subnet)} ${K('destination')} ${V(b.v6subnet+'\n')}`;
      o+=`  ${K('rule 10 permit ipv6 source')} ${V(b.v6subnet)} ${K('destination')} ${V(a.v6subnet+'\n')}${K('quit')}\n`;
    });
  }
  return o;
}

function huaweiFloor(f){
  const dist=f.devices.find(d=>d.type==='dist');
  let o=C(`# ══════ ${f.label} — HUAWEI DIST SW ══════\n`);
  o+=K('sysname')+' '+V((dist?.hostname||'DIST-SW')+'\n\n');
  o+=K('vlan batch')+' '+N(f.vlans.join(' ')+'\n\n');
  o+=K('interface GigabitEthernet0/0/1\n');
  o+=`  ${K('port link-type trunk')}\n  ${K('port trunk allow-pass vlan')} ${N(f.vlans.join(' ')+'\n')}  ${K('undo shutdown')}\n${K('quit')}\n\n`;
  f.devices.filter(d=>d.type==='acc').forEach((sw,i)=>{
    o+=K('interface')+` GigabitEthernet0/0/${i+2}\n`;
    o+=`  ${K('port link-type trunk')}\n  ${K('port trunk allow-pass vlan')} ${N(f.vlans.join(' ')+'\n')}  ${K('undo shutdown')}\n${K('quit')}\n`;
  });
  return o;
}

function huaweiAccess(f,acc){
  const pv=(S.vlans.filter(v=>v.floor===f.floor)[0])||S.vlans[0];
  let o=C(`# ══════ ${acc.hostname} — HUAWEI ACCESS SW ══════\n`);
  o+=K('sysname')+' '+V(acc.hostname+'\n\n');
  o+=K('vlan batch')+' '+N(f.vlans.join(' ')+'\n\n');
  o+=K('interface GigabitEthernet0/0/1\n');
  o+=`  ${K('port link-type trunk')}\n  ${K('port trunk allow-pass vlan')} ${N(f.vlans.join(' ')+'\n')}  ${K('undo shutdown')}\n${K('quit')}\n\n`;
  if(pv){o+=K('interface GigabitEthernet0/0/2\n');o+=`  ${K('port link-type access')}\n  ${K('port default vlan')} ${N(pv.id+'\n')}  ${K('stp edged-port enable')}\n${K('quit')}\n`;}
  return o;
}

// ─── FORTINET (IPv6 Dual-Stack) ───────────────────

