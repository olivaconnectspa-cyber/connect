# Configurar Firebase para Connect

La app usa React Native + Expo y el SDK JavaScript de Firebase, por lo que puede ejecutarse en Expo Go. El proyecto de Firebase debe ser tuyo; no pegues aquí contraseñas, claves privadas ni el contenido de `.env`.

## 1. Crear el proyecto y la aplicación web

1. Entra a la [consola de Firebase](https://console.firebase.google.com/) e inicia un proyecto nuevo.
2. En la página principal del proyecto, selecciona **Agregar app** y elige el icono **Web** (`</>`). Aunque Connect sea una app de celular, este registro permite usar el SDK de Firebase compatible con Expo Go.
3. Registra la app como `Connect` y copia los valores de configuración del SDK web.

## 2. Activar acceso por correo

1. En Firebase abre **Authentication → Comenzar → Sign-in method**.
2. Activa **Correo electrónico/contraseña** y guarda.

## 3. Crear Firestore

1. Abre **Firestore Database → Crear base de datos**.
2. Elige una ubicación cercana a tus usuarios. La ubicación no se puede cambiar fácilmente después.
3. Puedes iniciar en modo de producción. Las reglas del proyecto están en `firestore.rules`; su publicación se hace desde Firebase CLI después de seleccionar tu proyecto.

## 4. Poner la configuración local en VS Code

1. En VS Code, abre la carpeta `OlivaConnect/app`.
2. Copia `.env.example` como `.env` en esa misma carpeta.
3. Completa los valores de la app web:

```env
EXPO_PUBLIC_FIREBASE_API_KEY=valor_de_apiKey
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=tu-proyecto.firebaseapp.com
EXPO_PUBLIC_FIREBASE_PROJECT_ID=tu-proyecto
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=tu-proyecto.firebasestorage.app
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=valor_de_messagingSenderId
EXPO_PUBLIC_FIREBASE_APP_ID=valor_de_appId
```

Firebase incluye una API key pública para identificar el proyecto. La seguridad de los datos depende de las reglas de Firestore y de la autenticación; no agregues claves de cuentas de servicio a la app. `.env` está excluido de Git.

## 5. Publicar las reglas

Instala Firebase CLI si no la tienes, inicia sesión y desde la terminal integrada de VS Code, en `OlivaConnect/app`, ejecuta:

```powershell
npx.cmd firebase-tools login
npx.cmd firebase-tools use --add
npx.cmd firebase-tools deploy --only firestore:rules
```

Cuando pregunte por el proyecto, selecciona el que acabas de crear. Comprueba que `firebase.json` apunta a `firestore.rules` antes de desplegar.

## 6. Reiniciar Expo

Detén el servidor con `Ctrl+C` y vuelve a iniciarlo:

```powershell
npm.cmd start -- --clear
```

En Cuenta podrás registrar un usuario, confirmar el correo y luego crear una ruta que se guardará bajo la cuenta autenticada. El prototipo actual guarda rutas y entregas del día; todavía no incluye historial, fotos, teléfono verificado ni reglas de suscripción.
