// ═══════════════════════════════════════════════════════
// MÓDULO: Script Nornir + NAPALM
// Generador de script Python para despliegue automatizado
// ═══════════════════════════════════════════════════════

function nornirScript(){
  const dhcpSrv=getDhcpServerIp();
  const d1=getDns1(),d2=getDns2(),dom=getDomain();
  const vendorObj=NAPALM_VENDORS.find(v=>v.id===S.napalmDriver)||NAPALM_VENDORS[0];
  const driver=vendorObj.driver;
  const isOfficial=['ios','nxos_ssh','junos'].includes(vendorObj.id);

  // Build inventory list
  const inv=[];
  S.infra.forEach(f=>f.devices.forEach(d=>{
    if(d.mgmt) inv.push({
      hostname:d.hostname, ip:d.mgmt, role:d.role,
      layer:d.type==='core'?'core':d.type==='dist'?'distribution':'access',
      location:f.isCore?'Core/CPD':'Piso '+f.floor
    });
  }));

  const L=[];
  const c=t=>C(t); const k=t=>K(t); const s=t=>St(t); const py=t=>Py(t);

  // ── Header ──
  L.push(c('#!/usr/bin/env python3'));
  L.push(c('# ═══════════════════════════════════════════════════════════════'));
  L.push(c('#  NetPlan Pro — Automatización con Nornir + NAPALM'));
  L.push(c('#  Red: '+S.net+'/'+S.pfx+'   VLANs: '+S.results.length+'   DHCP: '+dhcpSrv));
  L.push(c('#  IPv6: '+(S.v6Enabled?getV6SitePrefix()+'::/48 · '+S.v6Mode.toUpperCase():'Desactivado')));
  L.push(c('#  Driver NAPALM: '+driver+' ('+vendorObj.name+')'+(isOfficial?' [oficial]':' [comunidad]')));
  L.push(c('#'));
  L.push(c('#  Instalar dependencias:'));
  L.push(c('#    pip install nornir nornir-napalm nornir-utils '+vendorObj.install));
  L.push(c('#'));
  L.push(c('#  Uso:'));
  L.push(c('#    python deploy_network.py              # dry-run (solo muestra diff)'));
  L.push(c('#    python deploy_network.py --deploy     # aplica cambios en producción'));
  L.push(c('#    python deploy_network.py --filter core  # solo dispositivos core'));
  L.push(c('#    python deploy_network.py --export-json  # exporta plan a JSON'));
  L.push(c('# ═══════════════════════════════════════════════════════════════'));
  L.push('');

  // ── Imports ──
  L.push(py('import')+' json, datetime, argparse, sys, os');
  L.push(py('from')+' nornir '+py('import')+' InitNornir');
  L.push(py('from')+' nornir.core.inventory '+py('import')+' Inventory, Hosts, Groups, Host, Group, Defaults');
  L.push(py('from')+' nornir.core.filter '+py('import')+' F');
  L.push(py('from')+' nornir_napalm.plugins.tasks '+py('import')+' napalm_configure, napalm_get');
  L.push(py('from')+' nornir_utils.plugins.functions '+py('import')+' print_result');
  L.push('');

  // ── Credentials (env vars recommended) ──
  L.push(c('# ── Credenciales (en producción: variables de entorno o HashiCorp Vault) ───'));
  L.push(s('SSH_USER')+' = os.getenv('+s('"NET_USER"')+', '+s('"admin"')+')'+c('  # export NET_USER=admin'));
  L.push(s('SSH_PASS')+' = os.getenv('+s('"NET_PASS"')+', '+s('"YOUR_PASSWORD"')+')'+c('  # export NET_PASS=secret'));
  L.push(s('SSH_PORT')+' = int(os.getenv('+s('"NET_PORT"')+', 22))');
  L.push('');

  // ── Inventory ──
  L.push(c('# ── Inventario de dispositivos ────────────────────────────────────────────'));
  L.push(s('HOSTS')+' = {');
  if(inv.length===0){
    L.push('    '+s('"CORE-SW-01"')+': {'+s('"hostname"')+': '+s('"192.168.1.1"')+', '+s('"platform"')+': '+s('"'+driver+'"')+', '+s('"data"')+': {'+s('"role"')+': '+s('"core"')+', '+s('"location"')+': '+s('"Core/CPD"')+'} },');
    L.push('    '+c('# Agrega más dispositivos aquí'));
  } else {
    inv.forEach(d=>{
      L.push('    '+s('"'+d.hostname+'"')+': {');
      L.push('        '+s('"hostname"')+': '+s('"'+d.ip+'"')+','+c('  # IP de gestión (cambiar)'));
      L.push('        '+s('"platform"')+': '+s('"'+driver+'"')+','+c('  # NAPALM driver: '+vendorObj.name));
      L.push('        '+s('"data"')+': {');
      L.push('            '+s('"role"')+':     '+s('"'+d.role+'"')+',');
      L.push('            '+s('"layer"')+':    '+s('"'+d.layer+'"')+',');
      L.push('            '+s('"location"')+': '+s('"'+d.location+'"')+',');
      L.push('        },');
      L.push('    },');
    });
  }
  L.push('}');
  L.push('');
  L.push(s('GROUPS')+' = {');
  L.push('    '+s('"network"')+': {},'+c('  # grupo base — las credenciales se inyectan en build_nornir()'));
  L.push('    '+s('"core"')+':    {'+s('"data"')+': {'+s('"priority"')+': 1}},');
  L.push('    '+s('"distribution"')+': {'+s('"data"')+': {'+s('"priority"')+': 2}},');
  L.push('    '+s('"access"')+':  {'+s('"data"')+': {'+s('"priority"')+': 3}},');
  L.push('}');
  L.push('');

  // ── Network plan ──
  L.push(c('# ── Plan de red generado por NetPlan Pro (no modificar manualmente) ────────'));
  L.push(s('NETWORK_PLAN')+' = {');
  L.push('    '+s('"base_network"')+': '+s('"'+S.net+'"')+',');
  L.push('    '+s('"prefix"')+':       '+S.pfx+',');
  L.push('    '+s('"mask"')+':         '+s('"'+maskFromPfx(S.pfx)+'"')+',');
  L.push('    '+s('"dhcp_server"')+':  '+s('"'+dhcpSrv+'"')+',');
  L.push('    '+s('"dns_primary"')+':  '+s('"'+d1+'"')+',');
  L.push('    '+s('"dns_secondary"')+':'+s('"'+d2+'"')+',');
  L.push('    '+s('"ipv6_enabled"')+': '+py(S.v6Enabled?'True':'False')+',');
  if(S.v6Enabled){
    L.push('    '+s('"ipv6_mode"')+':    '+s('"'+S.v6Mode+'"')+',');
    L.push('    '+s('"ipv6_site_prefix"')+': '+s('"'+getV6SitePrefix()+'::/48"')+',');
  }
  L.push('    '+s('"vlans"')+': [');
  S.results.forEach(r=>{
    L.push('        {'+s('"id"')+': '+r.vlan+', '+s('"name"')+': '+s('"'+r.name+'"')+', '+s('"type"')+': '+s('"'+r.type+'"')+',');
    L.push('         '+s('"network"')+': '+s('"'+r.network+'"')+', '+s('"mask"')+': '+s('"'+r.mask+'"')+', '+s('"gateway"')+': '+s('"'+r.gateway+'"')+',');
    L.push('         '+s('"pool_start"')+': '+s('"'+r.poolStart+'"')+', '+s('"pool_end"')+': '+s('"'+r.poolEnd+'"')+(S.v6Enabled?',':'}')+',');
    if(S.v6Enabled) L.push('         '+s('"v6_subnet"')+': '+s('"'+r.v6subnet+'"')+', '+s('"v6_gateway"')+': '+s('"'+r.v6gateway+'"')+'},');
  });
  L.push('    ],');
  L.push('}');
  L.push('');

  // ── Device configs ──
  L.push(c('# ── Configuraciones IOS/CLI por dispositivo (generadas por NetPlan Pro) ────'));
  L.push(s('DEVICE_CONFIGS')+' = {}');
  L.push('');
  // Core
  L.push(s('DEVICE_CONFIGS')+`[`+s('"CORE-SW-01"')+`] = """`);
  if(S.v6Enabled){ L.push('ipv6 unicast-routing'); L.push('ipv6 cef'); }
  L.push('!');
  S.results.forEach(r=>{L.push('vlan '+r.vlan); L.push(' name '+r.name.replace(/ /g,'_'));});
  L.push('!');
  S.results.forEach(r=>{
    L.push('interface Vlan'+r.vlan);
    L.push(' description '+r.type+'_'+r.name.replace(/ /g,'_'));
    L.push(' ip address '+r.gateway+' '+r.mask);
    L.push(' ip helper-address '+dhcpSrv);
    if(S.v6Enabled){
      L.push(' ipv6 enable');
      L.push(' ipv6 address '+r.v6gateway+'/64');
      if(S.v6Mode==='slaac'||S.v6Mode==='both') L.push(' no ipv6 nd ra suppress');
    }
    L.push(' no shutdown');
  });
  L.push('"""');
  L.push('');
  // Floor switches
  S.infra.filter(f=>!f.isCore).forEach(f=>{
    const dist=f.devices.find(d=>d.type==='dist');
    if(!dist) return;
    L.push(s('DEVICE_CONFIGS')+`[`+s('"'+dist.hostname+'"')+`] = """`);
    f.vlans.forEach(vid=>{L.push('vlan '+vid);});
    L.push('interface GigabitEthernet1/0/1');
    L.push(' switchport mode trunk');
    L.push(' switchport trunk allowed vlan '+f.vlans.join(','));
    L.push(' no shutdown');
    L.push('"""');
    L.push('');
  });

  // ── Build Nornir ──
  L.push(c('# ── Construcción del inventario Nornir (programático, sin archivos YAML) ──'));
  L.push(py('def')+' build_nornir():');
  L.push('    grps = Groups({');
  L.push('        name: Group(name=name, data=g.get('+s('"data"')+', {}))');
  L.push('        '+py('for')+' name, g '+py('in')+' GROUPS.items()');
  L.push('    })');
  L.push('    hosts = Hosts()');
  L.push('    '+py('for')+' name, h '+py('in')+' HOSTS.items():');
  L.push('        host_groups = [grps[g] '+py('for')+' g '+py('in')+' ['+s('"network"')+', h['+s('"data"')+'].get('+s('"role"')+', '+s('"access"')+')] '+py('if')+' g '+py('in')+' grps]');
  L.push('        hosts[name] = Host(');
  L.push('            name=name,');
  L.push('            hostname=h['+s('"hostname"')+'],');
  L.push('            username=SSH_USER,');
  L.push('            password=SSH_PASS,');
  L.push('            port=SSH_PORT,');
  L.push('            platform=h['+s('"platform"')+'],');
  L.push('            groups=host_groups,');
  L.push('            data=h.get('+s('"data"')+', {})');
  L.push('        )');
  L.push('    '+py('return')+' InitNornir(');
  L.push('        runner={'+s('"plugin"')+': '+s('"threaded"')+', '+s('"options"')+': {'+s('"num_workers"')+': 10}},');
  L.push('        inventory=Inventory(hosts=hosts, groups=grps, defaults=Defaults()),');
  L.push('    )');
  L.push('');

  // ── Deploy task ──
  L.push(c('# ── Tarea Nornir: aplica config via NAPALM (merge, no replace) ────────────'));
  L.push(py('def')+' task_deploy(task, dry_run='+py('True')+'):');
  L.push('    '+c('"""NAPALM load_merge_candidate → compare → commit (o discard si dry_run)"""'));
  L.push('    cfg = DEVICE_CONFIGS.get(task.host.name)');
  L.push('    '+py('if not')+' cfg:');
  L.push('        return f'+s('"[!] Sin config para {task.host.name} — omitido"'));
  L.push('    result = task.run(');
  L.push('        task=napalm_configure,');
  L.push('        configuration=cfg,');
  L.push('        dry_run=dry_run,'+c('  # True → solo muestra diff, no aplica'));
  L.push('        replace='+py('False')+','+c('       # merge = más seguro que replace total'));
  L.push('    )');
  L.push('    '+py('return')+' result');
  L.push('');

  // ── Get facts ──
  L.push(c('# ── Tarea Nornir: obtener facts de dispositivos ───────────────────────────'));
  L.push(py('def')+' task_get_facts(task):');
  L.push('    '+py('return')+' task.run(task=napalm_get, getters=['+s('"facts"')+', '+s('"interfaces_ip"')+'])');
  L.push('');

  // ── Export JSON ──
  L.push(c('# ── Exportar plan completo a JSON (para backend / audit trail) ─────────────'));
  L.push(py('def')+' export_json():');
  L.push('    plan = {');
  L.push('        **NETWORK_PLAN,');
  L.push('        '+s('"devices"')+': [{'+s('"hostname"')+': n, **h} '+py('for')+' n, h '+py('in')+' HOSTS.items()],');
  L.push('        '+s('"meta"')+': {');
  L.push('            '+s('"schema_version"')+': '+s('"1.0"')+',');
  L.push('            '+s('"tool"')+': '+s('"NetPlan Pro"')+',');
  L.push('            '+s('"napalm_driver"')+': '+s('"'+driver+'"')+',');
  L.push('            '+s('"generated_at"')+': datetime.datetime.now().isoformat(),');
  L.push('        }');
  L.push('    }');
  L.push('    fname = f'+s('"netplan_export_{datetime.datetime.now().strftime('+s("'%Y%m%d_%H%M%S'")+')}.json"'));
  L.push('    '+py('with')+' open(fname, '+s('"w"')+', encoding='+s('"utf-8"')+') '+py('as')+' f:');
  L.push('        json.dump(plan, f, indent=2, ensure_ascii='+py('False')+')');
  L.push('    print(f'+s('"✅ Plan exportado: {fname} ({os.path.getsize(fname)//1024} KB)"')+')');
  L.push('    '+py('return')+' fname');
  L.push('');

  // ── Main ──
  L.push(c('# ── Entry point ────────────────────────────────────────────────────────────'));
  L.push(py('def')+' main():');
  L.push('    parser = argparse.ArgumentParser(description='+s('"NetPlan Pro — Nornir+NAPALM"')+')');
  L.push('    parser.add_argument('+s('"--deploy"')+',      action='+s('"store_true"')+', help='+s('"Aplicar config (por defecto: dry-run)"')+')');
  L.push('    parser.add_argument('+s('"--filter"')+',      type=str,                  help='+s('"Filtrar por rol: core|distribution|access"')+')');
  L.push('    parser.add_argument('+s('"--get-facts"')+',   action='+s('"store_true"')+', help='+s('"Obtener facts de dispositivos"')+')');
  L.push('    parser.add_argument('+s('"--export-json"')+', action='+s('"store_true"')+', help='+s('"Exportar plan a JSON"')+')');
  L.push('    args = parser.parse_args()');
  L.push('');
  L.push('    '+py('if')+' args.export_json:');
  L.push('        export_json(); '+py('return'));
  L.push('');
  L.push('    print('+s('"═" * 68')+')');
  L.push('    print('+s('"  NetPlan Pro — Despliegue Nornir + NAPALM (SSH)"')+')');
  L.push('    print(f'+s('"  Red: '+S.net+'/'+S.pfx+'  ·  '+S.results.length+' VLANs  ·  DHCP: '+dhcpSrv+'"')+')');
  L.push('    print(f'+s('"  Driver: '+driver+' ('+vendorObj.name+')'+(isOfficial?' [oficial]':' [comunidad]')+'  ·  SSH puerto: {SSH_PORT}"')+')');
  L.push('    print(f'+s('"  Modo: {'+s("'🚀 DEPLOY'")+' if args.deploy else '+s("'⚠️  DRY-RUN (usa --deploy para aplicar)'")+' }"')+')');
  L.push('    print('+s('"═" * 68')+')');
  L.push('');
  L.push('    nr = build_nornir()');
  L.push('');
  L.push('    '+py('if')+' args.filter:');
  L.push('        nr = nr.filter(F(data__role=args.filter))');
  L.push('        print(f'+s('"[~] Filtro activo: rol = {args.filter}"')+')');
  L.push('');
  L.push('    '+py('if')+' args.get_facts:');
  L.push('        print('+s('"\\n[→] Obteniendo facts...\\n"')+')');
  L.push('        r = nr.run(task=task_get_facts)');
  L.push('        print_result(r); '+py('return'));
  L.push('');
  L.push('    dry_run = '+py('not')+' args.deploy');
  L.push('    '+py('if not')+' dry_run:');
  L.push('        confirm = input('+s('"\\n⚠️  Confirmar despliegue en PRODUCCIÓN [si/no]: "')+')');
  L.push('        '+py('if')+' confirm.lower() != '+s('"si"')+':');
  L.push('            print('+s('"Cancelado."')+'); '+py('return'));
  L.push('');
  L.push('    print(f'+s('"\\n[→] Ejecutando en {len(nr.inventory.hosts)} dispositivos...\\n"')+')');
  L.push('    results = nr.run(task=task_deploy, dry_run=dry_run)');
  L.push('    print_result(results)');
  L.push('');
  L.push('    ok   = [h '+py('for')+' h, r '+py('in')+' results.items() '+py('if not')+' r.failed]');
  L.push('    fail = [h '+py('for')+' h, r '+py('in')+' results.items() '+py('if')+' r.failed]');
  L.push('    print(f'+s('"\\n✓ OK: {len(ok)}   ✗ Fallidos: {len(fail)}"')+')');
  L.push('');
  L.push('    report = {');
  L.push('        '+s('"timestamp"')+': datetime.datetime.now().isoformat(),');
  L.push('        '+s('"mode"')+': '+s('"dry_run"')+' '+py('if')+' dry_run '+py('else')+' '+s('"deploy"')+',');
  L.push('        '+s('"driver"')+': '+s('"'+driver+'"')+',');
  L.push('        '+s('"results"')+': {h: {'+s('"status"')+': '+s('"ok"')+' '+py('if not')+' r.failed '+py('else')+' '+s('"failed"')+', '+s('"changed"')+': r[0].changed '+py('if')+' r '+py('else None')+'} '+py('for')+' h, r '+py('in')+' results.items()}');
  L.push('    }');
  L.push('    '+py('with')+' open('+s('"deploy_report.json"')+', '+s('"w"')+') '+py('as')+' f:');
  L.push('        json.dump(report, f, indent=2)');
  L.push('    print('+s('"\\n📄 Reporte: deploy_report.json"')+')');
  L.push('');
  L.push(py('if')+' __name__ == '+s('"__main__"')+': main()');

  return L.join('\n');
}

// ── RENDER ALL EXPORT ─────────────────────────────

