/*
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  NetPlan Pro v4.6 — script.js                                ║
 * ║                                                              ║
 * ║  Cambios v4.6 (Paso 6 reorganizado + SW-ACC + Hardening L2): ║
 * ║   · Generadores Cisco/Huawei devuelven array de bloques      ║
 * ║     por dispositivo: CORE + SW-ACC-PN + FW (referencial).    ║
 * ║   · SW-ACC L2 reales con uplink trunk al Core, port-security ║
 * ║     y bpduguard configurables vía toggle "Hardening L2".     ║
 * ║   · Render del Paso 6 por bloques: cada uno con Copiar       ║
 * ║     y Descargar .txt, más botón global Descargar todo (.zip).║
 * ║   · Excel robustecido a 7 hojas con estilos.                 ║
 * ║   · Eliminado: PDF, Mermaid, HTML completo.                  ║
 * ║   · Modal de finalizar con 3 opciones (guardar/quedarse,     ║
 * ║     guardar/nuevo, descartar/nuevo con confirmación).        ║
 * ║                                                              ║
 * ║  Secciones:                                                  ║
 * ║    1.  Estado global                                         ║
 * ║    2.  Constantes                                            ║
 * ║    3.  Utilidades IPv4                                       ║
 * ║    4.  Utilidades IPv6                                       ║
 * ║    5.  Validaciones de formulario                            ║
 * ║    6.  Paso 1 — Infraestructura                              ║
 * ║    7.  Paso 2 — Análisis IPv4                                ║
 * ║    8.  Paso 3 — Servicios                                    ║
 * ║    9.  Paso 4 — Plan y gestión de VLANs                      ║
 * ║   10.  Paso 4 — Render tarjetas VLAN                         ║
 * ║   10b. IPs de reserva por VLAN                               ║
 * ║   11.  Paso 5 — Resumen y tabla VLSM                         ║
 * ║   12.  Generador Cisco IOS/XE (por dispositivo)              ║
 * ║   13.  Generador Huawei VRP (por dispositivo)                ║
 * ║   13b. Generador Fortinet FortiOS                            ║
 * ║   14.  Paso 6 — Exportar (bloques, copy, txt, zip)           ║
 * ║   14b. Rollback / borrado seguro                             ║
 * ║   14c. Topología SVG + Drawio                                ║
 * ║   14d. Exportaciones (Excel, JSON, Drawio)                   ║
 * ║   15.  Navegación del wizard                                 ║
 * ║   16.  Panel lateral, toast y modal de finalizar             ║
 * ║   17.  Persistencia (JSON, autoguardado)                     ║
 * ║   18.  Nube — UI y handlers de Firebase                      ║
 * ║   19.  Inicialización                                        ║
 * ╚══════════════════════════════════════════════════════════════╝
 */


/* ══════════════════════════════════════════════════════════════
   1. ESTADO GLOBAL
   ══════════════════════════════════════════════════════════════ */
const S = {
  /* Paso 1 */
  pisos:       3,
  core_piso:   1,
  hosts_piso:  null,
  puertos:     48,
  redundancia: 'single',
  vendor:      'cisco',
  growth_factor: 2,

  /* NUEVO v4.6 — Hardening L2 básico */
  hardening_l2: true,    // port-security + bpduguard en SW-ACC

  /* Paso 2 */
  net:      null,
  override: '',

  /* Paso 3 */
  dns4:        '8.8.8.8',
  dns6:        '2001:4860:4860::8888',
  ntp:         'pool.ntp.org',
  domain:      'corp.local',
  ipv6:        true,
  wan_nexthop: '',
  wan_routes:  [],

  /* VLANs */
  vlan_defs: [],
  vlans:     [],
  ula_prefix: '',

  /* UI */
  step:             0,
  export_vendor:    'cisco',
  rollback_vendor:  'cisco',
  vlan_edit_id:     null,
  reserve_expanded: {},
  cloud_plan_id:    null,

  /* NUEVO v4.7 — Modo sin nube (Bloque A).
   * Cuando es true: la app funciona solo con localStorage + JSON.
   * Los botones cloud están ocultos. Esta decisión persiste en
   * localStorage.netplan_cloudless="true" hasta que el usuario haga
   * sign-in desde el header. */
  cloudless_mode:   false,
};


/* ══════════════════════════════════════════════════════════════
   2. CONSTANTES
   ══════════════════════════════════════════════════════════════ */

const VLAN_TEMPLATES = [
  { id: 10, name: 'Usuarios',       type: 'users',   floor: 'all',  badge: 'blue',  hosts_factor: 0.70, min_hosts: 10 },
  { id: 20, name: 'Administración', type: 'admin',   floor: 'core', badge: 'green', hosts_factor: 0.10, min_hosts: 10 },
  { id: 30, name: 'Servidores',     type: 'servers', floor: 'core', badge: 'green', hosts_factor: 0.05, min_hosts: 20 },
  { id: 40, name: 'VoIP',           type: 'voip',    floor: 'all',  badge: 'blue',  hosts_factor: 0.30, min_hosts: 10 },
  { id: 50, name: 'WiFi-Invitados', type: 'wifi',    floor: 'all',  badge: 'purple',hosts_factor: 0.40, min_hosts: 10 },
  { id: 60, name: 'Gestión',        type: 'mgmt',    floor: 'all',  badge: 'amber', hosts_factor: 0.00, min_hosts: 0  },
];

const RFC1918 = [
  { network: '192.168.0.0', min_prefix: 16 },
  { network: '172.16.0.0',  min_prefix: 12 },
  { network: '10.0.0.0',    min_prefix:  1 },
];

const TYPE_BADGE = {
  users: 'blue', admin: 'green', servers: 'green',
  voip: 'blue',  mgmt: 'amber', wifi: 'purple', custom: 'blue',
};


/* ══════════════════════════════════════════════════════════════
   3. UTILIDADES IPv4
   ══════════════════════════════════════════════════════════════ */

function ipToInt(ip) {
  return ip.split('.').reduce((acc, o) => (acc << 8) + parseInt(o, 10), 0) >>> 0;
}

function intToIp(n) {
  return [(n>>>24)&255, (n>>>16)&255, (n>>>8)&255, n&255].join('.');
}

function prefixToMask(prefix) {
  return intToIp(prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0);
}

function usableHosts(prefix) {
  return Math.pow(2, 32 - prefix) - 2;
}

function minPrefix(hostsRequired) {
  return 32 - Math.ceil(Math.log2(hostsRequired + 2));
}

function selectBaseNetwork(prefix) {
  for (const r of RFC1918) {
    if (prefix >= r.min_prefix) return r.network;
  }
  return '10.0.0.0';
}

function parseCIDR(cidr) {
  const m = cidr.trim().match(
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/
  );
  if (!m) return null;
  const octs = [m[1], m[2], m[3], m[4]].map(Number);
  if (octs.some(o => o > 255)) return null;
  const prefix = Number(m[5]);
  if (prefix < 8 || prefix > 30) return null;
  return { address: octs.join('.'), prefix };
}

function allocateVLSM(baseAddress, vlans) {
  const sorted = [...vlans].sort((a, b) => b.hosts_required - a.hosts_required);
  let current  = ipToInt(baseAddress);

  for (const vlan of sorted) {
    const prefix    = minPrefix(vlan.hosts_required);
    const blockSize = Math.pow(2, 32 - prefix);

    const target = vlans.find(v => v.id === vlan.id);
    target.prefix       = prefix;
    target.mask         = prefixToMask(prefix);
    target.network      = intToIp(current);
    target.gateway_v4   = intToIp(current + 1);
    target.broadcast    = intToIp(current + blockSize - 1);
    target.hosts_useful = blockSize - 2;
    target.efficiency   = Math.round((vlan.hosts_required / target.hosts_useful) * 100);

    current += blockSize;
  }
}


/* ══════════════════════════════════════════════════════════════
   4. UTILIDADES IPv6
   ══════════════════════════════════════════════════════════════ */

function calcULAPrefix(ipv4Address) {
  const p = ipv4Address.split('.').map(Number);
  const h = p.map(o => o.toString(16).padStart(2, '0'));
  return `fd${h[0]}:${h[1]}${h[2]}:${h[3]}00::/48`;
}

function calcV6Subnet(ula48, vlanId) {
  const site    = ula48.replace('::/48', '');
  const vlanHex = vlanId.toString(16).padStart(4, '0');
  return `${site}:${vlanHex}::/64`;
}

function calcV6Gateway(ula48, vlanId) {
  const site    = ula48.replace('::/48', '');
  const vlanHex = vlanId.toString(16).padStart(4, '0');
  return `${site}:${vlanHex}::1`;
}


/* ══════════════════════════════════════════════════════════════
   5. VALIDACIONES DE FORMULARIO
   ══════════════════════════════════════════════════════════════ */

function blockInvalidNumKeys(e) {
  if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
}

function setFieldValidity(fieldId, isValid) {
  document.getElementById(fieldId)?.classList.toggle('invalid', !isValid);
}

function isValidIPv4(str) {
  return /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/.test(str.trim());
}

function isValidIPv6(str) {
  const s = str.trim();
  if (!s.includes(':')) return false;
  if ((s.match(/::/g) || []).length > 1) return false;
  return /^[0-9a-fA-F:]+$/.test(s) && s.length >= 2;
}

function isValidIPv4orHostname(str) {
  const s = str.trim();
  if (isValidIPv4(s)) return true;
  return /^[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?)+$/.test(s);
}

function isValidDomain(str) {
  return /^[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?)+$/.test(str.trim());
}

function validateStep(step) {
  let valid = false;

  if (step === 0) {
    const pisosOk = S.pisos     !== null && S.pisos     >= 1 && S.pisos     <= 50;
    const maxCore = S.pisos || 50;
    const coreOk  = S.core_piso !== null && S.core_piso >= 1 && S.core_piso <= maxCore;
    const hOk     = S.hosts_piso !== null && S.hosts_piso >= 1 && S.hosts_piso <= 500;
    valid = pisosOk && coreOk && hOk;
  }

  if (step === 1) {
    const ov = document.getElementById('inp-override')?.value?.trim() || '';
    valid = ov === '' || parseCIDR(ov) !== null;
  }

  if (step === 2) {
    const d4Ok   = isValidIPv4(document.getElementById('inp-dns4')?.value || '');
    const d6Ok   = isValidIPv6(document.getElementById('inp-dns6')?.value || '');
    const ntpOk  = isValidIPv4orHostname(document.getElementById('inp-ntp')?.value || '');
    const domOk  = isValidDomain(document.getElementById('inp-domain')?.value || '');
    const nhVal  = document.getElementById('inp-wan-nexthop')?.value.trim() || '';
    const rtVal  = document.getElementById('inp-wan-routes')?.value || '';
    const nhOk   = nhVal === '' || isValidIPv4(nhVal);
    const rtOk   = rtVal.split('\n').map(l=>l.trim()).filter(Boolean).every(r=>parseCIDR(r)!==null);
    valid = d4Ok && d6Ok && ntpOk && domOk && nhOk && rtOk;
  }

  if (step >= 3) valid = true;

  const btn = document.getElementById('btn-next');
  if (btn) btn.disabled = !valid;
  return valid;
}


/* ══════════════════════════════════════════════════════════════
   6. PASO 1 — INFRAESTRUCTURA
   ══════════════════════════════════════════════════════════════ */

function selectToggle(groupId, btn) {
  document.querySelectorAll(`#${groupId} .toggle-btn`).forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const val = btn.dataset.value;
  if (groupId === 'tg-redund') {
    S.redundancia = val;
    setText('st-redund', val === 'single' ? 'Single-Link' : 'Dual-Link (LACP)');
  }
  autosave();
}

function selectVendor(btn) {
  document.querySelectorAll('#tg-vendor .vendor-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  S.vendor = btn.dataset.value;
  setText('st-vendor', btn.querySelector('.vendor-name').textContent);
  autosave();
}

function onPisosChange() {
  const inpPisos = document.getElementById('inp-pisos');
  const inpCore  = document.getElementById('inp-core');
  const raw      = inpPisos.value.trim();
  const pisosVal = parseInt(raw, 10);
  const pisosOk  = !isNaN(pisosVal) && pisosVal >= 1 && pisosVal <= 50;

  setFieldValidity('field-pisos', pisosOk || raw === '');

  if (pisosOk) {
    S.pisos = pisosVal;
    inpCore.max = pisosVal;
    const hint = document.getElementById('hint-core');
    if (hint) hint.textContent = `Rango: 1 – ${pisosVal} (debe ser ≤ número de pisos)`;
    const errMsg = document.getElementById('error-core');
    if (errMsg) errMsg.textContent = `Debe estar entre 1 y ${pisosVal}`;

    const coreVal = parseInt(inpCore.value, 10);
    if (!isNaN(coreVal) && coreVal > pisosVal) {
      inpCore.value = pisosVal;
    }
    S.vlan_defs = [];
  } else {
    S.pisos = null;
  }

  validateCoreInput();
  validateStep(0);
  autosave();
}

function onCoreChange() {
  validateCoreInput();
  validateStep(0);
  autosave();
}

function validateCoreInput() {
  const inpCore = document.getElementById('inp-core');
  const raw     = inpCore.value.trim();
  const coreVal = parseInt(raw, 10);
  const max     = S.pisos || 50;
  const coreOk  = !isNaN(coreVal) && coreVal >= 1 && coreVal <= max;

  setFieldValidity('field-core', coreOk || raw === '');

  S.core_piso = coreOk ? coreVal : null;
}

function onGrowthChange() {
  S.growth_factor = parseFloat(document.getElementById('sel-growth').value);
  S.vlan_defs = [];
  if (S.pisos && S.hosts_piso) runAnalysis();
  validateStep(0);
  autosave();
}

function onHostsChange() {
  const hostsVal = parseInt(document.getElementById('inp-hosts').value, 10);
  const puertos  = parseInt(document.getElementById('sel-puertos').value, 10);
  const hostsOk  = !isNaN(hostsVal) && hostsVal >= 1 && hostsVal <= 500;

  S.hosts_piso = hostsOk ? hostsVal : null;
  S.puertos    = puertos;

  setFieldValidity('field-hosts', hostsOk || document.getElementById('inp-hosts').value === '');

  const box     = document.getElementById('sw-result');
  const countEl = document.getElementById('sw-count');
  const detailEl = document.getElementById('sw-detail');

  if (hostsOk) {
    const needed = Math.ceil(hostsVal / puertos);
    box.classList.toggle('ok',   needed === 1);
    box.classList.toggle('warn', needed > 1);
    countEl.textContent  = needed === 1 ? '1 switch por piso' : `${needed} switches por piso`;
    detailEl.textContent = `${hostsVal} hosts ÷ ${puertos} puertos = ${needed} switch${needed > 1 ? 'es' : ''} necesario${needed > 1 ? 's' : ''} por piso`;
    setText('st-hpiso', hostsVal);
    setText('st-ports', puertos);
    setText('st-sw',    needed);
  } else {
    countEl.textContent  = '—';
    detailEl.textContent = 'Ingresa los hosts por piso para ver el cálculo';
  }

  validateStep(0);
  autosave();
}

/* NUEVO v4.6 — Toggle de hardening L2 */
function onHardeningToggle(cb) {
  S.hardening_l2 = cb.checked;
  /* Re-renderizar pestaña de exportar si está visible */
  if (S.step === 5) renderExportCode();
  autosave();
}


/* ══════════════════════════════════════════════════════════════
   7. PASO 2 — ANÁLISIS IPv4
   ══════════════════════════════════════════════════════════════ */

function runAnalysis() {
  if (!S.pisos || !S.hosts_piso) return;

  const totalHosts = S.hosts_piso * S.pisos;
  const hostsPlan  = Math.round(totalHosts * S.growth_factor);

  let prefix, baseAddress;

  if (S.override && parseCIDR(S.override)) {
    const parsed = parseCIDR(S.override);
    baseAddress  = parsed.address;
    prefix       = parsed.prefix;
  } else {
    prefix      = minPrefix(hostsPlan);
    baseAddress = selectBaseNetwork(prefix);
  }

  const useful = usableHosts(prefix);
  const margin = useful - hostsPlan;
  const score  = Math.round((hostsPlan / useful) * 100);

  S.net = { address: baseAddress, prefix, mask: prefixToMask(prefix),
            hosts_plan: hostsPlan, hosts_total: totalHosts, useful, margin, score };

  if (S.ipv6) {
    S.ula_prefix = calcULAPrefix(baseAddress);
    setText('ipv6-prefix', S.ula_prefix);
    setText('st-prefix', S.ula_prefix.replace('::/48', '…/48'));
  }

  setText('res-network', `${baseAddress} / ${prefix}`);
  setText('res-mask',    `Máscara: ${prefixToMask(prefix)} — ${useful.toLocaleString()} hosts disponibles`);
  setText('res-planned', hostsPlan.toLocaleString());
  setText('res-margin',  margin.toLocaleString());
  setText('res-score',   score);

  const isRFC = ['10.', '172.16', '192.168'].some(p => baseAddress.startsWith(p));
  toggleClass('chk-rfc',    'ok', isRFC);
  toggleClass('chk-scale',  'ok', margin > 0);
  toggleClass('chk-vlsm',   'ok', true);
  toggleClass('chk-redund', 'ok', true);

  setText('st-network', `${baseAddress}/${prefix}`);
  setText('st-hosts',   `${hostsPlan.toLocaleString()} (${S.growth_factor}×)`);
  setText('st-hosts-lbl', `Hosts (${S.growth_factor}×)`);
  setText('res-planned-lbl', `hosts planificados (${S.growth_factor}×)`);
  setText('st-score',   score);
}

function onOverrideChange() {
  const val = document.getElementById('inp-override')?.value?.trim() || '';
  S.override = val;
  setFieldValidity('field-override', val === '' || parseCIDR(val) !== null);
  if (S.pisos && S.hosts_piso) runAnalysis();
  validateStep(1);
  autosave();
}


/* ══════════════════════════════════════════════════════════════
   8. PASO 3 — SERVICIOS DE RED
   ══════════════════════════════════════════════════════════════ */

function onServicesChange() {
  const dns4Val = document.getElementById('inp-dns4')?.value  || '';
  const dns6Val = document.getElementById('inp-dns6')?.value  || '';
  const ntpVal  = document.getElementById('inp-ntp')?.value   || '';
  const domVal  = document.getElementById('inp-domain')?.value || '';

  const d4Ok  = isValidIPv4(dns4Val);
  const d6Ok  = isValidIPv6(dns6Val);
  const ntpOk = isValidIPv4orHostname(ntpVal);
  const domOk = isValidDomain(domVal);

  setFieldValidity('field-dns4',   d4Ok);
  setFieldValidity('field-dns6',   d6Ok);
  setFieldValidity('field-ntp',    ntpOk);
  setFieldValidity('field-domain', domOk);

  if (d4Ok)  S.dns4   = dns4Val.trim();
  if (d6Ok)  S.dns6   = dns6Val.trim();
  if (ntpOk) S.ntp    = ntpVal.trim();
  if (domOk) S.domain = domVal.trim();

  validateStep(2);
  autosave();
}

function onIPv6Toggle(cb) {
  S.ipv6 = cb.checked;
  document.getElementById('ipv6-info')?.classList.toggle('hidden', !S.ipv6);
  if (S.ipv6 && S.net) {
    S.ula_prefix = calcULAPrefix(S.net.address);
    setText('ipv6-prefix', S.ula_prefix);
    setText('st-prefix', S.ula_prefix.replace('::/48', '…/48'));
  }
  autosave();
}

function onWanChange() {
  const nhVal  = document.getElementById('inp-wan-nexthop')?.value.trim() || '';
  const rtVal  = document.getElementById('inp-wan-routes')?.value        || '';

  const nhOk   = nhVal === '' || isValidIPv4(nhVal);
  const routes = rtVal.split('\n').map(l => l.trim()).filter(Boolean);
  const rtOk   = routes.every(r => parseCIDR(r) !== null);

  setFieldValidity('field-wan-nexthop', nhOk);
  setFieldValidity('field-wan-routes',  rtOk);

  if (nhOk)  S.wan_nexthop = nhVal;
  if (rtOk)  S.wan_routes  = routes;

  validateStep(2);
  autosave();
}


/* ══════════════════════════════════════════════════════════════
   9. PASO 4 — PLAN Y GESTIÓN DE VLANs
   ══════════════════════════════════════════════════════════════ */

function initVlanDefs() {
  if (S.vlan_defs.length > 0) return;

  const totalHosts = S.hosts_piso * S.pisos;
  const swPerFloor  = Math.ceil(S.hosts_piso / S.puertos);
  const apsPerFloor  = Math.ceil(S.hosts_piso / 30);
  const mgmtDevices  = swPerFloor * S.pisos + apsPerFloor * S.pisos + 3;

  S.vlan_defs = VLAN_TEMPLATES.map(t => ({
    id:             t.id,
    name:           t.name,
    type:           t.type,
    badge:          t.badge,
    floor:          t.floor,
    reserved_ips:   [],
    hosts_required: t.id === 60
      ? Math.max(t.min_hosts, mgmtDevices)
      : Math.max(t.min_hosts, Math.ceil(totalHosts * t.hosts_factor)),
  }));
}

function calcFloorLabel(floor) {
  if (floor === 'all')  return S.pisos === 1 ? `Piso ${S.core_piso}` : `Pisos 1–${S.pisos}`;
  if (floor === 'core') return `Piso ${S.core_piso} (CPD)`;
  return `Piso ${floor}`;
}

function buildVLANPlan() {
  if (!S.net || !S.pisos || !S.hosts_piso) return;

  initVlanDefs();

  S.vlans = S.vlan_defs.map(d => ({
    ...d,
    floor_label:  calcFloorLabel(d.floor),
    reserved_ips: d.reserved_ips || [],
    prefix: null, mask: null, network: null,
    gateway_v4: null, broadcast: null, hosts_useful: null, efficiency: null,
  }));

  allocateVLSM(S.net.address, S.vlans);

  if (S.ipv6 && S.ula_prefix) {
    S.vlans.forEach(v => {
      v.subnet_v6  = calcV6Subnet(S.ula_prefix, v.id);
      v.gateway_v6 = calcV6Gateway(S.ula_prefix, v.id);
    });
  }

  setText('st-vlans',  S.vlans.length);
  setText('st-blocks', S.ipv6 ? S.vlans.length : '—');
}

function showAddVlanForm() {
  S.vlan_edit_id = null;
  setText('vlan-form-title', 'Nueva VLAN');

  ['inp-vid', 'inp-vname', 'inp-vhosts'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; el.disabled = false; }
  });
  document.getElementById('sel-vtype').value  = 'users';
  document.getElementById('sel-vfloor').value = 'all';

  ['field-vid', 'field-vname', 'field-vhosts'].forEach(id =>
    document.getElementById(id)?.classList.remove('invalid')
  );

  document.getElementById('btn-save-vlan').disabled = true;
  document.getElementById('vlan-form').classList.remove('hidden');
  document.getElementById('vlan-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function editVlan(id) {
  const vlan = S.vlan_defs.find(v => v.id === id);
  if (!vlan) return;

  S.vlan_edit_id = id;
  setText('vlan-form-title', `Editar VLAN ${id} — ${vlan.name}`);

  document.getElementById('inp-vid').value    = vlan.id;
  document.getElementById('inp-vid').disabled = true;
  document.getElementById('inp-vname').value  = vlan.name;
  document.getElementById('inp-vhosts').value = vlan.hosts_required;
  document.getElementById('sel-vtype').value  = vlan.type;
  document.getElementById('sel-vfloor').value = vlan.floor;

  ['field-vid', 'field-vname', 'field-vhosts'].forEach(id =>
    document.getElementById(id)?.classList.remove('invalid')
  );

  document.getElementById('btn-save-vlan').disabled = false;
  document.getElementById('vlan-form').classList.remove('hidden');
  document.getElementById('vlan-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function deleteVlan(id) {
  if (S.vlan_defs.length <= 1) {
    showToast('El plan debe tener al menos 1 VLAN', 'error');
    return;
  }
  S.vlan_defs = S.vlan_defs.filter(v => v.id !== id);
  buildVLANPlan();
  renderVLANCards();
  updateVlansCount();
  showToast(`VLAN ${id} eliminada`, 'success');
  autosave();
}

function cancelVlanEdit() {
  document.getElementById('vlan-form').classList.add('hidden');
  S.vlan_edit_id = null;
}

function validateVlanForm() {
  const idEl    = document.getElementById('inp-vid');
  const nameEl  = document.getElementById('inp-vname');
  const hostsEl = document.getElementById('inp-vhosts');

  const id    = parseInt(idEl?.value, 10);
  const name  = nameEl?.value?.trim() || '';
  const hosts = parseInt(hostsEl?.value, 10);

  const idExists = S.vlan_defs.some(v => v.id === id && v.id !== S.vlan_edit_id);
  const idOk     = !isNaN(id) && id >= 1 && id <= 4094 && !idExists;
  const nameOk   = /^[a-zA-ZáéíóúÁÉÍÓÚñÑ0-9_\-]{1,20}$/.test(name);
  const hostsOk  = !isNaN(hosts) && hosts >= 2 && hosts <= 500;

  const idTouched    = idEl?.value    !== '';
  const nameTouched  = nameEl?.value  !== '';
  const hostsTouched = hostsEl?.value !== '';

  setFieldValidity('field-vid',    idOk    || !idTouched);
  setFieldValidity('field-vname',  nameOk  || !nameTouched);
  setFieldValidity('field-vhosts', hostsOk || !hostsTouched);

  document.getElementById('btn-save-vlan').disabled = !(idOk && nameOk && hostsOk);
}

function saveVlan() {
  const id    = parseInt(document.getElementById('inp-vid').value, 10);
  const name  = document.getElementById('inp-vname').value.trim();
  const hosts = parseInt(document.getElementById('inp-vhosts').value, 10);
  const type  = document.getElementById('sel-vtype').value;
  const floor = document.getElementById('sel-vfloor').value;
  const badge = TYPE_BADGE[type] || 'blue';

  if (S.vlan_edit_id !== null) {
    const idx = S.vlan_defs.findIndex(v => v.id === S.vlan_edit_id);
    if (idx !== -1) {
      S.vlan_defs[idx] = { ...S.vlan_defs[idx], name, hosts_required: hosts, type, floor, badge };
    }
    showToast(`VLAN ${S.vlan_edit_id} actualizada`, 'success');
  } else {
    S.vlan_defs.push({ id, name, type, floor, badge, hosts_required: hosts, reserved_ips: [] });
    S.vlan_defs.sort((a, b) => a.id - b.id);
    showToast(`VLAN ${id} agregada`, 'success');
  }

  cancelVlanEdit();
  buildVLANPlan();
  renderVLANCards();
  updateVlansCount();
  autosave();
}

function updateVlansCount() {
  const n = S.vlan_defs.length;
  setText('vlans-count', `${n} VLAN${n !== 1 ? 's' : ''}`);
}


/* ══════════════════════════════════════════════════════════════
   10. PASO 4 — RENDER TARJETAS VLAN
   ══════════════════════════════════════════════════════════════ */

function renderVLANCards() {
  const container = document.getElementById('vlans-container');
  if (!container) return;

  if (!S.vlans.length) {
    container.innerHTML = '<p class="placeholder-msg">Completa los pasos anteriores para generar las VLANs</p>';
    return;
  }

  container.innerHTML = S.vlans.map(v => {
    const overWarn = (S.hosts_piso && v.hosts_required > S.hosts_piso)
      ? `<span class="vlan-warn-badge" title="Los hosts requeridos (${v.hosts_required}) superan el promedio por piso (${S.hosts_piso})">⚠ Supera prom./piso</span>`
      : '';

    return `
    <div class="vlan-card type-${v.type}">
      <div class="vlan-card-header">
        <span class="vlan-card-name">VLAN ${v.id} — ${v.name}</span>
        <div class="vlan-card-actions">
          ${overWarn}
          <span class="vlan-badge ${v.badge}">${v.floor_label}</span>
          <button class="btn-icon btn-edit"   onclick="editVlan(${v.id})"   title="Editar VLAN">✎</button>
          <button class="btn-icon btn-delete" onclick="deleteVlan(${v.id})" title="Eliminar VLAN">✕</button>
        </div>
      </div>
      <div class="vlan-card-detail">
        <span class="v4">IPv4: ${v.network}/${v.prefix} · GW: ${v.gateway_v4} · ${v.hosts_useful} hosts útiles · Eficiencia: ${v.efficiency}%</span>
        ${S.ipv6 && v.subnet_v6 ? `<br><span class="v6">IPv6: ${v.subnet_v6} · GW: ${v.gateway_v6}</span>` : ''}
      </div>
      ${renderReserveSection(v)}
    </div>`;
  }).join('');
}


/* ══════════════════════════════════════════════════════════════
   10b. IPs DE RESERVA POR VLAN (Dual Stack)
   ══════════════════════════════════════════════════════════════ */

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function genResId() {
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

function getNextReservedIP4(vlanId) {
  const vlan = S.vlans.find(v => v.id === vlanId);
  if (!vlan || !vlan.gateway_v4) return '';
  const gwInt = ipToInt(vlan.gateway_v4);
  const used  = (vlan.reserved_ips || []).map(r => r.ip4).filter(Boolean).map(ipToInt);
  for (let offset = 1; offset <= 9; offset++) {
    if (!used.includes(gwInt + offset)) return intToIp(gwInt + offset);
  }
  return '';
}

function getNextReservedIP6(vlanId) {
  const vlan = S.vlans.find(v => v.id === vlanId);
  if (!vlan || !vlan.gateway_v6) return '';
  const base = vlan.gateway_v6.replace(/::1$/, '::');
  const used = (vlan.reserved_ips || []).map(r => r.ip6).filter(Boolean);
  for (let n = 2; n <= 10; n++) {
    const candidate = `${base}${n}`;
    if (!used.includes(candidate)) return candidate;
  }
  return '';
}

function isValidReservedIP4(ip4, vlanId, excludeResId = null) {
  const vlan = S.vlans.find(v => v.id === vlanId);
  if (!vlan || !isValidIPv4(ip4)) return false;
  const ipInt = ipToInt(ip4);
  const gwInt = ipToInt(vlan.gateway_v4);
  if (ipInt < gwInt + 1 || ipInt > gwInt + 9) return false;
  const used = (vlan.reserved_ips || [])
    .filter(r => r.id !== excludeResId)
    .map(r => r.ip4).filter(Boolean).map(ipToInt);
  return !used.includes(ipInt);
}

function isValidReservedIP6(ip6, vlanId, excludeResId = null) {
  const vlan = S.vlans.find(v => v.id === vlanId);
  if (!vlan || !isValidIPv6(ip6)) return false;
  if (ip6.trim() === vlan.gateway_v6) return false;
  const used = (vlan.reserved_ips || [])
    .filter(r => r.id !== excludeResId)
    .map(r => r.ip6).filter(Boolean);
  return !used.includes(ip6.trim());
}

function renderReserveSection(v) {
  const expanded  = S.reserve_expanded[v.id] || false;
  const rips      = v.reserved_ips || [];
  const maxReached = rips.length >= 9;
  const ipv6On    = S.ipv6 && !!v.subnet_v6;
  const gwInt     = v.gateway_v4 ? ipToInt(v.gateway_v4) : 0;
  const rangeStart = v.gateway_v4 ? intToIp(gwInt + 1) : '—';
  const rangeEnd   = v.gateway_v4 ? intToIp(gwInt + 9) : '—';
  const suggestIP4 = getNextReservedIP4(v.id);
  const suggestIP6 = ipv6On ? getNextReservedIP6(v.id) : '';

  let tableHtml = '';
  if (rips.length > 0) {
    const rows = rips.map(r => `
      <tr>
        <td class="res-alias">${escHtml(r.alias)}</td>
        <td class="mono res-ip4">${r.ip4 ? escHtml(r.ip4) : '<span class="res-none">—</span>'}</td>
        ${ipv6On ? `<td class="mono res-ip6">${r.ip6 ? escHtml(r.ip6) : '<span class="res-none">—</span>'}</td>` : ''}
        <td class="res-stack-badge"><span class="stack-pill stack-${r.stack}">${r.stack.toUpperCase()}</span></td>
        <td><button class="btn-icon btn-delete" onclick="deleteReservation(${v.id},'${r.id}')" title="Eliminar reserva">✕</button></td>
      </tr>`).join('');

    tableHtml = `
      <table class="reserve-table">
        <thead><tr>
          <th>Alias / Hostname</th>
          <th>IPv4</th>
          ${ipv6On ? '<th>IPv6</th>' : ''}
          <th>Stack</th>
          <th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } else {
    tableHtml = `<p class="reserve-empty">Sin IPs de reserva asignadas (rango ${rangeStart}–${rangeEnd})</p>`;
  }

  const stackOpts = ipv6On
    ? `<option value="ipv4">Solo IPv4</option>
       <option value="ipv6">Solo IPv6</option>
       <option value="dual">Dual Stack</option>`
    : `<option value="ipv4">Solo IPv4</option>`;

  const formHtml = `
    <div class="reserve-form hidden" id="reserve-form-${v.id}">
      <div class="grid-2">
        <div class="field" id="field-res-alias-${v.id}">
          <label for="inp-res-alias-${v.id}">Alias / Hostname</label>
          <input type="text" id="inp-res-alias-${v.id}" maxlength="30"
                 placeholder="Ej: AP-Piso1, Impresora-Adm"
                 oninput="validateReserveForm(${v.id})" />
          <span class="field-hint">Nombre del dispositivo (máx. 30 caracteres)</span>
          <span class="field-error">Alias inválido o vacío</span>
        </div>
        <div class="field">
          <label for="sel-res-stack-${v.id}">Tipo de Stack</label>
          <select id="sel-res-stack-${v.id}" onchange="onReserveStackChange(${v.id})">${stackOpts}</select>
          <span class="field-hint">Protocolos del dispositivo</span>
        </div>
      </div>
      <div class="grid-2">
        <div class="field" id="field-res-ip4-${v.id}">
          <label for="inp-res-ip4-${v.id}">Dirección IPv4</label>
          <input type="text" id="inp-res-ip4-${v.id}"
                 placeholder="${suggestIP4 || rangeStart}"
                 oninput="validateReserveForm(${v.id})" />
          <span class="field-hint">Rango reservado: ${rangeStart} – ${rangeEnd}</span>
          <span class="field-error">IP fuera del rango .2–.10 o ya usada</span>
        </div>
        <div class="field ${!ipv6On ? 'hidden' : ''}" id="field-res-ip6-${v.id}">
          <label for="inp-res-ip6-${v.id}">Dirección IPv6</label>
          <input type="text" id="inp-res-ip6-${v.id}"
                 placeholder="${suggestIP6}"
                 oninput="validateReserveForm(${v.id})" />
          <span class="field-hint">Dentro de ${v.subnet_v6 || '—'} · no puede ser ::1</span>
          <span class="field-error">IPv6 inválida, duplicada o es la gateway (::1)</span>
        </div>
      </div>
      <div class="reserve-form-footer">
        <button class="btn-nav btn-back" onclick="cancelReserveForm(${v.id})">Cancelar</button>
        <button class="btn-nav btn-next" id="btn-save-res-${v.id}"
                onclick="saveReservation(${v.id})" disabled>Guardar reserva</button>
      </div>
    </div>`;

  const addBtn = maxReached
    ? `<p class="reserve-full">⚠ Máximo de 9 reservas por VLAN alcanzado</p>`
    : `<button class="btn-add-reserve" id="btn-add-reserve-${v.id}"
              onclick="showReserveForm(${v.id})">+ Agregar reserva IP</button>`;

  return `
    <div class="vlan-reserve-section">
      <div class="vlan-reserve-toggle" onclick="toggleReserveSection(${v.id})">
        <span class="reserve-toggle-label">IPs de reserva</span>
        <span class="reserve-badge ${rips.length > 0 ? 'active' : ''}">${rips.length} asignada${rips.length !== 1 ? 's' : ''}</span>
        <span class="reserve-arrow ${expanded ? 'open' : ''}">▾</span>
      </div>
      <div class="vlan-reserve-body ${expanded ? '' : 'hidden'}" id="reserve-body-${v.id}">
        ${tableHtml}
        ${formHtml}
        ${addBtn}
      </div>
    </div>`;
}

function toggleReserveSection(vlanId) {
  S.reserve_expanded[vlanId] = !S.reserve_expanded[vlanId];
  const body  = document.getElementById(`reserve-body-${vlanId}`);
  const arrow = document.querySelector(`[onclick="toggleReserveSection(${vlanId})"] .reserve-arrow`);
  if (body)  body.classList.toggle('hidden', !S.reserve_expanded[vlanId]);
  if (arrow) arrow.classList.toggle('open', S.reserve_expanded[vlanId]);
}

function showReserveForm(vlanId) {
  const form   = document.getElementById(`reserve-form-${vlanId}`);
  const addBtn = document.getElementById(`btn-add-reserve-${vlanId}`);
  if (!form) return;

  const aliasEl = document.getElementById(`inp-res-alias-${vlanId}`);
  const ip4El   = document.getElementById(`inp-res-ip4-${vlanId}`);
  const ip6El   = document.getElementById(`inp-res-ip6-${vlanId}`);
  const stackEl = document.getElementById(`sel-res-stack-${vlanId}`);
  if (aliasEl) aliasEl.value = '';
  if (ip4El)   ip4El.value   = getNextReservedIP4(vlanId);
  if (ip6El)   ip6El.value   = getNextReservedIP6(vlanId);
  if (stackEl) stackEl.value = 'ipv4';

  [`field-res-alias-${vlanId}`, `field-res-ip4-${vlanId}`, `field-res-ip6-${vlanId}`]
    .forEach(id => document.getElementById(id)?.classList.remove('invalid'));

  onReserveStackChange(vlanId);

  const saveBtn = document.getElementById(`btn-save-res-${vlanId}`);
  if (saveBtn) saveBtn.disabled = true;

  form.classList.remove('hidden');
  if (addBtn) addBtn.classList.add('hidden');
}

function cancelReserveForm(vlanId) {
  document.getElementById(`reserve-form-${vlanId}`)?.classList.add('hidden');
  document.getElementById(`btn-add-reserve-${vlanId}`)?.classList.remove('hidden');
}

function onReserveStackChange(vlanId) {
  const stack   = document.getElementById(`sel-res-stack-${vlanId}`)?.value || 'ipv4';
  const ip4Fld  = document.getElementById(`field-res-ip4-${vlanId}`);
  const ip6Fld  = document.getElementById(`field-res-ip6-${vlanId}`);

  if (ip4Fld) ip4Fld.classList.toggle('hidden', stack === 'ipv6');
  if (ip6Fld) ip6Fld.classList.toggle('hidden', stack === 'ipv4');

  if (stack === 'ipv6') document.getElementById(`field-res-ip4-${vlanId}`)?.classList.remove('invalid');
  if (stack === 'ipv4') document.getElementById(`field-res-ip6-${vlanId}`)?.classList.remove('invalid');

  validateReserveForm(vlanId);
}

function validateReserveForm(vlanId) {
  const aliasEl = document.getElementById(`inp-res-alias-${vlanId}`);
  const ip4El   = document.getElementById(`inp-res-ip4-${vlanId}`);
  const ip6El   = document.getElementById(`inp-res-ip6-${vlanId}`);
  const stack   = document.getElementById(`sel-res-stack-${vlanId}`)?.value || 'ipv4';
  const saveBtn = document.getElementById(`btn-save-res-${vlanId}`);

  const alias   = aliasEl?.value?.trim() || '';
  const ip4     = ip4El?.value?.trim()   || '';
  const ip6     = ip6El?.value?.trim()   || '';

  const aliasOk   = /^[a-zA-ZáéíóúÁÉÍÓÚñÑ0-9_\-\.]{1,30}$/.test(alias);
  const needsIP4  = stack === 'ipv4' || stack === 'dual';
  const needsIP6  = stack === 'ipv6' || stack === 'dual';
  const ip4Ok     = !needsIP4 || isValidReservedIP4(ip4, vlanId);
  const ip6Ok     = !needsIP6 || isValidReservedIP6(ip6, vlanId);

  const aliasTouched = (aliasEl?.value || '') !== '';
  const ip4Touched   = (ip4El?.value   || '') !== '';
  const ip6Touched   = (ip6El?.value   || '') !== '';

  setFieldValidity(`field-res-alias-${vlanId}`, aliasOk  || !aliasTouched);
  if (needsIP4) setFieldValidity(`field-res-ip4-${vlanId}`, ip4Ok || !ip4Touched);
  if (needsIP6) setFieldValidity(`field-res-ip6-${vlanId}`, ip6Ok || !ip6Touched);

  if (saveBtn) saveBtn.disabled = !(aliasOk && ip4Ok && ip6Ok);
}

function saveReservation(vlanId) {
  const alias = document.getElementById(`inp-res-alias-${vlanId}`)?.value.trim();
  const ip4   = document.getElementById(`inp-res-ip4-${vlanId}`)?.value.trim();
  const ip6   = document.getElementById(`inp-res-ip6-${vlanId}`)?.value.trim();
  const stack = document.getElementById(`sel-res-stack-${vlanId}`)?.value || 'ipv4';

  if (!alias) return;

  const vlanDef = S.vlan_defs.find(v => v.id === vlanId);
  if (!vlanDef) return;
  if (!vlanDef.reserved_ips) vlanDef.reserved_ips = [];
  if (vlanDef.reserved_ips.length >= 9) {
    showToast('Máximo de 9 reservas por VLAN alcanzado', 'error');
    return;
  }

  vlanDef.reserved_ips.push({
    id:    genResId(),
    alias,
    ip4:   (stack === 'ipv4' || stack === 'dual') ? ip4 || null : null,
    ip6:   (stack === 'ipv6' || stack === 'dual') ? ip6 || null : null,
    stack,
  });

  S.reserve_expanded[vlanId] = true;
  buildVLANPlan();
  renderVLANCards();
  updateVlansCount();
  showToast(`Reserva "${alias}" agregada a VLAN ${vlanId}`, 'success');
  autosave();
}

function deleteReservation(vlanId, resId) {
  const vlanDef = S.vlan_defs.find(v => v.id === vlanId);
  if (!vlanDef) return;
  const prev = vlanDef.reserved_ips?.find(r => r.id === resId);
  vlanDef.reserved_ips = (vlanDef.reserved_ips || []).filter(r => r.id !== resId);
  S.reserve_expanded[vlanId] = true;
  buildVLANPlan();
  renderVLANCards();
  updateVlansCount();
  showToast(`Reserva${prev ? ` "${prev.alias}"` : ''} eliminada de VLAN ${vlanId}`, 'success');
  autosave();
}


/* ══════════════════════════════════════════════════════════════
   11. PASO 5 — RESUMEN Y TABLA VLSM
   ══════════════════════════════════════════════════════════════ */

function renderSummary() {
  if (!S.vlans.length) return;

  const totalHostsReq = S.vlans.reduce((sum, v) => sum + v.hosts_required, 0);
  const totalUseful   = S.vlans.reduce((sum, v) => sum + v.hosts_useful,   0);
  const globalEff     = Math.round((totalHostsReq / totalUseful) * 100);
  const swPerFloor    = Math.ceil(S.hosts_piso / S.puertos);

  setText('sum-eff',   `${globalEff}%`);
  setText('sum-vlans', S.vlans.length);
  setText('sum-hosts', (S.hosts_piso * S.pisos).toLocaleString());
  setText('sum-sw',    swPerFloor);

  const tbody = document.getElementById('vlsm-tbody');
  if (!tbody) return;

  tbody.innerHTML = S.vlans.map(v => `
    <tr>
      <td>${v.id}</td>
      <td class="td-name">${v.name}</td>
      <td>${v.floor_label}</td>
      <td>${v.network}/${v.prefix}</td>
      <td>${v.mask}</td>
      <td>${v.gateway_v4}</td>
      <td>${v.broadcast}</td>
      <td>${v.hosts_useful}</td>
      <td>${v.efficiency}%</td>
      <td>${S.ipv6 && v.subnet_v6 ? v.subnet_v6 : '—'}</td>
      <td>${S.ipv6 && v.gateway_v6 ? v.gateway_v6 : '—'}</td>
    </tr>`).join('');

  /* Render tabla de conexiones físicas (reemplaza al SVG inline) */
  renderConnectionsTable();
}

/* Helpers compartidos para configs */

function getFWip() {
  const v60 = S.vlans.find(v => v.id === 60);
  return v60 ? intToIp(ipToInt(v60.gateway_v4) + 1) : '(FW_IP)';
}

function getFWv6ip() {
  const v60 = S.vlans.find(v => v.id === 60);
  return v60 && v60.gateway_v6 ? v60.gateway_v6.replace('::1', '::2') : '(FW_IPV6)';
}

function getCoreIP() {
  const v60 = S.vlans.find(v => v.id === 60);
  return v60 ? v60.gateway_v4 : '(IP_CORE)';
}

function buildWifiComment(v, prefix) {
  if (v.type !== 'wifi') return '';
  return `${prefix} ─── ${v.name} (WiFi) ──────────────────────────────────\n`;
}

function buildWanRoutes(vendor) {
  if (!S.wan_nexthop || !S.wan_routes.length) return '';
  let c = '';
  S.wan_routes.forEach(route => {
    const p = parseCIDR(route);
    if (!p) return;
    if (vendor === 'cisco') {
      c += `ip route ${p.address} ${prefixToMask(p.prefix)} ${S.wan_nexthop}\n`;
    } else if (vendor === 'huawei') {
      c += `ip route-static ${p.address} ${prefixToMask(p.prefix)} ${S.wan_nexthop}\n`;
    }
  });
  if (c) c += vendor === 'cisco' ? '!\n' : '#\n';
  return c;
}


/* ══════════════════════════════════════════════════════════════
   12. GENERADOR CISCO IOS/XE — POR DISPOSITIVO
   Devuelve array de bloques: { hostname, role, content }
   ══════════════════════════════════════════════════════════════ */

function generateCiscoConfig() {
  const blocks = [];

  /* Bloque 1: Core Switch L3 */
  blocks.push({
    hostname: 'CORE-SW-01',
    role:     'Core Switch L3',
    content:  generateCiscoCore(),
  });

  /* Bloques 2..N: Switches L2 de acceso (uno por piso que NO sea el Core) */
  for (let floor = 1; floor <= S.pisos; floor++) {
    if (floor === S.core_piso) continue;  // Core absorbe ese piso (opción B)
    blocks.push({
      hostname: `SW-ACC-P${floor}`,
      role:     'Access Switch L2',
      content:  generateCiscoAccessSwitch(floor),
    });
  }

  /* Bloque N+1: Firewall referencial */
  blocks.push({
    hostname: 'FW-01',
    role:     'Firewall (Cisco ASA — referencia)',
    content:  generateCiscoFirewallRef(),
  });

  return blocks;
}

function generateCiscoCore() {
  const fw   = getFWip();
  const fwV6 = S.ipv6 ? getFWv6ip() : null;

  let c = `! ════════════════════════════════════════════════════════════
! NetPlan Pro v4.6 — Cisco IOS/XE — CORE-SW-01
! Tipo: Core Switch L3 (Catalyst)
! Redundancia: ${S.redundancia === 'dual' ? 'Dual-Link LACP' : 'Single-Link'}
! Generado automáticamente — verificar antes de aplicar en producción
! ════════════════════════════════════════════════════════════
!
hostname CORE-SW-01
ip domain-name ${S.domain}
ip name-server ${S.dns4}
ntp server ${S.ntp}
!
${S.ipv6 ? 'ipv6 unicast-routing\nipv6 nd drop-unsolicited-na\n!' : '! IPv6 deshabilitado\n!'}
! ─── VLANs ──────────────────────────────────────────────────\n`;

  S.vlans.forEach(v => {
    c += `vlan ${v.id}\n name ${v.name.replace(/\s/g, '_')}\n!\n`;
  });

  c += `! ─── SVIs — interfaces de capa 3 por VLAN ───────────────────\n`;
  S.vlans.forEach(v => {
    c += buildWifiComment(v, '!');
    c += `interface Vlan${v.id}\n`;
    c += ` description ${v.name} — ${v.floor_label}\n`;
    c += ` ip address ${v.gateway_v4} ${v.mask}\n`;
    if (S.ipv6) {
      c += ` ipv6 address ${v.gateway_v6}/64\n`;
      c += ` ipv6 nd other-config-flag\n`;
      c += ` ipv6 dhcp server VLAN${v.id}-v6\n`;
    }
    c += ` no shutdown\n!\n`;
  });

  c += `! ─── DHCP pools IPv4 ────────────────────────────────────────\n`;
  S.vlans.forEach(v => {
    const excl_end = intToIp(ipToInt(v.gateway_v4) + 9);
    c += `ip dhcp excluded-address ${v.gateway_v4} ${excl_end}\n`;
    c += `!\n`;
    c += `ip dhcp pool VLAN${v.id}-${v.name.replace(/\s/g, '_')}\n`;
    c += ` network ${v.network} ${v.mask}\n`;
    c += ` default-router ${v.gateway_v4}\n`;
    c += ` dns-server ${S.dns4}\n`;
    c += ` domain-name ${S.domain}\n`;
    c += ` lease 1\n!\n`;
  });

  /* IPs de reserva: pools estáticos por VLAN */
  const vlansWithReserves = S.vlans.filter(v => (v.reserved_ips || []).length > 0);
  if (vlansWithReserves.length > 0) {
    c += `! ─── Pools DHCP estáticos — IPs de reserva ─────────────────\n`;
    c += `! NOTA: Reemplazar XX:XX:XX:XX:XX:XX con la MAC real de cada dispositivo\n!\n`;
    vlansWithReserves.forEach(v => {
      (v.reserved_ips || []).forEach(r => {
        if (r.ip4) {
          const poolName = `STATIC-${r.alias.replace(/[^a-zA-Z0-9_\-]/g,'_')}-V${v.id}`;
          c += `ip dhcp pool ${poolName}\n`;
          c += ` host ${r.ip4} ${v.mask}\n`;
          c += ` hardware-address XX:XX:XX:XX:XX:XX ! ← MAC real del dispositivo "${r.alias}"\n`;
          c += ` default-router ${v.gateway_v4}\n`;
          c += ` dns-server ${S.dns4}\n`;
          c += ` domain-name ${S.domain}\n!\n`;
        }
        if (r.ip6 && S.ipv6) {
          c += `! IPv6 estática: ${r.ip6} → ${r.alias} (VLAN ${v.id})\n`;
          c += `! Asignar manualmente en el dispositivo o via DHCPv6 stateful\n!\n`;
        }
      });
    });
  }

  if (S.ipv6) {
    c += `! ─── DHCPv6 pools Stateless (SLAAC + DHCPv6) ───────────────\n`;
    S.vlans.forEach(v => {
      c += `ipv6 dhcp pool VLAN${v.id}-v6\n`;
      c += ` dns-server ${S.dns6}\n`;
      c += ` domain-name ${S.domain}\n!\n`;
    });
  }

  c += `! ─── Enrutamiento estático IPv4 ─────────────────────────────\n`;
  c += `! Ruta por defecto: todo el tráfico externo hacia el Firewall\n`;
  c += `ip route 0.0.0.0 0.0.0.0 ${fw}\n!\n`;
  c += buildWanRoutes('cisco');

  if (S.ipv6) {
    c += `! ─── Enrutamiento estático IPv6 ─────────────────────────────\n`;
    c += `ipv6 route ::/0 ${fwV6}\n!\n`;
  }

  if (S.redundancia === 'dual') {
    c += `! ─── Uplink Dual-Link LACP hacia Firewall ───────────────────\n`;
    c += `interface Port-channel1\n description Uplink-LACP-FW-01\n switchport mode trunk\n!\n`;
    c += `interface GigabitEthernet1/0/47\n channel-group 1 mode active\n no shutdown\n!\n`;
    c += `interface GigabitEthernet1/0/48\n channel-group 1 mode active\n no shutdown\n!\n`;
  } else {
    c += `! ─── Uplink Single-Link hacia Firewall ──────────────────────\n`;
    c += `interface GigabitEthernet1/0/48\n description Uplink-FW-01\n switchport mode trunk\n no shutdown\n!\n`;
  }

  /* Trunks hacia los SW-ACC */
  const accFloors = [];
  for (let f = 1; f <= S.pisos; f++) {
    if (f !== S.core_piso) accFloors.push(f);
  }
  if (accFloors.length > 0) {
    c += `! ─── Trunks hacia switches de acceso ────────────────────────\n`;
    if (S.redundancia === 'dual') {
      accFloors.forEach((f, idx) => {
        const poN = idx + 2;  // Po1 ya está reservado para uplink FW
        c += `interface Port-channel${poN}\n description Trunk-LACP-SW-ACC-P${f}\n switchport mode trunk\n switchport trunk allowed vlan ${S.vlans.map(v=>v.id).join(',')}\n!\n`;
        c += `interface GigabitEthernet1/0/${idx*2+1}\n description To-SW-ACC-P${f}-link1\n channel-group ${poN} mode active\n no shutdown\n!\n`;
        c += `interface GigabitEthernet1/0/${idx*2+2}\n description To-SW-ACC-P${f}-link2\n channel-group ${poN} mode active\n no shutdown\n!\n`;
      });
    } else {
      accFloors.forEach((f, idx) => {
        c += `interface GigabitEthernet1/0/${idx+1}\n description To-SW-ACC-P${f}\n switchport mode trunk\n switchport trunk allowed vlan ${S.vlans.map(v=>v.id).join(',')}\n no shutdown\n!\n`;
      });
    }
  }

  if (S.hardening_l2) {
    c += `! ─── Hardening L2 — protección global ──────────────────────\n`;
    c += `spanning-tree mode rapid-pvst\n`;
    c += `spanning-tree portfast bpduguard default\n`;
    c += `! Root bridge: este Core es la raíz STP para todas las VLANs\n`;
    c += `spanning-tree vlan ${S.vlans.map(v=>v.id).join(',')} root primary\n!\n`;
  }

  return c;
}

function generateCiscoAccessSwitch(floor) {
  const vlanIds = S.vlans.map(v => v.id).join(',');

  let c = `! ════════════════════════════════════════════════════════════
! NetPlan Pro v4.6 — Cisco IOS/XE — SW-ACC-P${floor}
! Tipo: Access Switch L2 (Catalyst)
! Piso: ${floor}
! Redundancia: ${S.redundancia === 'dual' ? 'Dual-Link LACP' : 'Single-Link'}
! Generado automáticamente — verificar antes de aplicar
! ════════════════════════════════════════════════════════════
!
hostname SW-ACC-P${floor}
ip domain-name ${S.domain}
ntp server ${S.ntp}
!
! ─── VLANs (solo declaración, sin SVIs) ─────────────────────\n`;

  S.vlans.forEach(v => {
    c += `vlan ${v.id}\n name ${v.name.replace(/\s/g, '_')}\n!\n`;
  });

  c += `! ─── VLAN de gestión (única SVI permitida en L2) ────────────\n`;
  c += `interface Vlan60\n description Gestion-SW-ACC-P${floor}\n`;
  const v60 = S.vlans.find(v => v.id === 60);
  if (v60) {
    /* Tomar una IP libre en la VLAN 60 — usamos .20+floor para no chocar con FW (.2) ni reservas (.2-.10) */
    const mgmtIp = intToIp(ipToInt(v60.gateway_v4) + 20 + floor);
    c += ` ip address ${mgmtIp} ${v60.mask}\n`;
  } else {
    c += ` ! Configurar IP de gestión en VLAN 60\n`;
  }
  c += ` no shutdown\n!\n`;
  c += `ip default-gateway ${getCoreIP()}\n!\n`;

  /* Uplink hacia el Core */
  if (S.redundancia === 'dual') {
    c += `! ─── Uplink Dual-Link LACP hacia Core ───────────────────────\n`;
    c += `interface Port-channel1\n description Uplink-LACP-CORE\n switchport mode trunk\n switchport trunk allowed vlan ${vlanIds}\n!\n`;
    c += `interface GigabitEthernet0/${S.puertos - 1}\n description Uplink-CORE-link1\n channel-group 1 mode active\n no shutdown\n!\n`;
    c += `interface GigabitEthernet0/${S.puertos}\n description Uplink-CORE-link2\n channel-group 1 mode active\n no shutdown\n!\n`;
  } else {
    c += `! ─── Uplink Single-Link hacia Core ──────────────────────────\n`;
    c += `interface GigabitEthernet0/${S.puertos}\n description Uplink-CORE\n switchport mode trunk\n switchport trunk allowed vlan ${vlanIds}\n no shutdown\n!\n`;
  }

  /* Puertos de acceso */
  const lastAccessPort = S.redundancia === 'dual' ? S.puertos - 2 : S.puertos - 1;
  c += `! ─── Puertos de acceso (1 — ${lastAccessPort}) ─────────────────────────\n`;
  c += `interface range GigabitEthernet0/1 - ${lastAccessPort}\n`;
  c += ` description Acceso-Piso${floor}\n`;
  c += ` switchport mode access\n`;
  c += ` switchport access vlan 10\n`;
  c += ` switchport voice vlan 40\n`;
  c += ` spanning-tree portfast\n`;
  if (S.hardening_l2) {
    c += ` spanning-tree bpduguard enable\n`;
    c += ` switchport port-security\n`;
    c += ` switchport port-security maximum 2\n`;
    c += ` switchport port-security violation restrict\n`;
    c += ` switchport port-security aging time 60\n`;
    c += ` switchport port-security aging type inactivity\n`;
  }
  c += ` no shutdown\n!\n`;

  if (S.hardening_l2) {
    c += `! ─── Hardening L2 ───────────────────────────────────────────\n`;
    c += `spanning-tree mode rapid-pvst\n`;
    c += `spanning-tree portfast bpduguard default\n!\n`;
    c += `! Recomendaciones adicionales (no automatizadas):\n`;
    c += `!   - DHCP snooping habilitado en VLANs de usuarios\n`;
    c += `!     ip dhcp snooping\n`;
    c += `!     ip dhcp snooping vlan 10,40\n`;
    c += `!   - Dynamic ARP Inspection en las mismas VLANs\n`;
    c += `!     ip arp inspection vlan 10,40\n!\n`;
  }

  return c;
}

function generateCiscoFirewallRef() {
  const v60 = S.vlans.find(v => v.id === 60);
  let c = `! ════════════════════════════════════════════════════════════
! NetPlan Pro v4.6 — Cisco ASA/Firepower — FW-01 (REFERENCIA)
! Esta configuración es de referencia comentada para ASA/Firepower.
! Si tu firewall es FortiGate, usa el bloque generado en la
! pestaña "FortiGate (FW)" en lugar de este.
! ════════════════════════════════════════════════════════════
!
! hostname FW-01
! interface GigabitEthernet0/0
!  nameif outside
!  security-level 0
!  ip address dhcp setroute
!
! interface GigabitEthernet0/1
!  nameif inside
!  security-level 100
!  ip address ${getFWip()} ${v60?.mask || '255.255.255.0'}
!
`;
  S.vlans.forEach(v => {
    c += `! access-list INSIDE_OUT extended permit ip ${v.network} ${v.mask} any\n`;
  });
  c += `! nat (inside,outside) dynamic interface\n!\n`;

  return c;
}


/* ══════════════════════════════════════════════════════════════
   13. GENERADOR HUAWEI VRP — POR DISPOSITIVO
   ══════════════════════════════════════════════════════════════ */

function generateHuaweiConfig() {
  const blocks = [];

  blocks.push({
    hostname: 'CORE-SW-01',
    role:     'Core Switch L3',
    content:  generateHuaweiCore(),
  });

  for (let floor = 1; floor <= S.pisos; floor++) {
    if (floor === S.core_piso) continue;
    blocks.push({
      hostname: `SW-ACC-P${floor}`,
      role:     'Access Switch L2',
      content:  generateHuaweiAccessSwitch(floor),
    });
  }

  blocks.push({
    hostname: 'FW-01',
    role:     'Firewall (Huawei USG — referencia)',
    content:  generateHuaweiFirewallRef(),
  });

  return blocks;
}

function generateHuaweiCore() {
  const fw   = getFWip();
  const fwV6 = S.ipv6 ? getFWv6ip() : null;
  const vlanIds = S.vlans.map(v => v.id).join(' ');

  let c = `# ════════════════════════════════════════════════════════════
# NetPlan Pro v4.6 — Huawei VRP — CORE-SW-01
# Tipo: Core Switch L3 (S-series)
# Redundancia: ${S.redundancia === 'dual' ? 'Dual-Link LACP' : 'Single-Link'}
# Generado automáticamente — verificar antes de aplicar en producción
# ════════════════════════════════════════════════════════════
#
sysname CORE-SW-01
#
dns resolve
dns server ${S.dns4}
#
ntp-service unicast-server ${S.ntp}
#
${S.ipv6 ? 'ipv6\n#' : '# IPv6 deshabilitado\n#'}
dhcp enable
#
# ─── VLANs ──────────────────────────────────────────────────
vlan batch ${vlanIds}
#`;

  S.vlans.forEach(v => {
    c += `\nvlan ${v.id}\n description ${v.name}\n#`;
  });

  c += `\n# ─── Interfaces VLAN (SVIs) ──────────────────────────────────\n`;
  S.vlans.forEach(v => {
    c += buildWifiComment(v, '#');
    c += `interface Vlanif${v.id}\n`;
    c += ` description ${v.name} — ${v.floor_label}\n`;
    c += ` ip address ${v.gateway_v4} ${v.mask}\n`;
    if (S.ipv6) {
      c += ` ipv6 enable\n`;
      c += ` ipv6 address ${v.gateway_v6}/64\n`;
      c += ` ipv6 nd other-config-flag\n`;
    }
    c += ` undo shutdown\n#\n`;
  });

  c += `# ─── DHCP pools IPv4 ────────────────────────────────────────\n`;
  S.vlans.forEach(v => {
    const excl_end = intToIp(ipToInt(v.gateway_v4) + 9);
    c += `ip pool VLAN${v.id}-${v.name.replace(/\s/g, '_')}\n`;
    c += ` gateway-list ${v.gateway_v4}\n`;
    c += ` network ${v.network} mask ${v.mask}\n`;
    c += ` dns-list ${S.dns4}\n`;
    c += ` excluded-ip-address ${v.gateway_v4} ${excl_end}\n`;
    c += ` domain-name ${S.domain}\n#\n`;
  });

  const vlansWithResH = S.vlans.filter(v => (v.reserved_ips || []).length > 0);
  if (vlansWithResH.length > 0) {
    c += `# ─── DHCP estático — IPs de reserva ────────────────────────\n`;
    c += `# NOTA: Reemplazar XXXX-XXXX-XXXX con la MAC real de cada dispositivo\n#\n`;
    vlansWithResH.forEach(v => {
      (v.reserved_ips || []).forEach(r => {
        if (r.ip4) {
          const poolName = `STATIC-${r.alias.replace(/[^a-zA-Z0-9_\-]/g,'_')}-V${v.id}`;
          c += `ip pool ${poolName}\n`;
          c += ` gateway-list ${v.gateway_v4}\n`;
          c += ` network ${v.network} mask ${v.mask}\n`;
          c += ` static-bind ip-address ${r.ip4} mac-address XXXX-XXXX-XXXX ! ← MAC "${r.alias}"\n`;
          c += ` domain-name ${S.domain}\n#\n`;
        }
        if (r.ip6 && S.ipv6) {
          c += `# IPv6 estática: ${r.ip6} → ${r.alias} (VLAN ${v.id})\n`;
          c += `# Asignar en el dispositivo o habilitar DHCPv6 stateful\n#\n`;
        }
      });
    });
  }

  if (S.ipv6) {
    c += `# ─── DHCPv6 pools Stateless ─────────────────────────────────\n`;
    S.vlans.forEach(v => {
      c += `dhcpv6 pool VLAN${v.id}-v6\n dns-server ${S.dns6}\n domain-name ${S.domain}\n#\n`;
    });
    c += `# Asociar pools DHCPv6 a SVIs\n`;
    S.vlans.forEach(v => {
      c += `interface Vlanif${v.id}\n dhcpv6 server VLAN${v.id}-v6\n#\n`;
    });
  }

  c += `# ─── Enrutamiento estático IPv4 ─────────────────────────────\n`;
  c += `ip route-static 0.0.0.0 0.0.0.0 ${fw}\n#\n`;
  c += buildWanRoutes('huawei');

  if (S.ipv6) {
    c += `# ─── Enrutamiento estático IPv6 ─────────────────────────────\n`;
    c += `ipv6 route-static :: 0 ${fwV6}\n#\n`;
  }

  if (S.redundancia === 'dual') {
    c += `# ─── Dual-Link LACP hacia Firewall ──────────────────────────\n`;
    c += `interface Eth-Trunk1\n description Uplink-LACP-FW-01\n mode lacp-static\n port link-type trunk\n port trunk allow-pass vlan ${vlanIds}\n#\n`;
    c += `interface GigabitEthernet0/0/47\n eth-trunk 1\n#\n`;
    c += `interface GigabitEthernet0/0/48\n eth-trunk 1\n#\n`;
  } else {
    c += `# ─── Uplink Single-Link hacia Firewall ──────────────────────\n`;
    c += `interface GigabitEthernet0/0/48\n description Uplink-FW-01\n port link-type trunk\n port trunk allow-pass vlan ${vlanIds}\n undo shutdown\n#\n`;
  }

  /* Trunks hacia los SW-ACC */
  const accFloors = [];
  for (let f = 1; f <= S.pisos; f++) {
    if (f !== S.core_piso) accFloors.push(f);
  }
  if (accFloors.length > 0) {
    c += `# ─── Trunks hacia switches de acceso ────────────────────────\n`;
    if (S.redundancia === 'dual') {
      accFloors.forEach((f, idx) => {
        const trN = idx + 2;
        c += `interface Eth-Trunk${trN}\n description Trunk-LACP-SW-ACC-P${f}\n mode lacp-static\n port link-type trunk\n port trunk allow-pass vlan ${vlanIds}\n#\n`;
        c += `interface GigabitEthernet0/0/${idx*2+1}\n description To-SW-ACC-P${f}-link1\n eth-trunk ${trN}\n#\n`;
        c += `interface GigabitEthernet0/0/${idx*2+2}\n description To-SW-ACC-P${f}-link2\n eth-trunk ${trN}\n#\n`;
      });
    } else {
      accFloors.forEach((f, idx) => {
        c += `interface GigabitEthernet0/0/${idx+1}\n description To-SW-ACC-P${f}\n port link-type trunk\n port trunk allow-pass vlan ${vlanIds}\n undo shutdown\n#\n`;
      });
    }
  }

  if (S.hardening_l2) {
    c += `# ─── Hardening L2 — protección global ──────────────────────\n`;
    c += `stp mode rstp\n`;
    c += `stp bpdu-protection\n`;
    c += `# Este Core es la raíz STP\n`;
    c += `stp instance 0 priority 0\n#\n`;
  }

  return c;
}

function generateHuaweiAccessSwitch(floor) {
  const vlanIds = S.vlans.map(v => v.id).join(' ');
  const vlanIdsCsv = S.vlans.map(v => v.id).join(',');

  let c = `# ════════════════════════════════════════════════════════════
# NetPlan Pro v4.6 — Huawei VRP — SW-ACC-P${floor}
# Tipo: Access Switch L2 (S-series)
# Piso: ${floor}
# Redundancia: ${S.redundancia === 'dual' ? 'Dual-Link LACP' : 'Single-Link'}
# ════════════════════════════════════════════════════════════
#
sysname SW-ACC-P${floor}
#
ntp-service unicast-server ${S.ntp}
#
# ─── VLANs (solo declaración) ───────────────────────────────
vlan batch ${vlanIds}
#`;

  S.vlans.forEach(v => {
    c += `\nvlan ${v.id}\n description ${v.name}\n#`;
  });

  c += `\n# ─── VLAN de gestión ────────────────────────────────────────\n`;
  const v60 = S.vlans.find(v => v.id === 60);
  if (v60) {
    const mgmtIp = intToIp(ipToInt(v60.gateway_v4) + 20 + floor);
    c += `interface Vlanif60\n description Gestion-SW-ACC-P${floor}\n ip address ${mgmtIp} ${v60.mask}\n undo shutdown\n#\n`;
  }
  c += `ip route-static 0.0.0.0 0.0.0.0 ${getCoreIP()}\n#\n`;

  if (S.redundancia === 'dual') {
    c += `# ─── Uplink Dual-Link LACP hacia Core ───────────────────────\n`;
    c += `interface Eth-Trunk1\n description Uplink-LACP-CORE\n mode lacp-static\n port link-type trunk\n port trunk allow-pass vlan ${vlanIds}\n#\n`;
    c += `interface GigabitEthernet0/0/${S.puertos - 1}\n description Uplink-CORE-link1\n eth-trunk 1\n#\n`;
    c += `interface GigabitEthernet0/0/${S.puertos}\n description Uplink-CORE-link2\n eth-trunk 1\n#\n`;
  } else {
    c += `# ─── Uplink Single-Link hacia Core ──────────────────────────\n`;
    c += `interface GigabitEthernet0/0/${S.puertos}\n description Uplink-CORE\n port link-type trunk\n port trunk allow-pass vlan ${vlanIds}\n undo shutdown\n#\n`;
  }

  const lastAccessPort = S.redundancia === 'dual' ? S.puertos - 2 : S.puertos - 1;
  c += `# ─── Puertos de acceso (1 — ${lastAccessPort}) ─────────────────────────\n`;
  c += `port-group access-piso${floor}\n group-member GigabitEthernet0/0/1 to GigabitEthernet0/0/${lastAccessPort}\n`;
  c += ` port link-type access\n`;
  c += ` port default vlan 10\n`;
  c += ` voice-vlan 40 enable\n`;
  c += ` stp edged-port enable\n`;
  if (S.hardening_l2) {
    c += ` stp bpdu-protection\n`;
    c += ` port-security enable\n`;
    c += ` port-security max-mac-num 2\n`;
    c += ` port-security protect-action restrict\n`;
    c += ` port-security aging-time 60\n`;
  }
  c += ` undo shutdown\n#\n`;

  if (S.hardening_l2) {
    c += `# ─── Hardening L2 ───────────────────────────────────────────\n`;
    c += `stp mode rstp\n`;
    c += `stp bpdu-protection\n#\n`;
    c += `# Recomendaciones adicionales (no automatizadas):\n`;
    c += `#   - DHCP snooping en VLANs de usuarios:\n`;
    c += `#     dhcp snooping enable\n`;
    c += `#     vlan ${vlanIdsCsv}\n`;
    c += `#       dhcp snooping enable\n`;
    c += `#   - ARP anti-spoofing en las mismas VLANs\n#\n`;
  }

  return c;
}

function generateHuaweiFirewallRef() {
  const v60 = S.vlans.find(v => v.id === 60);
  let c = `# ════════════════════════════════════════════════════════════
# NetPlan Pro v4.6 — Huawei USG — FW-01 (REFERENCIA)
# Esta configuración es de referencia comentada para USG.
# Si tu firewall es FortiGate, usa el bloque generado en la
# pestaña "FortiGate (FW)" en lugar de este.
# ════════════════════════════════════════════════════════════
#
# sysname FW-01
# #
# interface GigabitEthernet0/0/1
#  alias "WAN"
#  ip address dhcp-alloc
# #
# interface GigabitEthernet0/0/0
#  alias "LAN-Core"
#  ip address ${getFWip()} ${v60?.mask || '255.255.255.0'}
# #
`;
  S.vlans.forEach(v => {
    c += `# ip route-static ${v.network} ${v.mask} ${v.gateway_v4}\n`;
  });
  c += `# #\n`;

  return c;
}


/* ══════════════════════════════════════════════════════════════
   13b. GENERADOR FORTINET FortiOS (FortiGate — Firewall perimetral)
   Devuelve un array con UN solo bloque (es un único equipo).
   ══════════════════════════════════════════════════════════════ */

function generateFortinetConfig() {
  return [{
    hostname: 'FG-CORP-01',
    role:     'Firewall perimetral (FortiGate)',
    content:  generateFortinetFW(),
  }];
}

function generateFortinetFW() {
  const coreIP = getCoreIP();

  let c = `# ════════════════════════════════════════════════════════════
# NetPlan Pro v4.6 — Fortinet FortiOS — FG-CORP-01
# Rol: Firewall perimetral (FortiGate)
# NOTA: Esta configuración es para el FIREWALL, no para el switch.
# Núcleo L3 / L2 generado por separado (Cisco o Huawei).
# ════════════════════════════════════════════════════════════
#
config system global
    set hostname "FG-CORP-01"
    set timezone 12
end
#
config system dns
    set primary ${S.dns4}
end
#
config system ntp
    set ntpsync enable
    config ntpserver
        edit 1
            set server "${S.ntp}"
        next
    end
end
#
# ─── Interfaces VLAN sobre el puerto interno ────────────────
`;
  S.vlans.forEach(v => {
    const fwIp = intToIp(ipToInt(v.gateway_v4) + 1);
    c += `config system interface
    edit "lan-vlan${v.id}"
        set vdom "root"
        set ip ${fwIp} ${v.mask}
        set allowaccess ping https ssh
        set vlanid ${v.id}
        set interface "internal"
        set description "${v.name} — VLAN ${v.id}"
`;
    if (S.ipv6 && v.gateway_v6) {
      const fwV6 = v.gateway_v6.replace('::1', '::2');
      c += `        set ip6-address ${fwV6}/64
        set ip6-allowaccess ping https ssh
`;
    }
    c += `    next
end
#
`;
  });

  c += `# ─── Política de salida LAN → WAN (NAT) ─────────────────────\n`;
  S.vlans.forEach((v, idx) => {
    c += `config firewall policy
    edit ${idx + 1}
        set name "${v.name}-to-WAN"
        set srcintf "lan-vlan${v.id}"
        set dstintf "wan1"
        set srcaddr "all"
        set dstaddr "all"
        set action accept
        set schedule "always"
        set service "ALL"
        set nat enable
        set logtraffic all
    next
end
#
`;
  });

  c += `# ─── Rutas estáticas hacia el Core Switch ───────────────────\n`;
  S.vlans.forEach((v, idx) => {
    c += `config router static
    edit ${idx + 1}
        set dst ${v.network} ${v.mask}
        set gateway ${coreIP}
        set device "lan-vlan${v.id}"
    next
end
#
`;
  });

  if (S.wan_routes.length > 0 && S.wan_nexthop) {
    c += `# ─── Rutas estáticas WAN ────────────────────────────────────\n`;
    S.wan_routes.forEach((route, idx) => {
      const p = parseCIDR(route);
      if (!p) return;
      c += `config router static
    edit ${100 + idx}
        set dst ${p.address} ${prefixToMask(p.prefix)}
        set gateway ${S.wan_nexthop}
        set device "wan1"
    next
end
#
`;
    });
  }

  c += `# ─── Servidor DHCP por VLAN ─────────────────────────────────\n`;
  c += `# El FW actúa como relay para cada VLAN.\n#\n`;

  S.vlans.forEach(v => {
    const fwIp = intToIp(ipToInt(v.gateway_v4) + 1);
    c += `config system dhcp server\n`;
    c += `    edit 0\n`;
    c += `        set dns-server1 ${S.dns4}\n`;
    c += `        set default-gateway ${fwIp}\n`;
    c += `        set netmask ${v.mask}\n`;
    c += `        set interface "lan-vlan${v.id}"\n`;
    c += `        set dns-service default\n`;
    c += `        set domain ${S.domain}\n`;
    c += `        config ip-range\n            edit 1\n`;
    const poolStart = intToIp(ipToInt(v.gateway_v4) + 10);
    const poolEnd   = intToIp(ipToInt(v.broadcast) - 1);
    c += `                set start-ip ${poolStart}\n                set end-ip ${poolEnd}\n`;
    c += `            next\n        end\n`;

    const rips = (v.reserved_ips || []).filter(r => r.ip4);
    if (rips.length > 0) {
      c += `        config reserved-address\n`;
      rips.forEach((r, idx) => {
        c += `            edit ${idx + 1}\n                set ip ${r.ip4}\n                set mac XX:XX:XX:XX:XX:XX\n                set description "${r.alias}"\n                set action reserved\n            next\n`;
      });
      c += `        end\n`;
    }
    c += `    next\nend\n#\n`;
  });

  const vlansWithResF = S.vlans.filter(v => (v.reserved_ips || []).some(r => r.ip6));
  if (vlansWithResF.length > 0 && S.ipv6) {
    c += `# ─── Reservas IPv6 (asignación manual recomendada) ──────────\n`;
    vlansWithResF.forEach(v => {
      (v.reserved_ips || []).filter(r => r.ip6).forEach(r => {
        c += `# ${r.ip6} → ${r.alias} (VLAN ${v.id} — ${v.name})\n`;
      });
    });
    c += `#\n`;
  }

  return c;
}


/* ══════════════════════════════════════════════════════════════
   14. PASO 6 — EXPORTAR (BLOQUES, COPY, TXT, ZIP)
   ══════════════════════════════════════════════════════════════ */

function selectExportTab(btn) {
  document.querySelectorAll('.export-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  S.export_vendor = btn.dataset.vendor;

  const subtabs = document.getElementById('rollback-subtabs');
  if (S.export_vendor === 'rollback') {
    if (!S.rollback_vendor) S.rollback_vendor = 'cisco';
    document.querySelectorAll('.rb-subtab').forEach(t =>
      t.classList.toggle('active', t.dataset.vendor === S.rollback_vendor)
    );
    subtabs?.classList.remove('hidden');
  } else {
    subtabs?.classList.add('hidden');
  }

  renderExportCode();
}

function selectRollbackVendor(btn) {
  document.querySelectorAll('.rb-subtab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  S.rollback_vendor = btn.dataset.vendor;
  renderExportCode();
}

/**
 * Render principal del Paso 6: pinta bloques por dispositivo
 * según el vendor activo, cada uno con Copiar y Descargar .txt.
 */
function renderExportCode() {
  const container = document.getElementById('export-blocks');
  if (!container) return;

  if (!S.vlans.length) {
    container.innerHTML = '<p class="placeholder-msg">Completa el plan antes de generar configuraciones</p>';
    document.getElementById('export-zip-bar')?.classList.add('hidden');
    return;
  }

  let blocks = [];

  if (S.export_vendor === 'cisco')    blocks = generateCiscoConfig();
  if (S.export_vendor === 'huawei')   blocks = generateHuaweiConfig();
  if (S.export_vendor === 'fortinet') blocks = generateFortinetConfig();
  if (S.export_vendor === 'rollback') blocks = generateRollback();

  container.innerHTML = blocks.map((b, idx) => `
    <div class="device-block">
      <div class="device-block-header">
        <div class="device-block-title">
          <span class="device-block-hostname">${escHtml(b.hostname)}</span>
          <span class="device-block-role">${escHtml(b.role)}</span>
        </div>
        <div class="device-block-actions">
          <button class="device-block-btn" onclick="copyBlock(${idx})" title="Copiar al portapapeles">⧉ Copiar</button>
          <button class="device-block-btn" onclick="downloadBlockTxt(${idx})" title="Descargar como archivo .txt">↓ .txt</button>
        </div>
      </div>
      <pre class="device-block-code" id="device-block-code-${idx}"><code>${escHtml(b.content)}</code></pre>
    </div>
  `).join('');

  /* Guardar bloques en una propiedad temporal del contenedor para los handlers */
  container._blocks = blocks;

  /* Mostrar barra de "Descargar todo" si hay más de 1 bloque */
  const zipBar = document.getElementById('export-zip-bar');
  if (zipBar) {
    if (blocks.length > 1 && S.export_vendor !== 'rollback') {
      zipBar.classList.remove('hidden');
    } else {
      zipBar.classList.add('hidden');
    }
  }
}

/** Copia el contenido de un bloque al portapapeles. */
function copyBlock(idx) {
  const container = document.getElementById('export-blocks');
  if (!container?._blocks?.[idx]) return;
  const text = container._blocks[idx].content;
  navigator.clipboard.writeText(text)
    .then(() => showToast(`Configuración de ${container._blocks[idx].hostname} copiada`, 'success'))
    .catch(() => showToast('No se pudo copiar', 'error'));
}

/** Descarga un bloque como archivo .txt. */
function downloadBlockTxt(idx) {
  const container = document.getElementById('export-blocks');
  const block = container?._blocks?.[idx];
  if (!block) return;

  const date = new Date().toISOString().slice(0, 10);
  const vendor = S.export_vendor;
  const safeHost = block.hostname.replace(/[^a-zA-Z0-9_\-]/g, '_');
  const filename = `${safeHost}_${vendor}_${date}.txt`;

  const blob = new Blob([block.content], { type: 'text/plain;charset=utf-8' });
  _download(blob, filename);
  showToast(`Descargado: ${filename}`, 'success');
}

/** Carga JSZip desde CDN una sola vez. */
function _loadJSZip() {
  return _loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');
}

/** Descarga todos los bloques del vendor activo en un .zip. */
async function downloadAllConfigsZip() {
  if (!S.vlans.length) {
    showToast('Completa el plan antes de exportar', 'error');
    return;
  }

  showToast('Preparando archivo zip…', 'success');

  try {
    await _loadJSZip();
  } catch (e) {
    showToast('No se pudo cargar JSZip. Verifica tu conexión.', 'error');
    return;
  }

  let blocks = [];
  const vendor = S.export_vendor;
  if (vendor === 'cisco')    blocks = generateCiscoConfig();
  if (vendor === 'huawei')   blocks = generateHuaweiConfig();
  if (vendor === 'fortinet') blocks = generateFortinetConfig();
  if (!blocks.length) return;

  const date = new Date().toISOString().slice(0, 10);
  const zip = new window.JSZip();

  blocks.forEach(b => {
    const safeHost = b.hostname.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const filename = `${safeHost}_${vendor}_${date}.txt`;
    zip.file(filename, b.content);
  });

  /* README dentro del zip */
  const readme = `NetPlan Pro v4.6 — Paquete de configuración
==============================================
Dominio:        ${S.domain}
Vendor:         ${vendor}
Generado:       ${new Date().toLocaleString('es-CO')}
Dispositivos:   ${blocks.length}

Contenido:
${blocks.map(b => `  - ${b.hostname.padEnd(16)} ${b.role}`).join('\n')}

ADVERTENCIA: Estas configuraciones son una base de despliegue.
Antes de aplicar en producción revisa hardening adicional:
  - SSH-only, AAA, banners, exec-timeout
  - Spanning-Tree root bridge explícito
  - ACLs inter-VLAN (matriz de comunicación)
  - 802.1X / NAC si aplica
`;
  zip.file('README.txt', readme);

  const blob = await zip.generateAsync({ type: 'blob' });
  const safeDom = (S.domain || 'plan').toLowerCase().replace(/[^a-z0-9]/g, '_');
  const filename = `${safeDom}_${vendor}_configs.zip`;
  _download(blob, filename);

  showToast(`Descargado: ${filename}`, 'success');
}


/* ══════════════════════════════════════════════════════════════
   14b. ROLLBACK / BORRADO SEGURO
   ══════════════════════════════════════════════════════════════ */

function generateRollback() {
  /* Rollback se mantiene como bloque único por vendor */
  let content = '';
  let hostname = '';
  let role = '';

  switch (S.rollback_vendor) {
    case 'cisco':
      content = generateRollbackCisco();
      hostname = 'CORE-SW-01';
      role = 'Rollback Cisco IOS/XE';
      break;
    case 'huawei':
      content = generateRollbackHuawei();
      hostname = 'CORE-SW-01';
      role = 'Rollback Huawei VRP';
      break;
    case 'fortinet':
      content = generateRollbackFortinet();
      hostname = 'FG-CORP-01';
      role = 'Rollback FortiGate';
      break;
    default:
      content = generateRollbackCisco();
      hostname = 'CORE-SW-01';
      role = 'Rollback Cisco IOS/XE';
  }
  return [{ hostname, role, content }];
}

function generateRollbackCisco() {
  const fw = getFWip();
  let c = `! ════════════════════════════════════════════════════════════
! NetPlan Pro v4.6 — BORRADO SEGURO — Cisco IOS/XE — CORE-SW-01
! ADVERTENCIA: Aplica SOLO si deseas deshacer el plan completo.
! Esta config NO borra la imagen IOS ni el sistema operativo.
! Ejecutar en modo configuración: conf t
! ════════════════════════════════════════════════════════════
!\n`;

  c += `! ─── Eliminar rutas estáticas ───────────────────────────────\n`;
  c += `no ip route 0.0.0.0 0.0.0.0 ${fw}\n`;
  if (S.ipv6) c += `no ipv6 route ::/0\n`;
  S.wan_routes.forEach(r => {
    const p = parseCIDR(r);
    if (p) c += `no ip route ${p.address} ${prefixToMask(p.prefix)} ${S.wan_nexthop||'(next-hop)'}\n`;
  });
  c += `!\n`;

  c += `! ─── Eliminar pools DHCP IPv4 ───────────────────────────────\n`;
  S.vlans.forEach(v => {
    const nm = v.name.replace(/\s/g, '_');
    c += `no ip dhcp pool VLAN${v.id}-${nm}\n`;
    c += `no ip dhcp excluded-address ${v.gateway_v4} ${intToIp(ipToInt(v.gateway_v4)+9)}\n`;
    (v.reserved_ips||[]).filter(r=>r.ip4).forEach(r =>
      c += `no ip dhcp pool STATIC-${r.alias.replace(/[^a-zA-Z0-9_\-]/g,'_')}-V${v.id}\n`
    );
  });
  c += `!\n`;

  if (S.ipv6) {
    c += `! ─── Eliminar pools DHCPv6 ──────────────────────────────────\n`;
    S.vlans.forEach(v => c += `no ipv6 dhcp pool VLAN${v.id}-v6\n`);
    c += `!\n`;
  }

  c += `! ─── Eliminar SVIs ──────────────────────────────────────────\n`;
  [...S.vlans].reverse().forEach(v => {
    c += `interface Vlan${v.id}\n no ip address\n`;
    if (S.ipv6) c += ` no ipv6 address\n no ipv6 nd other-config-flag\n`;
    c += ` shutdown\n!\n`;
    c += `no interface Vlan${v.id}\n!\n`;
  });

  c += `! ─── Eliminar VLANs ─────────────────────────────────────────\n`;
  S.vlans.forEach(v => c += `no vlan ${v.id}\n`);
  c += `!\n`;

  if (S.redundancia === 'dual') {
    c += `! ─── Deshacer Dual-Link LACP ────────────────────────────────\n`;
    c += `no interface Port-channel1\n`;
    c += `interface GigabitEthernet1/0/47\n no channel-group\n!\n`;
    c += `interface GigabitEthernet1/0/48\n no channel-group\n!\n`;
  }

  c += `! ─── Limpiar configuración guardada ────────────────────────\n`;
  c += `! (Opcional) Para dejar el equipo sin configuración guardada:\n`;
  c += `! write erase\n! reload\n`;
  return c;
}

function generateRollbackHuawei() {
  const fw = getFWip();
  let c = `# ════════════════════════════════════════════════════════════
# NetPlan Pro v4.6 — BORRADO SEGURO — Huawei VRP — CORE-SW-01
# ADVERTENCIA: Aplica SOLO si deseas deshacer el plan completo.
# Esta config NO borra la imagen VRP ni el sistema operativo.
# ════════════════════════════════════════════════════════════
#\n`;

  c += `# ─── Eliminar rutas estáticas ───────────────────────────────\n`;
  c += `undo ip route-static 0.0.0.0 0.0.0.0 ${fw}\n`;
  if (S.ipv6) c += `undo ipv6 route-static :: 0\n`;
  S.wan_routes.forEach(r => {
    const p = parseCIDR(r);
    if (p) c += `undo ip route-static ${p.address} ${prefixToMask(p.prefix)} ${S.wan_nexthop||'(next-hop)'}\n`;
  });
  c += `#\n`;

  c += `# ─── Eliminar pools DHCP IPv4 ───────────────────────────────\n`;
  S.vlans.forEach(v => {
    const nm = v.name.replace(/\s/g, '_');
    c += `undo ip pool VLAN${v.id}-${nm}\n`;
    (v.reserved_ips||[]).filter(r=>r.ip4).forEach(r =>
      c += `undo ip pool STATIC-${r.alias.replace(/[^a-zA-Z0-9_\-]/g,'_')}-V${v.id}\n`
    );
  });
  c += `#\n`;

  if (S.ipv6) {
    c += `# ─── Eliminar pools DHCPv6 ──────────────────────────────────\n`;
    S.vlans.forEach(v => c += `undo dhcpv6 pool VLAN${v.id}-v6\n`);
    c += `#\n`;
  }

  c += `# ─── Eliminar SVIs ───────────────────────────────────────────\n`;
  [...S.vlans].reverse().forEach(v => {
    c += `interface Vlanif${v.id}\n undo ip address\n`;
    if (S.ipv6) c += ` undo ipv6 enable\n undo ipv6 address\n`;
    c += ` shutdown\n#\n`;
    c += `undo interface Vlanif${v.id}\n#\n`;
  });

  c += `# ─── Eliminar VLANs ─────────────────────────────────────────\n`;
  c += `undo vlan batch ${S.vlans.map(v=>v.id).join(' ')}\n#\n`;

  if (S.redundancia === 'dual') {
    c += `# ─── Deshacer Dual-Link LACP ────────────────────────────────\n`;
    c += `undo interface Eth-Trunk1\n`;
    c += `interface GigabitEthernet0/0/47\n undo eth-trunk\n#\n`;
    c += `interface GigabitEthernet0/0/48\n undo eth-trunk\n#\n`;
  }

  c += `# ─── Limpiar configuración guardada ────────────────────────\n`;
  c += `# (Opcional) Para dejar el equipo sin configuración guardada:\n`;
  c += `# reset saved-configuration\n# reboot\n`;
  return c;
}

function generateRollbackFortinet() {
  let c = `# ════════════════════════════════════════════════════════════
# NetPlan Pro v4.6 — BORRADO SEGURO — FortiGate — FG-CORP-01
# ADVERTENCIA: Aplica SOLO si deseas deshacer el plan completo.
# Esta config NO borra FortiOS ni licencias del equipo.
# ════════════════════════════════════════════════════════════
#\n`;

  c += `# ─── Eliminar políticas de firewall ─────────────────────────\n`;
  S.vlans.forEach((v, i) => {
    c += `config firewall policy\n    delete ${i+1}\nend\n#\n`;
  });

  c += `# ─── Eliminar rutas estáticas ───────────────────────────────\n`;
  S.vlans.forEach((v, i) => {
    c += `config router static\n    delete ${i+1}\nend\n#\n`;
  });

  c += `# ─── Eliminar servidores DHCP ───────────────────────────────\n`;
  c += `config system dhcp server\n`;
  S.vlans.forEach((v, i) => c += `    delete ${i+1}\n`);
  c += `end\n#\n`;

  c += `# ─── Eliminar interfaces VLAN ───────────────────────────────\n`;
  [...S.vlans].reverse().forEach(v => {
    c += `config system interface\n    delete "lan-vlan${v.id}"\nend\n#\n`;
  });

  c += `# ─── Limpiar configuración a valores de fábrica ────────────\n`;
  c += `# (Opcional) Para reset completo SIN borrar FortiOS:\n`;
  c += `# execute factoryreset\n`;
  return c;
}


/* ══════════════════════════════════════════════════════════════
   14c. CONEXIONES FÍSICAS + DRAWIO
   v4.6.1 — Eliminado generateTopologySVG (preview inline).
            La topología visual se obtiene exportando .drawio.
            La tabla de conexiones físicas reemplaza la preview SVG.
   ══════════════════════════════════════════════════════════════ */

/**
 * Construye la lista de conexiones físicas del plan.
 * Devuelve array de filas: { devA, ifA, devB, ifB, type, vlans }
 *
 * Refleja exactamente lo que se cablea según las configs generadas:
 *   - FW ↔ Core (uplink: single o LACP)
 *   - Core ↔ cada SW-ACC (trunk: single o LACP)
 *
 * NO incluye:
 *   - Internet/WAN (fuera del control de la herramienta)
 *   - APs WiFi (estimados, no configurados explícitamente)
 *   - Hosts finales (no se cablean a nivel de plan)
 */
function buildConnectionsTable() {
  if (!S.vlans.length) return [];

  const rows    = [];
  const dual    = S.redundancia === 'dual';
  const vlanIds = S.vlans.map(v => v.id).join(',');
  const isCisco = S.vendor === 'cisco';

  /* Sintaxis de interfaz según vendor */
  const iface = (slot, port) => isCisco
    ? `GigabitEthernet${slot}/${port}`
    : `GigabitEthernet0/0/${port}`;
  const ifaceCore = (port) => isCisco
    ? `GigabitEthernet1/0/${port}`
    : `GigabitEthernet0/0/${port}`;
  const ifaceShort = (slot, port) => isCisco
    ? `Gi${slot}/${port}`
    : `GE0/0/${port}`;
  const ifaceCoreShort = (port) => isCisco
    ? `Gi1/0/${port}`
    : `GE0/0/${port}`;

  /* 1) FW ↔ Core */
  if (dual) {
    rows.push({
      devA: 'FW-01',           ifA: 'GE0/1 + GE0/2 (Po1)',
      devB: 'CORE-SW-01',      ifB: `${ifaceCoreShort(47)} + ${ifaceCoreShort(48)} (Po1)`,
      type: 'LACP (Dual-Link)',
      vlans: vlanIds,
    });
  } else {
    rows.push({
      devA: 'FW-01',           ifA: 'GE0/1',
      devB: 'CORE-SW-01',      ifB: ifaceCoreShort(48),
      type: 'Trunk single',
      vlans: vlanIds,
    });
  }

  /* 2) Core ↔ cada SW-ACC (uno por piso ≠ Core) */
  const accFloors = [];
  for (let f = 1; f <= S.pisos; f++) {
    if (f !== S.core_piso) accFloors.push(f);
  }

  accFloors.forEach((floor, idx) => {
    const accUplinkLast = S.puertos;
    const accUplinkPrev = S.puertos - 1;

    if (dual) {
      const corePort1 = idx * 2 + 1;
      const corePort2 = idx * 2 + 2;
      const poN       = idx + 2;
      rows.push({
        devA: 'CORE-SW-01',
        ifA:  `${ifaceCoreShort(corePort1)} + ${ifaceCoreShort(corePort2)} (Po${poN})`,
        devB: `SW-ACC-P${floor}`,
        ifB:  `${ifaceShort(0, accUplinkPrev)} + ${ifaceShort(0, accUplinkLast)} (Po1)`,
        type: 'LACP (Dual-Link)',
        vlans: vlanIds,
      });
    } else {
      const corePort = idx + 1;
      rows.push({
        devA: 'CORE-SW-01',
        ifA:  ifaceCoreShort(corePort),
        devB: `SW-ACC-P${floor}`,
        ifB:  ifaceShort(0, accUplinkLast),
        type: 'Trunk single',
        vlans: vlanIds,
      });
    }
  });

  return rows;
}


/**
 * Pinta la tabla de conexiones físicas en el contenedor #connections-table.
 * Llamada desde renderSummary().
 */
function renderConnectionsTable() {
  const wrap = document.getElementById('connections-table');
  if (!wrap) return;

  const rows = buildConnectionsTable();
  if (!rows.length) {
    wrap.innerHTML = '<p class="placeholder-msg">La tabla se genera al calcular el plan</p>';
    return;
  }

  const isCisco = S.vendor === 'cisco';
  const ifaceCol = isCisco ? 'Interfaz Cisco' : 'Interfaz Huawei';

  wrap.innerHTML = `
    <div class="table-wrap">
      <table class="connections-table">
        <thead>
          <tr>
            <th>Dispositivo A</th>
            <th>${ifaceCol} A</th>
            <th>Dispositivo B</th>
            <th>${ifaceCol} B</th>
            <th>Tipo de enlace</th>
            <th>VLANs trunk</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td class="td-dev">${escHtml(r.devA)}</td>
              <td class="mono">${escHtml(r.ifA)}</td>
              <td class="td-dev">${escHtml(r.devB)}</td>
              <td class="mono">${escHtml(r.ifB)}</td>
              <td>${escHtml(r.type)}</td>
              <td class="mono small">${escHtml(r.vlans)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <p class="connections-note no-print">
      📐 <strong>Topología visual editable:</strong>
      exporta el archivo <code>.drawio</code> en el Paso 6 y ábrelo en
      <a href="https://app.diagrams.net" target="_blank" rel="noopener">app.diagrams.net</a>
      para editar o exportar como PNG/SVG/PDF.
    </p>`;
}



function generateDrawioXML() {
  if (!S.vlans.length) return '';

  const dual = S.redundancia === 'dual';
  const esc  = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  const STYLES = {
    inet:  'rounded=1;whiteSpace=wrap;html=1;fillColor=#fff7ed;strokeColor=#f59e0b;fontColor=#92400e;fontSize=11;',
    fw:    'rounded=1;whiteSpace=wrap;html=1;fillColor=#fef2f2;strokeColor=#dc2626;fontColor=#7f1d1d;fontSize=11;',
    core:  'rounded=1;whiteSpace=wrap;html=1;fillColor=#e8f0fb;strokeColor=#1a6fc4;strokeWidth=2;fontColor=#0f4d8f;fontSize=12;fontStyle=1;',
    swCore:'rounded=1;whiteSpace=wrap;html=1;fillColor=#e8f0fb;strokeColor=#1a6fc4;fontColor=#1a6fc4;fontSize=11;fontStyle=1;',
    swAcc: 'rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#94a3b8;fontColor=#1a2332;fontSize=10;',
    vlan:  c => `rounded=1;whiteSpace=wrap;html=1;fillColor=${c}1a;strokeColor=${c};fontColor=${c};fontSize=9;`,
    edge:  'endArrow=classic;html=1;rounded=0;strokeColor=#94a3b8;strokeWidth=1.5;',
    edgeDual: 'endArrow=classic;html=1;rounded=0;strokeColor=#1a6fc4;strokeWidth=2;dashed=0;',
  };

  const TYPE_CLR = {
    users:'#1a6fc4', admin:'#1a7a4a', servers:'#7c3aed',
    voip:'#0891b2', wifi:'#7c3aed', mgmt:'#875a00', custom:'#718096',
  };

  let cells = '';
  let id = 100;
  const cx = 600;
  const inetY = 40;
  const fwY = 130;
  const coreY = 230;
  const swY = 380;
  const vlanY = 480;
  const colW = 200;

  cells += `<mxCell id="inet" value="${esc('☁ INTERNET / WAN' + (S.wan_nexthop ? '\n' + S.wan_nexthop : ''))}" style="${STYLES.inet}" vertex="1" parent="1"><mxGeometry x="${cx-65}" y="${inetY}" width="130" height="50" as="geometry"/></mxCell>\n`;
  cells += `<mxCell id="fw"   value="${esc('🛡 FW-01\n' + getFWip())}"           style="${STYLES.fw}"   vertex="1" parent="1"><mxGeometry x="${cx-85}" y="${fwY}"   width="170" height="50" as="geometry"/></mxCell>\n`;
  cells += `<mxCell id="core" value="${esc('⚡ CORE SWITCH L3\n' + getCoreIP() + '\n' + S.vlans.length + ' SVIs')}" style="${STYLES.core}" vertex="1" parent="1"><mxGeometry x="${cx-110}" y="${coreY}" width="220" height="60" as="geometry"/></mxCell>\n`;

  cells += `<mxCell id="e1" style="${STYLES.edge}" edge="1" parent="1" source="inet" target="fw"><mxGeometry relative="1" as="geometry"/></mxCell>\n`;
  cells += `<mxCell id="e2" style="${STYLES.edge}" edge="1" parent="1" source="fw"   target="core"><mxGeometry relative="1" as="geometry"/></mxCell>\n`;

  const pisos     = S.pisos;
  const totalW    = pisos * colW;
  const startX    = cx - totalW/2 + colW/2;

  const floorVlans = (fl) => S.vlans.filter(v =>
    v.floor === 'all' || (v.floor === 'core' && fl === S.core_piso)
  );

  for (let fl = 1; fl <= pisos; fl++) {
    const sx     = startX + (fl - 1) * colW;
    const isCore = fl === S.core_piso;
    const swId   = `sw${fl}`;
    const lbl    = isCore
      ? `🟦 SW-CORE (P${fl})\nCore L3 + Access`
      : `SW-ACC P${fl}\nL2 Access`;
    const style = isCore ? STYLES.swCore : STYLES.swAcc;

    cells += `<mxCell id="${swId}" value="${esc(lbl)}" style="${style}" vertex="1" parent="1"><mxGeometry x="${sx-70}" y="${swY}" width="140" height="50" as="geometry"/></mxCell>\n`;

    if (!isCore) {
      const edgeStyle = dual ? STYLES.edgeDual : STYLES.edge;
      const lblEdge   = dual ? 'LACP/Po1' : '';
      cells += `<mxCell id="ec${fl}" value="${esc(lblEdge)}" style="${edgeStyle}" edge="1" parent="1" source="core" target="${swId}"><mxGeometry relative="1" as="geometry"/></mxCell>\n`;
    }

    const vstk = floorVlans(fl);
    vstk.forEach((v, vi) => {
      const vx = sx - 70 + (vi % 3) * 50;
      const vy = vlanY + Math.floor(vi / 3) * 32;
      const vId = `v${v.id}_p${fl}`;
      const clr = TYPE_CLR[v.type] || '#718096';
      cells += `<mxCell id="${vId}" value="${esc('VLAN ' + v.id + '\n' + v.name)}" style="${STYLES.vlan(clr)}" vertex="1" parent="1"><mxGeometry x="${vx}" y="${vy}" width="46" height="28" as="geometry"/></mxCell>\n`;
      cells += `<mxCell id="ev${id++}" style="${STYLES.edge};dashed=1;" edge="1" parent="1" source="${swId}" target="${vId}"><mxGeometry relative="1" as="geometry"/></mxCell>\n`;
    });
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net" modified="${new Date().toISOString()}" agent="NetPlan Pro v4.6" version="22.0.0">
  <diagram name="Topología — ${esc(S.domain)}" id="netplan">
    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1200" pageHeight="900" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
${cells}      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;
}


/* ══════════════════════════════════════════════════════════════
   14d. EXPORTACIONES (Excel, JSON, Drawio)
   ══════════════════════════════════════════════════════════════ */

const _scriptCache = {};

function _loadScript(url) {
  if (_scriptCache[url]) return _scriptCache[url];
  _scriptCache[url] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload  = () => resolve();
    s.onerror = () => {
      delete _scriptCache[url];
      reject(new Error('No se pudo cargar ' + url));
    };
    document.head.appendChild(s);
  });
  return _scriptCache[url];
}

function _download(blob, filename) {
  const a = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function _fileName(ext) {
  const date = new Date().toISOString().slice(0, 10);
  const dom  = (S.domain || 'plan').replace(/[^a-z0-9._-]/gi, '_');
  return `netplan_${dom}_${date}.${ext}`;
}

/* ── EXPORTACIÓN EXCEL v4.6 — 7 hojas con estilos ─────────────── */

async function exportPlanExcel() {
  if (!S.vlans.length) {
    showToast('Completa el plan antes de exportar', 'error');
    return;
  }
  showToast('Cargando librería Excel…', 'success');

  try {
    await _loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
  } catch (e) {
    showToast('No se pudo cargar la librería. Verifica tu conexión.', 'error');
    return;
  }
  const XLSX = window.XLSX;
  const wb = XLSX.utils.book_new();

  /* Helper: aplicar estilo de cabecera (color de fondo + bold + freeze) */
  function styleHeader(ws, headerRow = 0, colCount, color = 'FF1A6FC4') {
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let c = 0; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r: headerRow, c });
      if (!ws[addr]) continue;
      ws[addr].s = {
        fill:   { fgColor: { rgb: color } },
        font:   { bold: true, color: { rgb: 'FFFFFFFF' }, sz: 11 },
        alignment: { horizontal: 'left', vertical: 'center' },
        border: {
          top:    { style: 'thin', color: { rgb: 'FF94A3B8' } },
          bottom: { style: 'thin', color: { rgb: 'FF94A3B8' } },
        },
      };
    }
  }

  const totalReq   = S.vlans.reduce((s,v) => s + v.hosts_required, 0);
  const totalUsf   = S.vlans.reduce((s,v) => s + v.hosts_useful,   0);
  const efficiency = Math.round((totalReq / totalUsf) * 100);
  const swPiso     = Math.ceil(S.hosts_piso / S.puertos);

  /* ── Hoja 1: Resumen ejecutivo ── */
  const summary = [
    ['NetPlan Pro v4.6 — Resumen ejecutivo'],
    [''],
    ['Información general'],
    ['Dominio interno',     S.domain],
    ['Generado',            new Date().toLocaleString('es-CO')],
    ['Esquema',             'netplan.v1'],
    [''],
    ['Infraestructura'],
    ['Pisos',               S.pisos],
    ['Piso del Core / CPD', S.core_piso],
    ['Hosts por piso',      S.hosts_piso],
    ['Puertos por switch',  S.puertos],
    ['Switches por piso',   swPiso],
    ['Switches totales',    swPiso * (S.pisos - 1) + 1],  // SW-ACC × (pisos-1) + Core
    ['Redundancia',         S.redundancia === 'dual' ? 'Dual-Link (LACP)' : 'Single-Link'],
    ['Vendor',              S.vendor === 'cisco' ? 'Cisco IOS/XE' : 'Huawei VRP'],
    ['Factor crecimiento',  S.growth_factor + '×'],
    ['Hardening L2',        S.hardening_l2 ? 'Habilitado (port-security + BPDU guard)' : 'Deshabilitado'],
    [''],
    ['Direccionamiento'],
    ['Red base IPv4',       (S.net && S.net.address+'/'+S.net.prefix) || '—'],
    ['Total VLANs',         S.vlans.length],
    ['Hosts requeridos',    totalReq],
    ['Hosts útiles asignados', totalUsf],
    ['Eficiencia global',   efficiency + '%'],
    [''],
    ['IPv6 Dual-Stack'],
    ['Habilitado',          S.ipv6 ? 'Sí' : 'No'],
    ['Prefijo ULA',         S.ula_prefix || '—'],
    [''],
    ['Servicios'],
    ['DNS IPv4',            S.dns4],
    ['DNS IPv6',            S.dns6],
    ['NTP',                 S.ntp],
    [''],
    ['WAN'],
    ['Next-hop',            S.wan_nexthop || '—'],
    ['Rutas estáticas',     (S.wan_routes || []).join(', ') || '—'],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summary);
  wsSummary['!cols'] = [{ wch: 32 }, { wch: 50 }];
  /* Título grande */
  if (wsSummary['A1']) {
    wsSummary['A1'].s = {
      font: { bold: true, sz: 16, color: { rgb: 'FF1A6FC4' } },
      alignment: { horizontal: 'left' },
    };
  }
  /* Subcabeceras */
  ['A3','A8','A21','A28','A32','A37'].forEach(addr => {
    if (wsSummary[addr]) {
      wsSummary[addr].s = {
        font: { bold: true, sz: 12, color: { rgb: 'FF0F4D8F' } },
        fill: { fgColor: { rgb: 'FFE8F0FB' } },
      };
    }
  });
  wsSummary['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumen');

  /* ── Hoja 2: Inventario de dispositivos ── */
  const inventory = [
    ['Hostname', 'Rol', 'Piso', 'Vendor', 'Modelo sugerido', 'Puertos', 'Notas'],
  ];
  const vendorName = S.vendor === 'cisco' ? 'Cisco' : 'Huawei';
  const coreModel  = S.vendor === 'cisco' ? 'Catalyst 9300 (L3)' : 'S5735-S-L (L3)';
  const accModel   = S.vendor === 'cisco' ? 'Catalyst 2960X (L2)' : 'S2700 (L2)';
  inventory.push([
    'CORE-SW-01',
    'Core Switch L3',
    `Piso ${S.core_piso} (CPD)`,
    vendorName,
    coreModel,
    `${S.puertos} + uplinks`,
    `Hace SVI, DHCP, rutas. ${S.redundancia === 'dual' ? 'Uplinks LACP a FW.' : 'Uplink simple a FW.'}`,
  ]);
  for (let fl = 1; fl <= S.pisos; fl++) {
    if (fl === S.core_piso) continue;
    inventory.push([
      `SW-ACC-P${fl}`,
      'Access Switch L2',
      `Piso ${fl}`,
      vendorName,
      accModel,
      `${S.puertos}`,
      S.hardening_l2 ? 'Port-security + BPDU guard activos' : 'Sin hardening L2',
    ]);
  }
  inventory.push([
    'FW-01',
    'Firewall perimetral',
    `Piso ${S.core_piso} (CPD)`,
    'FortiGate (o vendor del Core)',
    'FortiGate 100F (referencia)',
    '4-8',
    'NAT salida + políticas LAN→WAN',
  ]);

  const apsPerFloor = Math.ceil(S.hosts_piso / 30);
  const totalAPs = apsPerFloor * S.pisos;
  inventory.push([
    `AP-WiFi (×${totalAPs})`,
    'Access Points WiFi',
    'Todos los pisos',
    'Cisco/Huawei/Aruba',
    'WiFi 6 (802.11ax)',
    '—',
    `${apsPerFloor} AP por piso (≈1 AP cada 30 usuarios)`,
  ]);

  const wsInv = XLSX.utils.aoa_to_sheet(inventory);
  wsInv['!cols'] = [{wch:16},{wch:22},{wch:18},{wch:18},{wch:22},{wch:14},{wch:50}];
  wsInv['!freeze'] = { xSplit: 0, ySplit: 1 };
  wsInv['!autofilter'] = { ref: `A1:G${inventory.length}` };
  styleHeader(wsInv, 0, 7);
  XLSX.utils.book_append_sheet(wb, wsInv, 'Inventario');

  /* ── Hoja 3: VLSM IPv4 ── */
  const vlsmHead = ['VLAN ID', 'Nombre', 'Tipo', 'Piso', 'Hosts req.', 'Hosts útiles', 'Eficiencia', 'Red IPv4', 'Máscara', 'Gateway', 'Broadcast'];
  const vlsmRows = S.vlans.map(v => [
    v.id, v.name, v.type, v.floor_label,
    v.hosts_required, v.hosts_useful, v.efficiency + '%',
    v.network + '/' + v.prefix, v.mask, v.gateway_v4, v.broadcast,
  ]);
  const wsV4 = XLSX.utils.aoa_to_sheet([vlsmHead, ...vlsmRows]);
  wsV4['!cols'] = [{wch:8},{wch:18},{wch:10},{wch:16},{wch:11},{wch:12},{wch:11},{wch:20},{wch:16},{wch:16},{wch:16}];
  wsV4['!freeze'] = { xSplit: 0, ySplit: 1 };
  wsV4['!autofilter'] = { ref: `A1:K${vlsmRows.length + 1}` };
  styleHeader(wsV4, 0, vlsmHead.length);
  XLSX.utils.book_append_sheet(wb, wsV4, 'VLSM IPv4');

  /* ── Hoja 4: VLSM IPv6 ── */
  if (S.ipv6) {
    const v6Head = ['VLAN ID', 'Nombre', 'Subred IPv6 /64', 'Gateway IPv6'];
    const v6Rows = S.vlans.map(v => [
      v.id, v.name, v.subnet_v6 || '—', v.gateway_v6 || '—',
    ]);
    const wsV6 = XLSX.utils.aoa_to_sheet([v6Head, ...v6Rows]);
    wsV6['!cols'] = [{wch:8},{wch:18},{wch:36},{wch:36}];
    wsV6['!freeze'] = { xSplit: 0, ySplit: 1 };
    wsV6['!autofilter'] = { ref: `A1:D${v6Rows.length + 1}` };
    styleHeader(wsV6, 0, v6Head.length, 'FF7C3AED');
    XLSX.utils.book_append_sheet(wb, wsV6, 'VLSM IPv6');
  }

  /* ── Hoja 5: Reservas IP ── */
  const reservations = [];
  S.vlans.forEach(v => (v.reserved_ips || []).forEach(r => {
    reservations.push([
      v.id, v.name, r.alias,
      r.ip4 || '—', r.ip6 || '—', (r.stack || '').toUpperCase(),
    ]);
  }));
  const resHead = ['VLAN ID', 'VLAN Nombre', 'Alias / Hostname', 'IPv4', 'IPv6', 'Stack'];
  const wsRes = XLSX.utils.aoa_to_sheet([resHead, ...reservations]);
  wsRes['!cols'] = [{wch:8},{wch:18},{wch:24},{wch:16},{wch:36},{wch:10}];
  wsRes['!freeze'] = { xSplit: 0, ySplit: 1 };
  if (reservations.length > 0) {
    wsRes['!autofilter'] = { ref: `A1:F${reservations.length + 1}` };
  }
  styleHeader(wsRes, 0, resHead.length, 'FF1A7A4A');
  XLSX.utils.book_append_sheet(wb, wsRes, 'Reservas IP');

  /* ── Hoja 6: Tabla de enrutamiento ── */
  const routes = [
    ['Tipo', 'Red destino', 'Máscara / Prefijo', 'Next-hop / Interfaz', 'Descripción'],
  ];
  /* Conectadas (SVIs) */
  S.vlans.forEach(v => {
    routes.push([
      'Conectada (C)',
      v.network,
      `${v.mask} (/${v.prefix})`,
      `SVI Vlan${v.id}`,
      `${v.name} — ${v.floor_label}`,
    ]);
  });
  /* Default */
  routes.push([
    'Estática (S*)',
    '0.0.0.0',
    '0.0.0.0 (/0)',
    getFWip(),
    'Default → Firewall FW-01',
  ]);
  /* WAN routes */
  S.wan_routes.forEach(r => {
    const p = parseCIDR(r);
    if (!p) return;
    routes.push([
      'Estática (S)',
      p.address,
      `${prefixToMask(p.prefix)} (/${p.prefix})`,
      S.wan_nexthop || '(next-hop)',
      'Red remota WAN',
    ]);
  });
  /* IPv6 default */
  if (S.ipv6) {
    routes.push([
      'Estática IPv6 (S)',
      '::',
      '::/0',
      getFWv6ip(),
      'Default IPv6 → FW-01',
    ]);
  }
  const wsRou = XLSX.utils.aoa_to_sheet(routes);
  wsRou['!cols'] = [{wch:16},{wch:18},{wch:22},{wch:24},{wch:40}];
  wsRou['!freeze'] = { xSplit: 0, ySplit: 1 };
  wsRou['!autofilter'] = { ref: `A1:E${routes.length}` };
  styleHeader(wsRou, 0, 5, 'FF875A00');
  XLSX.utils.book_append_sheet(wb, wsRou, 'Enrutamiento');

  /* ── Hoja 7: Servicios y WAN ── */
  const services = [
    ['Parámetro', 'Valor'],
    ['Dominio interno', S.domain],
    ['DNS primario IPv4', S.dns4],
    ['DNS primario IPv6', S.dns6],
    ['Servidor NTP', S.ntp],
    ['IPv6 habilitado', S.ipv6 ? 'Sí' : 'No'],
    ['Prefijo IPv6 ULA', S.ula_prefix || '—'],
    [''],
    ['WAN'],
    ['Next-hop WAN', S.wan_nexthop || '(no configurado)'],
    ['Rutas estáticas remotas', (S.wan_routes || []).length.toString()],
    ...(S.wan_routes || []).map((r, i) => [`  Ruta ${i+1}`, r]),
  ];
  const wsSrv = XLSX.utils.aoa_to_sheet(services);
  wsSrv['!cols'] = [{wch:28},{wch:40}];
  wsSrv['!freeze'] = { xSplit: 0, ySplit: 1 };
  styleHeader(wsSrv, 0, 2, 'FF0891B2');
  if (wsSrv['A9']) {
    wsSrv['A9'].s = {
      font: { bold: true, sz: 11, color: { rgb: 'FF0F4D8F' } },
      fill: { fgColor: { rgb: 'FFE8F0FB' } },
    };
  }
  XLSX.utils.book_append_sheet(wb, wsSrv, 'Servicios');

  /* ── Hoja 8: Conexiones físicas (NUEVO v4.6.1) ── */
  const conns = buildConnectionsTable();
  if (conns.length > 0) {
    const connHead = [
      'Dispositivo A', 'Interfaz A',
      'Dispositivo B', 'Interfaz B',
      'Tipo de enlace', 'VLANs trunk',
    ];
    const connRows = conns.map(c => [c.devA, c.ifA, c.devB, c.ifB, c.type, c.vlans]);
    const wsConn   = XLSX.utils.aoa_to_sheet([connHead, ...connRows]);
    wsConn['!cols'] = [{wch:18},{wch:30},{wch:18},{wch:30},{wch:18},{wch:30}];
    wsConn['!freeze'] = { xSplit: 0, ySplit: 1 };
    wsConn['!autofilter'] = { ref: `A1:F${connRows.length + 1}` };
    styleHeader(wsConn, 0, connHead.length, 'FF7C3AED');
    XLSX.utils.book_append_sheet(wb, wsConn, 'Conexiones');
  }

  /* Escribir y descargar */
  XLSX.writeFile(wb, _fileName('xlsx'));
  showToast('Excel exportado correctamente', 'success');
}

/* ── EXPORTACIÓN JSON ────────────────────────────────────────── */

function exportPlanJSON() {
  if (!S.vlans.length) { showToast('Completa el plan antes de exportar', 'error'); return; }
  const json = JSON.stringify(buildPlanJSON(), null, 2);
  _download(new Blob([json], { type: 'application/json' }), _fileName('json'));
  showToast('JSON exportado correctamente', 'success');
}

/* ── EXPORTACIÓN DRAWIO ──────────────────────────────────────── */

function exportPlanDrawio() {
  if (!S.vlans.length) { showToast('Completa el plan antes de exportar', 'error'); return; }
  const xml = generateDrawioXML();
  _download(new Blob([xml], { type: 'application/xml' }), _fileName('drawio'));
  showToast('Drawio exportado — ábrelo en https://app.diagrams.net', 'success');
}


/* ══════════════════════════════════════════════════════════════
   15. NAVEGACIÓN DEL WIZARD
   ══════════════════════════════════════════════════════════════ */

function goToStep(n) {
  if (n > S.step && !validateStep(S.step)) return;
  activateStep(n);
}

function changeStep(dir) {
  if (S.step === 5 && dir > 0) { openFinishModal(); return; }
  const next = S.step + dir;
  if (next < 0 || next > 5) return;
  if (dir > 0 && !validateStep(S.step)) return;
  activateStep(next);
}

function activateStep(n) {
  document.querySelectorAll('.step-content').forEach((el, i) =>
    el.classList.toggle('active', i === n)
  );

  document.querySelectorAll('.step-tab').forEach((tab, i) => {
    tab.classList.remove('active', 'done');
    if (i === n) tab.classList.add('active');
    else if (i < n) tab.classList.add('done');
  });

  S.step = n;

  const btnBack = document.getElementById('btn-back');
  if (btnBack) btnBack.disabled = n === 0;

  const btnNext = document.getElementById('btn-next');
  if (btnNext) {
    btnNext.textContent = n === 5 ? 'Finalizar' : 'Siguiente →';
    btnNext.disabled = n >= 3 ? false : !validateStep(n);
  }

  onStepEnter(n);
}

function onStepEnter(n) {
  if (n === 0) validateStep(0);
  if (n === 1) { runAnalysis();       validateStep(1); }
  if (n === 2) { onServicesChange(); }
  if (n === 3) { buildVLANPlan();    renderVLANCards(); updateVlansCount(); }
  if (n === 4) { renderSummary(); }
  if (n === 5) { renderExportCode(); }
}


/* ══════════════════════════════════════════════════════════════
   16. PANEL LATERAL, TOAST Y MODAL DE FINALIZAR (v4.6 — 3 opciones)
   ══════════════════════════════════════════════════════════════ */

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function toggleClass(id, cls, condition) {
  document.getElementById(id)?.classList.toggle(cls, condition);
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className   = `toast ${type}`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.className = 'toast hidden'; }, 2500);
}

function openFinishModal() {
  document.getElementById('modal-finish')?.classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-finish')?.classList.add('hidden');
}

/**
 * NUEVO v4.6 — Guardar el plan actual sin reiniciar.
 * Si hay Firebase + sesión, guarda en la nube; si no, descarga JSON.
 */
async function finishSaveAndStay() {
  closeModal();

  /* Caso 1: Firebase disponible → guardar en la nube */
  if (window.NetPlanCloud?.isAvailable()) {
    try {
      const name = S.domain || 'Plan sin título';
      const planJson = buildPlanJSON();
      const id = await window.NetPlanCloud.savePlan(planJson, name, S.cloud_plan_id);
      S.cloud_plan_id = id;
      showToast(`Plan "${name}" guardado en la nube`, 'success');
      return;
    } catch (e) {
      showToast('Error al guardar en nube: ' + e.message + '. Descargando JSON…', 'error');
    }
  }

  /* Caso 2: sin nube → descargar JSON */
  exportPlanJSON();
}

/**
 * NUEVO v4.6 — Guardar y luego iniciar plan nuevo.
 */
async function finishSaveAndNew() {
  await finishSaveAndStay();
  /* Pequeño delay para que se vea el toast antes del reset */
  setTimeout(() => resetApp(), 800);
}

/**
 * NUEVO v4.6 — Descartar sin guardar (con segundo confirm).
 */
function finishDiscardAndNew() {
  const ok = confirm(
    'Vas a iniciar un plan nuevo SIN guardar el actual.\n\n' +
    'Esta acción no se puede deshacer. ¿Continuar?'
  );
  if (!ok) return;
  closeModal();
  resetApp();
}

/**
 * Resetea toda la aplicación al estado inicial.
 */
function resetApp() {
  S.pisos       = 3;
  S.core_piso   = 1;
  S.hosts_piso  = null;
  S.puertos     = 48;
  S.redundancia = 'single';
  S.vendor      = 'cisco';
  S.growth_factor = 2;
  S.hardening_l2 = true;
  S.net         = null;
  S.override    = '';
  S.dns4        = '8.8.8.8';
  S.dns6        = '2001:4860:4860::8888';
  S.ntp         = 'pool.ntp.org';
  S.domain      = 'corp.local';
  S.ipv6        = true;
  S.wan_nexthop = '';
  S.wan_routes  = [];
  S.vlan_defs   = [];
  S.vlans       = [];
  S.ula_prefix  = '';
  S.export_vendor   = 'cisco';
  S.rollback_vendor = 'cisco';
  S.vlan_edit_id    = null;
  S.reserve_expanded = {};
  S.cloud_plan_id   = null;

  closeModal();

  /* Resetear inputs UI */
  const inpPisos = document.getElementById('inp-pisos');     if (inpPisos) inpPisos.value = '3';
  const inpCore  = document.getElementById('inp-core');      if (inpCore)  inpCore.value  = '1';
  const inpHosts = document.getElementById('inp-hosts');     if (inpHosts) inpHosts.value = '';
  const selPuertos = document.getElementById('sel-puertos'); if (selPuertos) selPuertos.value = '48';
  const selGrowth  = document.getElementById('sel-growth');  if (selGrowth)  selGrowth.value = '2';
  const inpOverride = document.getElementById('inp-override'); if (inpOverride) inpOverride.value = '';
  const inpDns4   = document.getElementById('inp-dns4');     if (inpDns4)   inpDns4.value   = '8.8.8.8';
  const inpDns6   = document.getElementById('inp-dns6');     if (inpDns6)   inpDns6.value   = '2001:4860:4860::8888';
  const inpNtp    = document.getElementById('inp-ntp');      if (inpNtp)    inpNtp.value    = 'pool.ntp.org';
  const inpDomain = document.getElementById('inp-domain');   if (inpDomain) inpDomain.value = 'corp.local';
  const inpWanNh  = document.getElementById('inp-wan-nexthop'); if (inpWanNh) inpWanNh.value = '';
  const inpWanRt  = document.getElementById('inp-wan-routes');  if (inpWanRt) inpWanRt.value = '';
  const cbIpv6    = document.getElementById('chk-ipv6');     if (cbIpv6)    cbIpv6.checked = true;
  const cbHard    = document.getElementById('chk-hardening');if (cbHard)    cbHard.checked = true;

  /* Toggle groups: marcar default */
  document.querySelectorAll('#tg-redund .toggle-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.value === 'single')
  );
  document.querySelectorAll('#tg-vendor .vendor-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.value === 'cisco')
  );

  /* Limpiar contenedores */
  const vc = document.getElementById('vlans-container');
  if (vc) vc.innerHTML = '<p class="placeholder-msg">Completa los pasos anteriores para generar las VLANs</p>';
  const tb = document.getElementById('vlsm-tbody');
  if (tb) tb.innerHTML = '';
  const ec = document.getElementById('export-blocks');
  if (ec) ec.innerHTML = '<p class="placeholder-msg">Selecciona un vendor para ver las configuraciones</p>';
  const ct = document.getElementById('connections-table');
  if (ct) ct.innerHTML = '<p class="placeholder-msg" style="padding:24px 0">La tabla se genera al calcular el plan</p>';

  document.getElementById('vlan-form')?.classList.add('hidden');
  document.getElementById('export-zip-bar')?.classList.add('hidden');

  /* Resetear panel lateral */
  ['st-network','st-hosts','st-vlans','st-prefix','st-blocks',
   'st-hpiso','st-ports','st-sw','st-score',
   'res-network','res-mask','res-planned','res-margin','res-score',
   'ipv6-prefix','sw-count'].forEach(id => setText(id, '—'));
  setText('st-vendor', 'Cisco');
  setText('st-redund', 'Single-Link');
  setText('sw-detail', 'Ingresa los hosts por piso para ver el cálculo');
  setText('vlans-count', '0 VLANs');

  const swBox = document.getElementById('sw-result');
  if (swBox) { swBox.classList.add('ok'); swBox.classList.remove('warn'); }

  activateStep(0);
  try { localStorage.removeItem(_autosaveKey()); } catch(e) {}
  document.getElementById('recovery-banner')?.classList.add('hidden');
  showToast('Plan reiniciado. Comienza desde el paso 1.', 'success');
}


/* ══════════════════════════════════════════════════════════════
   17. PERSISTENCIA — JSON, IMPORT/EXPORT, AUTOGUARDADO
   ══════════════════════════════════════════════════════════════ */

const PLAN_SCHEMA_VERSION = 'netplan.v1';
const STORAGE_KEY_PREFIX  = 'netplan_pro_autosave';
const CLOUDLESS_FLAG      = 'netplan_cloudless';
const AUTOSAVE_DEBOUNCE   = 800;

let _autosaveTimer = null;

/**
 * Devuelve la clave de localStorage para el autoguardado del usuario actual.
 *
 * v4.7: las claves están aisladas por UID para resolver el bug del
 * autoguardado huérfano (cuando cerrabas sesión Google sin sign-out,
 * el siguiente usuario veía el plan del anterior).
 *
 *   - Con sesión Firebase (Google/email): netplan_pro_autosave_{uid}
 *   - Modo sin nube:                       netplan_pro_autosave_local
 *   - Sin Firebase configurado (legacy):   netplan_pro_autosave_local
 */
function _autosaveKey() {
  const cloud = window.NetPlanCloud;
  if (cloud?.isAvailable()) {
    const user = cloud.getCurrentUser();
    if (user?.uid) return `${STORAGE_KEY_PREFIX}_${user.uid}`;
  }
  return `${STORAGE_KEY_PREFIX}_local`;
}

function buildPlanJSON() {
  const now = new Date().toISOString();
  return {
    schema: PLAN_SCHEMA_VERSION,
    metadata: {
      name:        S.domain || 'plan',
      description: '',
      author:      '',
      createdAt:   now,
      updatedAt:   now,
    },
    infrastructure: {
      pisos:         S.pisos,
      core_piso:     S.core_piso,
      hosts_piso:    S.hosts_piso,
      puertos:       S.puertos,
      redundancia:   S.redundancia,
      vendor:        S.vendor,
      growth_factor: S.growth_factor,
      hardening_l2:  S.hardening_l2,
    },
    ipv4: {
      override: S.override || '',
    },
    services: {
      dns4:        S.dns4,
      dns6:        S.dns6,
      ntp:         S.ntp,
      domain:      S.domain,
      ipv6:        S.ipv6,
      wan_nexthop: S.wan_nexthop || '',
      wan_routes:  Array.isArray(S.wan_routes) ? S.wan_routes : [],
    },
    vlans: (S.vlan_defs || []).map(v => ({
      id:             v.id,
      name:           v.name,
      type:           v.type,
      badge:          v.badge,
      floor:          v.floor,
      hosts_required: v.hosts_required,
      reserved_ips:   (v.reserved_ips || []).map(r => ({
        id:    r.id,
        alias: r.alias,
        ip4:   r.ip4 || null,
        ip6:   r.ip6 || null,
        stack: r.stack,
      })),
    })),
  };
}

function validateAndMigratePlan(data) {
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'JSON malformado o vacío' };
  }
  if (!data.schema) {
    return { ok: false, error: 'Falta el campo "schema" — ¿es un plan NetPlan?' };
  }

  if (data.schema !== PLAN_SCHEMA_VERSION) {
    return { ok: false, error: `Versión "${data.schema}" no soportada. Esperado: ${PLAN_SCHEMA_VERSION}` };
  }

  const inf = data.infrastructure || {};
  if (!inf.pisos || inf.pisos < 1 || inf.pisos > 50) {
    return { ok: false, error: 'pisos debe estar entre 1 y 50' };
  }
  if (!inf.core_piso || inf.core_piso < 1 || inf.core_piso > inf.pisos) {
    return { ok: false, error: `core_piso debe estar entre 1 y ${inf.pisos}` };
  }
  if (!inf.hosts_piso || inf.hosts_piso < 1 || inf.hosts_piso > 500) {
    return { ok: false, error: 'hosts_piso debe estar entre 1 y 500' };
  }

  return { ok: true, plan: data };
}

function applyPlan(plan) {
  const inf = plan.infrastructure || {};
  const svc = plan.services       || {};

  S.pisos        = inf.pisos        ?? 3;
  S.core_piso    = inf.core_piso    ?? 1;
  S.hosts_piso   = inf.hosts_piso   ?? null;
  S.puertos      = inf.puertos      ?? 48;
  S.redundancia  = inf.redundancia  ?? 'single';
  S.vendor       = inf.vendor       ?? 'cisco';
  S.growth_factor = inf.growth_factor ?? 2;
  S.hardening_l2 = inf.hardening_l2 ?? true;

  S.override = (plan.ipv4 && plan.ipv4.override) || '';

  S.dns4        = svc.dns4        ?? '8.8.8.8';
  S.dns6        = svc.dns6        ?? '2001:4860:4860::8888';
  S.ntp         = svc.ntp         ?? 'pool.ntp.org';
  S.domain      = svc.domain      ?? 'corp.local';
  S.ipv6        = svc.ipv6        ?? true;
  S.wan_nexthop = svc.wan_nexthop ?? '';
  S.wan_routes  = Array.isArray(svc.wan_routes) ? svc.wan_routes : [];

  S.vlan_defs = (plan.vlans || []).map(v => ({
    id:             v.id,
    name:           v.name,
    type:           v.type,
    badge:          v.badge || (TYPE_BADGE[v.type] || 'blue'),
    floor:          v.floor,
    hosts_required: v.hosts_required,
    reserved_ips:   (v.reserved_ips || []).map(r => ({
      id:    r.id || genResId(),
      alias: r.alias,
      ip4:   r.ip4 || null,
      ip6:   r.ip6 || null,
      stack: r.stack,
    })),
  }));

  /* Sincronizar UI */
  const inpPisos = document.getElementById('inp-pisos');     if (inpPisos) inpPisos.value = String(S.pisos);
  const inpCore  = document.getElementById('inp-core');      if (inpCore)  { inpCore.value  = String(S.core_piso); inpCore.max = S.pisos; }
  const inpHosts = document.getElementById('inp-hosts');     if (inpHosts) inpHosts.value = String(S.hosts_piso || '');
  const selPuertos = document.getElementById('sel-puertos'); if (selPuertos) selPuertos.value = String(S.puertos);
  const selGrowth  = document.getElementById('sel-growth');  if (selGrowth)  selGrowth.value = String(S.growth_factor);
  const inpOverride = document.getElementById('inp-override'); if (inpOverride) inpOverride.value = S.override;
  const inpDns4   = document.getElementById('inp-dns4');     if (inpDns4)   inpDns4.value   = S.dns4;
  const inpDns6   = document.getElementById('inp-dns6');     if (inpDns6)   inpDns6.value   = S.dns6;
  const inpNtp    = document.getElementById('inp-ntp');      if (inpNtp)    inpNtp.value    = S.ntp;
  const inpDomain = document.getElementById('inp-domain');   if (inpDomain) inpDomain.value = S.domain;
  const inpWanNh  = document.getElementById('inp-wan-nexthop'); if (inpWanNh) inpWanNh.value = S.wan_nexthop;
  const inpWanRt  = document.getElementById('inp-wan-routes');  if (inpWanRt) inpWanRt.value = S.wan_routes.join('\n');
  const cbIpv6    = document.getElementById('chk-ipv6');     if (cbIpv6)    cbIpv6.checked = S.ipv6;
  const cbHard    = document.getElementById('chk-hardening');if (cbHard)    cbHard.checked = S.hardening_l2;

  document.querySelectorAll('#tg-redund .toggle-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.value === S.redundancia)
  );
  document.querySelectorAll('#tg-vendor .vendor-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.value === S.vendor)
  );

  setText('st-vendor', S.vendor === 'cisco' ? 'Cisco' : 'Huawei');
  setText('st-redund', S.redundancia === 'single' ? 'Single-Link' : 'Dual-Link (LACP)');

  runAnalysis();
  buildVLANPlan();
  renderVLANCards();
  updateVlansCount();
  onHostsChange();
  activateStep(0);
}

function triggerImportJSON() {
  const fi = document.getElementById('file-import-json');
  if (fi) { fi.value = ''; fi.click(); }
}

function onImportFileSelected(evt) {
  const file = evt.target.files?.[0];
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.json')) {
    showToast('El archivo debe tener extensión .json', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    let parsed;
    try {
      parsed = JSON.parse(e.target.result);
    } catch (err) {
      showToast('JSON inválido: ' + err.message, 'error');
      return;
    }
    const result = validateAndMigratePlan(parsed);
    if (!result.ok) {
      showToast('Error al cargar: ' + result.error, 'error');
      return;
    }
    applyPlan(result.plan);
    S.cloud_plan_id = null;
    showToast('Plan cargado correctamente', 'success');
  };
  reader.onerror = () => showToast('No se pudo leer el archivo', 'error');
  reader.readAsText(file);
}

function autosave() {
  clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(() => {
    try {
      if (!S.hosts_piso) return;
      const plan = buildPlanJSON();
      localStorage.setItem(_autosaveKey(), JSON.stringify(plan));
    } catch (e) {
      console.warn('Autoguardado no disponible:', e.message);
    }
  }, AUTOSAVE_DEBOUNCE);
}

function checkAutosaveOnLoad() {
  try {
    const raw = localStorage.getItem(_autosaveKey());
    if (!raw) return;
    const plan = JSON.parse(raw);
    if (!plan || plan.schema !== PLAN_SCHEMA_VERSION) return;
    if (!plan.infrastructure?.hosts_piso) return;

    const banner  = document.getElementById('recovery-banner');
    const metaEl  = document.getElementById('recovery-meta');
    if (!banner) return;

    const updated = plan.metadata?.updatedAt
      ? new Date(plan.metadata.updatedAt).toLocaleString('es-CO',
          { dateStyle: 'medium', timeStyle: 'short' })
      : 'fecha desconocida';
    const vlanCnt = (plan.vlans || []).length;
    if (metaEl) metaEl.textContent =
      `${plan.metadata?.name || 'plan'} · ${vlanCnt} VLANs · guardado ${updated}`;

    banner.classList.remove('hidden');
  } catch (e) {
    console.warn('No se pudo leer autoguardado:', e.message);
  }
}

function restoreAutosave() {
  try {
    const raw = localStorage.getItem(_autosaveKey());
    if (!raw) {
      showToast('No hay autoguardado disponible', 'error');
      return;
    }
    const plan   = JSON.parse(raw);
    const result = validateAndMigratePlan(plan);
    if (!result.ok) {
      showToast('Autoguardado corrupto: ' + result.error, 'error');
      return;
    }
    applyPlan(result.plan);
    S.cloud_plan_id = null;
    document.getElementById('recovery-banner')?.classList.add('hidden');
    showToast('Plan restaurado desde autoguardado', 'success');
  } catch (e) {
    showToast('Error al restaurar: ' + e.message, 'error');
  }
}

function discardAutosave() {
  try { localStorage.removeItem(_autosaveKey()); } catch(e) {}
  document.getElementById('recovery-banner')?.classList.add('hidden');
  showToast('Autoguardado descartado', 'success');
}




/* ══════════════════════════════════════════════════════════════
   18. NUBE — UI Y HANDLERS DE FIREBASE (v4.7 — Bloque A)
   ══════════════════════════════════════════════════════════════
   Toda la lógica Firebase vive en firebase-cloud.js (módulo ES6).
   Aquí solo se invoca la API expuesta en window.NetPlanCloud.

   Cambios v4.7:
   - Pantalla de login obligatoria al cargar (Google / Email / Sin nube)
   - Manejo de 3 modales auth: signup, signin, forgot password
   - Toggle "Mantener sesión" aplica persistencia antes del sign-in
   - Banner de email no verificado (no bloqueante)
   - Banner discreto en modo sin nube
   - Botón "Iniciar sesión" en header cuando está en modo sin nube
   ══════════════════════════════════════════════════════════════ */

/* Flag: ya hemos decidido qué pantalla mostrar (login vs wizard).
 * Evita parpadeo y re-renders en cargas con sesión persistida. */
let _authDecisionMade = false;

window.addEventListener('netplan-cloud-ready', (e) => {
  if (!e.detail?.available) {
    /* Firebase no configurado → entrar directamente al wizard en
       modo sin nube de facto. No mostramos login porque no hay cloud
       que ofrecer. */
    enterCloudlessMode({ silent: true, persist: false });
    return;
  }

  document.body.classList.add('cloud-ready');

  /* Si el usuario eligió "modo sin nube" antes, respetar esa decisión.
     No mostrar pantalla de login. */
  if (localStorage.getItem(CLOUDLESS_FLAG) === 'true') {
    enterCloudlessMode({ silent: true, persist: false });
    return;
  }

  /* Suscribirse a cambios de auth. El primer evento determina si
     mostramos login (user=null) o vamos directo al wizard (user). */
  window.NetPlanCloud.onAuthStateChanged(onAuthChange);
});

function onAuthChange(user) {
  if (user) {
    /* Hay sesión activa (recuperada de persistencia o recién creada).
       Mostrar wizard. */
    _authDecisionMade = true;
    hideLoginScreen();
    updateUserMenuUI(user);
    /* Re-leer autoguardado bajo la NUEVA clave (por UID).
       El plan anterior queda intacto en su clave; este usuario verá el suyo. */
    checkAutosaveOnLoad();
  } else {
    /* Sin sesión. Mostrar pantalla de login. */
    if (!_authDecisionMade) showLoginScreen();
    /* Si _authDecisionMade ya es true, es porque el usuario hizo
       signOut. Lo redirigimos al login también. */
    if (_authDecisionMade) showLoginScreen();
  }
}


/* ── PANTALLA DE LOGIN ────────────────────────────────────── */

function showLoginScreen() {
  const overlay = document.getElementById('login-overlay');
  if (overlay) overlay.classList.remove('hidden');
  /* Por seguridad, ocultar todos los modales que pudieran estar abiertos */
  document.getElementById('modal-cloud-plans')?.classList.add('hidden');
  document.getElementById('modal-finish')?.classList.add('hidden');
  document.getElementById('modal-email-signup')?.classList.add('hidden');
  document.getElementById('modal-email-signin')?.classList.add('hidden');
  document.getElementById('modal-forgot-password')?.classList.add('hidden');
}

function hideLoginScreen() {
  const overlay = document.getElementById('login-overlay');
  if (overlay) overlay.classList.add('hidden');
  _authDecisionMade = true;
}

/* Toggle "Mantener sesión" — aplica persistencia. */
function onRememberToggle(cb) {
  if (window.NetPlanCloud?.isAvailable()) {
    window.NetPlanCloud.setRememberSession(cb.checked);
  }
}


/* ── BOTÓN GOOGLE EN PANTALLA DE LOGIN ─────────────────────── */

async function loginWithGoogle() {
  if (!window.NetPlanCloud?.isAvailable()) {
    showToast('Nube no disponible', 'error');
    return;
  }
  /* Aplicar persistencia según toggle ANTES del sign-in */
  const remember = document.getElementById('chk-remember-session')?.checked ?? true;
  await window.NetPlanCloud.setRememberSession(remember);

  try {
    await window.NetPlanCloud.signInWithGoogle();
    /* hideLoginScreen() se llama desde onAuthChange cuando llegue el evento */
    showToast('Sesión iniciada con Google', 'success');
  } catch (e) {
    handleAuthError(e, 'Google');
  }
}


/* ── BOTÓN EMAIL EN PANTALLA DE LOGIN ──────────────────────── */

function openEmailSigninModal() {
  document.getElementById('modal-email-signin')?.classList.remove('hidden');
  /* Limpiar campos */
  const inpE = document.getElementById('inp-signin-email');
  const inpP = document.getElementById('inp-signin-password');
  if (inpE) inpE.value = '';
  if (inpP) inpP.value = '';
  document.getElementById('field-signin-email')?.classList.remove('invalid');
  document.getElementById('field-signin-password')?.classList.remove('invalid');
  document.getElementById('btn-do-signin').disabled = true;
  setTimeout(() => inpE?.focus(), 100);
}

function closeEmailSigninModal() {
  document.getElementById('modal-email-signin')?.classList.add('hidden');
}

function validateSigninForm() {
  const email = document.getElementById('inp-signin-email')?.value.trim() || '';
  const pwd   = document.getElementById('inp-signin-password')?.value || '';
  const ok    = isValidEmail(email) && pwd.length >= 6;
  document.getElementById('btn-do-signin').disabled = !ok;
}

async function doEmailSignin() {
  const email = document.getElementById('inp-signin-email')?.value.trim() || '';
  const pwd   = document.getElementById('inp-signin-password')?.value || '';
  if (!isValidEmail(email) || pwd.length < 6) return;

  const remember = document.getElementById('chk-remember-session')?.checked ?? true;
  await window.NetPlanCloud.setRememberSession(remember);

  const btn = document.getElementById('btn-do-signin');
  if (btn) { btn.disabled = true; btn.textContent = 'Verificando…'; }

  try {
    await window.NetPlanCloud.signInWithEmail(email, pwd);
    closeEmailSigninModal();
    showToast('Sesión iniciada', 'success');
  } catch (e) {
    handleAuthError(e, 'Email');
    if (btn) { btn.disabled = false; btn.textContent = 'Iniciar sesión'; }
  }
}


/* ── BOTÓN CREAR CUENTA ─────────────────────────────────────── */

function openEmailSignupModal() {
  closeEmailSigninModal();
  document.getElementById('modal-email-signup')?.classList.remove('hidden');
  /* Limpiar campos */
  ['inp-signup-email','inp-signup-password','inp-signup-password-confirm'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  ['field-signup-email','field-signup-password','field-signup-password-confirm'].forEach(id => {
    document.getElementById(id)?.classList.remove('invalid');
  });
  document.getElementById('btn-do-signup').disabled = true;
  setTimeout(() => document.getElementById('inp-signup-email')?.focus(), 100);
}

function closeEmailSignupModal() {
  document.getElementById('modal-email-signup')?.classList.add('hidden');
}

function validateSignupForm() {
  const email = document.getElementById('inp-signup-email')?.value.trim() || '';
  const pwd   = document.getElementById('inp-signup-password')?.value || '';
  const pwd2  = document.getElementById('inp-signup-password-confirm')?.value || '';

  const emailOk = isValidEmail(email);
  const pwdOk   = pwd.length >= 8;
  const match   = pwd === pwd2 && pwd2.length > 0;

  /* Solo marcar inválido si el campo no está vacío (UX más amable) */
  setFieldValidity('field-signup-email',           emailOk || email === '');
  setFieldValidity('field-signup-password',        pwdOk   || pwd === '');
  setFieldValidity('field-signup-password-confirm', match  || pwd2 === '');

  document.getElementById('btn-do-signup').disabled = !(emailOk && pwdOk && match);
}

async function doEmailSignup() {
  const email = document.getElementById('inp-signup-email')?.value.trim() || '';
  const pwd   = document.getElementById('inp-signup-password')?.value || '';
  const pwd2  = document.getElementById('inp-signup-password-confirm')?.value || '';

  if (!isValidEmail(email) || pwd.length < 8 || pwd !== pwd2) return;

  const remember = document.getElementById('chk-remember-session')?.checked ?? true;
  await window.NetPlanCloud.setRememberSession(remember);

  const btn = document.getElementById('btn-do-signup');
  if (btn) { btn.disabled = true; btn.textContent = 'Creando cuenta…'; }

  try {
    const user = await window.NetPlanCloud.signUpWithEmail(email, pwd);
    /* Enviar email de verificación opcional (no bloqueante) */
    if (user && !user.emailVerified) {
      try {
        await window.NetPlanCloud.sendEmailVerification();
      } catch(_) { /* no crítico */ }
    }
    closeEmailSignupModal();
    showToast('Cuenta creada. Revisa tu correo para verificarla.', 'success');
  } catch (e) {
    handleAuthError(e, 'Crear cuenta');
    if (btn) { btn.disabled = false; btn.textContent = 'Crear cuenta'; }
  }
}


/* ── OLVIDÉ MI CONTRASEÑA ──────────────────────────────────── */

function openForgotPasswordModal() {
  closeEmailSigninModal();
  document.getElementById('modal-forgot-password')?.classList.remove('hidden');
  const inp = document.getElementById('inp-forgot-email');
  if (inp) inp.value = '';
  document.getElementById('field-forgot-email')?.classList.remove('invalid');
  document.getElementById('btn-do-forgot').disabled = true;
  setTimeout(() => inp?.focus(), 100);
}

function closeForgotPasswordModal() {
  document.getElementById('modal-forgot-password')?.classList.add('hidden');
}

function validateForgotForm() {
  const email = document.getElementById('inp-forgot-email')?.value.trim() || '';
  document.getElementById('btn-do-forgot').disabled = !isValidEmail(email);
}

async function doSendPasswordReset() {
  const email = document.getElementById('inp-forgot-email')?.value.trim() || '';
  if (!isValidEmail(email)) return;

  const btn = document.getElementById('btn-do-forgot');
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }

  try {
    await window.NetPlanCloud.sendPasswordReset(email);
    closeForgotPasswordModal();
    showToast(
      'Si esa cuenta existe, te enviamos un correo con instrucciones.',
      'success'
    );
  } catch (e) {
    handleAuthError(e, 'Reset');
    if (btn) { btn.disabled = false; btn.textContent = 'Enviar enlace'; }
  }
}


/* ── MODO SIN NUBE ──────────────────────────────────────────── */

/**
 * Activa el modo sin nube: oculta login, muestra wizard y banner discreto.
 *
 * @param {Object} opts
 * @param {boolean} opts.silent  - true: no muestra toast (uso interno al cargar)
 * @param {boolean} opts.persist - true: guarda flag en localStorage para futuras cargas
 */
function enterCloudlessMode({ silent = false, persist = true } = {}) {
  S.cloudless_mode = true;
  if (persist) {
    try { localStorage.setItem(CLOUDLESS_FLAG, 'true'); } catch(_) {}
  }
  hideLoginScreen();
  document.body.classList.add('cloudless-mode');
  document.getElementById('cloudless-banner')?.classList.remove('hidden');
  checkAutosaveOnLoad();
  if (!silent) showToast('Modo sin nube activado', 'success');
}

/**
 * Sale del modo sin nube y vuelve a mostrar la pantalla de login.
 * Si hay un plan actual con contenido, pregunta si conservarlo.
 */
function exitCloudlessMode() {
  const hasContent = S.hosts_piso && S.vlan_defs.length > 0;

  if (hasContent) {
    const keep = confirm(
      'Tienes un plan en curso en modo sin nube.\n\n' +
      '¿Conservar este plan al iniciar sesión?\n\n' +
      '• Aceptar: el plan actual se mantendrá visible.\n' +
      '• Cancelar: se descarta el plan y empezarás vacío.'
    );
    if (!keep) {
      /* Limpiar autoguardado local y plan en memoria */
      try { localStorage.removeItem(_autosaveKey()); } catch(_) {}
      resetPlanState();
    }
  }

  S.cloudless_mode = false;
  try { localStorage.removeItem(CLOUDLESS_FLAG); } catch(_) {}
  document.body.classList.remove('cloudless-mode');
  document.getElementById('cloudless-banner')?.classList.add('hidden');
  showLoginScreen();
}

/**
 * Resetea el plan en memoria pero sin tocar localStorage ni mostrar toast.
 * Helper de exitCloudlessMode cuando el usuario decide no conservar.
 */
function resetPlanState() {
  S.pisos = 3; S.core_piso = 1; S.hosts_piso = null;
  S.puertos = 48; S.redundancia = 'single'; S.vendor = 'cisco';
  S.growth_factor = 2; S.hardening_l2 = true;
  S.net = null; S.override = '';
  S.dns4 = '8.8.8.8'; S.dns6 = '2001:4860:4860::8888';
  S.ntp = 'pool.ntp.org'; S.domain = 'corp.local';
  S.ipv6 = true; S.wan_nexthop = ''; S.wan_routes = [];
  S.vlan_defs = []; S.vlans = []; S.ula_prefix = '';
  S.cloud_plan_id = null;
  S.vlan_edit_id = null; S.reserve_expanded = {};
}


/* ── MENÚ DE USUARIO EN HEADER ────────────────────────────── */

function updateUserMenuUI(user) {
  if (!user) return;
  const avatar = document.getElementById('user-avatar');
  const label  = document.getElementById('user-label');
  const info   = document.getElementById('user-menu-info');
  const verify = document.getElementById('email-verify-banner');

  const provider = window.NetPlanCloud.getProviderType();
  const display  = user.displayName || user.email || 'Usuario';
  const initial  = (display[0] || 'U').toUpperCase();

  if (avatar) avatar.textContent = initial;
  if (label)  label.textContent  = display.split(' ')[0];

  let infoText = user.email || display;
  if (provider === 'google')   infoText += ' · Google';
  if (provider === 'password') infoText += ' · Email';
  if (info) info.textContent = infoText;

  /* Banner de email no verificado (solo para password, no aplica a Google) */
  if (verify) {
    const showVerify = provider === 'password' && !user.emailVerified;
    verify.classList.toggle('hidden', !showVerify);
    const emailSpan = document.getElementById('verify-email-addr');
    if (emailSpan) emailSpan.textContent = user.email || '';
  }
}

function toggleUserMenu(evt) {
  evt?.stopPropagation();
  document.getElementById('user-menu-dropdown')?.classList.toggle('hidden');
}

document.addEventListener('click', (e) => {
  const menu = document.getElementById('user-menu');
  const dd   = document.getElementById('user-menu-dropdown');
  if (menu && dd && !menu.contains(e.target) && !dd.classList.contains('hidden')) {
    dd.classList.add('hidden');
  }
});

/* Reenvío de verificación de email (desde el banner). */
async function resendEmailVerification() {
  if (!window.NetPlanCloud?.isAvailable()) return;
  try {
    await window.NetPlanCloud.sendEmailVerification();
    showToast('Correo de verificación reenviado', 'success');
  } catch (e) {
    showToast('No se pudo reenviar: ' + (e.message || e.code), 'error');
  }
}


/* ── CERRAR SESIÓN ─────────────────────────────────────────── */

async function cloudSignOut() {
  if (!window.NetPlanCloud?.isAvailable()) return;
  if (!confirm('¿Cerrar sesión? Volverás a la pantalla de inicio.')) return;

  document.getElementById('user-menu-dropdown')?.classList.add('hidden');
  try {
    await window.NetPlanCloud.signOut();
    S.cloud_plan_id = null;
    showToast('Sesión cerrada', 'success');
    /* onAuthChange recibe user=null y muestra la pantalla de login */
  } catch (e) {
    showToast('Error al cerrar sesión: ' + e.message, 'error');
  }
}


/* ── HELPERS DE ERROR Y VALIDACIÓN ─────────────────────────── */

function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * Convierte códigos de Firebase Auth en mensajes legibles en español.
 */
function handleAuthError(e, context = '') {
  /* Cierre/cancelación de popup: no es error, no molestar */
  if (e.code === 'auth/popup-closed-by-user' ||
      e.code === 'auth/cancelled-popup-request') {
    return;
  }

  const map = {
    'auth/popup-blocked':
      'El navegador bloqueó el popup. Habilita popups para este sitio y vuelve a intentar.',
    'auth/email-already-in-use':
      'Ya existe una cuenta con ese correo. Usa "Iniciar sesión" o recupera tu contraseña.',
    'auth/invalid-email':
      'El correo no tiene un formato válido.',
    'auth/user-not-found':
      'No existe una cuenta con ese correo.',
    'auth/wrong-password':
      'Contraseña incorrecta.',
    'auth/invalid-credential':
      'Correo o contraseña incorrectos.',
    'auth/weak-password':
      'La contraseña es demasiado débil. Usa mínimo 8 caracteres.',
    'auth/too-many-requests':
      'Demasiados intentos. Espera unos minutos antes de reintentar.',
    'auth/network-request-failed':
      'Sin conexión a internet. Verifica tu red.',
    'auth/operation-not-allowed':
      'Este método de inicio de sesión no está habilitado en Firebase. Contacta al administrador.',
    'auth/account-exists-with-different-credential':
      'Ya existe una cuenta con ese correo usando otro método (Google o Email). Usa ese método.',
  };

  const msg = map[e.code] || e.message || e.code || 'Error desconocido';
  showToast(msg, 'error');
  console.error(`[Auth ${context}]`, e.code, e.message);
}


/* ── MODAL "MIS PLANES EN LA NUBE" ──────────────────────────── */

function openCloudPlansModal() {
  if (!window.NetPlanCloud?.isAvailable()) {
    showToast('Nube no configurada', 'error');
    return;
  }
  if (S.cloudless_mode || !window.NetPlanCloud.getCurrentUser()) {
    /* No tiene sentido abrir el modal sin sesión cloud */
    showToast('Inicia sesión para ver tus planes guardados', 'error');
    return;
  }
  document.getElementById('modal-cloud-plans')?.classList.remove('hidden');
  const inp = document.getElementById('inp-plan-name');
  if (inp && !inp.value && S.domain) inp.value = S.domain;
  refreshCloudPlansList();
}

function closeCloudPlansModal() {
  document.getElementById('modal-cloud-plans')?.classList.add('hidden');
}

async function cloudSaveCurrentPlan() {
  if (!window.NetPlanCloud?.isAvailable()) return;

  if (!S.pisos || !S.core_piso || !S.hosts_piso) {
    showToast('Completa al menos el paso 1 antes de guardar', 'error');
    return;
  }

  const name = document.getElementById('inp-plan-name')?.value?.trim()
            || S.domain || 'Plan sin título';
  const planJson = buildPlanJSON();

  try {
    const id = await window.NetPlanCloud.savePlan(planJson, name, S.cloud_plan_id);
    S.cloud_plan_id = id;
    showToast(`Plan "${name}" guardado en la nube`, 'success');
    refreshCloudPlansList();
  } catch (e) {
    showToast('Error al guardar: ' + e.message, 'error');
  }
}

async function refreshCloudPlansList() {
  if (!window.NetPlanCloud?.isAvailable()) return;
  const list = document.getElementById('cloud-plans-list');
  if (!list) return;

  list.innerHTML = '<p class="placeholder-msg">Cargando planes…</p>';

  try {
    const plans = await window.NetPlanCloud.listPlans();
    if (plans.length === 0) {
      list.innerHTML = '<p class="placeholder-msg">No tienes planes guardados todavía. Guarda el plan actual para empezar.</p>';
      return;
    }

    list.innerHTML = '';
    for (const p of plans) {
      const updated = p.updatedAt
        ? new Date(p.updatedAt).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
        : 'sin fecha';
      const isCurrent = p.id === S.cloud_plan_id;

      const row = document.createElement('div');
      row.className = 'cloud-plan-row';
      row.innerHTML = `
        <div class="cloud-plan-info">
          <span class="cloud-plan-name">${escapeHTML(p.name)}${isCurrent ? ' · <em style="color:var(--accent);font-style:normal">actual</em>' : ''}</span>
          <span class="cloud-plan-meta">${p.vlanCount} VLAN${p.vlanCount !== 1 ? 's' : ''} · ${updated}</span>
        </div>
        <div class="cloud-plan-actions">
          <button class="btn-cloud-action" title="Cargar este plan" data-act="load" data-id="${p.id}">↓</button>
          <button class="btn-cloud-action btn-cloud-rename" title="Renombrar" data-act="rename" data-id="${p.id}" data-name="${escapeHTML(p.name)}">✎</button>
          <button class="btn-cloud-action btn-cloud-delete" title="Eliminar" data-act="delete" data-id="${p.id}" data-name="${escapeHTML(p.name)}">✕</button>
        </div>`;
      list.appendChild(row);
    }

    /* Event delegation para los botones de acción */
    list.querySelectorAll('.btn-cloud-action').forEach(btn => {
      btn.addEventListener('click', () => onCloudPlanAction(btn));
    });
  } catch (e) {
    list.innerHTML = `<p class="placeholder-msg" style="color:var(--error)">Error: ${escapeHTML(e.message)}</p>`;
  }
}

async function onCloudPlanAction(btn) {
  const id   = btn.dataset.id;
  const act  = btn.dataset.act;
  const name = btn.dataset.name || '';

  if (act === 'load') {
    try {
      const planData = await window.NetPlanCloud.loadPlan(id);
      const result = validateAndMigratePlan(planData);
      if (!result.ok) {
        showToast('Plan corrupto: ' + result.error, 'error');
        return;
      }
      applyPlan(result.plan);
      S.cloud_plan_id = id;
      closeCloudPlansModal();
      showToast('Plan cargado desde la nube', 'success');
    } catch (e) {
      showToast('Error al cargar: ' + e.message, 'error');
    }
  }
  else if (act === 'rename') {
    const newName = prompt('Nuevo nombre del plan:', name);
    if (newName === null) return;
    const trimmed = newName.trim();
    if (!trimmed) { showToast('El nombre no puede estar vacío', 'error'); return; }
    try {
      await window.NetPlanCloud.renamePlan(id, trimmed);
      showToast('Plan renombrado', 'success');
      refreshCloudPlansList();
    } catch (e) {
      showToast('Error al renombrar: ' + e.message, 'error');
    }
  }
  else if (act === 'delete') {
    if (!confirm(`¿Eliminar "${name}" permanentemente?\n\nEsta acción no se puede deshacer.`)) return;
    try {
      await window.NetPlanCloud.deletePlan(id);
      if (S.cloud_plan_id === id) S.cloud_plan_id = null;
      showToast('Plan eliminado', 'success');
      refreshCloudPlansList();
    } catch (e) {
      showToast('Error al eliminar: ' + e.message, 'error');
    }
  }
}

function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}


/* ══════════════════════════════════════════════════════════════
   19. INICIALIZACIÓN
   ══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  activateStep(0);

  /* Si Firebase está configurado y la nube se inicia, el flujo
     queda en manos del listener 'netplan-cloud-ready'.
     Si Firebase NO se configura (timeout o no cargado), pasamos
     a modo sin nube como fallback después de 1.5s. */
  setTimeout(() => {
    if (!_authDecisionMade && !window.NetPlanCloud?.isAvailable()) {
      enterCloudlessMode({ silent: true, persist: false });
    }
  }, 1500);
});
