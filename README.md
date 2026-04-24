# NetPlan Pro v4.0

Herramienta web de planificación de redes corporativas con VLSM, Dual-Stack (IPv4 + IPv6), enrutamiento estático documentado y generación de configuraciones listas para aplicar en equipos Cisco, Huawei y FortiGate.

---

## Características principales

- **Wizard guiado de 6 pasos** — desde la infraestructura hasta la exportación
- **VLSM automático** — calcula subredes de longitud variable a partir del número real de hosts por VLAN
- **Dual-Stack (IPv4 + IPv6)** — prefijo ULA `/48` derivado de la red base; bloque `/64` por VLAN; SLAAC + DHCPv6 Stateless
- **Factor de crecimiento configurable** — 1.5× (corto plazo), 2× (medio, recomendado) o 3× (largo plazo)
- **6 VLANs prediseñadas** con factores calibrados, más soporte para VLANs personalizadas
- **IPs de reserva por VLAN** — rango `.1`–`.10` con alias, IPv4, IPv6 y tipo de stack (IPv4 / IPv6 / Dual)
- **Enrutamiento estático documentado** — separación explícita entre rutas conectadas (SVIs) y rutas estáticas (default + sedes remotas WAN)
- **Generadores de configuración** para Cisco IOS/XE, Huawei VRP y FortiGate (FortiOS)
- **Borrado seguro por vendor** — comandos inversos exactos sin afectar la imagen del sistema operativo
- **Topología lógica SVG** — generada automáticamente sin dependencias externas
- **Exportación unificada** — un único HTML autocontenido con tabla VLSM, IPs de reserva, tabla de enrutamiento, topología y configuraciones por vendor

---

## Archivos del proyecto

```
netplan/
├── index.html    — Estructura HTML del wizard (578 líneas)
├── script.js     — Lógica completa de la aplicación (2 479 líneas, 83 funciones)
└── styles.css    — Estilos de la interfaz (1 090 líneas)
```

No requiere dependencias externas, frameworks ni servidor. Se ejecuta directamente en el navegador.

---

## Cómo usar

1. Abre `index.html` en cualquier navegador moderno (Chrome, Firefox, Edge, Safari)
2. Completa los 6 pasos del wizard en orden
3. En el **Paso 05** revisa el resumen y la topología generada
4. En el **Paso 06** previsualiza la configuración por vendor y exporta el plan completo

---

## Pasos del wizard

### Paso 01 — Infraestructura

Define los parámetros físicos de la red:

| Campo | Descripción | Valores válidos |
|---|---|---|
| Número de pisos | Total de plantas del edificio | 1 – 10 |
| Piso del Core / CPD | Planta donde se ubica el Core Switch y el CPD | 1 – pisos configurados |
| Hosts por piso (promedio) | Cantidad estimada de dispositivos por planta | 1 – 500 |
| Puertos por switch | Capacidad del switch de acceso | 24 o 48 |
| Factor de crecimiento | Multiplicador de hosts para dimensionar la red base | 1.5× / 2× / 3× |
| Redundancia de enlaces | Modo de conexión entre switches | Single-Link / Dual-Link (LACP) |
| Vendor principal | Fabricante del equipo Core | Cisco / Huawei |

**Cálculos automáticos que se actualizan en tiempo real:**
- Switches de acceso necesarios por piso: `ceil(hosts_piso / puertos)`
- Hosts totales: `hosts_piso × pisos`
- Hosts planificados: `hosts_totales × growth_factor`

### Paso 02 — Análisis IPv4

La herramienta selecciona automáticamente la red base más eficiente del espacio privado RFC 1918, con los siguientes criterios:

- Espacio privado válido (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
- Prefijo calculado: `32 − ceil(log₂(hosts_planificados + 2))`
- Score de eficiencia: porcentaje de hosts planificados sobre el total de hosts útiles de la red base

También se puede sobrescribir la red base con una notación CIDR personalizada.

### Paso 03 — Servicios de red

| Campo | Descripción | Por defecto |
|---|---|---|
| DNS primario IPv4 | Servidor DNS para los pools DHCP | 8.8.8.8 |
| DNS primario IPv6 | Servidor DNS en los pools DHCPv6 | 2001:4860:4860::8888 |
| NTP | Servidor de tiempo | pool.ntp.org |
| Dominio interno | Sufijo DNS de la organización | corp.local |
| IPv6 Dual-Stack | Activa el direccionamiento IPv6 en todas las VLANs | Activado |
| Next-hop WAN *(opcional)* | IPv4 del equipo de borde del ISP o firewall externo | — |
| Redes remotas *(opcional)* | CIDRs de sedes remotas, una por línea | — |

Si se configuran redes remotas, la herramienta genera rutas estáticas específicas en la configuración de todos los vendors.

### Paso 04 — VLANs

La herramienta genera automáticamente las siguientes VLANs prediseñadas:

| VLAN ID | Nombre | Ámbito | Factor de hosts | Hosts mínimos |
|---|---|---|---|---|
| 10 | Usuarios | Todos los pisos | 70 % del total | 10 |
| 20 | Administración | Piso Core (CPD) | 10 % del total | 10 |
| 30 | Servidores | Piso Core (CPD) | 5 % del total | 20 |
| 40 | VoIP | Todos los pisos | 30 % del total | 10 |
| 50 | WiFi-Invitados | Todos los pisos | 40 % del total | 10 |
| 60 | Gestión | Todos los pisos | Calculado por dispositivos | — |

**Cálculo de VLAN 60 (Gestión):**
```
switches_por_piso  = ceil(hosts_piso / puertos)
aps_por_piso       = ceil(hosts_piso / 30)       ← 1 AP c/30 usuarios (IEEE 802.11)
dispositivos_mgmt  = (switches + aps) × pisos + 3  ← +3: Core + Firewall + margen
```

**Indicadores visuales:**
- ⚠ **Supera prom./piso** — aparece en la tarjeta cuando `hosts_required > hosts_piso`, advirtiendo que la VLAN fue dimensionada considerando múltiples pisos
- Las VLANs se ordenan de mayor a menor hosts requeridos antes de aplicar VLSM, garantizando la asignación óptima

**VLANs personalizadas** — se pueden agregar VLANs adicionales con cualquier ID (1–4094), nombre, tipo y número de hosts. La herramienta valida que el ID no esté duplicado.

**IPs de reserva por VLAN:**
- Rango disponible: `.1` (gateway) a `.10` de cada subred — máximo 9 reservas por VLAN
- Campos: Alias/Hostname, IPv4, IPv6 y tipo de stack (Solo IPv4 / Solo IPv6 / Dual Stack)
- Las reservas se incluyen como pools DHCP estáticos en la configuración exportada

### Paso 05 — Resumen

Muestra la tabla VLSM completa con todos los parámetros calculados y la topología lógica SVG generada automáticamente.

### Paso 06 — Exportar

Cuatro tabs de previsualización:

| Tab | Contenido |
|---|---|
| Cisco IOS/XE | Configuración para Core Switch Catalyst y ASA/Firepower |
| Huawei VRP | Configuración para switches S-series y USG |
| FortiGate (FW) | Configuración para firewall perimetral FortiOS |
| ⚠ Borrado Seguro | Comandos inversos para deshacer toda la configuración |

El botón **Exportar plan completo (HTML)** descarga un único archivo autocontenido con:
- Métricas globales (eficiencia, VLANs, hosts, switches)
- Tabla VLSM completa (IPv4 + IPv6)
- Tabla de IPs de reserva con stack
- Tabla de enrutamiento documentada (conectadas vs. estáticas)
- Nota explicativa sobre inter-VLAN via SVIs
- Topología lógica SVG
- Configuraciones Cisco / Huawei / FortiGate en tabs interactivos
- Borrado seguro por vendor

---

## Cálculos técnicos

### VLSM (Variable Length Subnet Masking)

Las VLANs se ordenan de mayor a menor `hosts_required` y se asignan subredes de forma contigua dentro del bloque base:

```
prefix_vlan = 32 − ceil(log₂(hosts_required + 2))
hosts_útiles = 2^(32 − prefix) − 2
eficiencia   = round(hosts_required / hosts_útiles × 100) %
```

### IPv6 ULA

El prefijo `/48` se deriva del último octeto par de la dirección IPv4 base:

```
fd[HH]:[LLLL]:0000::/48
```

Cada VLAN recibe un bloque `/64` a partir del offset del ID de VLAN, y la gateway es siempre `::1` dentro de ese bloque.

### Enrutamiento estático

La herramienta distingue explícitamente entre:

- **Rutas conectadas** — instaladas automáticamente en el RIB del Core Switch al configurar cada SVI. No requieren comandos `ip route`.
- **Ruta estática por defecto** — `ip route 0.0.0.0 0.0.0.0 [IP_Firewall]` para el tráfico hacia Internet.
- **Rutas estáticas WAN** — una entrada por red remota declarada en el Paso 03, con next-hop hacia el equipo de borde del ISP.

---

## Borrado seguro (Rollback)

Genera los comandos inversos exactos en el orden correcto (rutas → DHCP → IPv6 → SVIs → VLANs → LACP) para deshacer la configuración aplicada **sin afectar la imagen del sistema operativo**:

| Vendor | Borrado de config | Borrado de startup (opcional) |
|---|---|---|
| Cisco IOS/XE | `no vlan`, `no interface Vlan`, `no ip dhcp pool`, `no ip route` | `write erase` + `reload` |
| Huawei VRP | `undo vlan batch`, `undo interface Vlanif`, `undo ip pool`, `undo ip route-static` | `reset saved-configuration` + `reboot` |
| FortiGate | `delete system interface`, `delete system dhcp server`, `delete router static` | `execute factoryreset` |

> **Nota:** Los comandos opcionales de borrado de startup (`write erase`, `reset saved-configuration`, `execute factoryreset`) eliminan la configuración guardada pero **nunca** tocan la imagen IOS/VRP/FortiOS ni las licencias del equipo.

---

## VLANs WiFi y configuración de APs

La VLAN 50 (WiFi-Invitados) genera correctamente la SVI, el pool DHCP IPv4 e IPv6 y las rutas correspondientes. Sin embargo, la configuración específica del punto de acceso inalámbrico (SSID, cifrado WPA3, bandas 2.4/5 GHz, portal cautivo, roaming) es interactiva y específica de cada vendor:

- **Cisco** — Catalyst Center / Meraki Dashboard
- **Huawei** — AirEngine Campus Insight
- **Ubiquiti** — UniFi Controller
- **Aruba** — Aruba Central / AOS

La configuración exportada incluye un comentario explícito en el bloque de la VLAN 50 indicando este punto.

---

## Estructura del código (`script.js`)

El archivo está organizado en 17 secciones documentadas:

| Sección | Contenido |
|---|---|
| 1 — Estado global | Objeto `S` — única fuente de verdad de toda la aplicación |
| 2 — Constantes | `VLAN_TEMPLATES`, `TYPE_BADGE`, rangos de validación |
| 3 — Utilidades IPv4 | `ipToInt`, `intToIp`, `prefixToMask`, `parseCIDR`, `calcNextSubnet` |
| 4 — Utilidades IPv6 | `calcULAPrefix`, `calcVlanIPv6`, `isValidIPv6` |
| 5 — Validaciones | `isValidIPv4`, `isValidDomain`, `setFieldValidity`, `validateStep` |
| 6 — Paso 01 | `onHostsChange`, `onCoreChange`, `onGrowthChange`, `selectToggle`, `selectVendor` |
| 7 — Paso 02 | `runAnalysis`, `onOverrideChange` |
| 8 — Paso 03 | `onServicesChange`, `onIPv6Toggle`, `onWanChange` |
| 9 — Paso 04 (lógica) | `initVlanDefs`, `buildVLANPlan`, `saveVlan`, `deleteVlan`, `validateVlanForm` |
| 10 — Paso 04 (render) | `renderVLANCards`, `editVlan` |
| 10b — IPs de reserva | `renderReserveSection`, `saveReservation`, `deleteReservation`, `validateReserveForm` |
| Helpers config | `buildWifiComment`, `buildWanRoutes` — reutilizados en los tres vendors |
| 12 — Cisco | `generateCiscoConfig` |
| 13 — Huawei | `generateHuaweiConfig` |
| 13b — FortiGate | `generateFortinetConfig` |
| 14 — Exportar | `selectExportTab`, `renderExportCode`, `generateRollback`, `generateTopologySVG`, `downloadPlan` |
| 15 — Navegación | `changeStep`, `updateStepUI` |
| 16 — UI | `updateSidePanel`, `showToast`, `closeModal`, `resetApp` |
| 17 — Init | Listener `DOMContentLoaded` |

---

## Validaciones implementadas

Todos los campos del wizard tienen validación en tiempo real que bloquea el avance al siguiente paso si hay errores:

- **IPv4** — formato `x.x.x.x` con octetos 0–255
- **IPv6** — notación completa y abreviada `::` permitida
- **CIDR** — red y prefijo válidos (8–30), dentro del espacio RFC 1918
- **Hostname / Dominio** — expresión regular `[a-zA-Z0-9\-\.]+`
- **ID de VLAN** — entero 1–4094, único dentro del plan
- **Hosts por piso** — entero 1–500
- **Alias de reserva** — alfanumérico con guion y punto, máximo 30 caracteres
- **IPs de reserva** — dentro del rango `.1`–`.10` de la subred VLAN, sin duplicados
- **Redes remotas WAN** — cada línea debe ser CIDR válido

---

## Compatibilidad

| Entorno | Soporte |
|---|---|
| Chrome / Edge (Chromium) | ✓ Completo |
| Firefox | ✓ Completo |
| Safari | ✓ Completo |
| Dispositivos móviles | ✓ Responsive |
| Servidor web | No requerido — archivo estático |
| Dependencias npm / CDN | Ninguna |

---

## Historial de versiones

### v4.0 (actual)
- Borrado seguro por vendor (Cisco, Huawei, FortiGate) con tab dedicado en el Paso 06
- Topología lógica SVG generada automáticamente sin librerías externas
- Exportación unificada en un único HTML autocontenido (`downloadPlan`)
- Sección de enrutamiento estático WAN con validación CIDR por línea
- Factor de crecimiento configurable (1.5×/2×/3×)
- VLAN 50 WiFi-Invitados con comentario explícito para configuración de AP
- Helpers compartidos `buildWifiComment` y `buildWanRoutes` — sin duplicación entre vendors
- Conteo de APs en la VLAN de Gestión (`ceil(hosts/30)` por piso)
- Ajuste de factores: Usuarios 0.70, VoIP 0.30, WiFi 0.40
- Eliminación de `downloadSummary`, `downloadCisco`, `downloadHuawei`, `downloadFortinet`

### v1.0
- Factor de crecimiento configurable en el Paso 01
- Sección de IPs de reserva Dual Stack por VLAN (máx. 9 por VLAN)
- Indicador visual ⚠ en tarjetas VLAN cuando `hosts_required > hosts_piso`
- VLAN 50 WiFi-Invitados agregada a las plantillas
- Enrutamiento estático WAN opcional en el Paso 03

### v2.0
- Indicador de desbordamiento de hosts por VLAN
- Sección de reservas con validación en tiempo real
- Corrección del factor VoIP (0.50 → 0.30)

### v3.0
- Wizard de 6 pasos con VLSM automático
- Dual-Stack IPv6 con prefijo ULA derivado de la red base
- Generadores de configuración Cisco, Huawei y FortiGate
- Panel lateral con estado del plan en tiempo real

---

## Licencia

Desarrollado como proyecto académico en el marco de la asignatura **Interconexión de Redes WAN** — Fundación Universitaria Compensar, Bogotá D.C., Colombia. 2026.
