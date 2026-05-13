# NetPlan Pro v4.0

> **Herramienta web de planificación de red multi-vendor con enrutamiento estático Dual-Stack**  
> VLSM automático · IPv4 + IPv6 ULA · Cisco IOS/XE · Huawei VRP · FortiGate · Firebase Cloud

---

## ¿Qué es NetPlan Pro?

NetPlan Pro es una herramienta web de planificación de redes corporativas construida en HTML, CSS y JavaScript vanilla — sin frameworks, sin build steps, sin dependencias de runtime. El operador de red captura las decisiones de diseño una sola vez a través de un wizard de 6 pasos y obtiene:

- **Plan de direccionamiento VLSM** completo con IPv4 y IPv6 Dual-Stack
- **Configuraciones listas para aplicar** en Cisco IOS/XE, Huawei VRP y FortiGate
- **Borrado seguro por vendor** (rollback completo sin tocar la imagen del SO)
- **Topología lógica SVG** generada automáticamente con soporte de Dual-Link LACP
- **Exportación en 6 formatos**: HTML, PDF, Excel, JSON, Mermaid, drawio
- **Persistencia en la nube** vía Firebase Auth + Firestore (opcional)

---

## Demo rápida

```bash
# Sin instalación — servir los archivos estáticos
python3 -m http.server 8000
# Abrir http://localhost:8000
```

> **Nota:** Firebase (guardado en la nube) requiere configuración adicional. Sin configurarla, la herramienta funciona completamente en modo local con autoguardado en `localStorage`.

---

## Características principales

### Wizard de 6 pasos

| Paso | Contenido |
|------|-----------|
| **1 — Infraestructura** | Pisos, Core/CPD, hosts por piso, puertos, redundancia, vendor, factor de crecimiento |
| **2 — Red base** | Auto-cálculo del bloque IPv4 óptimo o override CIDR personalizado |
| **3 — Servicios y WAN** | DNS, NTP, dominio, Dual-Stack IPv6, next-hop WAN, rutas estáticas remotas |
| **4 — VLANs** | Definición de VLANs con tipo, piso asignado, hosts requeridos e IPs de reserva |
| **5 — Resumen** | Tabla VLSM completa, métricas globales, topología SVG, tabla de enrutamiento |
| **6 — Exportación** | 6 formatos de exportación + pestaña de borrado seguro por vendor |

### Motor VLSM

- Ordena las VLANs por demanda decreciente y asigna subredes contiguas dentro del bloque base
- Calcula máscara, gateway, broadcast, primera/última IP útil, hosts útiles y eficiencia por VLAN
- Aplica factor de crecimiento configurable: `1.5×` (1–2 años), `2×` (3–5 años), `3×` (5–10 años)
- Score de eficiencia global con validación del umbral mínimo (50% aceptable, 80%+ excelente)

### Dual-Stack IPv6

- Deriva prefijo ULA `/48` a partir del identificador IPv4 de la red base (`fd0a:XXXX::/48`)
- Asigna un bloque `/64` por VLAN siguiendo la convención de mejor práctica IPv6
- VLAN ID = Subnet ID en IPv6 (correspondencia uno a uno, simplifica operación NOC)
- Genera pools DHCP IPv4 y DHCPv6 stateless (SLAAC + `other-config-flag`)

### Generadores por vendor

Tres generadores independientes que comparten helpers para evitar duplicación:

```
Cisco IOS/XE    → VLANs, SVIs, DHCP pools, rutas estáticas, LACP
Huawei VRP      → VLANs, VLANIF, DHCP, rutas estáticas, Eth-Trunk
FortiGate       → Zonas, interfaces, DHCP server, políticas, rutas estáticas
```

### Borrado seguro

Comandos inversos exactos por vendor (`no` / `undo` / `delete`) en orden de dependencia:

```
Rutas estáticas → DHCP → SVIs → VLANs → Trunks/LAG
```

**No elimina la imagen del SO ni las licencias del equipo.**

### Topología SVG

- Layout dinámico que escala con el número de pisos (modo wrap automático si pisos > 5)
- Diferencia visual **Single-Link** vs **Dual-Link LACP** (líneas dobles con etiqueta `LACP`)
- Chips de VLAN coloreados por tipo bajo cada switch, sin truncar
- Exportable en Mermaid (GitHub/Notion/Confluence) y drawio (diagrams.net)

### Persistencia

Tres niveles complementarios:

```
localStorage    → Autoguardado local con debounce (800 ms) + banner de recuperación
Firebase        → Guardado multi-dispositivo por usuario (anónimo o Google)
JSON            → Export/import versionado (esquema netplan.v1)
```

---

## Estructura del proyecto

```
netplan-pro/
├── index.html              # Aplicación completa (wizard, modales, UI)
├── script.js               # Lógica principal (~3800 líneas)
│   ├── Motor VLSM          # Cálculo de subredes IPv4 + IPv6
│   ├── Generadores         # Cisco / Huawei / FortiGate / Rollback
│   ├── Topología SVG       # Generador + Mermaid + drawio
│   ├── Exportación         # HTML / PDF / Excel / JSON / Mermaid / drawio
│   ├── Persistencia        # localStorage + import/export JSON
│   └── UI Cloud            # Handlers Firebase (auth, modal planes)
├── styles.css              # Sistema de diseño (~1600 líneas)
│   └── Variables CSS       # Paleta, tipografía, espaciado, radios
├── firebase-cloud.js       # Módulo ES6 — Firebase Auth + Firestore CRUD
├── firebase-config.js      # Configuración Firebase (editar con tus credenciales)
├── firestore.rules         # Reglas de seguridad Firestore
└── FIREBASE_SETUP.md       # Guía de configuración Firebase paso a paso
```

---

## Exportación en 6 formatos

| Formato | Descripción | Librería |
|---------|-------------|---------|
| **HTML completo** | Documento autocontenido con todo el plan, configs y topología | Nativa |
| **PDF ejecutivo** | Resumen + tabla VLSM + reservas, firmable | jsPDF + autoTable (lazy CDN) |
| **Excel (.xlsx)** | 4 hojas: Resumen · VLSM IPv4 · VLSM IPv6 · Reservas IP | SheetJS (lazy CDN) |
| **JSON editable** | Plan versionado reimportable (esquema `netplan.v1`) | Nativa |
| **Mermaid** | Diagrama de topología para GitHub / Notion / Confluence | Nativa |
| **drawio** | XML editable en [app.diagrams.net](https://app.diagrams.net) | Nativa |

Las librerías PDF y Excel se cargan **lazy desde CDN** solo cuando se solicitan — la página inicial pesa menos de 250 KB.

---

## Configuración de Firebase (opcional)

Sin Firebase, la herramienta funciona completamente en modo local. Los botones de nube quedan ocultos automáticamente.

Para activar el guardado en la nube:

### 1. Crear proyecto en Firebase

1. Ir a [console.firebase.google.com](https://console.firebase.google.com)
2. Crear proyecto → habilitar **Authentication** (Google + Anónimo) → crear **Firestore Database**

### 2. Pegar las reglas de seguridad

En Firestore → Rules, pegar el contenido de `firestore.rules`:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/plans/{planId} {
      allow read, write: if request.auth != null
                         && request.auth.uid == userId;
    }
  }
}
```

### 3. Editar `firebase-config.js`

```javascript
export const firebaseConfig = {
  apiKey:            "TU_API_KEY",
  authDomain:        "TU_PROYECTO.firebaseapp.com",
  projectId:         "TU_PROYECTO_ID",
  storageBucket:     "TU_PROYECTO.appspot.com",
  messagingSenderId: "TU_SENDER_ID",
  appId:             "TU_APP_ID",
};
```

### 4. Servir desde servidor HTTP

Firebase Auth con Google requiere un servidor HTTP (no `file://`):

```bash
# Python
python3 -m http.server 8000

# Node.js
npx serve

# VS Code — extensión "Live Server" → click derecho en index.html
```

Ver `FIREBASE_SETUP.md` para instrucciones detalladas.

---

## Esquema JSON versionado

El plan se serializa como `netplan.v1`. Solo se guardan las **decisiones del usuario** — los valores derivados (redes, máscaras, gateways) se recalculan al importar:

```json
{
  "schema": "netplan.v1",
  "metadata": {
    "name": "metalpro.local",
    "createdAt": "2026-05-09T21:06:36.283Z",
    "updatedAt": "2026-05-09T21:06:36.283Z"
  },
  "infrastructure": {
    "pisos": 4,
    "core_piso": 1,
    "hosts_piso": 60,
    "puertos": 48,
    "redundancia": "dual",
    "vendor": "cisco",
    "growth_factor": 2
  },
  "ipv4": { "override": "10.50.0.0/20" },
  "services": {
    "dns4": "10.50.1.10",
    "dns6": "2001:4860:4860::8888",
    "ntp": "10.50.1.11",
    "domain": "metalpro.local",
    "ipv6": true,
    "wan_nexthop": "190.85.45.1",
    "wan_routes": ["192.168.30.0/24", "192.168.40.0/24", "172.20.0.0/16"]
  },
  "vlans": [
    {
      "id": 10,
      "name": "Oficinas",
      "type": "users",
      "floor": "all",
      "hosts_required": 120,
      "reserved_ips": []
    }
  ]
}
```

**Editá el JSON directamente** y reimportalo — el VLSM se recalcula automáticamente con los nuevos valores.

---

## Caso práctico: MetalPro S.A.S.

Planta manufacturera con separación IT/OT (IEC 62443):

| Parámetro | Valor |
|-----------|-------|
| Pisos | 4 (3 administrativos + 1 producción) |
| Red base | `10.50.0.0/20` (4094 hosts disponibles) |
| Prefijo IPv6 ULA | `fd0a:3200::/48` |
| Eficiencia VLSM | **80%** |
| VLANs | 7 (Oficinas, Servidores, VoIP, WiFi, OT-Producción, Cámaras, Gestión) |
| Rutas estáticas | 4 (default + 3 WAN remotas: Medellín, Bogotá, Cloud ERP) |
| Vendor | Cisco IOS/XE |
| Redundancia | Dual-Link LACP |

### Tabla VLSM generada

| VLAN | Nombre | Red IPv4 | Gateway | Efic. | Subred IPv6 /64 |
|------|--------|----------|---------|-------|-----------------|
| 10 | Oficinas | `10.50.0.0/25` | `10.50.0.1` | 95% | `fd0a:3200:0:a::/64` |
| 20 | Servidores | `10.50.2.0/27` | `10.50.2.1` | 100% | `fd0a:3200:0:14::/64` |
| 30 | VoIP | `10.50.1.128/26` | `10.50.1.129` | 97% | `fd0a:3200:0:1e::/64` |
| 40 | WiFi-Corp | `10.50.1.0/25` | `10.50.1.1` | 63% | `fd0a:3200:0:28::/64` |
| 50 | OT-Producción | `10.50.0.128/25` | `10.50.0.129` | 79% | `fd0a:3200:0:32::/64` |
| 60 | Cámaras-CCTV | `10.50.1.192/26` | `10.50.1.193` | 65% | `fd0a:3200:0:3c::/64` |
| 99 | Gestión | `10.50.2.32/27` | `10.50.2.33` | 67% | `fd0a:3200:0:63::/64` |

### Enrutamiento estático Dual-Stack

```
! Rutas conectadas (instaladas automáticamente por las SVIs)
C  10.50.0.0/25    → SVI Vlan10   (Oficinas)
C  10.50.2.0/27    → SVI Vlan20   (Servidores)
C  10.50.1.128/26  → SVI Vlan30   (VoIP)
C  10.50.1.0/25    → SVI Vlan40   (WiFi-Corp)
C  10.50.0.128/25  → SVI Vlan50   (OT-Producción)
C  10.50.1.192/26  → SVI Vlan60   (Cámaras-CCTV)
C  10.50.2.32/27   → SVI Vlan99   (Gestión)

! Rutas estáticas configuradas manualmente
S* 0.0.0.0/0           → 10.50.1.194   (default → FW-01)
S  192.168.30.0/24     → 190.85.45.1   (Sede Medellín)
S  192.168.40.0/24     → 190.85.45.1   (Bodega Bogotá)
S  172.20.0.0/16       → 190.85.45.1   (Cloud privado ERP)

! IPv6
S  ::/0               → fd0a:3200:0:3c::2  (default IPv6 → FW-01)
```

---

## Stack tecnológico

| Capa | Tecnología | Justificación |
|------|-----------|---------------|
| Frontend | HTML5 + CSS3 + JavaScript ES2022 vanilla | Sin build step, auditable, deployable en cualquier servidor estático |
| Persistencia local | `localStorage` + `IndexedDB` | Autoguardado y persistencia offline |
| Persistencia nube | Firebase Auth + Firestore (Spark — gratuito) | Multi-dispositivo, autenticación anónima + Google |
| Excel | SheetJS 0.18.5 — lazy CDN | Export de 4 hojas sin inflar la carga inicial |
| PDF | jsPDF 2.5.1 + autoTable 3.8.2 — lazy CDN | PDF firmable sin dependencias en runtime |
| Tipografía | Plus Jakarta Sans + DM Mono (Google Fonts) | Identidad visual coherente y profesional |

---

## Limitaciones conocidas (roadmap v5.0)

La herramienta genera aproximadamente el **70% de la configuración necesaria** para un despliegue real. El 30% restante se agrega manualmente:

- **Hardening base** — SSH-only, AAA, banners, exec-timeout, service password-encryption
- **Spanning-Tree explícito** — root bridge (`spanning-tree vlan X root primary`), portfast, BPDU guard
- **ACLs inter-VLAN** — la segmentación lógica existe pero no se generan ACLs entre VLANs
- **Defensas L2** — port-security, DHCP snooping, ARP inspection, 802.1X

---

## Requisitos

- **Navegador moderno** con soporte ES2022: Chrome 90+, Firefox 88+, Edge 90+, Safari 15+
- **Servidor HTTP** para usar Firebase (no funciona con `file://`)
- **Cuenta Firebase** (gratuita, plan Spark) — solo si se quiere guardado en la nube

---

## Uso sin Firebase

```bash
# Clonar el repositorio
git clone https://github.com/tu-usuario/netplan-pro.git
cd netplan-pro

# Servir con Python
python3 -m http.server 8000

# Abrir en el navegador
# http://localhost:8000
```

Los botones "Mis planes" y el menú de usuario **no aparecen** hasta que `firebase-config.js` tenga credenciales reales. El resto de la herramienta funciona completamente sin Firebase.

---

## Deployment

La herramienta es un sitio estático — se puede deployar en cualquier hosting sin configuración:

```bash
# GitHub Pages
# Subí los archivos al repositorio y activá Pages en Settings → Pages

# Netlify
# Arrastrá la carpeta del proyecto a netlify.com/drop

# Vercel
vercel --prod

# Servidor propio
cp -r . /var/www/html/netplan/
```

Si usás Firebase, agregá el dominio de producción en:
`Firebase Console → Authentication → Settings → Authorized domains`

---

## Control de versiones

| Versión | Cambios principales |
|---------|-------------------|
| v4.0 | Base: wizard 6 pasos, VLSM IPv4, Dual-Stack IPv6, generadores Cisco/Huawei/FortiGate, rollback, topología SVG, export HTML |
| v4.1 | Inputs numéricos validados (pisos/core), esquema JSON v1, import/export, autoguardado localStorage |
| v4.2 | Firebase Auth + Firestore, modal "Mis planes en la nube", persistencia offline IndexedDB |
| v4.3 | Topología SVG dinámica (Dual-Link visual, wrap mode), exports Excel/PDF/Mermaid/drawio |
| v4.4 | Fix bug borrado seguro (sub-selector de vendor en pestaña Rollback) |
| v4.5 | Aviso de sesión anónima en modal de planes |

---

## Créditos

Desarrollado como proyecto final de la asignatura **Interconexión de Redes WAN** — Ingeniería en Telecomunicaciones, Fundación Universitaria Compensar (2026).

**Autores:**
- Jhonatan Ramos Ladino — jmiguelramos@ucompensar.edu.co
- Cristian David Viasus Vega — cviasus@ucompensar.edu.co

**Asistencia de IA:** Claude Opus 4.7 (Anthropic) — codificación, arquitectura y documentación técnica bajo supervisión y validación del equipo.

---

## Referencias

- Cisco Systems. *Configuring IP Routing Protocols — Cisco IOS XE Documentation.* (2024)
- Huawei Technologies. *VRP Configuration Guide — IP Routing.* (2024)
- Fortinet Inc. *FortiGate Administration Guide — Static Routing.* (2024)
- IETF. *RFC 1918 — Address Allocation for Private Internets.*
- IETF. *RFC 4193 — Unique Local IPv6 Unicast Addresses.*
- IETF. *RFC 4291 — IP Version 6 Addressing Architecture.*
- ISA/IEC 62443. *Industrial Communication Networks: Network and System Security.*
- NIST SP 800-82 Rev. 3. *Guide to Operational Technology (OT) Security.*

---

<div align="center">

**NetPlan Pro v4.0** · Fundación Universitaria Compensar · 2026

</div>
