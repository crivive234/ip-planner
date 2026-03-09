// ═══════════════════════════════════════════════════════
// MÓDULO: IPv4 Math
// Funciones de cálculo y conversión de direcciones IPv4
// ═══════════════════════════════════════════════════════

const ipToInt=ip=>ip.split('.').reduce((a,o)=>(a<<8)|+o,0)>>>0;

const intToIp=n=>[(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255].join('.');

const maskFromPfx=p=>intToIp(p===0?0:(0xFFFFFFFF<<(32-p))>>>0);

const wildcardFromPfx=p=>intToIp(p===32?0:((1<<(32-p))-1));

const hostsFromPfx=p=>Math.pow(2,32-p)-2;

const pfxForHosts=n=>{for(let p=30;p>=1;p--)if(hostsFromPfx(p)>=n)return p;return 1;};

const netInt=(ip,p)=>ipToInt(ip)&((0xFFFFFFFF<<(32-p))>>>0);

const bcastInt=(ip,p)=>netInt(ip,p)|((1<<(32-p))-1);

const ipHex=ip=>{const[a,b,c,d]=ip.split('.').map(Number);return`${a.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}:${c.toString(16).padStart(2,'0')}${d.toString(16).padStart(2,'0')}`;};

// ══════════════════════════════════════════════════
// IPv6 DUAL-STACK MATH
// ══════════════════════════════════════════════════
// Derive a stable ULA /48 from the IPv4 base network
// fd[oct1][oct2]:[oct3][oct4]::[...]/48

