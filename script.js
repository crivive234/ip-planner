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

  /* Paso 2 */
  net:      null,           // resultado del análisis: { address, prefix, mask, ... }
  override: '',             // CIDR personalizado (vacío = usar automática)

  /* Paso 3 */
  dns4:   '8.8.8.8',
  dns6:   '2001:4860:4860::8888',
  ntp:    'pool.ntp.org',
  domain: 'corp.local',
  ipv6:   true,

  /* VLANs */
  vlan_defs: [],            // definiciones editables por el usuario
  vlans:     [],            // resultados VLSM calculados (incluye network, mask, etc.)
  ula_prefix: '',           // prefijo ULA /48 derivado de la red base

  /* UI */
  step:          0,
  export_vendor: 'cisco',   // tab activo en paso 6
  vlan_edit_id:  null,      // ID de VLAN siendo editada (null = nueva)
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
  { id: 10, name: 'Usuarios',       type: 'users',   floor: 'all',  badge: 'blue',  hosts_factor: 1.00, min_hosts: 10 },
  { id: 20, name: 'Administración', type: 'admin',   floor: 'core', badge: 'green', hosts_factor: 0.10, min_hosts: 10 },
  { id: 30, name: 'Servidores',     type: 'servers', floor: 'core', badge: 'green', hosts_factor: 0.05, min_hosts: 20 },
  { id: 40, name: 'VoIP',           type: 'voip',    floor: 'all',  badge: 'blue',  hosts_factor: 0.50, min_hosts: 10 },
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
  voip: 'blue',  mgmt: 'amber', custom: 'blue',
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
    const d4Ok  = isValidIPv4(document.getElementById('inp-dns4')?.value || '');
    const d6Ok  = isValidIPv6(document.getElementById('inp-dns6')?.value || '');
    const ntpOk = isValidIPv4orHostname(document.getElementById('inp-ntp')?.value || '');
    const domOk = isValidDomain(document.getElementById('inp-domain')?.value || '');
    valid = d4Ok && d6Ok && ntpOk && domOk;
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
 *   hosts_plan  = total_hosts × 2   (overhead fijo 2×)
 *   prefix      = 32 − ceil(log2(hosts_plan + 2))
 *   score       = round(hosts_plan / usable × 100)
 *   margin      = usable − hosts_plan
 */
function runAnalysis() {
  /* Guard: no calcular si el paso 1 está incompleto */
  if (!S.pisos || !S.hosts_piso) return;

  const totalHosts = S.hosts_piso * S.pisos;
  const hostsPlan  = totalHosts * 2;

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
  setText('st-hosts',   `${hostsPlan.toLocaleString()} (2×)`);
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
  const swPerFloor = Math.ceil(S.hosts_piso / S.puertos);
  const mgmtDevices = swPerFloor * S.pisos + 3; /* switches + core + firewall */

  S.vlan_defs = VLAN_TEMPLATES.map(t => ({
    id:             t.id,
    name:           t.name,
    type:           t.type,
    badge:          t.badge,
    floor:          t.floor,
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
    floor_label:    calcFloorLabel(d.floor),
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
    S.vlan_defs.push({ id, name, type, floor, badge, hosts_required: hosts });
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

  container.innerHTML = S.vlans.map(v => `
    <div class="vlan-card type-${v.type}">
      <div class="vlan-card-header">
        <span class="vlan-card-name">VLAN ${v.id} — ${v.name}</span>
        <div class="vlan-card-actions">
          <span class="vlan-badge ${v.badge}">${v.floor_label}</span>
          <button class="btn-icon btn-edit"   onclick="editVlan(${v.id})"   title="Editar VLAN">✎</button>
          <button class="btn-icon btn-delete" onclick="deleteVlan(${v.id})" title="Eliminar VLAN">✕</button>
        </div>
      </div>
      <div class="vlan-card-detail">
        <span class="v4">IPv4: ${v.network}/${v.prefix} · GW: ${v.gateway_v4} · ${v.hosts_useful} hosts útiles · Eficiencia: ${v.efficiency}%</span>
        ${S.ipv6 && v.subnet_v6 ? `<br><span class="v6">IPv6: ${v.subnet_v6} · GW: ${v.gateway_v6}</span>` : ''}
      </div>
    </div>
  `).join('');
}


/* ══════════════════════════════════════════════════════════════
   11. PASO 5 — RENDER TABLA VLSM
   ══════════════════════════════════════════════════════════════ */

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
    next
end
#
`;
  });

  return c;
}

/** IP del Core Switch: gateway de VLAN 60. */
function getCoreIP() {
  const v60 = S.vlans.find(v => v.id === 60);
  return v60 ? v60.gateway_v4 : '(IP_CORE)';
}

/* ══════════════════════════════════════════════════════════════
   14. PASO 6 — EXPORTAR
   ══════════════════════════════════════════════════════════════ */

/** Selecciona el tab de exportación y renderiza el código. */
function selectExportTab(btn) {
  document.querySelectorAll('.export-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  S.export_vendor = btn.dataset.vendor;
  renderExportCode();
}

/**
 * Genera y muestra el contenido del tab activo en el paso 6.
 */
function renderExportCode() {
  const codeEl = document.getElementById('export-code');

  let code = '';
  switch (S.export_vendor) {
    case 'cisco':    code = generateCiscoConfig();    break;
    case 'huawei':   code = generateHuaweiConfig();   break;
    case 'fortinet': code = generateFortinetConfig(); break;
    default:         code = '— Selecciona un vendor —';
  }
  if (codeEl) codeEl.textContent = code;
}

/** Copia el contenido visible al portapapeles. */
function copyCode() {
  const el = document.getElementById('export-code');
  if (!el) return;
  navigator.clipboard.writeText(el.textContent)
    .then(() => showToast('Configuración copiada al portapapeles', 'success'))
    .catch(() => showToast('No se pudo copiar', 'error'));
}

/** Helper: descarga texto como archivo. */
function downloadText(content, filename) {
  const a   = document.createElement('a');
  a.href    = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast(`Descargando ${filename}`, 'success');
}

function downloadCisco()    { downloadText(generateCiscoConfig(),    `netplan_cisco_${S.domain}.txt`); }
function downloadHuawei()   { downloadText(generateHuaweiConfig(),   `netplan_huawei_${S.domain}.txt`); }
function downloadFortinet() { downloadText(generateFortinetConfig(), `netplan_fortinet_${S.domain}.txt`); }

/**
 * Genera y descarga el Resumen del plan como archivo HTML imprimible.
 * Incluye métricas globales y la tabla VLSM completa con estilos inline.
 */
function downloadSummary() {
  if (!S.vlans.length) { showToast('Completa el plan antes de descargar el resumen', 'error'); return; }

  const totalHostsReq = S.vlans.reduce((sum, v) => sum + v.hosts_required, 0);
  const totalUseful   = S.vlans.reduce((sum, v) => sum + v.hosts_useful,   0);
  const globalEff     = Math.round((totalHostsReq / totalUseful) * 100);
  const swPerFloor    = Math.ceil(S.hosts_piso / S.puertos);
  const now           = new Date().toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });

  const rows = S.vlans.map(v => `
    <tr>
      <td>${v.id}</td>
      <td><strong>${v.name}</strong></td>
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

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>Resumen NetPlan Pro — ${S.domain}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #1a2332; background: #fff; padding: 32px; }
    header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #1a6fc4; padding-bottom: 12px; margin-bottom: 24px; }
    .brand { font-size: 22px; font-weight: 700; letter-spacing: .08em; color: #1a2332; }
    .brand span { color: #1a6fc4; }
    .meta { font-size: 11px; color: #718096; text-align: right; line-height: 1.8; }
    h2 { font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #4a5568; margin-bottom: 14px; }
    .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 28px; }
    .mc { background: #f0f4f8; border: 1px solid #d1dae6; border-radius: 8px; padding: 14px 16px; }
    .mc .val { font-size: 26px; font-weight: 700; color: #1a6fc4; line-height: 1.1; }
    .mc .lbl { font-size: 11px; color: #718096; margin-top: 3px; }
    table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
    thead tr { background: #f0f4f8; }
    th { text-align: left; padding: 8px 10px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #718096; border-bottom: 2px solid #d1dae6; white-space: nowrap; }
    td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-family: 'Courier New', monospace; color: #4a5568; white-space: nowrap; }
    td strong { font-family: 'Segoe UI', Arial, sans-serif; font-weight: 600; color: #1a2332; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #f7f9fb; }
    footer { margin-top: 24px; font-size: 11px; color: #a0aec0; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 12px; }
    @media print {
      body { padding: 16px; }
      .metrics { grid-template-columns: repeat(4, 1fr); }
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">NET<span>PLAN</span> <small style="font-size:13px;font-weight:400;color:#718096;">Pro v4.0</small></div>
    <div class="meta">
      Dominio: <strong>${S.domain}</strong><br>
      Red base: <strong>${S.net ? S.net.address + '/' + S.net.prefix : '—'}</strong><br>
      Generado: ${now}
    </div>
  </header>

  <h2>Métricas globales</h2>
  <div class="metrics">
    <div class="mc"><div class="val">${globalEff}%</div><div class="lbl">Eficiencia IPv4</div></div>
    <div class="mc"><div class="val">${S.vlans.length}</div><div class="lbl">VLANs generadas</div></div>
    <div class="mc"><div class="val">${(S.hosts_piso * S.pisos).toLocaleString()}</div><div class="lbl">Hosts totales</div></div>
    <div class="mc"><div class="val">${swPerFloor}</div><div class="lbl">Switches / piso</div></div>
  </div>

  <h2>Tabla VLSM — Direccionamiento IPv4${S.ipv6 ? ' e IPv6' : ''}</h2>
  <table>
    <thead>
      <tr>
        <th>VLAN</th><th>Nombre</th><th>Piso</th><th>Red IPv4</th>
        <th>Máscara</th><th>Gateway IPv4</th><th>Broadcast</th>
        <th>Hosts útiles</th><th>Efic.</th>
        <th>Subred IPv6 /64</th><th>Gateway IPv6</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <footer>NetPlan Pro v4.0 · Fundación Universitaria Compensar · Documento generado automáticamente</footer>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `netplan_resumen_${S.domain}.html`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Resumen descargado correctamente', 'success');
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
    redundancia: 'single', vendor: 'cisco',
    net: null, override: '',
    dns4: '8.8.8.8', dns6: '2001:4860:4860::8888',
    ntp: 'pool.ntp.org', domain: 'corp.local', ipv6: true,
    vlan_defs: [], vlans: [], ula_prefix: '',
    step: 0, export_vendor: 'cisco', vlan_edit_id: null,
  });

  /* Resetear selects */
  document.getElementById('sel-pisos').value   = '3';
  document.getElementById('sel-puertos').value = '48';
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
