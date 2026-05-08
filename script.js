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
  rollback_vendor:  'cisco',   // sub-selector dentro de pestaña Borrado Seguro
  vlan_edit_id:     null,      // ID de VLAN siendo editada (null = nueva)
  reserve_expanded: {},        // mapa vlanId → boolean (sección IPs de reserva abierta)
  cloud_plan_id:    null,      // ID del plan en Firestore si fue cargado/guardado en nube
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
    /* Ahora pisos y core_piso vienen de inputs numéricos: hay que validarlos */
    const pisosOk = S.pisos     !== null && S.pisos     >= 1 && S.pisos     <= 50;
    const maxCore = S.pisos || 50;
    const coreOk  = S.core_piso !== null && S.core_piso >= 1 && S.core_piso <= maxCore;
    const hOk     = S.hosts_piso !== null && S.hosts_piso >= 1 && S.hosts_piso <= 500;
    valid = pisosOk && coreOk && hOk;
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
  autosave();
}

/** Selecciona vendor y actualiza estado + panel lateral. */
function selectVendor(btn) {
  document.querySelectorAll('#tg-vendor .vendor-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  S.vendor = btn.dataset.value;
  setText('st-vendor', btn.querySelector('.vendor-name').textContent);
  autosave();
}

/**
 * Maneja el cambio en el input numérico de pisos.
 * - Valida rango 1–50.
 * - Actualiza dinámicamente el atributo max del input de core.
 * - Si el core actual excede los nuevos pisos, lo ajusta automáticamente.
 * - Resetea vlan_defs para que se recalculen con los nuevos pisos.
 */
function onPisosChange() {
  const inpPisos = document.getElementById('inp-pisos');
  const inpCore  = document.getElementById('inp-core');
  const raw      = inpPisos.value.trim();
  const pisosVal = parseInt(raw, 10);
  const pisosOk  = !isNaN(pisosVal) && pisosVal >= 1 && pisosVal <= 50;

  /* El campo vacío también marca como inválido (sin mostrar error rojo) */
  setFieldValidity('field-pisos', pisosOk || raw === '');

  if (pisosOk) {
    S.pisos = pisosVal;

    /* Actualizar restricción del input de core */
    inpCore.max = pisosVal;
    const hint = document.getElementById('hint-core');
    if (hint) hint.textContent = `Rango: 1 – ${pisosVal} (debe ser ≤ número de pisos)`;
    const errMsg = document.getElementById('error-core');
    if (errMsg) errMsg.textContent = `Debe estar entre 1 y ${pisosVal}`;

    /* Si el core actual ya no cabe en el nuevo rango, ajustarlo al máximo permitido */
    const coreVal = parseInt(inpCore.value, 10);
    if (!isNaN(coreVal) && coreVal > pisosVal) {
      inpCore.value = pisosVal;
    }

    /* Forzar recálculo de VLANs con los nuevos pisos */
    S.vlan_defs = [];
  } else {
    S.pisos = null;
  }

  /* Re-validar core porque su max pudo haber cambiado */
  validateCoreInput();
  validateStep(0);
  autosave();
}

/** Maneja el cambio en el input numérico del piso del Core / CPD. */
function onCoreChange() {
  validateCoreInput();
  validateStep(0);
  autosave();
}

/**
 * Valida el input del Core respetando el rango dinámico [1, S.pisos].
 * Encapsulado para poder llamarlo desde onPisosChange y onCoreChange.
 */
function validateCoreInput() {
  const inpCore = document.getElementById('inp-core');
  const raw     = inpCore.value.trim();
  const coreVal = parseInt(raw, 10);
  const max     = S.pisos || 50;
  const coreOk  = !isNaN(coreVal) && coreVal >= 1 && coreVal <= max;

  setFieldValidity('field-core', coreOk || raw === '');

  S.core_piso = coreOk ? coreVal : null;
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
  autosave();
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
  autosave();
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
  autosave();
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
  autosave();
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
  autosave();
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
  autosave();
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
  autosave();
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
  autosave();
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
  autosave();
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
  autosave();
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

/**
 * Selecciona el tab de exportación principal.
 * Para la pestaña "Borrado Seguro": muestra el sub-selector de vendor
 * y sincroniza su botón activo con S.rollback_vendor.
 */
function selectExportTab(btn) {
  document.querySelectorAll('.export-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  S.export_vendor = btn.dataset.vendor;

  const subtabs = document.getElementById('rollback-subtabs');
  if (S.export_vendor === 'rollback') {
    /* Asegurar default y sincronizar UI del sub-selector */
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

/**
 * Selecciona el vendor cuyo borrado seguro se va a mostrar.
 * Solo se usa cuando la pestaña "Borrado Seguro" está activa.
 */
function selectRollbackVendor(btn) {
  document.querySelectorAll('.rb-subtab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  S.rollback_vendor = btn.dataset.vendor;
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
 * Genera el borrado seguro del vendor seleccionado en el sub-selector.
 * Estrategia: comandos "no/undo/delete" en orden inverso al de aplicación.
 */
function generateRollback() {
  switch (S.rollback_vendor) {
    case 'cisco':    return generateRollbackCisco();
    case 'huawei':   return generateRollbackHuawei();
    case 'fortinet': return generateRollbackFortinet();
    default:         return generateRollbackCisco();
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
/**
 * Genera la topología lógica como SVG.
 *
 * Mejoras vs versión anterior:
 *  - Layout dinámico: ancho/alto se calculan según pisos y VLANs reales
 *  - Soporta dual-link: dibuja doble línea con etiqueta "Po1 (LACP)"
 *  - No trunca VLANs: si hay muchas, fluyen en filas debajo del switch
 *  - Diferencia visual Core L3 (azul oscuro) vs Access L2 (azul claro)
 *  - Cuenta switches por piso según hosts_piso/puertos
 *  - Anotaciones de WAN routes y DNS si están definidos
 *  - Modo wrap para 6+ pisos: dispone los switches en filas
 */
function generateTopologySVG() {
  if (!S.vlans.length) return '<svg xmlns="http://www.w3.org/2000/svg"></svg>';

  /* ── Paleta (coherente con la app) ── */
  const CLR = {
    accent:'#1a6fc4', accentDk:'#0f4d8f', accentLt:'#e8f0fb',
    ok:'#1a7a4a', okBg:'#e8f5ee',
    warn:'#875a00', warnBg:'#fff7ed',
    err:'#c0392b', errBg:'#fef2f2',
    purple:'#7c3aed', voip:'#0891b2',
    border:'#d1dae6', borderStrong:'#94a3b8',
    text:'#1a2332', muted:'#718096', bg:'#f7f9fb',
  };
  const TYPE_CLR = {
    users:CLR.accent, admin:CLR.ok, servers:CLR.purple,
    voip:CLR.voip, wifi:CLR.purple, mgmt:CLR.warn, custom:CLR.muted,
  };

  /* ── Configuración de layout ── */
  const pisos     = S.pisos;
  const dual      = S.redundancia === 'dual';
  const swPerPiso = Math.max(1, Math.ceil((S.hosts_piso || 0) / S.puertos));

  /* Modo wrap: si hay más de 5 pisos, los switches se disponen en filas */
  const WRAP_AT       = 5;
  const swPerRow      = pisos > WRAP_AT ? Math.ceil(pisos / Math.ceil(pisos / WRAP_AT)) : pisos;
  const switchRows    = Math.ceil(pisos / swPerRow);

  /* Anchos */
  const colW         = 170;          // ancho por columna (switch)
  const margin       = 50;
  const svgW         = Math.max(720, margin * 2 + colW * swPerRow);

  /* VLAN chips: cuántas caben por fila bajo cada switch */
  const chipW        = 44;
  const chipH        = 18;
  const chipGap      = 4;
  const chipsPerRow  = Math.max(2, Math.floor((colW - 8) / (chipW + chipGap)));

  /* Calcular cuántas filas de chips necesita cada switch */
  const floorVlans = (fl) => S.vlans.filter(v =>
    v.floor === 'all' || (v.floor === 'core' && fl === S.core_piso)
  );
  const maxVlansPerSw = Math.max(...Array.from({length: pisos}, (_, i) => floorVlans(i+1).length), 1);
  const maxChipRows   = Math.ceil(maxVlansPerSw / chipsPerRow);

  /* Alturas dinámicas */
  const headerH      = 60;
  const inetH        = 50;   // altura ocupada por nodo internet
  const fwH          = 50;
  const coreH        = 60;
  const swH          = 50;
  const chipsBlockH  = maxChipRows * (chipH + 4) + 8;
  const vGap         = 70;   // separación vertical entre niveles
  const rowGap       = 30;   // separación entre filas de switches en wrap mode
  const legendH      = 40;
  const footerH      = 20;

  /* Coordenadas Y de cada nivel */
  const inetY  = headerH + inetH/2;
  const fwY    = inetY  + inetH/2 + vGap + fwH/2;
  const coreY  = fwY    + fwH/2   + vGap + coreH/2;
  const swYs   = [];
  for (let r = 0; r < switchRows; r++) {
    const y = coreY + coreH/2 + vGap + r * (swH + chipsBlockH + rowGap) + swH/2;
    swYs.push(y);
  }
  const svgH = swYs[swYs.length - 1] + swH/2 + chipsBlockH + legendH + footerH;

  /* Coordenadas X de switches */
  const cx = svgW / 2;
  const swPos = [];                 // [{x, y, floor, isCore}]
  for (let i = 0; i < pisos; i++) {
    const row     = Math.floor(i / swPerRow);
    const col     = i % swPerRow;
    const colsRow = (row === switchRows - 1)
      ? (pisos - row * swPerRow)
      : swPerRow;
    /* Centrar la última fila si quedó incompleta */
    const x = svgW/2 - (colsRow * colW)/2 + colW/2 + col * colW;
    swPos.push({ x, y: swYs[row], floor: i + 1, isCore: (i + 1) === S.core_piso });
  }

  /* ── Helpers de dibujo ── */
  const esc = escHtml;
  function node(x, y, w, h, fill, stroke, label, sub='', strokeW=1.5) {
    return `<rect x="${x-w/2}" y="${y-h/2}" width="${w}" height="${h}" rx="8"
        fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}"/>
      <text x="${x}" y="${y-3}" text-anchor="middle" font-family="'DM Mono',monospace"
        font-size="11" font-weight="600" fill="${CLR.text}">${esc(label)}</text>
      ${sub ? `<text x="${x}" y="${y+12}" text-anchor="middle" font-family="monospace"
        font-size="9.5" fill="${CLR.muted}">${esc(sub)}</text>` : ''}`;
  }

  /**
   * Línea entre nodos. Si dual=true, dibuja DOS líneas paralelas con
   * etiqueta "Po (LACP)" para representar EtherChannel/Eth-Trunk.
   * Si dual=false, una sola línea con flecha.
   */
  function link(x1, y1, x2, y2, isDual = dual) {
    if (!isDual) {
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
        stroke="${CLR.borderStrong}" stroke-width="1.6"/>`;
    }
    /* Dos líneas paralelas separadas por offset perpendicular */
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx*dx + dy*dy) || 1;
    const offX = (-dy / len) * 3;   // offset perpendicular ±3px
    const offY = (dx / len) * 3;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    return `
      <line x1="${x1+offX}" y1="${y1+offY}" x2="${x2+offX}" y2="${y2+offY}"
        stroke="${CLR.accent}" stroke-width="1.4"/>
      <line x1="${x1-offX}" y1="${y1-offY}" x2="${x2-offX}" y2="${y2-offY}"
        stroke="${CLR.accent}" stroke-width="1.4"/>
      <rect x="${mx-16}" y="${my-7}" width="32" height="14" rx="3"
        fill="#fff" stroke="${CLR.accent}" stroke-width="0.8"/>
      <text x="${mx}" y="${my+3}" text-anchor="middle" font-family="monospace"
        font-size="8" font-weight="600" fill="${CLR.accent}">LACP</text>`;
  }

  /* ── Construir nodos ── */
  let svg = '';

  /* Líneas Internet → FW → Core (siempre simples) */
  svg += `<line x1="${cx}" y1="${inetY+inetH/2}" x2="${cx}" y2="${fwY-fwH/2}"
    stroke="${CLR.borderStrong}" stroke-width="1.6"/>`;
  svg += `<line x1="${cx}" y1="${fwY+fwH/2}" x2="${cx}" y2="${coreY-coreH/2}"
    stroke="${CLR.borderStrong}" stroke-width="1.6"/>`;

  /* Líneas Core → switches de acceso (con dual-link si aplica) */
  swPos.forEach(sp => {
    if (sp.isCore) return;          // el switch core es el mismo del centro
    svg += link(cx, coreY + coreH/2, sp.x, sp.y - swH/2);
  });

  /* Internet */
  svg += node(cx, inetY, 130, inetH, CLR.warnBg, '#f59e0b',
    'INTERNET / WAN',
    S.wan_nexthop ? `Next-hop: ${S.wan_nexthop}` : '');

  /* Firewall */
  svg += node(cx, fwY, 170, fwH, CLR.errBg, '#f87171',
    'FIREWALL — FW-01',
    `IP Gestión: ${getFWip()}`);

  /* Core Switch (más grande, color destacado) */
  svg += node(cx, coreY, 220, coreH, CLR.accentLt, CLR.accentDk,
    'CORE SWITCH L3',
    `${S.vlans.length} SVIs · ${getCoreIP()} · Piso ${S.core_piso}`, 2);

  /* Anotación de routing — la pongo encima del core para evitar
     que las líneas LACP que bajan al core se le superpongan */
  svg += `<text x="${cx}" y="${coreY - coreH/2 - 8}" text-anchor="middle"
    font-size="9" fill="${CLR.muted}" font-family="monospace">
    Inter-VLAN via SVIs · Default → FW · ${dual ? 'Uplinks LACP (2x)' : 'Uplinks Single-Link'}</text>`;

  /* Switches de acceso + chips de VLANs */
  swPos.forEach(sp => {
    const vstk     = floorVlans(sp.floor);
    const isCore   = sp.isCore;
    const fill     = isCore ? CLR.accentLt : CLR.bg;
    const stroke   = isCore ? CLR.accent   : CLR.borderStrong;
    const lbl      = isCore ? `SW-CORE (P${sp.floor})` : `SW-ACC-P${sp.floor}`;
    const subLbl   = isCore
      ? 'Core L3 + Access'
      : `${swPerPiso} switch${swPerPiso > 1 ? 'es' : ''} · L2`;

    svg += node(sp.x, sp.y, colW - 16, swH, fill, stroke, lbl, subLbl, isCore ? 2 : 1.5);

    /* Chips de VLAN — TODAS, sin truncar, en múltiples filas */
    const chipsStartX = sp.x - colW/2 + 4;
    const chipsStartY = sp.y + swH/2 + 12;
    vstk.forEach((v, vi) => {
      const r   = Math.floor(vi / chipsPerRow);
      const c   = vi % chipsPerRow;
      const cx2 = chipsStartX + c * (chipW + chipGap);
      const cy2 = chipsStartY + r * (chipH + 4);
      const clr = TYPE_CLR[v.type] || CLR.muted;
      svg += `<rect x="${cx2}" y="${cy2}" width="${chipW}" height="${chipH}" rx="3"
        fill="${clr}33" stroke="${clr}" stroke-width="1"/>
        <text x="${cx2 + chipW/2}" y="${cy2 + chipH/2 + 3}" text-anchor="middle"
          font-family="monospace" font-size="8.5" font-weight="700" fill="${clr}">V${v.id}</text>`;
    });

    /* Línea sutil del switch a sus chips */
    svg += `<line x1="${sp.x}" y1="${sp.y + swH/2}" x2="${sp.x}" y2="${chipsStartY - 2}"
      stroke="${CLR.border}" stroke-width="1" stroke-dasharray="2,2"/>`;
  });

  /* ── Leyenda de tipos VLAN al pie ── */
  const usedTypes = [...new Set(S.vlans.map(v => v.type))];
  const legendY   = svgH - legendH;
  let legend      = '';
  usedTypes.forEach((t, i) => {
    const lx = margin + i * 95;
    const clr = TYPE_CLR[t] || CLR.muted;
    legend += `<rect x="${lx}" y="${legendY + 8}" width="11" height="11" rx="2"
      fill="${clr}1a" stroke="${clr}" stroke-width="0.8"/>
      <text x="${lx + 16}" y="${legendY + 17}" font-size="9.5"
        fill="${CLR.text}" font-family="sans-serif">${esc(t)}</text>`;
  });

  /* ── SVG final ── */
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}"
    width="${svgW}" height="${svgH}" preserveAspectRatio="xMidYMid meet">

    <!-- fondo -->
    <rect width="${svgW}" height="${svgH}" fill="#fbfcfd" rx="12"/>

    <!-- título -->
    <text x="${margin}" y="26" font-family="'DM Mono',monospace"
      font-size="14" font-weight="600" fill="${CLR.accent}">
      Topología Lógica — ${esc(S.domain)}</text>
    <text x="${margin}" y="42" font-family="sans-serif" font-size="10" fill="${CLR.muted}">
      Red base: ${S.net ? S.net.address+'/'+S.net.prefix : '—'} ·
      ${S.ipv6 ? 'Dual Stack (IPv4+IPv6)' : 'IPv4'} ·
      ${dual ? 'Redundancia: Dual-Link LACP' : 'Redundancia: Single-Link'} ·
      ${pisos} piso${pisos !== 1 ? 's' : ''} · ${S.vlans.length} VLAN${S.vlans.length !== 1 ? 's' : ''}</text>

    ${svg}

    <!-- leyenda -->
    ${legend}
  </svg>`;
}

/* ── GENERADORES DE TOPOLOGÍA EDITABLE ──────────────────────────
   Tres formatos adicionales al SVG inline:
     · Mermaid  → texto plano que renderiza GitHub/Notion/Confluence
     · drawio   → XML editable en draw.io / diagrams.net
   Ambos preservan jerarquía Internet → FW → Core → Access + VLANs.
   ─────────────────────────────────────────────────────────────── */

/**
 * Genera código Mermaid (graph TD) listo para pegar en markdown.
 * GitHub, Notion y Confluence lo renderizan automáticamente.
 */
function generateMermaid() {
  if (!S.vlans.length) return '';

  const dual = S.redundancia === 'dual';
  const linkStyle = dual ? '===' : '-->';   // === = línea gruesa para LACP

  const floorVlans = (fl) => S.vlans.filter(v =>
    v.floor === 'all' || (v.floor === 'core' && fl === S.core_piso)
  );

  let m = '';
  m += '%%{init: {"theme":"base","themeVariables":{"primaryColor":"#e8f0fb","primaryBorderColor":"#1a6fc4","lineColor":"#94a3b8"}}}%%\n';
  m += 'graph TD\n';

  /* Cabecera de la red */
  m += `    INET["☁ Internet / WAN${S.wan_nexthop ? '<br/>'+S.wan_nexthop : ''}"]\n`;
  m += `    FW["🛡 FW-01<br/>${getFWip()}"]\n`;
  m += `    CORE["⚡ CORE L3<br/>${getCoreIP()}<br/>${S.vlans.length} SVIs"]\n`;
  m += `    INET --> FW\n`;
  m += `    FW --> CORE\n\n`;

  /* Switches por piso */
  for (let fl = 1; fl <= S.pisos; fl++) {
    const isCore = fl === S.core_piso;
    const swId   = `SW${fl}`;
    const lbl    = isCore
      ? `🟦 SW-CORE P${fl}<br/>Core L3 + Access`
      : `SW-ACC P${fl}<br/>L2 Access`;
    m += `    ${swId}["${lbl}"]\n`;
    if (!isCore) {
      /* Edge desde core a switch — con etiqueta LACP si dual */
      m += `    CORE ${linkStyle}${dual ? '|"LACP/Po1"|' : ''} ${swId}\n`;
    }

    /* VLANs de este switch como subnodos */
    const vstk = floorVlans(fl);
    vstk.forEach(v => {
      const vId   = `V${v.id}_P${fl}`;
      const stack = v.network ? `${v.network}/${v.prefix}` : '';
      m += `    ${vId}(["VLAN ${v.id}<br/>${v.name}<br/>${stack}"])\n`;
      m += `    ${swId} --- ${vId}\n`;
    });
  }

  /* Estilos por tipo de VLAN */
  m += '\n';
  const typeColor = {
    users:'#1a6fc4', admin:'#1a7a4a', servers:'#7c3aed',
    voip:'#0891b2', wifi:'#7c3aed', mgmt:'#875a00', custom:'#718096',
  };
  S.vlans.forEach(v => {
    for (let fl = 1; fl <= S.pisos; fl++) {
      const inFloor = v.floor === 'all' || (v.floor === 'core' && fl === S.core_piso);
      if (!inFloor) continue;
      const c = typeColor[v.type] || '#718096';
      m += `    style V${v.id}_P${fl} fill:${c}1a,stroke:${c},color:${c}\n`;
    }
  });

  /* Estilo del Core destacado */
  m += `    style CORE fill:#e8f0fb,stroke:#0f4d8f,stroke-width:3px\n`;
  m += `    style FW   fill:#fef2f2,stroke:#c0392b\n`;
  m += `    style INET fill:#fff7ed,stroke:#f59e0b\n`;

  return m;
}

/**
 * Genera XML compatible con draw.io / diagrams.net.
 * El usuario lo abre en https://app.diagrams.net y puede editarlo
 * libremente: mover nodos, cambiar estilos, exportar a PNG/PDF, etc.
 *
 * Formato: mxGraphModel → root con cells. Cada cell tiene un id único,
 * un parent ("1" = raíz), un style mxGraph, y geometry (x,y,w,h).
 */
function generateDrawioXML() {
  if (!S.vlans.length) return '';

  const dual = S.redundancia === 'dual';
  const esc  = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
                      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  /* Estilos predefinidos (mxGraph syntax) */
  const STYLES = {
    inet:   'rounded=1;whiteSpace=wrap;html=1;fillColor=#fff7ed;strokeColor=#f59e0b;fontSize=11;fontStyle=1;',
    fw:     'rounded=1;whiteSpace=wrap;html=1;fillColor=#fef2f2;strokeColor=#c0392b;fontSize=11;fontStyle=1;',
    core:   'rounded=1;whiteSpace=wrap;html=1;fillColor=#e8f0fb;strokeColor=#0f4d8f;fontSize=12;fontStyle=1;strokeWidth=2;',
    swCore: 'rounded=1;whiteSpace=wrap;html=1;fillColor=#e8f0fb;strokeColor=#1a6fc4;fontSize=11;strokeWidth=2;',
    swAcc:  'rounded=1;whiteSpace=wrap;html=1;fillColor=#f7f9fb;strokeColor=#94a3b8;fontSize=11;',
    edge:   'edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#94a3b8;strokeWidth=1.5;endArrow=none;',
    edgeDual:'edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#1a6fc4;strokeWidth=2.5;endArrow=none;',
    vlan:   (color) => `rounded=1;whiteSpace=wrap;html=1;fillColor=${color}1a;strokeColor=${color};fontSize=10;`,
  };
  const TYPE_CLR = {
    users:'#1a6fc4', admin:'#1a7a4a', servers:'#7c3aed',
    voip:'#0891b2', wifi:'#7c3aed', mgmt:'#875a00', custom:'#718096',
  };

  /* Layout en grid */
  const colW   = 180,  rowH = 110;
  const cx     = 600;
  const inetY  = 40,   fwY = 160, coreY = 280, swY = 440;
  const vlanY  = 580;

  let cells = '';
  let id    = 100;

  /* Cabecera vertical */
  cells += `<mxCell id="inet" value="${esc('☁ Internet / WAN' + (S.wan_nexthop ? '\n' + S.wan_nexthop : ''))}" style="${STYLES.inet}" vertex="1" parent="1"><mxGeometry x="${cx-65}" y="${inetY}" width="130" height="50" as="geometry"/></mxCell>\n`;
  cells += `<mxCell id="fw"   value="${esc('🛡 FW-01\n' + getFWip())}"           style="${STYLES.fw}"   vertex="1" parent="1"><mxGeometry x="${cx-85}" y="${fwY}"   width="170" height="50" as="geometry"/></mxCell>\n`;
  cells += `<mxCell id="core" value="${esc('⚡ CORE SWITCH L3\n' + getCoreIP() + '\n' + S.vlans.length + ' SVIs')}" style="${STYLES.core}" vertex="1" parent="1"><mxGeometry x="${cx-110}" y="${coreY}" width="220" height="60" as="geometry"/></mxCell>\n`;

  /* Edges INET → FW → CORE */
  cells += `<mxCell id="e1" style="${STYLES.edge}" edge="1" parent="1" source="inet" target="fw"><mxGeometry relative="1" as="geometry"/></mxCell>\n`;
  cells += `<mxCell id="e2" style="${STYLES.edge}" edge="1" parent="1" source="fw"   target="core"><mxGeometry relative="1" as="geometry"/></mxCell>\n`;

  /* Switches por piso (en fila horizontal, centrados sobre el core) */
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

    /* VLANs como nodos pequeños debajo del switch */
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
<mxfile host="app.diagrams.net" modified="${new Date().toISOString()}" agent="NetPlan Pro v4.0" version="22.0.0">
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


/* ──────────────────────────────────────────────────────────────
   LAZY LOAD DE LIBRERÍAS EXTERNAS (CDN)
   Estas se cargan solo cuando el usuario pide ese formato,
   manteniendo la página inicial liviana y sin npm install.
   ────────────────────────────────────────────────────────────── */

const _scriptCache = {};

/** Carga un script externo una sola vez y devuelve una promesa. */
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


/* ── EXPORTACIONES ALTERNATIVAS ─────────────────────────────────
   Cuatro formatos adicionales al HTML completo:
     · Excel (.xlsx) → tabla VLSM + reservas + métricas en hojas
     · PDF           → resumen ejecutivo imprimible
     · Mermaid       → texto pegable en markdown
     · drawio        → XML editable en draw.io
   Cada uno genera un archivo descargable independiente.
   ─────────────────────────────────────────────────────────────── */

/** Helper: dispara descarga de un blob. */
function _download(blob, filename) {
  const a = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Nombre base para archivos exportados. */
function _fileName(ext) {
  const date = new Date().toISOString().slice(0, 10);
  const dom  = (S.domain || 'plan').replace(/[^a-z0-9._-]/gi, '_');
  return `netplan_${dom}_${date}.${ext}`;
}

/* ── EXPORTACIÓN EXCEL (.xlsx) ──────────────────────────────────
   Usa SheetJS desde CDN. Genera un libro con 4 hojas:
     1. Resumen      → métricas globales del plan
     2. VLSM IPv4    → tabla completa de subredes IPv4
     3. VLSM IPv6    → tabla IPv6 (si está habilitado)
     4. Reservas IP  → todas las IPs estáticas reservadas
   ─────────────────────────────────────────────────────────────── */

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

  /* Hoja 1: Resumen ejecutivo */
  const totalReq  = S.vlans.reduce((s,v) => s + v.hosts_required, 0);
  const totalUsf  = S.vlans.reduce((s,v) => s + v.hosts_useful,   0);
  const efficiency = Math.round((totalReq / totalUsf) * 100);
  const swPiso    = Math.ceil(S.hosts_piso / S.puertos);

  const summary = [
    ['NetPlan Pro v4.0 — Resumen del plan'],
    ['Generado',            new Date().toLocaleString('es-CO')],
    ['Dominio interno',     S.domain],
    [],
    ['INFRAESTRUCTURA'],
    ['Pisos',               S.pisos],
    ['Piso del Core / CPD', S.core_piso],
    ['Hosts por piso',      S.hosts_piso],
    ['Puertos por switch',  S.puertos],
    ['Switches por piso',   swPiso],
    ['Switches totales',    swPiso * S.pisos],
    ['Redundancia',         S.redundancia === 'dual' ? 'Dual-Link (LACP)' : 'Single-Link'],
    ['Vendor',              S.vendor === 'cisco' ? 'Cisco IOS/XE' : 'Huawei VRP'],
    ['Factor de crecimiento', S.growth_factor + 'x'],
    [],
    ['DIRECCIONAMIENTO IPv4'],
    ['Red base',            (S.net && S.net.address+'/'+S.net.prefix) || '—'],
    ['Total VLANs',         S.vlans.length],
    ['Hosts requeridos',    totalReq],
    ['Hosts útiles asignados', totalUsf],
    ['Eficiencia global',   efficiency + '%'],
    [],
    ['DUAL STACK / IPv6'],
    ['Habilitado',          S.ipv6 ? 'Sí' : 'No'],
    ['Prefijo ULA',         S.ula_prefix || '—'],
    [],
    ['SERVICIOS'],
    ['DNS IPv4',            S.dns4],
    ['DNS IPv6',            S.dns6],
    ['NTP',                 S.ntp],
    [],
    ['WAN'],
    ['Next-hop',            S.wan_nexthop || '—'],
    ['Rutas estáticas',     (S.wan_routes || []).join(', ') || '—'],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summary);
  /* Anchos de columna */
  wsSummary['!cols'] = [{ wch: 32 }, { wch: 40 }];

  /* Hoja 2: VLSM IPv4 */
  const vlsmHead = ['VLAN ID', 'Nombre', 'Tipo', 'Piso', 'Hosts Req.', 'Hosts Útiles',
                    'Eficiencia %', 'Red', 'Prefijo', 'Máscara', 'Gateway',
                    'Broadcast', 'Primera IP', 'Última IP'];
  const vlsmRows = S.vlans.map(v => [
    v.id, v.name, v.type, v.floor_label, v.hosts_required, v.hosts_useful,
    v.efficiency, v.network, '/' + v.prefix, v.mask, v.gateway_v4,
    v.broadcast, v.first_host, v.last_host,
  ]);
  const wsVLSM4 = XLSX.utils.aoa_to_sheet([vlsmHead, ...vlsmRows]);
  wsVLSM4['!cols'] = [
    { wch: 8 }, { wch: 18 }, { wch: 10 }, { wch: 10 }, { wch: 11 }, { wch: 12 },
    { wch: 13 }, { wch: 16 }, { wch: 8 }, { wch: 16 }, { wch: 16 },
    { wch: 16 }, { wch: 16 }, { wch: 16 },
  ];

  /* Hoja 3: VLSM IPv6 (solo si está habilitado) */
  let wsVLSM6 = null;
  if (S.ipv6) {
    const head6 = ['VLAN ID', 'Nombre', 'Subred IPv6', 'Gateway IPv6', 'Notas'];
    const rows6 = S.vlans.map(v => [
      v.id, v.name, v.subnet_v6 || '—', v.gateway_v6 || '—',
      v.subnet_v6 ? '/64 Dual-Stack' : '',
    ]);
    wsVLSM6 = XLSX.utils.aoa_to_sheet([head6, ...rows6]);
    wsVLSM6['!cols'] = [{ wch: 8 }, { wch: 18 }, { wch: 32 }, { wch: 32 }, { wch: 18 }];
  }

  /* Hoja 4: Reservas IP */
  const resHead = ['VLAN ID', 'VLAN Nombre', 'Alias', 'IPv4', 'IPv6', 'Stack'];
  const resRows = [];
  S.vlans.forEach(v => {
    (v.reserved_ips || []).forEach(r => {
      resRows.push([v.id, v.name, r.alias, r.ip4 || '—', r.ip6 || '—', r.stack.toUpperCase()]);
    });
  });
  let wsRes = null;
  if (resRows.length > 0) {
    wsRes = XLSX.utils.aoa_to_sheet([resHead, ...resRows]);
    wsRes['!cols'] = [{ wch: 8 }, { wch: 18 }, { wch: 22 }, { wch: 16 }, { wch: 32 }, { wch: 8 }];
  }

  /* Construir libro */
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumen');
  XLSX.utils.book_append_sheet(wb, wsVLSM4,   'VLSM IPv4');
  if (wsVLSM6) XLSX.utils.book_append_sheet(wb, wsVLSM6, 'VLSM IPv6');
  if (wsRes)   XLSX.utils.book_append_sheet(wb, wsRes,   'Reservas IP');

  XLSX.writeFile(wb, _fileName('xlsx'));
  showToast('Excel exportado correctamente', 'success');
}


/* ── EXPORTACIÓN PDF ────────────────────────────────────────────
   Usa jsPDF + jspdf-autotable desde CDN. Genera un documento de
   2-3 páginas con resumen ejecutivo, tabla VLSM y reservas.
   ─────────────────────────────────────────────────────────────── */

async function exportPlanPDF() {
  if (!S.vlans.length) {
    showToast('Completa el plan antes de exportar', 'error');
    return;
  }
  showToast('Cargando librería PDF…', 'success');

  try {
    await _loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js');
    await _loadScript('https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js');
  } catch (e) {
    showToast('No se pudo cargar la librería. Verifica tu conexión.', 'error');
    return;
  }
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) { showToast('Error inicializando PDF', 'error'); return; }

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W   = doc.internal.pageSize.getWidth();
  const M   = 40;                                  // margen

  /* ── Cabecera ── */
  doc.setFillColor(26, 111, 196);                  // accent
  doc.rect(0, 0, W, 70, 'F');
  doc.setTextColor(255);
  doc.setFont('helvetica', 'bold').setFontSize(20);
  doc.text('NetPlan Pro v4.0', M, 38);
  doc.setFont('helvetica', 'normal').setFontSize(11);
  doc.text(`Plan de Red — ${S.domain}`, M, 56);

  doc.setTextColor(120);
  doc.setFontSize(9);
  doc.text(new Date().toLocaleDateString('es-CO', { dateStyle: 'long' }), W - M, 56, { align: 'right' });

  let y = 100;
  doc.setTextColor(26, 35, 50);

  /* ── Resumen ejecutivo ── */
  const totalReq  = S.vlans.reduce((s,v) => s + v.hosts_required, 0);
  const totalUsf  = S.vlans.reduce((s,v) => s + v.hosts_useful,   0);
  const efficiency = Math.round((totalReq / totalUsf) * 100);
  const swPiso    = Math.ceil(S.hosts_piso / S.puertos);

  doc.setFont('helvetica', 'bold').setFontSize(13);
  doc.text('Resumen ejecutivo', M, y);
  y += 6;
  doc.setDrawColor(26, 111, 196);
  doc.setLineWidth(1.5);
  doc.line(M, y, M + 130, y);
  y += 18;

  const summaryRows = [
    ['Pisos / Core',        `${S.pisos} pisos · Core en piso ${S.core_piso}`],
    ['Hosts por piso',      `${S.hosts_piso} hosts × ${S.puertos} puertos = ${swPiso} switch(es)`],
    ['Redundancia',         S.redundancia === 'dual' ? 'Dual-Link LACP' : 'Single-Link'],
    ['Vendor',              S.vendor === 'cisco' ? 'Cisco IOS/XE' : 'Huawei VRP'],
    ['Red base IPv4',       (S.net && S.net.address+'/'+S.net.prefix) || '—'],
    ['VLANs / Hosts',       `${S.vlans.length} VLANs · ${totalReq} requeridos · ${totalUsf} útiles`],
    ['Eficiencia VLSM',     `${efficiency}%`],
    ['Dual Stack',          S.ipv6 ? `Sí — ULA: ${S.ula_prefix}` : 'No'],
    ['Servicios',           `DNS: ${S.dns4} · NTP: ${S.ntp}`],
    ['WAN',                 S.wan_nexthop ? `Next-hop ${S.wan_nexthop}` : '—'],
  ];
  doc.autoTable({
    startY: y,
    body:   summaryRows,
    theme:  'plain',
    styles: { fontSize: 9.5, cellPadding: 4 },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 130, textColor: [113, 128, 150] },
      1: { textColor: [26, 35, 50] },
    },
    margin: { left: M, right: M },
  });
  y = doc.lastAutoTable.finalY + 24;

  /* ── Tabla VLSM ── */
  if (y > 720) { doc.addPage(); y = 50; }
  doc.setFont('helvetica', 'bold').setFontSize(13);
  doc.text('Tabla VLSM IPv4', M, y);
  y += 6; doc.line(M, y, M + 130, y); y += 12;

  doc.autoTable({
    startY: y,
    head: [['VLAN', 'Nombre', 'Piso', 'Red', 'Máscara', 'Gateway', 'Broadcast', 'Útiles', 'Ef.%']],
    body: S.vlans.map(v => [
      v.id, v.name, v.floor_label,
      v.network + '/' + v.prefix, v.mask, v.gateway_v4,
      v.broadcast, v.hosts_useful, v.efficiency + '%',
    ]),
    theme: 'striped',
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: {
      fillColor: [26, 111, 196], textColor: 255,
      fontStyle: 'bold', fontSize: 8.5,
    },
    alternateRowStyles: { fillColor: [247, 249, 251] },
    margin: { left: M, right: M },
  });
  y = doc.lastAutoTable.finalY + 24;

  /* ── Tabla VLSM IPv6 (si aplica) ── */
  if (S.ipv6) {
    if (y > 700) { doc.addPage(); y = 50; }
    doc.setFont('helvetica', 'bold').setFontSize(13);
    doc.text('Tabla VLSM IPv6 (Dual Stack)', M, y);
    y += 6; doc.line(M, y, M + 200, y); y += 12;
    doc.autoTable({
      startY: y,
      head: [['VLAN', 'Nombre', 'Subred IPv6', 'Gateway IPv6']],
      body: S.vlans.map(v => [v.id, v.name, v.subnet_v6 || '—', v.gateway_v6 || '—']),
      theme: 'striped',
      styles: { fontSize: 8, cellPadding: 3, font: 'courier' },
      headStyles: { fillColor: [124, 58, 237], textColor: 255, font: 'helvetica', fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [247, 249, 251] },
      margin: { left: M, right: M },
    });
    y = doc.lastAutoTable.finalY + 24;
  }

  /* ── Reservas IP ── */
  const reservations = [];
  S.vlans.forEach(v => (v.reserved_ips || []).forEach(r => {
    reservations.push([
      `VLAN ${v.id} — ${v.name}`, r.alias,
      r.ip4 || '—', r.ip6 || '—', r.stack.toUpperCase(),
    ]);
  }));

  if (reservations.length > 0) {
    if (y > 680) { doc.addPage(); y = 50; }
    doc.setFont('helvetica', 'bold').setFontSize(13);
    doc.text('IPs de reserva', M, y);
    y += 6; doc.line(M, y, M + 130, y); y += 12;
    doc.autoTable({
      startY: y,
      head: [['VLAN', 'Alias', 'IPv4', 'IPv6', 'Stack']],
      body: reservations,
      theme: 'striped',
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [26, 122, 74], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [247, 249, 251] },
      margin: { left: M, right: M },
    });
  }

  /* ── Pie de página en cada página ── */
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal').setFontSize(8);
    doc.setTextColor(140);
    doc.text(`NetPlan Pro v4.0  ·  ${S.domain}`, M, 825);
    doc.text(`Página ${p} / ${pageCount}`, W - M, 825, { align: 'right' });
  }

  doc.save(_fileName('pdf'));
  showToast('PDF exportado correctamente', 'success');
}


/* ── EXPORTACIÓN MERMAID Y DRAWIO ────────────────────────────── */

function exportPlanMermaid() {
  if (!S.vlans.length) { showToast('Completa el plan antes de exportar', 'error'); return; }
  const mmd = generateMermaid();
  _download(new Blob([mmd], { type: 'text/plain' }), _fileName('mmd'));
  showToast('Mermaid exportado — péguelo en GitHub o Notion', 'success');
}

function exportPlanDrawio() {
  if (!S.vlans.length) { showToast('Completa el plan antes de exportar', 'error'); return; }
  const xml = generateDrawioXML();
  _download(new Blob([xml], { type: 'application/xml' }), _fileName('drawio'));
  showToast('Drawio exportado — abrirlo en https://app.diagrams.net', 'success');
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
    step: 0, export_vendor: 'cisco', rollback_vendor: 'cisco',
    vlan_edit_id: null, reserve_expanded: {},
    cloud_plan_id: null,
  });

  /* Resetear selects e inputs numéricos del paso 1 */
  document.getElementById('inp-pisos').value   = '3';
  document.getElementById('inp-core').value    = '1';
  document.getElementById('inp-core').max      = '3';
  const hintCore = document.getElementById('hint-core');
  if (hintCore) hintCore.textContent = 'Rango: 1 – 3 (debe ser ≤ número de pisos)';
  const errCore = document.getElementById('error-core');
  if (errCore)  errCore.textContent  = 'Debe estar entre 1 y 3';
  document.getElementById('sel-puertos').value = '48';
  const selGrowth = document.getElementById('sel-growth');
  if (selGrowth) selGrowth.value = '2';

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
  /* Limpiar autoguardado al reiniciar el plan */
  try { localStorage.removeItem(STORAGE_KEY); } catch(e) {}
  document.getElementById('recovery-banner')?.classList.add('hidden');
  showToast('Plan reiniciado. Comienza desde el paso 1.', 'success');
}


/* ══════════════════════════════════════════════════════════════
   17. PERSISTENCIA — JSON, IMPORT/EXPORT, AUTOGUARDADO
   ══════════════════════════════════════════════════════════════
   Diseño:
   ─ El JSON solo guarda decisiones del usuario (no valores derivados
     como network/mask/gateway). Estos se recalculan al cargar.
   ─ El esquema lleva versión: futuras migraciones via migratePlan().
   ─ La misma estructura sirve para localStorage y para Firebase
     más adelante: una sola fuente de verdad.
   ══════════════════════════════════════════════════════════════ */

const PLAN_SCHEMA_VERSION = 'netplan.v1';
const STORAGE_KEY         = 'netplan_pro_autosave';
const AUTOSAVE_DEBOUNCE   = 800;       // ms — evita saturar localStorage

let _autosaveTimer = null;

/**
 * Construye el objeto JSON serializable del plan actual.
 * Solo incluye lo que el usuario decidió; lo derivado se recalcula.
 */
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

/**
 * Valida y migra un objeto plan recibido (JSON parseado).
 * Devuelve { ok: bool, plan?: object, error?: string }.
 *
 * Reglas de validación: idénticas a las del UI (rango pisos 1-50,
 * core ≤ pisos, hosts 1-500, etc.). Mensajes en español, claros.
 */
function validateAndMigratePlan(data) {
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'JSON malformado o vacío' };
  }
  if (!data.schema) {
    return { ok: false, error: 'Falta el campo "schema" — ¿es un plan NetPlan?' };
  }

  /* Migración (placeholder para futuras versiones) */
  if (data.schema !== PLAN_SCHEMA_VERSION) {
    return { ok: false, error: `Versión "${data.schema}" no soportada. Esperado: ${PLAN_SCHEMA_VERSION}` };
  }

  /* Secciones requeridas */
  for (const k of ['infrastructure', 'services', 'vlans']) {
    if (!data[k]) return { ok: false, error: `Falta sección obligatoria "${k}"` };
  }

  /* infrastructure */
  const i = data.infrastructure;
  if (!Number.isInteger(i.pisos) || i.pisos < 1 || i.pisos > 50)
    return { ok: false, error: 'Pisos debe ser entero entre 1 y 50' };
  if (!Number.isInteger(i.core_piso) || i.core_piso < 1 || i.core_piso > i.pisos)
    return { ok: false, error: `Piso del core debe ser entero entre 1 y ${i.pisos}` };
  if (!Number.isInteger(i.hosts_piso) || i.hosts_piso < 1 || i.hosts_piso > 500)
    return { ok: false, error: 'Hosts por piso debe ser entero entre 1 y 500' };
  if (![24, 48].includes(i.puertos))
    return { ok: false, error: 'Puertos por switch debe ser 24 o 48' };
  if (!['single', 'dual'].includes(i.redundancia))
    return { ok: false, error: 'Redundancia debe ser "single" o "dual"' };
  if (!['cisco', 'huawei'].includes(i.vendor))
    return { ok: false, error: 'Vendor debe ser "cisco" o "huawei"' };
  if (![1.5, 2, 3].includes(i.growth_factor))
    return { ok: false, error: 'Factor de crecimiento debe ser 1.5, 2 o 3' };

  /* services */
  const s = data.services;
  if (!isValidIPv4(s.dns4 || ''))            return { ok: false, error: 'DNS IPv4 inválido' };
  if (!isValidIPv6(s.dns6 || ''))            return { ok: false, error: 'DNS IPv6 inválido' };
  if (!isValidIPv4orHostname(s.ntp || ''))   return { ok: false, error: 'NTP inválido (IPv4 u hostname)' };
  if (!isValidDomain(s.domain || ''))        return { ok: false, error: 'Dominio interno inválido' };
  if (typeof s.ipv6 !== 'boolean')           return { ok: false, error: 'Campo services.ipv6 debe ser booleano' };
  if (s.wan_nexthop && !isValidIPv4(s.wan_nexthop))
    return { ok: false, error: 'WAN next-hop inválido' };
  if (!Array.isArray(s.wan_routes))          return { ok: false, error: 'wan_routes debe ser array' };
  for (const r of s.wan_routes) {
    if (!parseCIDR(r)) return { ok: false, error: `Ruta WAN inválida: "${r}"` };
  }

  /* ipv4.override (opcional) */
  const ov = data.ipv4?.override || '';
  if (ov && !parseCIDR(ov)) return { ok: false, error: `Override CIDR inválido: "${ov}"` };

  /* vlans */
  if (!Array.isArray(data.vlans) || data.vlans.length === 0)
    return { ok: false, error: 'Debe haber al menos 1 VLAN' };
  const seen = new Set();
  for (const v of data.vlans) {
    if (!Number.isInteger(v.id) || v.id < 1 || v.id > 4094)
      return { ok: false, error: `VLAN ID inválido: ${v.id}` };
    if (seen.has(v.id))
      return { ok: false, error: `VLAN ID duplicado: ${v.id}` };
    seen.add(v.id);
    if (typeof v.name !== 'string' || !v.name.trim())
      return { ok: false, error: `VLAN ${v.id}: nombre inválido` };
    if (!Number.isInteger(v.hosts_required) || v.hosts_required < 2 || v.hosts_required > 500)
      return { ok: false, error: `VLAN ${v.id}: hosts requeridos debe estar entre 2 y 500` };
    if (!['all', 'core'].includes(v.floor))
      return { ok: false, error: `VLAN ${v.id}: floor debe ser "all" o "core"` };
  }

  return { ok: true, plan: data };
}

/**
 * Aplica un plan validado al estado S y al DOM.
 * Recalcula análisis IPv4 y VLSM, y navega al paso de Resumen.
 */
function applyPlan(plan) {
  /* infrastructure */
  S.pisos         = plan.infrastructure.pisos;
  S.core_piso     = plan.infrastructure.core_piso;
  S.hosts_piso    = plan.infrastructure.hosts_piso;
  S.puertos       = plan.infrastructure.puertos;
  S.redundancia   = plan.infrastructure.redundancia;
  S.vendor        = plan.infrastructure.vendor;
  S.growth_factor = plan.infrastructure.growth_factor;

  /* ipv4 */
  S.override = plan.ipv4?.override || '';

  /* services */
  S.dns4        = plan.services.dns4;
  S.dns6        = plan.services.dns6;
  S.ntp         = plan.services.ntp;
  S.domain      = plan.services.domain;
  S.ipv6        = !!plan.services.ipv6;
  S.wan_nexthop = plan.services.wan_nexthop || '';
  S.wan_routes  = Array.isArray(plan.services.wan_routes) ? plan.services.wan_routes : [];

  /* vlans */
  S.vlan_defs = plan.vlans.map(v => ({
    id:             v.id,
    name:           v.name,
    type:           v.type,
    badge:          v.badge || TYPE_BADGE[v.type] || 'blue',
    floor:          v.floor,
    hosts_required: v.hosts_required,
    reserved_ips:   Array.isArray(v.reserved_ips) ? v.reserved_ips.slice() : [],
  }));

  /* Sincronizar DOM */
  syncDOMFromState();

  /* Recalcular todo */
  runAnalysis();
  buildVLANPlan();
  renderVLANCards();
  updateVlansCount();
  renderSummary();

  /* Ir al paso de Resumen para que el usuario vea el plan completo */
  activateStep(4);
}

/**
 * Sincroniza los inputs del DOM con los valores actuales de S.
 * Se usa después de cargar un plan o restaurar autoguardado.
 */
function syncDOMFromState() {
  /* Paso 1 — infraestructura */
  const inpPisos = document.getElementById('inp-pisos');
  const inpCore  = document.getElementById('inp-core');
  if (inpPisos) inpPisos.value = S.pisos;
  if (inpCore) {
    inpCore.max   = S.pisos;
    inpCore.value = S.core_piso;
  }
  const hint = document.getElementById('hint-core');
  if (hint) hint.textContent = `Rango: 1 – ${S.pisos} (debe ser ≤ número de pisos)`;
  const err  = document.getElementById('error-core');
  if (err)  err.textContent  = `Debe estar entre 1 y ${S.pisos}`;

  const inpHosts = document.getElementById('inp-hosts');
  if (inpHosts) inpHosts.value = S.hosts_piso ?? '';

  document.getElementById('sel-puertos').value = String(S.puertos);
  const selGrowth = document.getElementById('sel-growth');
  if (selGrowth) selGrowth.value = String(S.growth_factor);

  /* Toggles */
  document.querySelectorAll('#tg-redund .toggle-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.value === S.redundancia)
  );
  document.querySelectorAll('#tg-vendor .vendor-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.value === S.vendor)
  );

  /* Paso 2 — override CIDR */
  const inpOver = document.getElementById('inp-override');
  if (inpOver) inpOver.value = S.override || '';

  /* Paso 3 — servicios */
  document.getElementById('inp-dns4').value   = S.dns4;
  document.getElementById('inp-dns6').value   = S.dns6;
  document.getElementById('inp-ntp').value    = S.ntp;
  document.getElementById('inp-domain').value = S.domain;
  document.getElementById('chk-ipv6').checked = S.ipv6;
  document.getElementById('ipv6-info')?.classList.toggle('hidden', !S.ipv6);

  /* Paso 3 — WAN */
  const wn = document.getElementById('inp-wan-nexthop');
  if (wn) wn.value = S.wan_nexthop || '';
  const wr = document.getElementById('inp-wan-routes');
  if (wr) wr.value = (S.wan_routes || []).join('\n');

  /* Limpiar estados de validación previos */
  document.querySelectorAll('.field.invalid').forEach(f => f.classList.remove('invalid'));

  /* Panel lateral */
  setText('st-vendor',  S.vendor === 'cisco' ? 'Cisco' : 'Huawei');
  setText('st-redund',  S.redundancia === 'single' ? 'Single-Link' : 'Dual-Link (LACP)');
  setText('st-hpiso',   S.hosts_piso ?? '—');
  setText('st-ports',   S.puertos);
  setText('st-sw',      S.hosts_piso ? Math.ceil(S.hosts_piso / S.puertos) : '—');
}

/**
 * Descarga el plan actual como archivo JSON.
 * Solo se permite si hay datos mínimos (paso 1 completo).
 */
function exportPlanJSON() {
  if (!S.pisos || !S.core_piso || !S.hosts_piso) {
    showToast('Completa al menos el paso 1 antes de exportar', 'error');
    return;
  }
  const plan = buildPlanJSON();
  const json = JSON.stringify(plan, null, 2);
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = `netplan_${S.domain}_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Plan JSON exportado correctamente', 'success');
}

/** Dispara el diálogo de selección de archivo. */
function triggerImportJSON() {
  const fi = document.getElementById('file-import-json');
  if (fi) { fi.value = ''; fi.click(); }
}

/** Maneja el archivo seleccionado para importar. */
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
    /* JSON importado desde archivo no está vinculado a ningún plan en nube */
    S.cloud_plan_id = null;
    showToast('Plan cargado correctamente', 'success');
  };
  reader.onerror = () => showToast('No se pudo leer el archivo', 'error');
  reader.readAsText(file);
}

/* ── AUTOGUARDADO EN localStorage ────────────────────────────── */

/**
 * Guarda el plan actual en localStorage con debounce.
 * Solo guarda si hay datos mínimos (evita guardar plantilla vacía).
 */
function autosave() {
  clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(() => {
    try {
      /* No guardar hasta que el usuario haya tocado algo significativo */
      if (!S.hosts_piso) return;
      const plan = buildPlanJSON();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
    } catch (e) {
      /* Cuota llena, modo privado, etc. — silencioso */
      console.warn('Autoguardado no disponible:', e.message);
    }
  }, AUTOSAVE_DEBOUNCE);
}

/**
 * Comprueba si hay un autoguardado al cargar la app.
 * Si lo hay, muestra el banner de recuperación.
 */
function checkAutosaveOnLoad() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const plan = JSON.parse(raw);
    if (!plan || plan.schema !== PLAN_SCHEMA_VERSION) return;
    if (!plan.infrastructure?.hosts_piso) return;

    /* Mostrar banner con metadata */
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

/** Restaura el autoguardado y lo aplica al plan actual. */
function restoreAutosave() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
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
    /* El autoguardado local no rastrea el ID de nube; al restaurar
       lo desvinculamos para evitar sobreescribir el plan equivocado */
    S.cloud_plan_id = null;
    document.getElementById('recovery-banner')?.classList.add('hidden');
    showToast('Plan restaurado desde autoguardado', 'success');
  } catch (e) {
    showToast('Error al restaurar: ' + e.message, 'error');
  }
}

/** Descarta el autoguardado actual. */
function discardAutosave() {
  try { localStorage.removeItem(STORAGE_KEY); } catch(e) {}
  document.getElementById('recovery-banner')?.classList.add('hidden');
  showToast('Autoguardado descartado', 'success');
}


/* ══════════════════════════════════════════════════════════════
   18. NUBE — UI Y HANDLERS DE FIREBASE
   ══════════════════════════════════════════════════════════════
   Toda la lógica Firebase vive en firebase-cloud.js (módulo ES6).
   Aquí solo se invoca la API expuesta en window.NetPlanCloud.
   Si la nube no está configurada, los botones .cloud-only quedan
   ocultos por CSS y estos handlers nunca se llaman.
   ══════════════════════════════════════════════════════════════ */

/**
 * Espera el evento que dispara firebase-cloud.js cuando termina de
 * inicializar. Si la nube quedó disponible, activa la UI cloud
 * (clase body.cloud-ready) y suscribe el cambio de auth.
 */
window.addEventListener('netplan-cloud-ready', (e) => {
  if (!e.detail?.available) return;
  document.body.classList.add('cloud-ready');
  if (window.NetPlanCloud) {
    window.NetPlanCloud.onAuthStateChanged(updateUserMenuUI);
  }
});

/**
 * Actualiza el menú de usuario según el estado de auth.
 * Para usuarios anónimos: avatar "?" y botón "Iniciar sesión".
 * Para usuarios con Google: avatar con inicial, email visible y botón "Cerrar sesión".
 */
function updateUserMenuUI(user) {
  if (!user) return;
  const avatar    = document.getElementById('user-avatar');
  const label     = document.getElementById('user-label');
  const info      = document.getElementById('user-menu-info');
  const btnIn     = document.getElementById('btn-signin-google');
  const btnOut    = document.getElementById('btn-signout');

  if (user.isAnonymous) {
    if (avatar) avatar.textContent = '?';
    if (label)  label.textContent  = 'Anónimo';
    if (info)   info.textContent   = 'Sesión anónima — los planes solo son accesibles desde este navegador';
    btnIn?.classList.remove('hidden');
    btnOut?.classList.add('hidden');
  } else {
    const display = user.displayName || user.email || 'Usuario';
    const initial = (display[0] || 'U').toUpperCase();
    if (avatar) avatar.textContent = initial;
    if (label)  label.textContent  = display.split(' ')[0];
    if (info)   info.textContent   = user.email || display;
    btnIn?.classList.add('hidden');
    btnOut?.classList.remove('hidden');
  }
}

/** Abre/cierra el dropdown del menú de usuario. */
function toggleUserMenu(evt) {
  evt?.stopPropagation();
  document.getElementById('user-menu-dropdown')?.classList.toggle('hidden');
}

/* Cerrar dropdown al hacer click afuera */
document.addEventListener('click', (e) => {
  const menu = document.getElementById('user-menu');
  const dd   = document.getElementById('user-menu-dropdown');
  if (menu && dd && !menu.contains(e.target) && !dd.classList.contains('hidden')) {
    dd.classList.add('hidden');
  }
});

/** Inicia sesión con Google. */
async function cloudSignInWithGoogle() {
  if (!window.NetPlanCloud?.isAvailable()) return;
  document.getElementById('user-menu-dropdown')?.classList.add('hidden');
  try {
    await window.NetPlanCloud.signInWithGoogle();
    showToast('Sesión iniciada con Google', 'success');
  } catch (e) {
    if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') {
      return; /* usuario canceló, sin toast */
    }
    showToast('No se pudo iniciar sesión: ' + (e.message || e.code), 'error');
  }
}

/** Cierra sesión y vuelve a anónimo. */
async function cloudSignOut() {
  if (!window.NetPlanCloud?.isAvailable()) return;
  if (!confirm('¿Cerrar sesión? Tus planes en la nube quedarán inaccesibles hasta que vuelvas a iniciar sesión con la misma cuenta.')) {
    return;
  }
  document.getElementById('user-menu-dropdown')?.classList.add('hidden');
  try {
    await window.NetPlanCloud.signOut();
    S.cloud_plan_id = null;
    showToast('Sesión cerrada', 'success');
  } catch (e) {
    showToast('Error al cerrar sesión: ' + e.message, 'error');
  }
}

/** Abre el modal de planes en la nube y refresca la lista. */
function openCloudPlansModal() {
  if (!window.NetPlanCloud?.isAvailable()) {
    showToast('Nube no configurada', 'error');
    return;
  }
  document.getElementById('modal-cloud-plans')?.classList.remove('hidden');
  /* Pre-llenar el nombre con el dominio del plan actual si está vacío */
  const inp = document.getElementById('inp-plan-name');
  if (inp && !inp.value && S.domain) inp.value = S.domain;
  refreshCloudPlansList();
}

/** Cierra el modal de planes en la nube. */
function closeCloudPlansModal() {
  document.getElementById('modal-cloud-plans')?.classList.add('hidden');
}

/**
 * Guarda el plan actual en la nube.
 * Si S.cloud_plan_id existe, sobreescribe ese plan; de lo contrario crea uno nuevo.
 */
async function cloudSaveCurrentPlan() {
  if (!window.NetPlanCloud?.isAvailable()) return;

  /* Validación mínima — coherente con exportPlanJSON */
  if (!S.pisos || !S.core_piso || !S.hosts_piso) {
    showToast('Completa al menos el paso 1 antes de guardar', 'error');
    return;
  }

  const name = document.getElementById('inp-plan-name')?.value?.trim() || S.domain || 'Plan sin título';
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

/**
 * Refresca la lista de planes en el modal.
 * Renderiza filas con nombre, metadata y acciones (cargar / renombrar / eliminar).
 */
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
          <span class="cloud-plan-meta">${p.vlanCount} VLAN${p.vlanCount !== 1 ? 's' : ''} · ${escapeHTML(p.domain || '—')} · ${updated}</span>
        </div>
        <div class="cloud-plan-actions">
          <button class="btn-cloud-action" title="Cargar este plan" data-act="load" data-id="${p.id}">↓</button>
          <button class="btn-cloud-action" title="Renombrar"        data-act="rename" data-id="${p.id}" data-name="${escapeHTML(p.name)}">✎</button>
          <button class="btn-cloud-action btn-cloud-action-danger" title="Eliminar" data-act="delete" data-id="${p.id}" data-name="${escapeHTML(p.name)}">✕</button>
        </div>
      `;
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

/** Maneja click en los botones de cada plan listado. */
async function onCloudPlanAction(btn) {
  const id   = btn.dataset.id;
  const act  = btn.dataset.act;
  const name = btn.dataset.name || '';

  if (act === 'load') {
    try {
      const plan = await window.NetPlanCloud.loadPlan(id);
      const result = validateAndMigratePlan(plan);
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
    if (newName === null) return;          // canceló
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
    if (!confirm(`¿Eliminar "${name}" permanentemente? Esta acción no se puede deshacer.`)) return;
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

/** Escapa texto para inserción segura como HTML. */
function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}


/* ══════════════════════════════════════════════════════════════
   19. INICIALIZACIÓN
   ══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  /*
   * Al cargar, S.pisos = 3 y S.core_piso = 1 (inicializados en S),
   * que coinciden con los valores por defecto de inp-pisos e inp-core.
   * El botón Siguiente arranca deshabilitado hasta que inp-hosts sea válido.
   */
  activateStep(0);
  /* Verificar si hay un plan auto-guardado para ofrecer recuperación */
  checkAutosaveOnLoad();
});
