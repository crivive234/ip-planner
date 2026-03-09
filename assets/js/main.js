// ═══════════════════════════════════════════════════════
// MAIN.JS — Punto de entrada de NetPlan Pro
//
// Inicializa la interfaz cuando todos los scripts han
// sido cargados. Los scripts se cargan al final del <body>
// por lo que el DOM ya está disponible aquí.
// ═══════════════════════════════════════════════════════

// ── Renderizado inicial de componentes ──────────────────
renderOrgs();          // Grid de tipos de organización
renderRedund();        // Grid de modelos de redundancia
renderVendorGrid();    // Grid de drivers NAPALM
updateNapalmNote();    // Nota informativa del driver activo

// ── Inicialización del wizard de pasos ──────────────────
renderStepsNav();      // Barra lateral de navegación
onBuildChange();       // Cálculo inicial de totales del edificio
updatePreview();       // Panel de vista previa en vivo
