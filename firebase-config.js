/*
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  NetPlan Pro v4.0 — firebase-config.js                       ║
 * ║                                                              ║
 * ║  Configuración de Firebase para guardar planes en la nube.   ║
 * ║  Sin Firebase configurado, la app sigue funcionando con      ║
 * ║  localStorage + import/export JSON (los botones de nube      ║
 * ║  quedan ocultos automáticamente).                            ║
 * ║                                                              ║
 * ║  CÓMO CONFIGURAR (una sola vez):                             ║
 * ║                                                              ║
 * ║  1. Ir a https://console.firebase.google.com                 ║
 * ║  2. Crear un proyecto nuevo (cualquier nombre).              ║
 * ║  3. Build → Authentication → Get started:                    ║
 * ║       Habilitar "Anonymous" y "Google" en Sign-in method.    ║
 * ║  4. Build → Firestore Database → Create database:            ║
 * ║       Modo "production", elegir ubicación cercana.           ║
 * ║  5. Pegar las reglas del archivo firestore.rules en          ║
 * ║       Firestore → Rules → Publish.                           ║
 * ║  6. Project Settings (engranaje) → Your Apps → Web (</>)     ║
 * ║       Registrar la app y COPIAR el objeto firebaseConfig.    ║
 * ║  7. Reemplazar los valores YOUR_xxx_HERE de abajo.           ║
 * ║                                                              ║
 * ║  Ver FIREBASE_SETUP.md para instrucciones detalladas.        ║
 * ║                                                              ║
 * ║  NOTA SOBRE SEGURIDAD: Estos valores NO son secretos.        ║
 * ║  Quedan visibles en el navegador del usuario por diseño.     ║
 * ║  Los datos están protegidos por las reglas de Firestore,     ║
 * ║  no por estas claves.                                        ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

export const firebaseConfig = {
  apiKey: "AIzaSyDkK0vN2OZHzZ7FmWnkp58HPljeOeV9upA",
  authDomain: "net-plan-18cec.firebaseapp.com",
  projectId: "net-plan-18cec",
  storageBucket: "net-plan-18cec.firebasestorage.app",
  messagingSenderId: "918047715614",
  appId: "1:918047715614:web:7c8dcd66c66e18e439d90f"
};
