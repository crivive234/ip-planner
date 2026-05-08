# Configuración de Firebase para NetPlan Pro

Esta guía explica cómo activar el guardado en la nube. **No es obligatoria**: la
herramienta funciona perfectamente sin Firebase usando `localStorage` (auto-guardado
local) e import/export JSON. Si no configuras Firebase, los botones de nube quedan
ocultos automáticamente y todo lo demás opera con normalidad.

---

## ¿Qué obtienes al configurar Firebase?

- Guardar múltiples planes en la nube y acceder a ellos desde cualquier dispositivo.
- Inicio de sesión con Google (o anónimo si solo usas un navegador).
- Persistencia offline: la app funciona sin internet y sincroniza cuando vuelve.
- Reglas de seguridad que aíslan los planes de cada usuario.

---

## Plan gratuito

El plan **Spark** de Firebase es gratis e incluye más que suficiente para uso personal
o pequeño:

- **50.000 lecturas / día** y **20.000 escrituras / día** en Firestore.
- **1 GB** de almacenamiento.
- Authentication ilimitado.

Solo necesitas una cuenta de Google. No te piden tarjeta de crédito.

---

## Pasos (10 minutos)

### 1. Crear proyecto

1. Ir a [https://console.firebase.google.com](https://console.firebase.google.com).
2. Click en **"Crear un proyecto"** (o "Add project").
3. Nombre del proyecto: cualquiera (ej. `netplan-personal`).
4. Desactivar Google Analytics si quieres ahorrarte el paso (no es necesario).
5. Esperar a que termine la creación.

### 2. Activar Authentication

1. En el menú lateral: **Build → Authentication**.
2. Click **"Get started"**.
3. Pestaña **"Sign-in method"**:
   - Habilitar **Anonymous** (click → enable → save).
   - Habilitar **Google** (click → enable → seleccionar email de soporte → save).

### 3. Crear Firestore Database

1. Menú lateral: **Build → Firestore Database**.
2. Click **"Create database"**.
3. Modo: **"Start in production mode"** (importante: las reglas las
   pegamos en el siguiente paso).
4. Ubicación: la más cercana geográficamente
   (ej. `southamerica-east1` para Sudamérica, `us-east1` para Norteamérica).
5. Esperar a que termine la creación.

### 4. Pegar las reglas de seguridad

1. En Firestore: pestaña **"Rules"**.
2. Borrar el contenido completo y pegar el contenido del archivo
   `firestore.rules` (incluido en este proyecto).
3. Click **"Publish"**.

Sin este paso, Firestore bloquea todo por defecto y los planes no se guardan.

### 5. Registrar la app web

1. Volver a la página principal del proyecto (icono ⚙ → **Project settings**).
2. Bajar a **"Your apps"** → click en el icono **`</>`** (Web).
3. Apodo de la app: cualquiera (ej. `netplan-web`).
4. **NO marcar** "Set up Firebase Hosting".
5. Click **"Register app"**.
6. Aparece un objeto de configuración JavaScript. **Copialo completo**:

```javascript
const firebaseConfig = {
  apiKey:            "AIzaSy...",
  authDomain:        "netplan-personal.firebaseapp.com",
  projectId:         "netplan-personal",
  storageBucket:     "netplan-personal.appspot.com",
  messagingSenderId: "123456789012",
  appId:             "1:123456789012:web:abc123def456"
};
```

### 6. Pegarlo en `firebase-config.js`

Abrir el archivo `firebase-config.js` y reemplazar los valores `YOUR_xxx_HERE`
con los que copiaste:

```javascript
export const firebaseConfig = {
  apiKey:            "AIzaSy...",
  authDomain:        "netplan-personal.firebaseapp.com",
  projectId:         "netplan-personal",
  storageBucket:     "netplan-personal.appspot.com",
  messagingSenderId: "123456789012",
  appId:             "1:123456789012:web:abc123def456"
};
```

### 7. Servir la app desde un servidor (no `file://`)

Los módulos ES6 (`import` desde URL) no funcionan abriendo `index.html` con
doble click. Hay que servir los archivos con un servidor local:

**Opción A — Python (preinstalado en macOS y Linux):**

```bash
cd /carpeta/del/proyecto
python3 -m http.server 8000
# Abrir http://localhost:8000
```

**Opción B — Node.js:**

```bash
npx serve
# Abrir la URL que muestra
```

**Opción C — Live Server de VS Code:**
Instalar la extensión "Live Server" → click derecho en `index.html` → "Open with Live Server".

### 8. Autorizar tu dominio

Si vas a desplegar la app en otro dominio (Netlify, Vercel, GitHub Pages, etc.),
añadir ese dominio a:

**Firebase Console → Authentication → Settings → Authorized domains**

`localhost` ya está autorizado por defecto.

---

## Verificación

Al abrir la app deberías ver:

- En el header, **dos botones nuevos**: "Mis planes" y un avatar circular.
- Avatar inicial con `?` (sesión anónima activa).
- Click en "Mis planes" abre un modal vacío con un input para guardar.

Si los botones no aparecen, abre la consola del navegador (F12). Deberías ver:

```
[NetPlanCloud] Firebase no configurado. Edita firebase-config.js …
```

Significa que los placeholders `YOUR_xxx_HERE` siguen ahí o algún valor está mal.

---

## Estructura de datos en Firestore

Los planes se guardan así:

```
users/
  └─ {tu_uid}/
       └─ plans/
            ├─ {planId_1}  → documento JSON completo del plan
            ├─ {planId_2}
            └─ ...
```

Cada plan es un documento autocontenido con el esquema `netplan.v1`. Es el mismo
formato que exporta el botón "Exportar plan editable (JSON)", así que puedes
descargar planes locales y subirlos manualmente desde la consola si hace falta.

---

## Preguntas frecuentes

**¿Mis claves de `firebaseConfig` son secretas?**
No. Por diseño quedan visibles en el navegador del usuario. Lo que protege tus
datos son las **reglas de Firestore** (paso 4), no estas claves.

**¿Puedo usar Firebase con dominio personalizado?**
Sí. Añadilo en Authentication → Settings → Authorized domains.

**¿Y si pierdo el acceso a la cuenta de Google?**
Los planes guardados con esa cuenta quedan inaccesibles desde la app. Pero
siempre podés exportar a JSON los planes importantes como respaldo local.

**¿La sesión anónima persiste?**
Sí, mientras el usuario no borre los datos del navegador. Si limpia cookies/storage,
pierde el UID anónimo y por tanto los planes asociados (a menos que los haya
exportado a JSON).
