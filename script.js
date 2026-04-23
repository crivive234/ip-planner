'use strict';

/*
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  NetPlan Pro v4.0 — script.js                               ║
 * ║                                                              ║
 * ║  Secciones:                                                  ║
 * ║    1.  Estado global (S)                                     ║
 * ║    2.  Constantes                                            ║
 * ║    3.  Utilidades IPv4                                       ║
 * ║    4.  Utilidades IPv6                                       ║
 * ║    5.  Validaciones de formulario                            ║
 * ║    6.  Paso 1 — Infraestructura (selects)                    ║
 * ║    7.  Paso 2 — Análisis IPv4                                ║
 * ║    8.  Paso 3 — Servicios de red                             ║
 * ║    9.  Paso 4 — Plan y gestión de VLANs                      ║
 * ║   10.  Paso 4 — Render tarjetas VLAN                         ║
 * ║   11.  Paso 5 — Render tabla VLSM                            ║
 * ║   12.  Generador Cisco IOS/XE                                ║
 * ║   13.  Generador Huawei VRP                                  ║
 * ║   14.  Paso 6 — Exportar                                     ║
 * ║   15.  Navegación del wizard                                 ║
 * ║   16.  Panel lateral, toast y modal                          ║
 * ║   17.  Inicialización                                        ║
 * ╚══════════════════════════════════════════════════════════════╝
 */


/* ══════════════════════════════════════════════════════════════
   1. ESTADO GLOBAL
   Único punto de verdad para toda la aplicación.
   Los selects de pisos y core arrancan con valor válido (3 y 1)
   → corrige el bug donde S.pisos/S.core_piso eran null al inicio.
   ══════════════════════════════════════════════════════════════ */
const S = {
  /* Paso 1 */
  pisos:       3,           // siempre válido: initializado desde default del select
  core_piso:   1,           // siempre válido: initializado desde default del select
  hosts_piso:  null,        // único campo de paso 1 que requiere validación manual
  puertos:     48,          // 24 | 48 — viene del select, siempre válido
  redundancia: 'single',    // 'single' | 'dual'
  vendor:      'cisco',     // 'cisco' | 'huawei'

  /* Paso 1 — factor de crecimiento */
  growth_factor: 2,         // 1.5 | 2 | 3 — multiplicador sobre hosts totales

  /* Paso 2 */
  net:      null,           // resultado del análisis: { address, prefix, mask, ... }
  override: '',             // CIDR personalizado (vacío = usar automática)

  /* Paso 3 */
  dns4:        '8.8.8.8',
  dns6:        '2001:4860:4860::8888',
  ntp:         'pool.ntp.org',
  domain:      'corp.local',
  ipv6:        true,
  wan_nexthop: '',          // IPv4 del equipo de borde WAN (opcional)
  wan_routes:  [],          // CIDRs de redes remotas — rutas estáticas adicionales

  /* VLANs */
  vlan_defs: [],            // definiciones editables por el usuario
  vlans:     [],            // resultados VLSM calculados (incluye network, mask, etc.)
  ula_prefix: '',           // prefijo ULA /48 derivado de la red base

  /* UI */
  step:             0,
  export_vendor:    'cisco',   // tab activo en paso 6
  vlan_edit_id:     null,      // ID de VLAN siendo editada (null = nueva)
  reserve_expanded: {},        // mapa vlanId → boolean (sección IPs de reserva abierta)
};


/* ══════════════════════════════════════════════════════════════
   2. CONSTANTES
   ══════════════════════════════════════════════════════════════ */

/*
 * Plantillas de VLANs predeterminadas para entorno corporativo.
 *   hosts_factor: fracción del total de hosts para esa VLAN
 *   min_hosts:    mínimo garantizado independientemente del factor
 *   floor:        'all' = todos los pisos | 'core' = solo piso Core
 *   type / badge: afectan el estilo visual de la tarjeta
 */
const VLAN_TEMPLATES = [
  { id: 10, name: 'Usuarios',       type: 'users',   floor: 'all',  badge: 'blue',  hosts_factor: 0.70, min_hosts: 10 },
  { id: 20, name: 'Administración', type: 'admin',   floor: 'core', badge: 'green', hosts_factor: 0.10, min_hosts: 10 },
  { id: 30, name: 'Servidores',     type: 'servers', floor: 'core', badge: 'green', hosts_factor: 0.05, min_hosts: 20 },
  { id: 40, name: 'VoIP',           type: 'voip',    floor: 'all',  badge: 'blue',  hosts_factor: 0.30, min_hosts: 10 },
  { id: 50, name: 'WiFi-Invitados', type: 'wifi',    floor: 'all',  badge: 'purple',hosts_factor: 0.40, min_hosts: 10 },
  { id: 60, name: 'Gestión',        type: 'mgmt',    floor: 'all',  badge: 'amber', hosts_factor: 0.00, min_hosts: 0  },
];

/* Rangos RFC 1918 — se selecciona según el prefijo calculado */
const RFC1918 = [
  { network: '192.168.0.0', min_prefix: 16 },
  { network: '172.16.0.0',  min_prefix: 12 },
  { network: '10.0.0.0',    min_prefix:  1 },
];

/* Badge por tipo de VLAN — usado al crear una VLAN personalizada */
const TYPE_BADGE = {
  users: 'blue', admin: 'green', servers: 'green',
  voip: 'blue',  mgmt: 'amber', wifi: 'purple', custom: 'blue',
};


/* ══════════════════════════════════════════════════════════════
   3. UTILIDADES IPv4
   ══════════════════════════════════════════════════════════════ */

/** Convierte IP "x.x.x.x" → entero de 32 bits sin signo. */
function ipToInt(ip) {
  return ip.split('.').reduce((acc, o) => (acc << 8) + parseInt(o, 10), 0) >>> 0;
}

/** Convierte entero de 32 bits → IP "x.x.x.x". */
function intToIp(n) {
  return [(n>>>24)&255, (n>>>16)&255, (n>>>8)&255, n&255].join('.');
}

/** Devuelve la máscara de subred para un prefijo dado. */
function prefixToMask(prefix) {
  return intToIp(prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0);
}

/** Hosts utilizables (usables) para un prefijo dado. */
function usableHosts(prefix) {
  return Math.pow(2, 32 - prefix) - 2;
}

/**
 * Prefijo mínimo que cubre hostsRequired.
 * El +2 reserva dirección de red y broadcast desde el inicio.
 */
function minPrefix(hostsRequired) {
  return 32 - Math.ceil(Math.log2(hostsRequired + 2));
}

/** Selecciona el rango RFC 1918 adecuado según el prefijo. */
function selectBaseNetwork(prefix) {
  for (const r of RFC1918) {
    if (prefix >= r.min_prefix) return r.network;
  }
  return '10.0.0.0';
}

/**
 * Parsea y valida una cadena CIDR "x.x.x.x/n".
 * Devuelve { address, prefix } o null si es inválido.
 */
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

/**
 * Asigna subredes VLSM al array de VLANs.
 * Ordena de mayor a menor para minimizar fragmentación,
 * luego asigna secuencialmente desde baseAddress.
 * Modifica el array en su lugar añadiendo campos de red a cada VLAN.
 */
function allocateVLSM(baseAddress, vlans) {
  const sorted = [...vlans].sort((a, b) => b.hosts_required - a.hosts_required);
  let current  = ipToInt(baseAddress);

  for (const vlan of sorted) {
    const prefix    = minPrefix(vlan.hosts_required);
    const blockSize = Math.pow(2, 32 - prefix);

    /* Buscar el objeto original en el array para modificarlo */
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

/**
 * Deriva el prefijo ULA /48 desde la red IPv4 base.
 * Fórmula: fd + hex(oct1) + hex(oct2) : hex(oct3) + hex(oct4) + 00 :: /48
 * Ejemplo: 192.168.0.0 → fdc0:a800:0000::/48
 */
function calcULAPrefix(ipv4Address) {
  const p = ipv4Address.split('.').map(Number);
  const h = p.map(o => o.toString(16).padStart(2, '0'));
  return `fd${h[0]}:${h[1]}${h[2]}:${h[3]}00::/48`;
}

/**
 * Subred /64 para una VLAN dado el prefijo ULA /48.
 * Usa el ID de VLAN en hex de 4 dígitos como tercer grupo.
 * Ejemplo: VLAN 10 → fdc0:a800:0000:000a::/64
 */
function calcV6Subnet(ula48, vlanId) {
  const site    = ula48.replace('::/48', '');
  const vlanHex = vlanId.toString(16).padStart(4, '0');
  return `${site}:${vlanHex}::/64`;
}

/** Gateway IPv6 de una VLAN (::1 en la subred /64). */
function calcV6Gateway(ula48, vlanId) {
  const site    = ula48.replace('::/48', '');
  const vlanHex = vlanId.toString(16).padStart(4, '0');
  return `${site}:${vlanHex}::1`;
}


/* ══════════════════════════════════════════════════════════════
   5. VALIDACIONES DE FORMULARIO
   ══════════════════════════════════════════════════════════════ */

/** Bloquea e, E, +, - en inputs numéricos. */
function blockInvalidNumKeys(e) {
  if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
}

/** Añade/quita la clase .invalid a un campo por su ID. */
function setFieldValidity(fieldId, isValid) {
  document.getElementById(fieldId)?.classList.toggle('invalid', !isValid);
}

/** Regex IPv4 estricta: cada octeto 0–255. */
function isValidIPv4(str) {
  return /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/.test(str.trim());
}

/** Validación básica de IPv6: contiene ':' y solo hex/':'. */
function isValidIPv6(str) {
  const s = str.trim();
  if (!s.includes(':')) return false;
  if ((s.match(/::/g) || []).length > 1) return false;
  return /^[0-9a-fA-F:]+$/.test(s) && s.length >= 2;
}

/** IPv4 válida o hostname con al menos un punto (para NTP). */
function isValidIPv4orHostname(str) {
  const s = str.trim();
  if (isValidIPv4(s)) return true;
  return /^[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?)+$/.test(s);
}

/** Dominio interno: formato nombre.tld, sin espacios. */
function isValidDomain(str) {
  return /^[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?)+$/.test(str.trim());
}

/**
 * Valida todos los campos de un paso y habilita/deshabilita btn-next.
 * Retorna true si el paso es válido.
 *
 * CORRECCIÓN DEL BUG:
 *   Paso 0: S.pisos y S.core_piso son SIEMPRE válidos porque vienen de
 *   selects con valores por defecto. Solo se valida inp-hosts.
 *   Antes ambos eran null al inicio → botón bloqueado permanentemente.
 */
function validateStep(step) {
  let valid = false;

  if (step === 0) {
    /* pisos y core_piso siempre válidos (selects con default) */
    const hOk = S.hosts_piso !== null && S.hosts_piso >= 1 && S.hosts_piso <= 500;
    valid = hOk;
  }

  if (step === 1) {
    /* override vacío = válido; si tiene contenido debe ser CIDR correcto */
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

  /* Pasos 3, 4, 5: siempre habilitados */
  if (step >= 3) valid = true;

  const btn = document.getElementById('btn-next');
  if (btn) btn.disabled = !valid;
  return valid;
}


/* ══════════════════════════════════════════════════════════════
   6. PASO 1 — INFRAESTRUCTURA
   ══════════════════════════════════════════════════════════════ */

/** Activa un botón en un toggle-group y actualiza el estado. */
function selectToggle(groupId, btn) {
  document.querySelectorAll(`#${groupId} .toggle-btn`).forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const val = btn.dataset.value;
  if (groupId === 'tg-redund') {
    S.redundancia = val;
    setText('st-redund', val === 'single' ? 'Single-Link' : 'Dual-Link (LACP)');
  }
}

/** Selecciona vendor y actualiza estado + panel lateral. */
function selectVendor(btn) {
  document.querySelectorAll('#tg-vendor .vendor-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  S.vendor = btn.dataset.value;
  setText('st-vendor', btn.querySelector('.vendor-name').textContent);
}

/**
 * Actualiza S.pisos y regenera las opciones de sel-core.
 * Si el core actual supera los nuevos pisos, se resetea a 1.
 * También resetea vlan_defs para que se recalculen con los nuevos pisos.
 */
function onPisosChange() {
  S.pisos = parseInt(document.getElementById('sel-pisos').value, 10);

  /* Actualizar opciones de sel-core dinámicamente */
  const selCore  = document.getElementById('sel-core');
  const prev     = parseInt(selCore.value, 10);
  selCore.innerHTML = '';

  for (let i = 1; i <= S.pisos; i++) {
    const opt       = document.createElement('option');
    opt.value       = i;
    opt.textContent = i === 1 ? 'Piso 1 (recomendado)' : `Piso ${i}`;
    selCore.appendChild(opt);
  }

  /* Conservar valor anterior si aún es válido, de lo contrario piso 1 */
  selCore.value = prev <= S.pisos ? prev : 1;
  S.core_piso   = parseInt(selCore.value, 10);

  /* Resetear VLANs para que se recalculen con los nuevos pisos */
  S.vlan_defs = [];

  validateStep(0);
}

/** Actualiza S.core_piso cuando cambia el select de Core. */
function onCoreChange() {
  S.core_piso = parseInt(document.getElementById('sel-core').value, 10);
}

/**
 * Actualiza S.growth_factor al cambiar el selector de crecimiento.
 * Resetea vlan_defs para que se recalculen con el nuevo factor.
 */
function onGrowthChange() {
  S.growth_factor = parseFloat(document.getElementById('sel-growth').value);
  S.vlan_defs = [];            // fuerza recálculo de hosts por VLAN
  if (S.pisos && S.hosts_piso) runAnalysis();
  validateStep(0);
}

/**
 * Valida inp-hosts, calcula switches necesarios y actualiza el info-box.
 * Formula: Math.ceil(hosts / puertos)
 */
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
}


/* ══════════════════════════════════════════════════════════════
   7. PASO 2 — ANÁLISIS IPv4
   ══════════════════════════════════════════════════════════════ */

/**
 * Ejecuta el análisis de red usando los datos del Paso 1.
 * Se llama automáticamente al entrar al Paso 2.
 *
 * Fórmulas:
 *   total_hosts = hosts_piso × pisos
 *   hosts_plan  = total_hosts × growth_factor  (configurable 1.5 | 2 | 3)
 *   prefix      = 32 − ceil(log2(hosts_plan + 2))
 *   score       = round(hosts_plan / usable × 100)
 *   margin      = usable − hosts_plan
 */
function runAnalysis() {
  /* Guard: no calcular si el paso 1 está incompleto */
  if (!S.pisos || !S.hosts_piso) return;

  const totalHosts = S.hosts_piso * S.pisos;
  const hostsPlan  = Math.round(totalHosts * S.growth_factor);

  let prefix, baseAddress;

  if (S.override && parseCIDR(S.override)) {
    /* El usuario especificó una red CIDR personalizada */
    const parsed = parseCIDR(S.override);
    baseAddress  = parsed.address;
    prefix       = parsed.prefix;
  } else {
    /* Selección automática basada en el prefijo calculado */
    prefix      = minPrefix(hostsPlan);
    baseAddress = selectBaseNetwork(prefix);
  }

  const useful = usableHosts(prefix);
  const margin = useful - hostsPlan;
  const score  = Math.round((hostsPlan / useful) * 100);

  S.net = { address: baseAddress, prefix, mask: prefixToMask(prefix),
            hosts_plan: hostsPlan, hosts_total: totalHosts, useful, margin, score };

  /* Calcular prefijo ULA si IPv6 está activo */
  if (S.ipv6) {
    S.ula_prefix = calcULAPrefix(baseAddress);
    setText('ipv6-prefix', S.ula_prefix);
    setText('st-prefix', S.ula_prefix.replace('::/48', '…/48'));
  }

  /* Renderizar en el DOM */
  setText('res-network', `${baseAddress} / ${prefix}`);
  setText('res-mask',    `Máscara: ${prefixToMask(prefix)} — ${useful.toLocaleString()} hosts disponibles`);
  setText('res-planned', hostsPlan.toLocaleString());
  setText('res-margin',  margin.toLocaleString());
  setText('res-score',   score);

  /* Checklist */
  const isRFC = ['10.', '172.16', '192.168'].some(p => baseAddress.startsWith(p));
  toggleClass('chk-rfc',    'ok', isRFC);
  toggleClass('chk-scale',  'ok', margin > 0);
  toggleClass('chk-vlsm',   'ok', true);
  toggleClass('chk-redund', 'ok', true);

  /* Panel lateral */
  setText('st-network', `${baseAddress}/${prefix}`);
  setText('st-hosts',   `${hostsPlan.toLocaleString()} (${S.growth_factor}×)`);
  setText('st-hosts-lbl', `Hosts (${S.growth_factor}×)`);
  setText('res-planned-lbl', `hosts planificados (${S.growth_factor}×)`);
  setText('st-score',   score);
}

/** Valida el campo override CIDR y re-ejecuta el análisis. */
function onOverrideChange() {
  const val = document.getElementById('inp-override')?.value?.trim() || '';
  S.override = val;
  setFieldValidity('field-override', val === '' || parseCIDR(val) !== null);
  if (S.pisos && S.hosts_piso) runAnalysis();
  validateStep(1);
}


/* ══════════════════════════════════════════════════════════════
   8. PASO 3 — SERVICIOS DE RED
   ══════════════════════════════════════════════════════════════ */

/** Valida todos los campos de servicios y actualiza el estado. */
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
}

/** Muestra u oculta el bloque de info IPv6. */
function onIPv6Toggle(cb) {
  S.ipv6 = cb.checked;
  document.getElementById('ipv6-info')?.classList.toggle('hidden', !S.ipv6);
  if (S.ipv6 && S.net) {
    S.ula_prefix = calcULAPrefix(S.net.address);
    setText('ipv6-prefix', S.ula_prefix);
    setText('st-prefix', S.ula_prefix.replace('::/48', '…/48'));
  }
}

/**
 * Valida los campos WAN opcionales y actualiza el estado.
 * · wan_nexthop: IPv4 válida o vacío
 * · wan_routes:  cada línea no vacía debe ser CIDR válido (/8–/30)
 */
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
}


/* ══════════════════════════════════════════════════════════════
   9. PASO 4 — PLAN Y GESTIÓN DE VLANs
   ══════════════════════════════════════════════════════════════ */

/**
 * Inicializa S.vlan_defs desde VLAN_TEMPLATES usando los datos
 * actuales de pisos y hosts. Solo se ejecuta si vlan_defs está vacío.
 */
function initVlanDefs() {
  if (S.vlan_defs.length > 0) return;

  const totalHosts = S.hosts_piso * S.pisos;
  const swPerFloor  = Math.ceil(S.hosts_piso / S.puertos);
  const apsPerFloor  = Math.ceil(S.hosts_piso / 30); // 1 AP c/30 usuarios (estándar IEEE)
  const mgmtDevices  = swPerFloor * S.pisos + apsPerFloor * S.pisos + 3; // SW + APs + core + FW

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

/** Devuelve el texto de piso según la definición de floor. */
function calcFloorLabel(floor) {
  if (floor === 'all')  return S.pisos === 1 ? `Piso ${S.core_piso}` : `Pisos 1–${S.pisos}`;
  if (floor === 'core') return `Piso ${S.core_piso} (CPD)`;
  return `Piso ${floor}`;
}

/**
 * Construye S.vlans desde S.vlan_defs:
 *   1. Aplica VLSM (asigna network, mask, gateway, broadcast, etc.)
 *   2. Calcula subredes IPv6 si está activo.
 */
function buildVLANPlan() {
  if (!S.net || !S.pisos || !S.hosts_piso) return;

  initVlanDefs();

  /* Crear copia con floor_label para el render */
  S.vlans = S.vlan_defs.map(d => ({
    ...d,
    floor_label:  calcFloorLabel(d.floor),
    reserved_ips: d.reserved_ips || [],   // preservar reservas existentes
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

/* ── Funciones de gestión de VLANs ──────────────────────────── */

/** Muestra el formulario en modo "agregar nueva VLAN". */
function showAddVlanForm() {
  S.vlan_edit_id = null;
  setText('vlan-form-title', 'Nueva VLAN');

  /* Limpiar campos */
  ['inp-vid', 'inp-vname', 'inp-vhosts'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; el.disabled = false; }
  });
  document.getElementById('sel-vtype').value  = 'users';
  document.getElementById('sel-vfloor').value = 'all';

  /* Limpiar validaciones */
  ['field-vid', 'field-vname', 'field-vhosts'].forEach(id =>
    document.getElementById(id)?.classList.remove('invalid')
  );

  document.getElementById('btn-save-vlan').disabled = true;
  document.getElementById('vlan-form').classList.remove('hidden');
  document.getElementById('vlan-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/** Muestra el formulario en modo "editar VLAN existente". */
function editVlan(id) {
  const vlan = S.vlan_defs.find(v => v.id === id);
  if (!vlan) return;

  S.vlan_edit_id = id;
  setText('vlan-form-title', `Editar VLAN ${id} — ${vlan.name}`);

  document.getElementById('inp-vid').value    = vlan.id;
  document.getElementById('inp-vid').disabled = true; /* ID no se puede cambiar al editar */
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

/** Elimina una VLAN del plan y recalcula. */
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
}

/** Cierra el formulario sin guardar. */
function cancelVlanEdit() {
  document.getElementById('vlan-form').classList.add('hidden');
  S.vlan_edit_id = null;
}

/**
 * Valida el formulario de VLAN en tiempo real.
 * Habilita/deshabilita el botón "Guardar VLAN".
 */
function validateVlanForm() {
  const idEl    = document.getElementById('inp-vid');
  const nameEl  = document.getElementById('inp-vname');
  const hostsEl = document.getElementById('inp-vhosts');

  const id    = parseInt(idEl?.value, 10);
  const name  = nameEl?.value?.trim() || '';
  const hosts = parseInt(hostsEl?.value, 10);

  /* ID: 1–4094, único (excepto al editar el propio ID) */
  const idExists = S.vlan_defs.some(v => v.id === id && v.id !== S.vlan_edit_id);
  const idOk     = !isNaN(id) && id >= 1 && id <= 4094 && !idExists;

  /* Nombre: letras, números, guion, máx. 20 caracteres */
  const nameOk   = /^[a-zA-ZáéíóúÁÉÍÓÚñÑ0-9_\-]{1,20}$/.test(name);

  /* Hosts: 2–500 */
  const hostsOk  = !isNaN(hosts) && hosts >= 2 && hosts <= 500;

  /* No mostrar error en campos vacíos al inicio */
  const idTouched    = idEl?.value    !== '';
  const nameTouched  = nameEl?.value  !== '';
  const hostsTouched = hostsEl?.value !== '';

  setFieldValidity('field-vid',    idOk    || !idTouched);
  setFieldValidity('field-vname',  nameOk  || !nameTouched);
  setFieldValidity('field-vhosts', hostsOk || !hostsTouched);

  document.getElementById('btn-save-vlan').disabled = !(idOk && nameOk && hostsOk);
}

/**
 * Guarda la VLAN (nueva o editada) en S.vlan_defs y recalcula el plan.
 */
function saveVlan() {
  const id    = parseInt(document.getElementById('inp-vid').value, 10);
  const name  = document.getElementById('inp-vname').value.trim();
  const hosts = parseInt(document.getElementById('inp-vhosts').value, 10);
  const type  = document.getElementById('sel-vtype').value;
  const floor = document.getElementById('sel-vfloor').value;
  const badge = TYPE_BADGE[type] || 'blue';

  if (S.vlan_edit_id !== null) {
    /* Editar VLAN existente */
    const idx = S.vlan_defs.findIndex(v => v.id === S.vlan_edit_id);
    if (idx !== -1) {
      S.vlan_defs[idx] = { ...S.vlan_defs[idx], name, hosts_required: hosts, type, floor, badge };
    }
    showToast(`VLAN ${S.vlan_edit_id} actualizada`, 'success');
  } else {
    /* Agregar nueva VLAN */
    S.vlan_defs.push({ id, name, type, floor, badge, hosts_required: hosts, reserved_ips: [] });
    S.vlan_defs.sort((a, b) => a.id - b.id); /* mantener orden por ID */
    showToast(`VLAN ${id} agregada`, 'success');
  }

  cancelVlanEdit();
  buildVLANPlan();
  renderVLANCards();
  updateVlansCount();
}

/** Actualiza el contador de VLANs en la barra de herramientas. */
function updateVlansCount() {
  const n = S.vlan_defs.length;
  setText('vlans-count', `${n} VLAN${n !== 1 ? 's' : ''}`);
}


/* ══════════════════════════════════════════════════════════════
   10. PASO 4 — RENDER TARJETAS VLAN
   ══════════════════════════════════════════════════════════════ */

/** Genera y renderiza las tarjetas de VLAN con botones editar/eliminar. */
function renderVLANCards() {
  const container = document.getElementById('vlans-container');
  if (!container) return;

  if (!S.vlans.length) {
    container.innerHTML = '<p class="placeholder-msg">Completa los pasos anteriores para generar las VLANs</p>';
    return;
  }

  container.innerHTML = S.vlans.map(v => {
    /* ── Indicador de desbordamiento: hosts > promedio por piso ── */
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

/** Escapa HTML para evitar XSS en alias de usuarios. */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Genera un ID único para una reserva. */
function genResId() {
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

/**
 * Siguiente IPv4 libre en el rango reservado (.2 – .10) de la VLAN.
 * Retorna string de IP o '' si el rango está lleno.
 */
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

/**
 * Siguiente IPv6 libre en el rango reservado (::2 – ::10) de la VLAN.
 * Retorna string de IPv6 o '' si IPv6 está desactivado o el rango está lleno.
 */
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

/**
 * Valida que una IPv4 sea válida y esté dentro del rango .2–.10 de la VLAN.
 * @param {string} ip4
 * @param {number} vlanId
 * @param {string|null} excludeResId  — ID de reserva a excluir de la comprobación de duplicados
 */
function isValidReservedIP4(ip4, vlanId, excludeResId = null) {
  const vlan = S.vlans.find(v => v.id === vlanId);
  if (!vlan || !isValidIPv4(ip4)) return false;
  const ipInt = ipToInt(ip4);
  const gwInt = ipToInt(vlan.gateway_v4);
  if (ipInt < gwInt + 1 || ipInt > gwInt + 9) return false;   // rango .2–.10
  const used = (vlan.reserved_ips || [])
    .filter(r => r.id !== excludeResId)
    .map(r => r.ip4).filter(Boolean).map(ipToInt);
  return !used.includes(ipInt);
}

/**
 * Valida que una IPv6 sea válida, no sea la gateway (::1) y no esté duplicada.
 */
function isValidReservedIP6(ip6, vlanId, excludeResId = null) {
  const vlan = S.vlans.find(v => v.id === vlanId);
  if (!vlan || !isValidIPv6(ip6)) return false;
  if (ip6.trim() === vlan.gateway_v6) return false;           // no puede ser ::1
  const used = (vlan.reserved_ips || [])
    .filter(r => r.id !== excludeResId)
    .map(r => r.ip6).filter(Boolean);
  return !used.includes(ip6.trim());
}

/**
 * Genera el HTML de la sección de IPs de reserva para una tarjeta VLAN.
 */
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

  /* ── Tabla de reservas existentes ── */
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

  /* ── Formulario de agregar reserva ── */
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

/** Alterna la visibilidad de la sección de reservas de una VLAN. */
function toggleReserveSection(vlanId) {
  S.reserve_expanded[vlanId] = !S.reserve_expanded[vlanId];
  const body  = document.getElementById(`reserve-body-${vlanId}`);
  const arrow = document.querySelector(`[onclick="toggleReserveSection(${vlanId})"] .reserve-arrow`);
  if (body)  body.classList.toggle('hidden', !S.reserve_expanded[vlanId]);
  if (arrow) arrow.classList.toggle('open', S.reserve_expanded[vlanId]);
}

/** Muestra el formulario de agregar reserva para una VLAN. */
function showReserveForm(vlanId) {
  const form   = document.getElementById(`reserve-form-${vlanId}`);
  const addBtn = document.getElementById(`btn-add-reserve-${vlanId}`);
  if (!form) return;

  /* Limpiar campos */
  const aliasEl = document.getElementById(`inp-res-alias-${vlanId}`);
  const ip4El   = document.getElementById(`inp-res-ip4-${vlanId}`);
  const ip6El   = document.getElementById(`inp-res-ip6-${vlanId}`);
  const stackEl = document.getElementById(`sel-res-stack-${vlanId}`);
  if (aliasEl) aliasEl.value = '';
  if (ip4El)   ip4El.value   = getNextReservedIP4(vlanId);
  if (ip6El)   ip6El.value   = getNextReservedIP6(vlanId);
  if (stackEl) stackEl.value = 'ipv4';

  /* Limpiar validaciones previas */
  [`field-res-alias-${vlanId}`, `field-res-ip4-${vlanId}`, `field-res-ip6-${vlanId}`]
    .forEach(id => document.getElementById(id)?.classList.remove('invalid'));

  onReserveStackChange(vlanId);   /* ajusta visibilidad IPv4/IPv6 según stack */

  const saveBtn = document.getElementById(`btn-save-res-${vlanId}`);
  if (saveBtn) saveBtn.disabled = true;

  form.classList.remove('hidden');
  if (addBtn) addBtn.classList.add('hidden');
}

/** Cierra el formulario de agregar reserva sin guardar. */
function cancelReserveForm(vlanId) {
  document.getElementById(`reserve-form-${vlanId}`)?.classList.add('hidden');
  document.getElementById(`btn-add-reserve-${vlanId}`)?.classList.remove('hidden');
}

/**
 * Actualiza visibilidad de campos IPv4/IPv6 según el tipo de stack seleccionado.
 * · ipv4 → solo muestra IPv4
 * · ipv6 → solo muestra IPv6
 * · dual → muestra ambos
 */
function onReserveStackChange(vlanId) {
  const stack   = document.getElementById(`sel-res-stack-${vlanId}`)?.value || 'ipv4';
  const ip4Fld  = document.getElementById(`field-res-ip4-${vlanId}`);
  const ip6Fld  = document.getElementById(`field-res-ip6-${vlanId}`);

  if (ip4Fld) ip4Fld.classList.toggle('hidden', stack === 'ipv6');
  if (ip6Fld) ip6Fld.classList.toggle('hidden', stack === 'ipv4');

  /* Limpiar estado de error al cambiar stack */
  if (stack === 'ipv6') document.getElementById(`field-res-ip4-${vlanId}`)?.classList.remove('invalid');
  if (stack === 'ipv4') document.getElementById(`field-res-ip6-${vlanId}`)?.classList.remove('invalid');

  validateReserveForm(vlanId);
}

/**
 * Valida el formulario de reserva en tiempo real.
 * Habilita / deshabilita "Guardar reserva".
 */
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

  /* Marcar error solo si el campo fue tocado */
  const aliasTouched = (aliasEl?.value || '') !== '';
  const ip4Touched   = (ip4El?.value   || '') !== '';
  const ip6Touched   = (ip6El?.value   || '') !== '';

  setFieldValidity(`field-res-alias-${vlanId}`, aliasOk  || !aliasTouched);
  if (needsIP4) setFieldValidity(`field-res-ip4-${vlanId}`, ip4Ok || !ip4Touched);
  if (needsIP6) setFieldValidity(`field-res-ip6-${vlanId}`, ip6Ok || !ip6Touched);

  if (saveBtn) saveBtn.disabled = !(aliasOk && ip4Ok && ip6Ok);
}

/**
 * Guarda una nueva reserva en S.vlan_defs y recalcula las tarjetas.
 */
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

  S.reserve_expanded[vlanId] = true;   // mantener sección abierta
  buildVLANPlan();
  renderVLANCards();
  updateVlansCount();
  showToast(`Reserva "${alias}" agregada a VLAN ${vlanId}`, 'success');
}

/**
 * Elimina una reserva específica de una VLAN.
 */
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
}



/** Rellena la tabla VLSM y las métricas globales. */
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
    </tr>
  `).join('');

  /* Renderizar topología SVG inline en el paso 5 */
  const topo = document.getElementById('topo-preview');
  if (topo) topo.innerHTML = generateTopologySVG();
}


/* ══════════════════════════════════════════════════════════════
   HELPERS COMPARTIDOS — GENERADORES DE CONFIGURACIÓN
   ══════════════════════════════════════════════════════════════ */

/**
 * Genera el bloque de comentario para VLANs WiFi en cualquier vendor.
 * @param {object} v  — objeto VLAN
 * @param {string} cm — prefijo de comentario ('!' o '#')
 */
function buildWifiComment(v, cm) {
  if (v.type !== 'wifi') return '';
  return `${cm} ─── NOTA WiFi — VLAN ${v.id} (${v.name}) ────────────────────────────
` +
         `${cm} La configuración del AP/Controlador inalámbrico (SSID, WPA3,
` +
         `${cm} bandas 2.4/5 GHz, portal cautivo) se realiza desde la GUI del vendor.
` +
         `${cm} Vendors: Cisco Meraki/Catalyst · Huawei AirEngine · Aruba · Ubiquiti
` +
         `${cm} IP Gateway/AP VLAN ${v.id}: ${v.gateway_v4}  |  IPv6: ${v.gateway_v6||'—'}
${cm}
`;
}

/**
 * Genera rutas estáticas WAN adicionales si el usuario las definió.
 * @param {string} vendor — 'cisco' | 'huawei'
 */
function buildWanRoutes(vendor) {
  if (!S.wan_nexthop || !S.wan_routes.length) return '';
  const cm = vendor === 'cisco' ? '!' : '#';
  let c = `${cm} ─── Rutas estáticas — Redes remotas / WAN ─────────────────
`;
  S.wan_routes.forEach(r => {
    const p = parseCIDR(r);
    if (!p) return;
    c += vendor === 'cisco'
      ? `ip route ${p.address} ${prefixToMask(p.prefix)} ${S.wan_nexthop}
`
      : `ip route-static ${p.address} ${prefixToMask(p.prefix)} ${S.wan_nexthop}
`;
  });
  return c + `${cm}
`;
}

/* ══════════════════════════════════════════════════════════════
   12. GENERADOR CISCO IOS/XE
   Cubre: Core Switch L3 (Catalyst) + rutas estáticas IPv4/IPv6
          + pools DHCP IPv4 + pools DHCPv6 Stateless
   ══════════════════════════════════════════════════════════════ */

/** IP del firewall: segunda IP usable de VLAN 60 (Gestión). */
function getFWip() {
  const v60 = S.vlans.find(v => v.id === 60);
  return v60 ? intToIp(ipToInt(v60.gateway_v4) + 1) : '(IP_FIREWALL)';
}

/** IPv6 del firewall: segunda IP en VLAN 60. */
function getFWv6ip() {
  const v60 = S.vlans.find(v => v.id === 60);
  return v60?.gateway_v6 ? v60.gateway_v6.replace('::1', '::2') : '(FW_IPV6)';
}

function generateCiscoConfig() {
  const fw  = getFWip();
  const fwV6 = S.ipv6 ? getFWv6ip() : null;

  let c = `! ════════════════════════════════════════════════════════════
! NetPlan Pro v4.0 — Cisco IOS/XE — CORE-SW-01
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

  /* ── IPs de reserva: pools estáticos por VLAN ── */
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
          c += `! Asignar manualmente en el dispositivo o via DHCPv6 stateful (requiere configuración adicional)\n!\n`;
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
  }

  c += `! ─── Puertos de acceso por piso ─────────────────────────────\n`;
  for (let floor = 1; floor <= S.pisos; floor++) {
    c += `! Piso ${floor}${floor === S.core_piso ? ' — Core/CPD' : ''}\n`;
    c += `interface range GigabitEthernet0/1 - ${S.puertos - 2}\n`;
    c += ` description Acceso-Piso${floor}\n`;
    c += ` switchport mode access\n`;
    c += ` switchport access vlan 10\n`;
    c += ` switchport voice vlan 40\n`;
    c += ` spanning-tree portfast\n no shutdown\n!\n`;
  }

  c += `! ─── Firewall Cisco ASA/Firepower — FW-01 ───────────────────\n`;
  c += `! (Configuración de referencia — adaptar según el modelo)\n!\n`;
  c += `! hostname FW-01\n`;
  c += `! interface GigabitEthernet0/0\n`;
  c += `!  nameif outside\n`;
  c += `!  security-level 0\n`;
  c += `!  ip address dhcp setroute\n`;
  c += `!\n`;
  c += `! interface GigabitEthernet0/1\n`;
  c += `!  nameif inside\n`;
  c += `!  security-level 100\n`;
  c += `!  ip address ${getFWip()} ${S.vlans.find(v=>v.id===60)?.mask || '255.255.255.0'}\n`;
  c += `!\n`;
  S.vlans.forEach(v => {
    c += `! access-list INSIDE_OUT extended permit ip ${v.network} ${v.mask} any\n`;
  });
  c += `! nat (inside,outside) dynamic interface\n!\n`;

  return c;
}


/* ══════════════════════════════════════════════════════════════
   13. GENERADOR HUAWEI VRP
   Cubre: Core Switch (S-series) + rutas estáticas IPv4/IPv6
          + pools DHCP IPv4 + pools DHCPv6 Stateless
   ══════════════════════════════════════════════════════════════ */

function generateHuaweiConfig() {
  const fw  = getFWip();
  const fwV6 = S.ipv6 ? getFWv6ip() : null;
  const vlanIds = S.vlans.map(v => v.id).join(' ');

  let c = `# ════════════════════════════════════════════════════════════
# NetPlan Pro v4.0 — Huawei VRP — CORE-SW-01
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

  /* ── IPs de reserva: static-bind por VLAN ── */
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
    c += `interface Eth-Trunk1\n description Uplink-LACP-FW-01\n mode lacp-static\n#\n`;
    c += `interface GigabitEthernet0/0/47\n eth-trunk 1\n#\n`;
    c += `interface GigabitEthernet0/0/48\n eth-trunk 1\n#\n`;
  }

  c += `# ─── Firewall Huawei USG — FW-01 ────────────────────────────\n`;
  c += `# (Configuración de referencia — adaptar según el modelo)\n#\n`;
  c += `# sysname FW-01\n`;
  c += `# #\n`;
  c += `# interface GigabitEthernet0/0/1\n`;
  c += `#  alias "WAN"\n`;
  c += `#  ip address dhcp-alloc\n`;
  c += `# #\n`;
  c += `# interface GigabitEthernet0/0/0\n`;
  c += `#  alias "LAN-Core"\n`;
  c += `#  ip address ${getFWip()} ${S.vlans.find(v=>v.id===60)?.mask || '255.255.255.0'}\n`;
  c += `# #\n`;
  S.vlans.forEach(v => {
    c += `# ip route-static ${v.network} ${v.mask} ${v.gateway_v4}\n`;
  });
  c += `# #\n`;

  return c;
}



/* ══════════════════════════════════════════════════════════════
   13b. GENERADOR FORTINET FortiOS (FortiGate — Firewall perimetral)
   Propósito: configurar el FortiGate como firewall perimetral de borde.
   NO genera config de switch — ese rol lo hace el Core Switch (Cisco/Huawei).
   Cubre:
     · Interfaces internas por VLAN (subinterfaces sobre port interno)
     · Políticas de firewall: LAN → WAN (permiso de salida a Internet)
     · NAT de origen (masquerading) para cada subred
     · Servidor DHCP por VLAN (respaldo o principal según topología)
     · Rutas estáticas hacia el Core Switch para cada subred interna
     · Configuración DNS y NTP del equipo
   ══════════════════════════════════════════════════════════════ */
function generateFortinetConfig() {
  const coreIP = getCoreIP();

  let c = `# ════════════════════════════════════════════════════════════
# NetPlan Pro v4.0 — Fortinet FortiOS — FG-CORP-01
# Rol: Firewall perimetral (FortiGate)
# NOTA: Esta configuración es para el FIREWALL, no para el switch.
#       El routing entre VLANs lo hace el Core Switch (Cisco/Huawei).
# Generado automáticamente — verificar antes de aplicar en producción
# ════════════════════════════════════════════════════════════
#
config system global
    set hostname FG-CORP-01
    set timezone 12
    set admintimeout 30
end
#
config system dns
    set primary ${S.dns4}
    set secondary 8.8.4.4
end
#
config system ntp
    set type custom
    config ntpserver
        edit 1
            set server "${S.ntp}"
        next
    end
    set ntpsync enable
end
#
# ─── Interfaces internas: subinterfaces por VLAN ─────────────
# Cada VLAN aparece como subinterfaz de la interfaz que conecta al Core.
# La IP es la segunda usable de la VLAN (la primera es el gateway del Core).
#
`;

  S.vlans.forEach((v, i) => {
    const fwIp = intToIp(ipToInt(v.gateway_v4) + 1);
    c += `config system interface
`;
    c += `    edit "lan-vlan${v.id}"
`;
    c += `        set vdom "root"
`;
    c += `        set mode static
`;
    c += `        set ip ${fwIp} ${v.mask}
`;
    c += `        set allowaccess ping
`;
    c += `        set interface "internal1"
`;
    c += `        set vlanid ${v.id}
`;
    c += `        set alias "${v.name} — ${v.floor_label}"
`;
    if (S.ipv6 && v.gateway_v6) {
      const fwV6 = v.gateway_v6.replace('::1', '::2');
      c += `        config ipv6
`;
      c += `            set ip6-address ${fwV6}/64
`;
      c += `            set ip6-allowaccess ping
`;
      c += `        end
`;
    }
    c += `    next
end
#
`;
  });

  c += `# ─── Rutas estáticas: FW → Core Switch por cada subred ──────
# El tráfico interno entre VLANs va al Core Switch, NO pasa por el FW.
#
`;
  S.vlans.forEach((v, i) => {
    c += `config router static
    edit ${i + 1}
`;
    c += `        set dst ${v.network} ${v.mask}
`;
    c += `        set gateway ${v.gateway_v4}
`;
    c += `        set device "internal1"
    next
end
#
`;
  });

  c += `# ─── Políticas de firewall: LAN → WAN (salida a Internet) ───
# Una política por VLAN permite el tráfico de salida con NAT.
#
`;
  S.vlans.forEach((v, i) => {
    c += `config firewall policy
    edit ${i + 1}
`;
    c += `        set name "${v.name}-to-WAN"
`;
    c += `        set srcintf "lan-vlan${v.id}"
`;
    c += `        set dstintf "wan1"
`;
    c += `        set srcaddr "all"
`;
    c += `        set dstaddr "all"
`;
    c += `        set action accept
`;
    c += `        set schedule "always"
`;
    c += `        set service "ALL"
`;
    c += `        set nat enable
    next
end
#
`;
  });

  c += `# ─── DHCP Relay: reenviar solicitudes al Core Switch ─────────
# El Core Switch es el servidor DHCP real.
# El FW actúa como relay para cada VLAN.
#
`;
  S.vlans.forEach(v => {
    const fwIp = intToIp(ipToInt(v.gateway_v4) + 1);
    c += `config system dhcp server
`;
    c += `    edit 0
`;
    c += `        set dns-server1 ${S.dns4}
`;
    c += `        set default-gateway ${fwIp}
`;
    c += `        set netmask ${v.mask}
`;
    c += `        set interface "lan-vlan${v.id}"
`;
    c += `        set dns-service default
`;
    c += `        set domain ${S.domain}
`;
    c += `        config ip-range
            edit 1
`;
    const poolStart = intToIp(ipToInt(v.gateway_v4) + 10);
    const poolEnd   = intToIp(ipToInt(v.broadcast) - 1);
    c += `                set start-ip ${poolStart}
                set end-ip ${poolEnd}
`;
    c += `            next
        end
`;
    /* Reservas como IP reservadas dentro del pool DHCP de FortiGate */
    const rips = (v.reserved_ips || []).filter(r => r.ip4);
    if (rips.length > 0) {
      c += `        config reserved-address
`;
      rips.forEach((r, idx) => {
        c += `            edit ${idx + 1}
                set ip ${r.ip4}
                set mac XX:XX:XX:XX:XX:XX
                set description "${r.alias}"
                set action reserved
            next
`;
      });
      c += `        end
`;
    }
    c += `    next
end
#
`;
  });

  /* IPv6 reservas — comentario informativo */
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

/** IP del Core Switch: gateway de VLAN 60. */
function getCoreIP() {
  const v60 = S.vlans.find(v => v.id === 60);
  return v60 ? v60.gateway_v4 : '(IP_CORE)';
}

/* ══════════════════════════════════════════════════════════════
   14. PASO 6 — EXPORTAR
   ── Funciones:
      selectExportTab()     selecciona tab de vendor
      renderExportCode()    muestra config en pantalla
      copyCode()            copia al portapapeles
      generateRollback()    genera borrado seguro por vendor
      generateTopologySVG() genera topología lógica SVG
      buildExportHTML()     ensambla HTML completo del plan
      downloadPlan()        descarga HTML autocontenido
   ══════════════════════════════════════════════════════════════ */

/** Selecciona el tab de exportación y renderiza el código. */
function selectExportTab(btn) {
  document.querySelectorAll('.export-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  S.export_vendor = btn.dataset.vendor;
  renderExportCode();
}

/** Genera y muestra la config del vendor activo en el área de código. */
function renderExportCode() {
  const codeEl = document.getElementById('export-code');
  if (!codeEl) return;
  const map = {
    cisco:    generateCiscoConfig,
    huawei:   generateHuaweiConfig,
    fortinet: generateFortinetConfig,
    rollback: generateRollback,   // borrado seguro del vendor con más reciente selección
  };
  codeEl.textContent = (map[S.export_vendor] || (() => '— Selecciona un vendor —'))();
}

/** Copia el contenido visible al portapapeles. */
function copyCode() {
  const el = document.getElementById('export-code');
  if (!el) return;
  navigator.clipboard.writeText(el.textContent)
    .then(() => showToast('Configuración copiada al portapapeles', 'success'))
    .catch(() => showToast('No se pudo copiar', 'error'));
}

/* ── BORRADO SEGURO (rollback inverso) ──────────────────────────
   Genera los comandos exactos inversos de la configuración aplicada.
   NO toca la imagen IOS/VRP/FortiOS — solo deshace la config de red.
   ─────────────────────────────────────────────────────────────── */

/**
 * Genera el borrado seguro según el vendor activo.
 * Estrategia: comandos "no/undo/delete" en orden inverso al de aplicación.
 */
function generateRollback() {
  switch (S.export_vendor) {
    case 'cisco':    return generateRollbackCisco();
    case 'huawei':   return generateRollbackHuawei();
    case 'fortinet': return generateRollbackFortinet();
    default:         return '— Selecciona un vendor —';
  }
}

function generateRollbackCisco() {
  const fw = getFWip();
  let c = `! ════════════════════════════════════════════════════════════
! NetPlan Pro v4.0 — BORRADO SEGURO — Cisco IOS/XE — CORE-SW-01
! ADVERTENCIA: Aplica SOLO si deseas deshacer el plan completo.
! Esta config NO borra la imagen IOS ni el sistema operativo.
! Ejecutar en modo configuración: conf t
! ════════════════════════════════════════════════════════════
!\n`;

  // 1. Rutas estáticas
  c += `! ─── Eliminar rutas estáticas ───────────────────────────────\n`;
  c += `no ip route 0.0.0.0 0.0.0.0 ${fw}\n`;
  if (S.ipv6) c += `no ipv6 route ::/0\n`;
  S.wan_routes.forEach(r => {
    const p = parseCIDR(r);
    if (p) c += `no ip route ${p.address} ${prefixToMask(p.prefix)} ${S.wan_nexthop||'(next-hop)'}\n`;
  });
  c += `!\n`;

  // 2. Pools DHCP
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

  // 3. DHCPv6
  if (S.ipv6) {
    c += `! ─── Eliminar pools DHCPv6 ──────────────────────────────────\n`;
    S.vlans.forEach(v => c += `no ipv6 dhcp pool VLAN${v.id}-v6\n`);
    c += `!\n`;
  }

  // 4. SVIs
  c += `! ─── Eliminar SVIs (interfaces VLAN L3) ─────────────────────\n`;
  [...S.vlans].reverse().forEach(v => {
    c += `interface Vlan${v.id}\n no ip address\n`;
    if (S.ipv6) c += ` no ipv6 address\n no ipv6 nd other-config-flag\n`;
    c += ` shutdown\n!\n`;
    c += `no interface Vlan${v.id}\n!\n`;
  });

  // 5. VLANs
  c += `! ─── Eliminar VLANs ─────────────────────────────────────────\n`;
  S.vlans.forEach(v => c += `no vlan ${v.id}\n`);
  c += `!\n`;

  // 6. LACP si aplica
  if (S.redundancia === 'dual') {
    c += `! ─── Deshacer Dual-Link LACP ────────────────────────────────\n`;
    c += `no interface Port-channel1\n`;
    c += `interface GigabitEthernet1/0/47\n no channel-group\n!\n`;
    c += `interface GigabitEthernet1/0/48\n no channel-group\n!\n`;
  }

  // 7. Limpiar startup-config
  c += `! ─── Limpiar configuración guardada ────────────────────────\n`;
  c += `! (Opcional) Para dejar el equipo sin configuración guardada:\n`;
  c += `! write erase\n! reload\n`;
  return c;
}

function generateRollbackHuawei() {
  const fw = getFWip();
  let c = `# ════════════════════════════════════════════════════════════
# NetPlan Pro v4.0 — BORRADO SEGURO — Huawei VRP — CORE-SW-01
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
# NetPlan Pro v4.0 — BORRADO SEGURO — FortiGate — FG-CORP-01
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

/* ── TOPOLOGÍA SVG ───────────────────────────────────────────────
   Genera diagrama lógico jerárquico: FW → Core → Access Switches
   con etiquetas de VLANs y direcciones IP. Sin dependencias externas.
   ─────────────────────────────────────────────────────────────── */

/**
 * Genera un SVG de topología lógica con los datos del plan actual.
 * Layout: Internet → Firewall → Core Switch → Switch por piso (columnas)
 */
function generateTopologySVG() {
  if (!S.vlans.length) return '<svg xmlns="http://www.w3.org/2000/svg"></svg>';

  const pisos     = S.pisos;
  const colW      = 180;       // ancho por columna (piso)
  const margin    = 40;
  const svgW      = Math.max(700, margin * 2 + colW * pisos);
  const svgH      = 560;

  // Coordenadas de los nodos principales
  const cx    = svgW / 2;
  const inetY = 60,  fwY = 150, coreY = 260;
  const swY   = 390, vlanY = 480;

  // Colores coherentes con la paleta de la app
  const CLR = { accent:'#1a6fc4', ok:'#1a7a4a', warn:'#875a00',
                border:'#d1dae6', text:'#1a2332', muted:'#718096',
                bg:'#f7f9fb', panel:'#ffffff', purple:'#7c3aed', voip:'#0891b2' };

  const TYPE_CLR = { users:CLR.accent, admin:CLR.ok, servers:CLR.purple,
                     voip:CLR.voip, wifi:CLR.purple, mgmt:CLR.warn, custom:CLR.muted };

  // Helper: rectángulo con texto centrado
  function node(x, y, w, h, fill, stroke, label, sub='', r=8) {
    return `<rect x="${x-w/2}" y="${y-h/2}" width="${w}" height="${h}" rx="${r}"
      fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
      <text x="${x}" y="${y-4}" text-anchor="middle" font-family="'DM Mono',monospace"
        font-size="11" font-weight="600" fill="${CLR.text}">${escHtml(label)}</text>
      ${sub ? `<text x="${x}" y="${y+11}" text-anchor="middle" font-family="monospace"
        font-size="9.5" fill="${CLR.muted}">${escHtml(sub)}</text>` : ''}`;
  }

  // Helper: línea
  function line(x1,y1,x2,y2,dash='') {
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
      stroke="${CLR.border}" stroke-width="1.5" ${dash?`stroke-dasharray="${dash}"`:''} marker-end="url(#arr)"/>`;
  }

  // Posiciones de switches por piso
  const swXs = Array.from({length: pisos}, (_, i) =>
    pisos === 1 ? cx : margin + colW/2 + i * colW
  );

  // Líneas de Core → Access switches
  let lines = swXs.map(sx => line(cx, coreY+22, sx, swY-22)).join('');
  // FW → Core
  lines = line(cx, fwY+22, cx, coreY-22) + lines;
  // Internet → FW
  lines = line(cx, inetY+18, cx, fwY-22) + lines;

  // VLANs por tipo de piso
  const floorVlans = (fl) => S.vlans.filter(v =>
    v.floor === 'all' || v.floor === 'core' && fl === S.core_piso
  );

  // SVIs label en core
  const coreVlans = S.vlans.map(v =>
    `VLAN${v.id} ${v.gateway_v4}`
  ).slice(0, 6).join('  |  ');

  // Nodos de switches por piso + VLANs
  let swNodes = swXs.map((sx, i) => {
    const fl    = i + 1;
    const label = fl === S.core_piso ? `SW-CORE (Piso ${fl})` : `SW-ACC-0${fl}`;
    const sub   = `Piso ${fl}${fl === S.core_piso ? ' — CPD' : ''}`;
    const fill  = fl === S.core_piso ? '#e8f0fb' : CLR.bg;
    const vstk  = floorVlans(fl);
    const vlabels = vstk.slice(0,4).map((v,vi) => {
      const clr = TYPE_CLR[v.type] || CLR.muted;
      return `<rect x="${sx - colW/2 + 4 + vi*42}" y="${vlanY-10}" width="38" height="18"
        rx="4" fill="${clr}22" stroke="${clr}" stroke-width="1"/>
        <text x="${sx - colW/2 + 4 + vi*42 + 19}" y="${vlanY+3}" text-anchor="middle"
          font-family="monospace" font-size="8.5" font-weight="600" fill="${clr}">V${v.id}</text>`;
    }).join('');
    const extraLabel = vstk.length > 4 ? `<text x="${sx}" y="${vlanY+22}" text-anchor="middle"
      font-size="8" fill="${CLR.muted}">+${vstk.length-4} más</text>` : '';
    return node(sx, swY, 140, 44, fill, CLR.border, label, sub)
      + line(sx, swY+22, sx, vlanY-12)
      + vlabels + extraLabel;
  }).join('');

  // FW — IP de gestión
  const fwIP  = getFWip();
  const coreIP = getCoreIP();

  // Leyenda de tipos VLAN
  const legendTypes = Object.entries(TYPE_CLR).map(([t,clr], i) => {
    const lx = margin + i * 90;
    return `<rect x="${lx}" y="${svgH-26}" width="10" height="10" rx="2" fill="${clr}"/>
      <text x="${lx+14}" y="${svgH-17}" font-size="9" fill="${CLR.muted}" font-family="sans-serif">${t}</text>`;
  }).join('');

  // Routing note
  const routeNote = `<text x="${cx}" y="${coreY+36}" text-anchor="middle" font-size="8.5"
    fill="${CLR.muted}" font-family="monospace">Inter-VLAN via SVIs • Ruta default → FW ${fwIP}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}">
  <defs>
    <marker id="arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
      <path d="M0,0 L0,6 L6,3 z" fill="${CLR.border}"/>
    </marker>
  </defs>
  <!-- fondo -->
  <rect width="${svgW}" height="${svgH}" fill="#f8fafc" rx="12"/>

  <!-- título -->
  <text x="${margin}" y="24" font-family="'DM Mono',monospace" font-size="13" font-weight="600"
    fill="${CLR.accent}">Topología Lógica — ${escHtml(S.domain)}</text>
  <text x="${margin}" y="38" font-family="sans-serif" font-size="10" fill="${CLR.muted}">
    Red base: ${S.net ? S.net.address+'/'+S.net.prefix : '—'} · Dual Stack: ${S.ipv6?'Sí':'No'} · Redundancia: ${S.redundancia}</text>

  <!-- líneas -->
  ${lines}

  <!-- Internet -->
  ${node(cx, inetY, 110, 36, '#fff7ed', '#f59e0b', 'INTERNET / WAN', S.wan_nexthop?`Next-hop: ${S.wan_nexthop}`:'', 8)}

  <!-- Firewall -->
  ${node(cx, fwY, 160, 44, '#fef2f2', '#f87171', 'FIREWALL — FW-01', `IP Gestión: ${fwIP}`, 8)}

  <!-- Core Switch -->
  ${node(cx, coreY, 200, 44, '#e8f0fb', CLR.accent, 'CORE SWITCH L3', `GW VLANs · ${S.vlans.length} SVIs · ${coreIP}`, 8)}
  ${routeNote}

  <!-- Access Switches + VLANs -->
  ${swNodes}

  <!-- Leyenda -->
  ${legendTypes}
</svg>`;
}

/* ── EXPORTAR PLAN COMPLETO ──────────────────────────────────────
   Un único HTML autocontenido con:
     · Métricas + Tabla VLSM
     · IPs de reserva por VLAN
     · Topología SVG
     · Configs Cisco / Huawei / FortiGate
     · Borrado seguro por vendor
   ─────────────────────────────────────────────────────────────── */

/**
 * Construye y descarga el HTML completo del plan.
 * Un solo archivo — sin dependencias externas — listo para imprimir.
 */
function downloadPlan() {
  if (!S.vlans.length) { showToast('Completa el plan antes de exportar', 'error'); return; }

  const now = new Date().toLocaleDateString('es-CO', {year:'numeric',month:'long',day:'numeric'});

  /* ── Métricas globales ── */
  const totalReq  = S.vlans.reduce((s,v) => s + v.hosts_required, 0);
  const totalUsf  = S.vlans.reduce((s,v) => s + v.hosts_useful,   0);
  const globalEff = Math.round((totalReq / totalUsf) * 100);
  const swPiso    = Math.ceil(S.hosts_piso / S.puertos);

  /* ── Tabla VLSM ── */
  const vlsmRows = S.vlans.map(v => `
    <tr>
      <td>${v.id}</td><td><strong>${escHtml(v.name)}</strong></td>
      <td>${v.floor_label}</td>
      <td>${v.network}/${v.prefix}</td><td>${v.mask}</td>
      <td>${v.gateway_v4}</td><td>${v.broadcast}</td>
      <td>${v.hosts_useful}</td><td>${v.efficiency}%</td>
      <td>${S.ipv6&&v.subnet_v6?v.subnet_v6:'—'}</td>
      <td>${S.ipv6&&v.gateway_v6?v.gateway_v6:'—'}</td>
    </tr>`).join('');

  /* ── IPs de reserva ── */
  const reserveRows = S.vlans.filter(v=>(v.reserved_ips||[]).length>0).map(v =>
    (v.reserved_ips||[]).map(r => `
    <tr>
      <td>VLAN ${v.id} — ${escHtml(v.name)}</td>
      <td><strong>${escHtml(r.alias)}</strong></td>
      <td>${r.ip4||'—'}</td><td>${r.ip6||'—'}</td>
      <td><span class="pill pill-${r.stack}">${r.stack.toUpperCase()}</span></td>
    </tr>`).join('')
  ).join('');

  /* ── Tabla de enrutamiento ── */
  const fwIP = getFWip();
  const routeRows = [
    ...S.vlans.map(v => `<tr><td>${v.network}/${v.prefix}</td><td>${v.mask}</td>
      <td>Conectada (SVI Vlan${v.id})</td><td>${v.gateway_v4}</td><td>${escHtml(v.name)}</td></tr>`),
    `<tr><td>0.0.0.0/0</td><td>0.0.0.0</td><td>Estática (default)</td><td>${fwIP}</td><td>Salida Internet</td></tr>`,
    ...S.wan_routes.map(r => { const p=parseCIDR(r); return p ?
      `<tr><td>${p.address}/${p.prefix}</td><td>${prefixToMask(p.prefix)}</td>
       <td>Estática (WAN remota)</td><td>${S.wan_nexthop}</td><td>Red remota</td></tr>` : '';})
  ].join('');

  /* ── Topología SVG ── */
  const svgTopo = generateTopologySVG();

  /* ── Configs + Rollback por vendor ── */
  const vendors = [
    { key:'cisco',    label:'Cisco IOS/XE',    cfg: generateCiscoConfig(),    rb: generateRollbackCisco()   },
    { key:'huawei',   label:'Huawei VRP',       cfg: generateHuaweiConfig(),   rb: generateRollbackHuawei()  },
    { key:'fortinet', label:'FortiGate (FW)',   cfg: generateFortinetConfig(), rb: generateRollbackFortinet()},
  ];

  const vendorTabs = vendors.map((v,i) =>
    `<button class="vtab${i===0?' active':''}" onclick="showVtab('${v.key}',this)">${v.label}</button>`
  ).join('');

  const vendorPanels = vendors.map((v,i) => `
    <div class="vpanel${i===0?'':' hidden'}" id="vp-${v.key}">
      <h3 style="font-size:13px;font-weight:700;text-transform:uppercase;color:#4a5568;margin-bottom:10px;">${v.label}</h3>
      <h4 style="font-size:11px;color:#1a6fc4;margin-bottom:6px;">Configuración</h4>
      <pre class="cfg">${escHtml(v.cfg)}</pre>
      <h4 style="font-size:11px;color:#b91c1c;margin:14px 0 6px;">Borrado Seguro (Rollback)</h4>
      <pre class="cfg rb">${escHtml(v.rb)}</pre>
    </div>`).join('');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<title>NetPlan Pro — ${escHtml(S.domain)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#1a2332;background:#fff;padding:32px}
header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #1a6fc4;padding-bottom:12px;margin-bottom:24px}
.brand{font-size:22px;font-weight:700;letter-spacing:.08em}.brand span{color:#1a6fc4}
.meta{font-size:11px;color:#718096;text-align:right;line-height:1.8}
h2{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#4a5568;margin:24px 0 12px;padding-bottom:6px;border-bottom:1px solid #e2e8f0}
.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
.mc{background:#f0f4f8;border:1px solid #d1dae6;border-radius:8px;padding:14px}
.mc .val{font-size:26px;font-weight:700;color:#1a6fc4;line-height:1.1}
.mc .lbl{font-size:10px;color:#718096;margin-top:3px}
table{width:100%;border-collapse:collapse;font-size:11.5px;margin-bottom:4px}
thead tr{background:#f0f4f8}
th{text-align:left;padding:7px 10px;font-size:10px;font-weight:700;text-transform:uppercase;color:#718096;border-bottom:2px solid #d1dae6;white-space:nowrap}
td{padding:7px 10px;border-bottom:1px solid #e2e8f0;font-family:'Courier New',monospace;color:#4a5568;white-space:nowrap}
td strong{font-family:'Segoe UI',Arial,sans-serif;font-weight:600;color:#1a2332}
tr:hover td{background:#f7f9fb}
.pill{font-size:9px;padding:2px 7px;border-radius:20px;font-weight:700}
.pill-ipv4{background:#e8f0fb;color:#1a6fc4;border:1px solid #c2d7f0}
.pill-ipv6{background:#f0fdf4;color:#15803d;border:1px solid #86efac}
.pill-dual{background:#fdf4ff;color:#7c3aed;border:1px solid #d8b4fe}
.topo-wrap{background:#f8fafc;border:1px solid #d1dae6;border-radius:10px;padding:16px;margin-bottom:8px;overflow-x:auto}
.vtabs{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap}
.vtab{padding:7px 16px;background:#f0f4f8;border:1px solid #d1dae6;border-radius:6px;font-size:12px;font-weight:500;cursor:pointer}
.vtab.active{background:#e8f0fb;border-color:#1a6fc4;color:#1a6fc4}
.vpanel.hidden{display:none}
.cfg{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:14px;font-family:'Courier New',monospace;font-size:11px;color:#334155;white-space:pre;overflow-x:auto;max-height:400px;overflow-y:auto;line-height:1.7}
.cfg.rb{border-color:#fca5a5;background:#fff8f8;color:#7f1d1d}
footer{margin-top:28px;font-size:11px;color:#a0aec0;text-align:center;border-top:1px solid #e2e8f0;padding-top:12px}
@media print{.vtab,.vtabs{display:none}.vpanel.hidden{display:block}.cfg{max-height:none}}
</style>
</head>
<body>
<header>
  <div class="brand">NET<span>PLAN</span> <small style="font-size:13px;font-weight:400;color:#718096">Pro v4.0</small></div>
  <div class="meta">Dominio: <strong>${escHtml(S.domain)}</strong><br>
    Red base: <strong>${S.net?S.net.address+'/'+S.net.prefix:'—'}</strong><br>
    Factor crecimiento: <strong>${S.growth_factor}×</strong> · Generado: ${now}</div>
</header>

<h2>Métricas globales</h2>
<div class="metrics">
  <div class="mc"><div class="val">${globalEff}%</div><div class="lbl">Eficiencia IPv4</div></div>
  <div class="mc"><div class="val">${S.vlans.length}</div><div class="lbl">VLANs generadas</div></div>
  <div class="mc"><div class="val">${(S.hosts_piso*S.pisos).toLocaleString()}</div><div class="lbl">Hosts totales</div></div>
  <div class="mc"><div class="val">${swPiso}</div><div class="lbl">Switches / piso</div></div>
</div>

<h2>Tabla VLSM — Direccionamiento IPv4${S.ipv6?' e IPv6':''}</h2>
<div style="overflow-x:auto"><table>
  <thead><tr><th>VLAN</th><th>Nombre</th><th>Piso</th><th>Red IPv4</th><th>Máscara</th>
    <th>Gateway IPv4</th><th>Broadcast</th><th>Hosts útiles</th><th>Efic.</th>
    <th>Subred IPv6</th><th>GW IPv6</th></tr></thead>
  <tbody>${vlsmRows}</tbody>
</table></div>

${reserveRows ? `<h2>IPs de Reserva (Dual Stack)</h2>
<div style="overflow-x:auto"><table>
  <thead><tr><th>VLAN</th><th>Alias / Hostname</th><th>IPv4</th><th>IPv6</th><th>Stack</th></tr></thead>
  <tbody>${reserveRows}</tbody>
</table></div>` : ''}

<h2>Tabla de Enrutamiento</h2>
<div style="overflow-x:auto"><table>
  <thead><tr><th>Red destino</th><th>Máscara</th><th>Tipo</th><th>Next-Hop / Interfaz</th><th>Descripción</th></tr></thead>
  <tbody>${routeRows}</tbody>
</table></div>
<p style="font-size:11px;color:#718096;margin-top:6px">* El enrutamiento inter-VLAN se realiza mediante SVIs en el Core Switch L3 (rutas directamente conectadas). Las rutas estáticas solo aplican para tráfico externo o redes remotas.</p>

<h2>Topología Lógica</h2>
<div class="topo-wrap">${svgTopo}</div>

<h2>Configuraciones de dispositivos</h2>
<div class="vtabs">${vendorTabs}</div>
${vendorPanels}

<footer>NetPlan Pro v4.0 · Fundación Universitaria Compensar · Documento generado automáticamente</footer>
<script>
function showVtab(key,btn){
  document.querySelectorAll('.vtab').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.vpanel').forEach(p=>p.classList.add('hidden'));
  btn.classList.add('active');
  document.getElementById('vp-'+key).classList.remove('hidden');
}
</script>
</body></html>`;

  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([html], {type:'text/html;charset=utf-8'}));
  a.download = `netplan_${S.domain}_${new Date().toISOString().slice(0,10)}.html`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Plan exportado correctamente', 'success');
}


/* ══════════════════════════════════════════════════════════════
   15. NAVEGACIÓN DEL WIZARD
   ══════════════════════════════════════════════════════════════ */

/** Navega a un paso haciendo clic en la barra (solo si el actual es válido). */
function goToStep(n) {
  if (n > S.step && !validateStep(S.step)) return;
  activateStep(n);
}

/** Avanza (+1) o retrocede (-1) un paso. */
function changeStep(dir) {
  /* En el último paso, "Finalizar" abre el modal antes de cualquier guard */
  if (S.step === 5 && dir > 0) { openFinishModal(); return; }
  const next = S.step + dir;
  if (next < 0 || next > 5) return;
  if (dir > 0 && !validateStep(S.step)) return;
  activateStep(next);
}

/**
 * Activa un paso: muestra la sección, actualiza tabs, ejecuta
 * la lógica de entrada del paso (onStepEnter).
 */
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
    /* Pasos 3-5 siempre habilitados; 0-2 según validación */
    btnNext.disabled = n >= 3 ? false : !validateStep(n);
  }

  onStepEnter(n);
}

/** Ejecuta la lógica específica al entrar a cada paso. */
function onStepEnter(n) {
  if (n === 0) validateStep(0);
  if (n === 1) { runAnalysis();       validateStep(1); }
  if (n === 2) { onServicesChange(); }
  if (n === 3) { buildVLANPlan();    renderVLANCards(); updateVlansCount(); }
  if (n === 4) { renderSummary(); }
  if (n === 5) { renderExportCode(); }
}


/* ══════════════════════════════════════════════════════════════
   16. PANEL LATERAL, TOAST Y MODAL
   ══════════════════════════════════════════════════════════════ */

/** Establece el texto de un elemento por ID. */
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/** Añade/quita una clase CSS de un elemento por ID. */
function toggleClass(id, cls, condition) {
  document.getElementById(id)?.classList.toggle(cls, condition);
}

/**
 * Muestra el toast de notificaciones durante 2.5 segundos.
 * @param {string} message - Texto a mostrar
 * @param {string} type    - 'success' | 'error'
 */
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
 * Resetea toda la aplicación al estado inicial.
 * Limpia el estado S, los formularios, los contenedores
 * generados y vuelve al paso 1.
 */
function resetApp() {
  closeModal();

  /* Resetear estado */
  Object.assign(S, {
    pisos: 3, core_piso: 1, hosts_piso: null, puertos: 48,
    redundancia: 'single', vendor: 'cisco', growth_factor: 2,
    net: null, override: '',
    dns4: '8.8.8.8', dns6: '2001:4860:4860::8888',
    ntp: 'pool.ntp.org', domain: 'corp.local', ipv6: true,
    wan_nexthop: '', wan_routes: [],
    vlan_defs: [], vlans: [], ula_prefix: '',
    step: 0, export_vendor: 'cisco', vlan_edit_id: null,
    reserve_expanded: {},
  });

  /* Resetear selects */
  document.getElementById('sel-pisos').value   = '3';
  document.getElementById('sel-puertos').value = '48';
  const selGrowth = document.getElementById('sel-growth');
  if (selGrowth) selGrowth.value = '2';
  /* Regenerar opciones de sel-core para 3 pisos */
  const selCore = document.getElementById('sel-core');
  selCore.innerHTML = '';
  for (let i = 1; i <= 3; i++) {
    const opt = document.createElement('option');
    opt.value = i; opt.textContent = i === 1 ? 'Piso 1 (recomendado)' : `Piso ${i}`;
    selCore.appendChild(opt);
  }
  selCore.value = '1';

  /* Limpiar inputs de texto */
  document.getElementById('inp-hosts').value   = '';
  document.getElementById('inp-override').value = '';
  const wn = document.getElementById('inp-wan-nexthop'); if (wn) wn.value = '';
  const wr = document.getElementById('inp-wan-routes');   if (wr) wr.value = '';
  document.getElementById('inp-dns4').value    = '8.8.8.8';
  document.getElementById('inp-dns6').value    = '2001:4860:4860::8888';
  document.getElementById('inp-ntp').value     = 'pool.ntp.org';
  document.getElementById('inp-domain').value  = 'corp.local';

  /* Resetear checkbox IPv6 */
  const ipv6cb = document.getElementById('chk-ipv6');
  if (ipv6cb) ipv6cb.checked = true;
  document.getElementById('ipv6-info')?.classList.remove('hidden');

  /* Limpiar estados de validación */
  document.querySelectorAll('.field.invalid').forEach(f => f.classList.remove('invalid'));

  /* Resetear toggles */
  document.querySelectorAll('#tg-redund .toggle-btn').forEach((b, i) =>
    b.classList.toggle('active', i === 0)
  );
  document.querySelectorAll('#tg-vendor .vendor-btn').forEach((b, i) =>
    b.classList.toggle('active', i === 0)
  );

  /* Resetear tabs de exportación */
  document.querySelectorAll('.export-tab').forEach((t, i) =>
    t.classList.toggle('active', i === 0)
  );

  /* Limpiar contenedores generados */
  const vc = document.getElementById('vlans-container');
  if (vc) vc.innerHTML = '<p class="placeholder-msg">Completa los pasos anteriores para generar las VLANs</p>';
  const tb = document.getElementById('vlsm-tbody');
  if (tb) tb.innerHTML = '';
  const ec = document.getElementById('export-code');
  if (ec) ec.textContent = 'Selecciona un vendor para ver la configuración generada';

  /* Cerrar formulario VLAN si estaba abierto */
  document.getElementById('vlan-form')?.classList.add('hidden');

  /* Resetear panel lateral */
  ['st-network','st-hosts','st-vlans','st-prefix','st-blocks',
   'st-hpiso','st-ports','st-sw','st-score',
   'res-network','res-mask','res-planned','res-margin','res-score',
   'ipv6-prefix','sw-count'].forEach(id => setText(id, '—'));
  setText('st-vendor', 'Cisco');
  setText('st-redund', 'Single-Link');
  setText('sw-detail', 'Ingresa los hosts por piso para ver el cálculo');
  setText('vlans-count', '0 VLANs');

  /* Resetear info-box */
  const swBox = document.getElementById('sw-result');
  if (swBox) { swBox.classList.add('ok'); swBox.classList.remove('warn'); }

  activateStep(0);
  showToast('Plan reiniciado. Comienza desde el paso 1.', 'success');
}


/* ══════════════════════════════════════════════════════════════
   17. INICIALIZACIÓN
   ══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  /*
   * Al cargar, S.pisos = 3 y S.core_piso = 1 (inicializados en S),
   * que coinciden con los valores por defecto de sel-pisos y sel-core.
   * El botón Siguiente arranca deshabilitado hasta que inp-hosts sea válido.
   */
  activateStep(0);
});
