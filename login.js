/*
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  NetPlan Pro v4.7 — login.js                                 ║
 * ║  Lógica de la página de autenticación (login.html)           ║
 * ║                                                              ║
 * ║  Responsabilidades:                                          ║
 * ║   - Recibir el evento netplan-cloud-ready                    ║
 * ║   - Si Firebase no está configurado → redirigir a index.html ║
 * ║   - Si ya hay sesión activa → redirigir a index.html         ║
 * ║   - Manejar UI de login (Google, email signin/signup, reset) ║
 * ║   - Handler de "Usar sin nube"                               ║
 * ║   - Aplicar persistencia según toggle "Mantener sesión"      ║
 * ║                                                              ║
 * ║  Después de un login exitoso o de elegir modo sin nube,      ║
 * ║  redirige a index.html con window.location.replace()         ║
 * ║  para no agregar al historial.                               ║
 * ╚══════════════════════════════════════════════════════════════╝
 */


/* Constantes compartidas con index.html */
const CLOUDLESS_FLAG = 'netplan_cloudless';
const INDEX_URL      = 'index.html';

/* Flag: ya redirigimos o estamos por hacerlo, no procesar más cambios de auth */
let _redirecting = false;


/* ══════════════════════════════════════════════════════════════
   INICIALIZACIÓN
   ══════════════════════════════════════════════════════════════ */

window.addEventListener('netplan-cloud-ready', (e) => {
  /* Caso 1: Firebase no está configurado (firebase-config.js con
     placeholders YOUR_xxx_HERE). No tiene sentido mostrar login —
     redirigir a index.html que entrará en modo sin nube de facto. */
  if (!e.detail?.available) {
    redirectToIndex();
    return;
  }

  /* Caso 2: Si el usuario YA eligió modo sin nube previamente,
     también redirigir. No queremos forzar login si ya decidió. */
  if (localStorage.getItem(CLOUDLESS_FLAG) === 'true') {
    redirectToIndex();
    return;
  }

  /* Caso 3: suscribirse a cambios de auth. El primer evento
     determina si hay sesión persistida o no. */
  window.NetPlanCloud.onAuthStateChanged(onAuthChange);
});

/**
 * Handler del cambio de auth. Si hay usuario activo, redirige a
 * index.html. Si no, deja la UI de login visible (que ya está
 * renderizada en el HTML inicial).
 */
function onAuthChange(user) {
  if (_redirecting) return;
  if (user) {
    _redirecting = true;
    redirectToIndex();
  }
  /* user == null: no hacer nada, dejar que el usuario interactúe
     con la UI de login. */
}

function redirectToIndex() {
  _redirecting = true;
  /* replace() en vez de href para no dejar entrada en historial.
     Así el botón "atrás" no trae al usuario de vuelta al login
     una vez está autenticado. */
  window.location.replace(INDEX_URL);
}


/* ══════════════════════════════════════════════════════════════
   TOGGLE "MANTENER SESIÓN"
   Se aplica ANTES del sign-in (importante para que Firebase use
   browserLocalPersistence vs browserSessionPersistence).
   ══════════════════════════════════════════════════════════════ */

function onRememberToggle(cb) {
  if (window.NetPlanCloud?.isAvailable()) {
    window.NetPlanCloud.setRememberSession(cb.checked);
  }
}


/* ══════════════════════════════════════════════════════════════
   GOOGLE SIGN-IN
   ══════════════════════════════════════════════════════════════ */

async function loginWithGoogle() {
  if (!window.NetPlanCloud?.isAvailable()) {
    showToast('Nube no disponible', 'error');
    return;
  }

  /* Aplicar persistencia según el toggle ANTES del sign-in */
  const remember = document.getElementById('chk-remember-session')?.checked ?? true;
  await window.NetPlanCloud.setRememberSession(remember);

  try {
    await window.NetPlanCloud.signInWithGoogle();
    /* La redirección la maneja onAuthChange cuando llegue el evento */
  } catch (e) {
    handleAuthError(e, 'Google');
  }
}


/* ══════════════════════════════════════════════════════════════
   EMAIL — INICIAR SESIÓN
   ══════════════════════════════════════════════════════════════ */

function openEmailSigninModal() {
  closeAllAuthModals();
  document.getElementById('modal-email-signin')?.classList.remove('hidden');

  /* Limpiar campos */
  const inpE = document.getElementById('inp-signin-email');
  const inpP = document.getElementById('inp-signin-password');
  if (inpE) inpE.value = '';
  if (inpP) inpP.value = '';
  document.getElementById('field-signin-email')?.classList.remove('invalid');
  document.getElementById('field-signin-password')?.classList.remove('invalid');
  document.getElementById('btn-do-signin').disabled = true;

  /* Auto-focus en el campo email */
  setTimeout(() => inpE?.focus(), 100);
}

function closeEmailSigninModal() {
  document.getElementById('modal-email-signin')?.classList.add('hidden');
}

function validateSigninForm() {
  const email = document.getElementById('inp-signin-email')?.value.trim() || '';
  const pwd   = document.getElementById('inp-signin-password')?.value || '';
  const ok    = isValidEmail(email) && pwd.length >= 6;

  const btn = document.getElementById('btn-do-signin');
  if (btn) btn.disabled = !ok;
}

async function doEmailSignin() {
  const email = document.getElementById('inp-signin-email')?.value.trim() || '';
  const pwd   = document.getElementById('inp-signin-password')?.value || '';
  if (!isValidEmail(email) || pwd.length < 6) return;

  const remember = document.getElementById('chk-remember-session')?.checked ?? true;
  await window.NetPlanCloud.setRememberSession(remember);

  const btn = document.getElementById('btn-do-signin');
  const originalText = btn?.textContent || 'Iniciar sesión';
  if (btn) { btn.disabled = true; btn.textContent = 'Verificando…'; }

  try {
    await window.NetPlanCloud.signInWithEmail(email, pwd);
    /* La redirección la maneja onAuthChange cuando llegue el evento */
  } catch (e) {
    handleAuthError(e, 'Email');
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
  }
}


/* ══════════════════════════════════════════════════════════════
   EMAIL — CREAR CUENTA
   ══════════════════════════════════════════════════════════════ */

function openEmailSignupModal() {
  closeAllAuthModals();
  document.getElementById('modal-email-signup')?.classList.remove('hidden');

  /* Limpiar campos */
  ['inp-signup-email','inp-signup-password','inp-signup-password-confirm'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  ['field-signup-email','field-signup-password','field-signup-password-confirm'].forEach(id => {
    document.getElementById(id)?.classList.remove('invalid');
  });
  document.getElementById('btn-do-signup').disabled = true;

  setTimeout(() => document.getElementById('inp-signup-email')?.focus(), 100);
}

function closeEmailSignupModal() {
  document.getElementById('modal-email-signup')?.classList.add('hidden');
}

function validateSignupForm() {
  const email = document.getElementById('inp-signup-email')?.value.trim() || '';
  const pwd   = document.getElementById('inp-signup-password')?.value || '';
  const pwd2  = document.getElementById('inp-signup-password-confirm')?.value || '';

  const emailOk = isValidEmail(email);
  const pwdOk   = pwd.length >= 8;
  const match   = pwd === pwd2 && pwd2.length > 0;

  /* Solo marcar inválido si el campo no está vacío (UX más amable) */
  setFieldValidity('field-signup-email',            emailOk || email === '');
  setFieldValidity('field-signup-password',         pwdOk   || pwd === '');
  setFieldValidity('field-signup-password-confirm', match   || pwd2 === '');

  const btn = document.getElementById('btn-do-signup');
  if (btn) btn.disabled = !(emailOk && pwdOk && match);
}

async function doEmailSignup() {
  const email = document.getElementById('inp-signup-email')?.value.trim() || '';
  const pwd   = document.getElementById('inp-signup-password')?.value || '';
  const pwd2  = document.getElementById('inp-signup-password-confirm')?.value || '';

  if (!isValidEmail(email) || pwd.length < 8 || pwd !== pwd2) return;

  const remember = document.getElementById('chk-remember-session')?.checked ?? true;
  await window.NetPlanCloud.setRememberSession(remember);

  const btn = document.getElementById('btn-do-signup');
  const originalText = btn?.textContent || 'Crear cuenta';
  if (btn) { btn.disabled = true; btn.textContent = 'Creando cuenta…'; }

  try {
    const user = await window.NetPlanCloud.signUpWithEmail(email, pwd);

    /* Enviar email de verificación opcional (no bloqueante) */
    if (user && !user.emailVerified) {
      try {
        await window.NetPlanCloud.sendEmailVerification();
      } catch (_) { /* no crítico */ }
    }

    showToast('Cuenta creada. Revisa tu correo para verificarla.', 'success');
    /* La redirección la maneja onAuthChange cuando llegue el evento */
  } catch (e) {
    handleAuthError(e, 'Crear cuenta');
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
  }
}


/* ══════════════════════════════════════════════════════════════
   OLVIDÉ MI CONTRASEÑA
   ══════════════════════════════════════════════════════════════ */

function openForgotPasswordModal() {
  closeAllAuthModals();
  document.getElementById('modal-forgot-password')?.classList.remove('hidden');

  const inp = document.getElementById('inp-forgot-email');
  if (inp) inp.value = '';
  document.getElementById('field-forgot-email')?.classList.remove('invalid');
  document.getElementById('btn-do-forgot').disabled = true;

  setTimeout(() => inp?.focus(), 100);
}

function closeForgotPasswordModal() {
  document.getElementById('modal-forgot-password')?.classList.add('hidden');
}

function validateForgotForm() {
  const email = document.getElementById('inp-forgot-email')?.value.trim() || '';
  const btn = document.getElementById('btn-do-forgot');
  if (btn) btn.disabled = !isValidEmail(email);
}

async function doSendPasswordReset() {
  const email = document.getElementById('inp-forgot-email')?.value.trim() || '';
  if (!isValidEmail(email)) return;

  const btn = document.getElementById('btn-do-forgot');
  const originalText = btn?.textContent || 'Enviar enlace';
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }

  try {
    await window.NetPlanCloud.sendPasswordReset(email);
    closeForgotPasswordModal();
    showToast(
      'Si esa cuenta existe, te enviamos un correo con instrucciones.',
      'success'
    );
  } catch (e) {
    handleAuthError(e, 'Reset');
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
  }
}


/* ══════════════════════════════════════════════════════════════
   MODO SIN NUBE
   ══════════════════════════════════════════════════════════════ */

function enterCloudlessMode() {
  try { localStorage.setItem(CLOUDLESS_FLAG, 'true'); } catch (_) {}
  redirectToIndex();
}


/* ══════════════════════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════════════════════ */

function closeAllAuthModals() {
  document.getElementById('modal-email-signin')?.classList.add('hidden');
  document.getElementById('modal-email-signup')?.classList.add('hidden');
  document.getElementById('modal-forgot-password')?.classList.add('hidden');
}

function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function setFieldValidity(fieldId, isValid) {
  document.getElementById(fieldId)?.classList.toggle('invalid', !isValid);
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className   = `toast ${type}`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.className = 'toast hidden'; }, 2500);
}


/* ══════════════════════════════════════════════════════════════
   MANEJO DE ERRORES DE AUTH
   ══════════════════════════════════════════════════════════════ */

function handleAuthError(e, context = '') {
  /* Cierre/cancelación de popup: no es error, no molestar */
  if (e.code === 'auth/popup-closed-by-user' ||
      e.code === 'auth/cancelled-popup-request') {
    return;
  }

  const map = {
    'auth/popup-blocked':
      'El navegador bloqueó el popup. Habilita popups para este sitio y vuelve a intentar.',
    'auth/email-already-in-use':
      'Ya existe una cuenta con ese correo. Usa "Iniciar sesión" o recupera tu contraseña.',
    'auth/invalid-email':
      'El correo no tiene un formato válido.',
    'auth/user-not-found':
      'No existe una cuenta con ese correo.',
    'auth/wrong-password':
      'Contraseña incorrecta.',
    'auth/invalid-credential':
      'Correo o contraseña incorrectos.',
    'auth/weak-password':
      'La contraseña es demasiado débil. Usa mínimo 8 caracteres.',
    'auth/too-many-requests':
      'Demasiados intentos. Espera unos minutos antes de reintentar.',
    'auth/network-request-failed':
      'Sin conexión a internet. Verifica tu red.',
    'auth/operation-not-allowed':
      'Este método de inicio de sesión no está habilitado en Firebase. Contacta al administrador.',
    'auth/account-exists-with-different-credential':
      'Ya existe una cuenta con ese correo usando otro método (Google o Email). Usa ese método.',
  };

  const msg = map[e.code] || e.message || e.code || 'Error desconocido';
  showToast(msg, 'error');
  console.error(`[Auth ${context}]`, e.code, e.message);
}


/* ══════════════════════════════════════════════════════════════
   FALLBACK: si después de 2s no llegó netplan-cloud-ready (porque
   firebase-cloud.js falló en cargar o tardó demasiado), redirigir
   a index.html para que entre en modo local de emergencia.
   ══════════════════════════════════════════════════════════════ */
setTimeout(() => {
  if (!_redirecting && !window.NetPlanCloud?.isAvailable()) {
    /* Firebase no se cargó. Redirigir a index para fallback. */
    redirectToIndex();
  }
}, 2000);
