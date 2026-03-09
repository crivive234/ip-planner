// ═══════════════════════════════════════════════════════
// MÓDULO: Constantes y datos de configuración
// Tipos de organización, redundancia, VLANs, vendors NAPALM
// ═══════════════════════════════════════════════════════

const ORG_TYPES=[
  {id:'corp',icon:'🏢',name:'Corporativo',desc:'Oficinas, empresas',
   vlans:[{name:'Usuarios',type:'Usuarios',pct:.40,floor:2},{name:'Administración',type:'Usuarios',pct:.12,floor:2},{name:'Servidores',type:'Servidores',pct:.08,floor:1},{name:'VoIP',type:'VoIP',pct:.08,floor:2},{name:'Gestión',type:'Gestión',pct:.03,floor:1},{name:'Invitados',type:'Invitados',pct:.06,floor:2},{name:'DMZ',type:'DMZ',pct:.03,floor:1}]},
  {id:'edu',icon:'🎓',name:'Educativo',desc:'Universidad, colegio',
   vlans:[{name:'Estudiantes',type:'Usuarios',pct:.50,floor:2},{name:'Docentes',type:'Usuarios',pct:.15,floor:2},{name:'Administrativo',type:'Usuarios',pct:.10,floor:1},{name:'Servidores',type:'Servidores',pct:.07,floor:1},{name:'WiFi-Campus',type:'Invitados',pct:.10,floor:2},{name:'Gestión',type:'Gestión',pct:.03,floor:1}]},
  {id:'hosp',icon:'🏥',name:'Hospital',desc:'Salud, clínicas',
   vlans:[{name:'Médicos',type:'Usuarios',pct:.25,floor:2},{name:'Administrativo',type:'Usuarios',pct:.15,floor:2},{name:'Equipos-Médicos',type:'Dispositivos',pct:.20,floor:2},{name:'Servidores',type:'Servidores',pct:.10,floor:1},{name:'Visitantes',type:'Invitados',pct:.08,floor:2},{name:'Gestión',type:'Gestión',pct:.04,floor:1},{name:'Seguridad',type:'Dispositivos',pct:.05,floor:1}]},
  {id:'hotel',icon:'🏨',name:'Hotel',desc:'Hotelería, turismo',
   vlans:[{name:'Huéspedes',type:'Invitados',pct:.45,floor:2},{name:'Staff',type:'Usuarios',pct:.20,floor:2},{name:'Administración',type:'Usuarios',pct:.10,floor:1},{name:'Servidores',type:'Servidores',pct:.07,floor:1},{name:'IPTV',type:'Dispositivos',pct:.10,floor:2},{name:'Gestión',type:'Gestión',pct:.03,floor:1}]},
  {id:'ind',icon:'🏭',name:'Industrial',desc:'Fábrica, planta',
   vlans:[{name:'Producción',type:'Usuarios',pct:.30,floor:2},{name:'SCADA-OT',type:'Dispositivos',pct:.25,floor:2},{name:'Supervisión',type:'Usuarios',pct:.15,floor:2},{name:'Administración',type:'Usuarios',pct:.10,floor:1},{name:'Servidores',type:'Servidores',pct:.08,floor:1},{name:'Gestión',type:'Gestión',pct:.03,floor:1}]},
  {id:'custom',icon:'⚙️',name:'Personalizado',desc:'Configura tus propias VLANs',
   vlans:[{name:'VLAN-Principal',type:'Usuarios',pct:.60,floor:2},{name:'Servidores',type:'Servidores',pct:.15,floor:1},{name:'Gestión',type:'Gestión',pct:.05,floor:1}]},
];

const REDUND=[
  {id:'none',icon:'➖',name:'Sin Redundancia',badge:'Sin resiliencia',cls:'none',
   desc:'Un solo enlace físico entre dispositivos.',
   detail:'• Sin LACP ni STP balanceo\n• Un uplink por switch\n• Recuperación: manual'},
  {id:'dual',icon:'⟺',name:'Dual-Link (LACP/STP)',badge:'Recomendado',cls:'rec',
   desc:'Dos enlaces físicos por dispositivo usando LACP o STP.',
   detail:'• LACP / 802.3ad port-channel\n• STP como fallback\n• Failover: < 1 segundo'},
  {id:'full',icon:'⬡',name:'Full-Mesh',badge:'Crítico/DC',cls:'crit',
   desc:'Todos los switches Core y Distribución enlazados en malla.',
   detail:'• Todos-con-todos en core/dist\n• ECMP activo\n• Para data centers'},
];

const VLAN_TYPES=['Usuarios','Servidores','Dispositivos','Gestión','DMZ','VoIP','Invitados','SCADA'];

const TYPE_COLOR={Usuarios:'#38bdf8',Servidores:'#fbbf24',Dispositivos:'#4ade80',Gestión:'#a78bfa',DMZ:'#f87171',VoIP:'#67e8f9',Invitados:'#94a3b8',SCADA:'#fb923c'};

const TYPE_TIER={Usuarios:2,Servidores:2,Dispositivos:2,Gestión:3,DMZ:0,VoIP:2,Invitados:1,SCADA:0};

function defaultComm(a,b){
  const ta=TYPE_TIER[a.type]??2,tb=TYPE_TIER[b.type]??2;
  if(ta===3||tb===3) return true;
  if(ta===0||tb===0) return false;
  if(ta===1||tb===1) return false;
  return a.type===b.type;
}

// NAPALM driver definitions (Nornir + NAPALM backend)
// driver = NAPALM platform string; install = pip package

const NAPALM_VENDORS=[
  {id:'ios',     icon:'🔵', name:'Cisco IOS/XE', driver:'ios',      install:'napalm',         note:'Soporte oficial NAPALM'},
  {id:'nxos_ssh',icon:'🔵', name:'Cisco NX-OS',  driver:'nxos_ssh', install:'napalm',         note:'SSH · NX-OS 9.x+'},
  {id:'ce',      icon:'🔴', name:'Huawei VRP',    driver:'ce',       install:'napalm-ce',      note:'Driver comunidad CloudEngine'},
  {id:'fortios', icon:'🟠', name:'Fortinet FortiOS',driver:'fortios',install:'napalm-fortios', note:'Driver comunidad FortiOS'},
  {id:'junos',   icon:'🟢', name:'Juniper JunOS', driver:'junos',    install:'napalm',         note:'Soporte oficial NAPALM'},
];

// ══════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════

const STEPS=[
  {n:1,icon:'🏢',label:'Infraestructura',sub:'Edificio y organización'},
  {n:2,icon:'🌐',label:'Análisis de Red',sub:'Selección automática'},
  {n:3,icon:'⚙️',label:'Servicios',sub:'DNS, NTP, DHCP central'},
  {n:4,icon:'🏷️',label:'VLANs',sub:'Generadas automáticamente'},
  {n:5,icon:'🔄',label:'Políticas',sub:'Comunicación inter-VLAN'},
  {n:6,icon:'📊',label:'Resumen',sub:'Plan completo + VLSM'},
  {n:7,icon:'💾',label:'Exportar',sub:'Configs · JSON · Nornir+NAPALM'},
];

// ══════════════════════════════════════════════════
// MOBILE MENU
// ══════════════════════════════════════════════════

