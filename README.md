# NetPlan Pro — Auto IP Planner

Herramienta de planificación automática de redes WAN/LAN con soporte
multi-vendor (Cisco, Huawei, Fortinet) e IPv6 Dual-Stack.

Desarrollada para el curso de **Interconexión de Redes WAN** —
Ingeniería de Telecomunicaciones, Fundación Universitaria Compensar.

---

## 📁 Estructura del Proyecto

```
netplan-pro/
├── index.html                    ← Punto de entrada principal
├── README.md                     ← Este archivo
│
└── assets/
    ├── css/
    │   └── main.css              ← Todos los estilos (variables, layout, componentes)
    │
    └── js/
        ├── main.js               ← Inicialización de la aplicación
        │
        ├── core/                 ← Núcleo lógico (sin dependencias de UI)
        │   ├── ipv4.js           ← Aritmética IPv4: conversiones, subredes, VLSM
        │   ├── ipv6.js           ← Aritmética IPv6: prefijos ULA/GUA, /64 por VLAN
        │   └── state.js          ← Estado global (S) y helpers de lectura del DOM
        │
        ├── data/
        │   └── constants.js      ← Datos estáticos: perfiles de org, redundancia,
        │                           tipos de VLAN, vendors NAPALM, pasos del wizard
        │
        ├── configs/              ← Generadores de configuración por vendor
        │   ├── helpers.js        ← Resaltado de sintaxis + bloque de código HTML
        │   ├── cisco.js          ← Cisco IOS/XE: Core, Distribución, Acceso
        │   ├── huawei.js         ← Huawei VRP: Core, Distribución, Acceso
        │   ├── fortinet.js       ← Fortinet FortiOS: FortiGate completo
        │   └── nornir.js         ← Script Python Nornir + NAPALM (multi-vendor)
        │
        ├── modules/              ← Lógica de cada paso del wizard
        │   ├── wizard.js         ← Navegación entre pasos, barra de progreso
        │   ├── analysis.js       ← Motor de análisis automático de red
        │   ├── services.js       ← DNS, NTP, dominio, IPv6 Dual-Stack
        │   ├── vlans.js          ← Generación de VLANs, cálculo VLSM
        │   ├── policy.js         ← Matriz de comunicación inter-VLAN, ACLs
        │   ├── summary.js        ← Tabla VLSM completa, resumen del plan
        │   └── export.js         ← Exportación: configs vendor, JSON, Nornir
        │
        └── ui/                   ← Componentes visuales reutilizables
            ├── render.js         ← Grids: organización, redundancia, NAPALM
            ├── preview.js        ← Panel derecho de vista previa en vivo
            └── toast.js          ← Notificaciones toast y copiado de código
```

---

## 🚀 Funcionalidades Actuales (v3.0)

| Paso | Funcionalidad |
|------|--------------|
| 1 | Selección de perfil de organización (Corporativo, Educativo, Hospital, Hotel, Industrial) |
| 2 | Análisis automático de red: selección de rango RFC 1918, prefijo óptimo, score |
| 3 | Servicios: DNS, NTP, dominio interno, DHCP centralizado, IPv6 Dual-Stack |
| 4 | Generación automática de VLANs con VLSM, soporte IPv4 + IPv6 |
| 5 | Matriz de políticas inter-VLAN, configuración de ACLs |
| 6 | Resumen completo: tabla VLSM, IPs reservadas, estadísticas |
| 7 | Exportación: Cisco IOS/XE, Huawei VRP, FortiOS, Script Nornir+NAPALM, JSON |

---

## 🤖 Próximo: Integración de IA

La herramienta está preparada para conectar con la API de Anthropic Claude
para los siguientes módulos:

- **Análisis inteligente**: descripción en lenguaje natural del plan generado
- **Validación de configuraciones**: detección de errores o inconsistencias
- **Recomendaciones**: sugerencias de seguridad y buenas prácticas
- **Chat de soporte**: asistente de red contextual

---

## 🛠️ Uso

1. Abrir `index.html` en un navegador moderno (Chrome, Firefox, Edge)
2. No requiere servidor — funciona 100% en el cliente
3. No requiere dependencias npm — solo HTML/CSS/JS puro

---

## 📋 Tecnologías

- **HTML5** — Semántica y estructura
- **CSS3** — Variables CSS, Grid, Flexbox, animaciones
- **JavaScript ES6+** — Módulos, arrow functions, destructuring
- **Fuentes**: Syne (UI), JetBrains Mono (código) — Google Fonts

---

*NetPlan Pro v3.0 — Interconexión de Redes WAN*