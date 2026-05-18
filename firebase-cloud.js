/*
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  NetPlan Pro v4.7 — firebase-cloud.js                        ║
 * ║                                                              ║
 * ║  Cambios v4.7 (Bloque A — Auth y persistencia):              ║
 * ║   · Solo 2 métodos de autenticación: Google y Email/Password ║
 * ║   · ELIMINADO: usuario anónimo (signInAnonymously) y toda la ║
 * ║     lógica de migración anónimo→cuenta. Resuelve de raíz los ║
 * ║     bugs de autoguardado huérfano, doble popup y anónimos    ║
 * ║     acumulados.                                              ║
 * ║   · Email/contraseña: signUp, signIn, sendPasswordReset      ║
 * ║   · Persistencia configurable (local vs sesión) ANTES del    ║
 * ║     sign-in según toggle "Mantener sesión" del login         ║
 * ║   · NO crea sesión automática al cargar. Si hay sesión       ║
 * ║     persistida (Google/email con persistencia local), se     ║
 * ║     recupera; si no, el usuario ve la pantalla de login.     ║
 * ║   · El "modo sin nube" lo gestiona script.js sin tocar       ║
 * ║     Firebase — esta capa solo conoce sesiones reales.        ║
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
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  fetchSignInMethodsForEmail,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import {
  getFirestore, collection, doc, setDoc, getDoc, getDocs, deleteDoc,
  query, orderBy, enableIndexedDbPersistence,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

import { firebaseConfig } from './firebase-config.js';

/* ── Estado interno del módulo ─────────────────────────────── */
let _app = null, _auth = null, _db = null, _currentUser = null;
const _authCallbacks = [];

/* Flag que indica si _init() ya terminó y emitió al menos un estado.
 * Permite a la pantalla de login esperar antes de mostrarse, evitando
 * un parpadeo cuando hay sesión persistida que se va a recuperar. */
let _initEmitted = false;

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
  _currentUser  = user;
  _initEmitted  = true;
  _authCallbacks.forEach(cb => {
    try { cb(user); } catch (e) { console.error('[NetPlanCloud] callback error:', e); }
  });
}

/**
 * Determina el tipo de proveedor del usuario actual.
 * Retorna: 'google' | 'password' | null
 */
function _getProviderType(user) {
  if (!user) return null;
  const providers = user.providerData || [];
  if (providers.some(p => p.providerId === 'google.com')) return 'google';
  if (providers.some(p => p.providerId === 'password'))   return 'password';
  return 'unknown';
}

/**
 * Inicializa Firebase si está configurado. Retorna true/false.
 *
 * v4.7: ya NO crea sesión anónima automática. La pantalla de login
 *       le pide al usuario que elija método.
 *       Si el usuario tenía sesión persistida (Google/email con
 *       "Mantener sesión" ON), onAuthStateChanged la recupera.
 */
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

    /* Suscripción al estado de auth.
     * Si hay sesión persistida, dispara con el usuario.
     * Si no hay sesión, dispara con null. */
    onAuthStateChanged(_auth, _emitAuthChange);

    return true;
  } catch (e) {
    console.error('[NetPlanCloud] Error de inicialización:', e);
    return false;
  }
}

/**
 * Aplica el modo de persistencia ANTES de cualquier sign-in.
 * Debe llamarse desde la pantalla de login según el toggle "Mantener sesión".
 *
 * @param {boolean} remember - true = browserLocalPersistence (persiste tras cerrar
 *                              navegador), false = browserSessionPersistence
 *                              (solo durante la pestaña).
 */
async function _applyPersistence(remember) {
  if (!_auth) return;
  const mode = remember ? browserLocalPersistence : browserSessionPersistence;
  try {
    await setPersistence(_auth, mode);
  } catch (e) {
    console.warn('[NetPlanCloud] No se pudo aplicar persistencia:', e.code);
  }
}

/* ══════════════════════════════════════════════════════════════
   API PÚBLICA — window.NetPlanCloud
   ══════════════════════════════════════════════════════════════ */

const NetPlanCloud = {

  /** ¿La nube está configurada y funcionando? */
  isAvailable: () => _app !== null,

  /** ¿_init() ya emitió al menos un estado? Útil para esperar antes de mostrar login. */
  hasInitEmitted: () => _initEmitted,

  /**
   * Registra un callback para cambios de auth.
   * Se llama inmediatamente con el estado actual si ya se conoce.
   */
  onAuthStateChanged(callback) {
    _authCallbacks.push(callback);
    /* Si ya emitimos al menos un evento, replicamos el último estado
       al nuevo suscriptor. _currentUser puede ser null (sin sesión)
       o un objeto User. Ambos son válidos. */
    if (_initEmitted) callback(_currentUser);
  },

  /** Devuelve el usuario actual (o null). */
  getCurrentUser: () => _currentUser,

  /**
   * Devuelve el tipo de proveedor: 'google' | 'password' | null
   * Útil para mostrar en la UI el método de auth usado.
   */
  getProviderType: () => _getProviderType(_currentUser),

  /**
   * Aplica persistencia ANTES de cualquier sign-in.
   * @param {boolean} remember - true: persiste tras cerrar; false: solo en pestaña
   */
  setRememberSession(remember) {
    return _applyPersistence(remember);
  },

  /**
   * Inicia sesión con Google.
   * Un solo popup. Si el popup es bloqueado o cerrado, lanza el error
   * correspondiente para que la UI lo maneje.
   *
   * v4.7.1: Fuerza el selector de cuentas Google con prompt='select_account'.
   * Sin esto, Google reusaba automáticamente la última cuenta utilizada en
   * el navegador, sin dar opción de elegir otra después de un signOut.
   */
  async signInWithGoogle() {
    if (!_auth) throw new Error('Cloud no disponible');
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const result = await signInWithPopup(_auth, provider);
    return result.user;
  },

  /**
   * Registra una nueva cuenta con email + password.
   * Firebase requiere password de mínimo 6 caracteres (configurable).
   * La validación adicional (mínimo 8, complejidad, etc.) la hace la UI.
   */
  async signUpWithEmail(email, password) {
    if (!_auth) throw new Error('Cloud no disponible');
    if (!email || !password) throw new Error('Email y contraseña requeridos');
    const result = await createUserWithEmailAndPassword(_auth, email, password);
    return result.user;
  },

  /**
   * Inicia sesión con email + password ya existente.
   */
  async signInWithEmail(email, password) {
    if (!_auth) throw new Error('Cloud no disponible');
    if (!email || !password) throw new Error('Email y contraseña requeridos');
    const result = await signInWithEmailAndPassword(_auth, email, password);
    return result.user;
  },

  /**
   * Envía un email de restablecimiento de contraseña.
   * Firebase envía el correo solo si la cuenta existe; por seguridad,
   * no informamos al cliente si el email existe o no.
   */
  async sendPasswordReset(email) {
    if (!_auth) throw new Error('Cloud no disponible');
    if (!email) throw new Error('Email requerido');
    await sendPasswordResetEmail(_auth, email);
  },

  /**
   * Envía un email de verificación al usuario actual.
   * Solo aplica a cuentas password con email no verificado.
   * Si el usuario no existe o ya está verificado, lanza error.
   */
  async sendEmailVerification() {
    if (!_auth || !_currentUser) throw new Error('No hay usuario activo');
    if (_currentUser.emailVerified) {
      throw new Error('El correo ya está verificado');
    }
    await sendEmailVerification(_currentUser);
  },

  /**
   * Verifica los métodos de sign-in registrados para un email.
   * Devuelve un array como ['google.com'], ['password'], ambos, o [].
   * Útil para que la UI sugiera "esta cuenta usa Google" cuando el
   * usuario intenta crear cuenta con un email que ya tiene Google.
   */
  async getSignInMethodsForEmail(email) {
    if (!_auth) throw new Error('Cloud no disponible');
    try {
      return await fetchSignInMethodsForEmail(_auth, email);
    } catch (e) {
      return [];
    }
  },

  /**
   * Cierra sesión.
   * v4.7: ya no crea anónimo automático al cerrar. El usuario vuelve
   *       a la pantalla de login y decide.
   */
  async signOut() {
    if (!_auth) return;
    await signOut(_auth);
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
