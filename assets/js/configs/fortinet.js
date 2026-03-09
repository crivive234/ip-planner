// ═══════════════════════════════════════════════════════
// MÓDULO: Generador Fortinet FortiOS
// Config completa del FortiGate con políticas y DHCP
// ═══════════════════════════════════════════════════════

function fortiCore(){
  const dom=getDomain(),d1=getDns1(),d2=getDns2(),pairs=allowedPairs();
  const dhcpSrv=getDhcpServerIp();
  const dnsInt=getDnsInt();
  let o=C(`# ══════ FORTINET FortiOS — FortiGate ══════\n`);
  o+=K('config system dns\n');
  o+=`  ${K('set primary')} ${V(d1)}\n  ${K('set secondary')} ${V(d2)}\n`;
  if(document.getElementById('tog-domain')?.checked)o+=`  ${K('set domain')} ${V(dom)}\n`;
  o+=K('end\n\n');
  o+=K('config system interface\n');
  S.results.forEach(r=>{
    const iname='VLAN'+r.vlan+'_'+r.name.replace(/ /g,'_').substring(0,8);
    o+=`  ${K('edit')} ${V('"'+iname+'"')}\n`;
    o+=`    ${K('set type')} vlan\n    ${K('set interface')} "port1"\n`;
    o+=`    ${K('set vlanid')} ${N(r.vlan)}\n`;
    o+=`    ${K('set ip')} ${V(r.gateway+' '+r.mask)}\n`;
    if(S.v6Enabled){
      o+=`    ${K('set ip6-address')} ${V(r.v6gateway+'/64')}\n`;
      if(S.v6Mode==='slaac'||S.v6Mode==='both'){
        o+=`    ${K('set ip6-send-adv')} enable\n`;
        o+=`    ${K('set ip6-prefix-list')} "${r.v6subnet}" max-interval 30\n`;
      }
    }
    o+=`    ${K('set allowaccess')} ping https ssh\n    ${K('set status')} up\n  ${K('next')}\n`;
  });
  o+=K('end\n\n');
  o+=C(`# ── DHCP IPv4 Central ──\n`);
  o+=K('config system dhcp server\n');
  S.results.forEach((r,i)=>{
    const iname='VLAN'+r.vlan+'_'+r.name.replace(/ /g,'_').substring(0,8);
    const dnsStr=dnsInt?dnsInt:d1;
    o+=`  ${K('edit')} ${N(i+1)}\n`;
    o+=`    ${K('set interface')} ${V('"'+iname+'"')}\n`;
    o+=`    ${K('set default-gateway')} ${V(r.gateway)}\n    ${K('set netmask')} ${V(r.mask)}\n`;
    o+=`    ${K('set dns-server1')} ${V(dnsStr)}\n    ${K('set dns-server2')} ${V(d2)}\n`;
    o+=`    ${K('config ip-range')}\n      ${K('edit')} 1\n`;
    o+=`        ${K('set start-ip')} ${V(r.poolStart)}\n        ${K('set end-ip')} ${V(r.poolEnd)}\n`;
    o+=`      ${K('next')}\n    ${K('end')}\n  ${K('next')}\n`;
  });
  o+=K('end\n\n');
  if(S.v6Enabled&&(S.v6Mode==='dhcpv6'||S.v6Mode==='both')){
    o+=C(`# ── DHCPv6 Server ──\n`);
    o+=K('config system dhcp6 server\n');
    S.results.forEach((r,i)=>{
      const iname='VLAN'+r.vlan+'_'+r.name.replace(/ /g,'_').substring(0,8);
      o+=`  ${K('edit')} ${N(i+1)}\n`;
      o+=`    ${K('set interface')} ${V('"'+iname+'"')}\n`;
      o+=`    ${K('set ip6-start')} ${V(r.v6poolStart)}\n`;
      o+=`    ${K('set ip6-end')} ${V(r.v6poolEnd)}\n`;
      o+=`    ${K('set dns-service')} default\n  ${K('next')}\n`;
    });
    o+=K('end\n\n');
  }
  o+=K('config firewall policy\n');
  let policyId=1;
  pairs.forEach(([a,b])=>{
    [[a,b],[b,a]].forEach(([s,dt])=>{
      o+=`  ${K('edit')} ${N(policyId++)}\n`;
      o+=`    ${K('set srcintf')} ${V('"VLAN'+s.vlan+'"')}\n    ${K('set dstintf')} ${V('"VLAN'+dt.vlan+'"')}\n`;
      o+=`    ${K('set srcaddr')} "all"\n    ${K('set dstaddr')} "all"\n`;
      o+=`    ${K('set action')} accept\n    ${K('set schedule')} "always"\n    ${K('set service')} "ALL"\n  ${K('next')}\n`;
    });
  });
  o+=K('end\n');
  return o;
}

// ─── NORNIR + NAPALM (SSH · multi-vendor) ─────────────────────

