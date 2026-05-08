/*
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  NetPlan Pro v4.0 — firebase-cloud.js                        ║
 * ║                                                              ║
 * ║  Módulo (ES Module) que encapsula toda la integración con    ║
 * ║  Firebase. Se carga con <script type="module"> y expone la   ║
 * ║  API en window.NetPlanCloud para que el script clásico       ║
 * ║  (script.js) pueda usarla.                                   ║
 * ║                                                              ║
 * ║  Si firebase-config.js tiene placeholders YOUR_xxx_HERE,     ║
 * ║  isAvailable() retorna false y la UI cloud queda oculta.     ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import { initializeApp }
  from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import {
  getAuth, signInAnonymously, signInWithPopup, GoogleAuthProvider,
  signOut, onAuthStateChanged, linkWithPopup,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import {
  getFirestore, collection, doc, setDoc, getDoc, getDocs, deleteDoc,
  query, orderBy, enableIndexedDbPersistence,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

import { firebaseConfig } from './firebase-config.js';

/* ── Estado interno del módulo ─────────────────────────────── */
let _app = null, _auth = null, _db = null, _currentUser = null;
const _authCallbacks = [];

/* ── Helpers ───────────────────────────────────────────────── */

/**
 * Detecta si firebase-config.js fue editado o tiene placeholders.
 * Si todos los campos requeridos están presentes y no empiezan
 * con "YOUR_", se considera configurado.
 */
function _isConfigured() {
  if (!firebaseConfig) return false;
  for (const key of ['apiKey', 'projectId', 'authDomain', 'appId']) {
    const val = firebaseConfig[key];
    if (!val || typeof val !== 'string' || val.startsWith('YOUR_')) return false;
  }
  return true;
}

/** Notifica a los suscriptores de cambios de auth. */
function _emitAuthChange(user) {
  _currentUser = user;
  _authCallbacks.forEach(cb => {
    try { cb(user); } catch (e) { console.error('[NetPlanCloud] callback error:', e); }
  });
}

/** Inicializa Firebase si está configurado. Retorna true/false. */
async function _init() {
  if (!_isConfigured()) {
    console.info(
      '[NetPlanCloud] Firebase no configurado. Edita firebase-config.js ' +
      'para activar el guardado en la nube. La app funciona normalmente ' +
      'con localStorage + import/export JSON.'
    );
    return false;
  }
  try {
    _app  = initializeApp(firebaseConfig);
    _auth = getAuth(_app);
    _db   = getFirestore(_app);

    /* Persistencia offline (IndexedDB) — opcional, falla silenciosa */
    enableIndexedDbPersistence(_db).catch(err => {
      const reason = err.code === 'failed-precondition'
        ? 'múltiples pestañas abiertas'
        : err.code === 'unimplemented'
          ? 'navegador sin soporte'
          : err.code;
      console.warn(`[NetPlanCloud] Persistencia offline no activada (${reason})`);
    });

    /* Suscripción al estado de auth */
    onAuthStateChanged(_auth, _emitAuthChange);

    /* Auto sign-in anónimo: el usuario puede usar la nube sin registrarse */
    if (!_auth.currentUser) {
      await signInAnonymously(_auth);
    }
    return true;
  } catch (e) {
    console.error('[NetPlanCloud] Error de inicialización:', e);
    return false;
  }
}

/* ══════════════════════════════════════════════════════════════
   API PÚBLICA — window.NetPlanCloud
   ══════════════════════════════════════════════════════════════ */

const NetPlanCloud = {

  /** ¿La nube está configurada y funcionando? */
  isAvailable: () => _app !== null,

  /**
   * Registra un callback para cambios de auth.
   * Se llama inmediatamente con el estado actual si ya se conoce.
   */
  onAuthStateChanged(callback) {
    _authCallbacks.push(callback);
    if (_currentUser !== null) callback(_currentUser);
  },

  /** Devuelve el usuario actual (o null). */
  getCurrentUser: () => _currentUser,

  /**
   * Inicia sesión con Google.
   * Si el usuario actual es anónimo, intenta vincular su cuenta para
   * preservar los planes ya guardados (linkWithPopup). Si el email
   * de Google ya tiene una cuenta Firebase, hace sign-in normal y
   * los planes anónimos quedan inaccesibles desde la nueva cuenta.
   */
  async signInWithGoogle() {
    if (!_auth) throw new Error('Cloud no disponible');
    const provider = new GoogleAuthProvider();

    if (_currentUser?.isAnonymous) {
      try {
        const result = await linkWithPopup(_currentUser, provider);
        return result.user;
      } catch (e) {
        if (e.code === 'auth/credential-already-in-use' ||
            e.code === 'auth/email-already-in-use') {
          /* La cuenta Google ya existe en Firebase.
             Hacemos sign-in normal — los planes anónimos quedan en
             el UID anónimo (huérfanos). El usuario puede importarlos
             desde el JSON local si los necesita. */
          const result = await signInWithPopup(_auth, provider);
          return result.user;
        }
        throw e;
      }
    }
    const result = await signInWithPopup(_auth, provider);
    return result.user;
  },

  /**
   * Cierra sesión y vuelve a iniciar sesión anónima inmediatamente,
   * para que el usuario pueda seguir usando la app sin registrarse.
   */
  async signOut() {
    if (!_auth) return;
    await signOut(_auth);
    await signInAnonymously(_auth);
  },

  /**
   * Guarda un plan. Si planId es null, crea uno nuevo; si tiene valor,
   * sobreescribe el existente (útil para "Guardar como").
   * Retorna el ID del plan guardado.
   */
  async savePlan(planJson, name, planId = null) {
    if (!_currentUser) throw new Error('No hay usuario activo');
    const id  = planId || (crypto.randomUUID
      ? crypto.randomUUID()
      : 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8));
    const ref = doc(_db, 'users', _currentUser.uid, 'plans', id);
    const now = new Date().toISOString();

    const dataToSave = {
      ...planJson,
      metadata: {
        ...(planJson.metadata || {}),
        name:      name || planJson.metadata?.name || 'Plan sin título',
        updatedAt: now,
        createdAt: planJson.metadata?.createdAt || now,
      },
    };
    await setDoc(ref, dataToSave);
    return id;
  },

  /**
   * Lista los planes del usuario actual, ordenados por fecha desc.
   * Devuelve metadatos resumidos, NO el plan completo.
   */
  async listPlans() {
    if (!_currentUser) return [];
    const ref = collection(_db, 'users', _currentUser.uid, 'plans');
    const q   = query(ref, orderBy('metadata.updatedAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => {
      const data = d.data() || {};
      return {
        id:        d.id,
        name:      data.metadata?.name      || 'Sin título',
        updatedAt: data.metadata?.updatedAt || '',
        createdAt: data.metadata?.createdAt || '',
        vlanCount: Array.isArray(data.vlans) ? data.vlans.length : 0,
        domain:    data.services?.domain    || '',
      };
    });
  },

  /** Carga un plan completo por ID. */
  async loadPlan(planId) {
    if (!_currentUser) throw new Error('No hay usuario activo');
    const ref  = doc(_db, 'users', _currentUser.uid, 'plans', planId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Plan no encontrado');
    return snap.data();
  },

  /** Elimina un plan por ID. */
  async deletePlan(planId) {
    if (!_currentUser) throw new Error('No hay usuario activo');
    const ref = doc(_db, 'users', _currentUser.uid, 'plans', planId);
    await deleteDoc(ref);
  },

  /** Renombra un plan (lee → modifica metadata.name → escribe). */
  async renamePlan(planId, newName) {
    if (!_currentUser) throw new Error('No hay usuario activo');
    const plan = await this.loadPlan(planId);
    plan.metadata = {
      ...(plan.metadata || {}),
      name:      newName,
      updatedAt: new Date().toISOString(),
    };
    const ref = doc(_db, 'users', _currentUser.uid, 'plans', planId);
    await setDoc(ref, plan);
  },
};

/* Exponer al script clásico */
window.NetPlanCloud = NetPlanCloud;

/* Inicializar y avisar al main script */
_init().then(ok => {
  window.dispatchEvent(new CustomEvent('netplan-cloud-ready', { detail: { available: ok } }));
});
