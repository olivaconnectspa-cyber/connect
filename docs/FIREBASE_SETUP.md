# Configurar Firebase para Connect

La app usa React Native + Expo y el SDK JavaScript de Firebase. El acceso por correo puede probarse en Expo Go; Google requiere una compilación de desarrollo y clientes OAuth configurados. El proyecto de Firebase debe ser tuyo; no pegues aquí contraseñas, claves privadas ni el contenido de `.env`.

## 1. Crear el proyecto y la aplicación web

1. Entra a la [consola de Firebase](https://console.firebase.google.com/) e inicia un proyecto nuevo.
2. En la página principal del proyecto, selecciona **Agregar app** y elige el icono **Web** (`</>`). Aunque Connect sea una app de celular, este registro permite usar el SDK de Firebase compatible con Expo Go.
3. Registra la app como `Connect` y copia los valores de configuración del SDK web.

## 2. Activar acceso por correo y Google

1. En Firebase abre **Authentication → Comenzar → Sign-in method**.
2. Activa **Correo electrónico/contraseña** y guarda.
3. Activa el proveedor **Google** y guarda.
4. En Google Cloud Console crea clientes OAuth de tipo **Web**, **Android** e **iOS** para la misma app/Firebase project. Usa el identificador de cliente público en `.env`; nunca agregues el secreto del cliente.

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
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=...
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=...
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=...
```

Los identificadores OAuth son públicos y específicos de cada plataforma. En Android y iOS agrega también el nombre de paquete/Bundle ID y las huellas SHA requeridas por Firebase/Google. Expo Go no puede completar el retorno OAuth a la app; para probar **Continuar con Google** crea una compilación de desarrollo después de configurar los clientes.

Firebase incluye una API key pública para identificar el proyecto. La seguridad de los datos depende de las reglas de Firestore y de la autenticación; no agregues claves de cuentas de servicio a la app. `.env` está excluido de Git.

## 5. Activar Firebase Storage para fotos

1. Abre **Storage → Comenzar** en la consola del proyecto y crea el bucket.
2. En la sección Reglas, publica las reglas del archivo `storage.rules`.
3. El código de Connect usa rutas `community/{addressId}/{uid}/photo.jpg`, limita cada imagen a 10 MB y exige una cuenta con correo verificado.

Las fotos quedan como **pendientes de revisión**. La credibilidad y el bloqueo al 90 % solo cambian cuando un proceso de moderación confiable actualiza el documento de la dirección; ese panel/proceso todavía debe desarrollarse. No publiques cambios de credibilidad desde el cliente.

## 6. Publicar las reglas

Instala Firebase CLI si no la tienes, inicia sesión y desde la terminal integrada de VS Code, en `OlivaConnect/app`, ejecuta:

```powershell
npx.cmd firebase-tools login
npx.cmd firebase-tools use --add
npx.cmd firebase-tools deploy --only firestore:rules,firestore:indexes,storage
```

Cuando pregunte por el proyecto, selecciona el que acabas de crear. Comprueba que `firebase.json` apunta a `firestore.rules` antes de desplegar.

Los comentarios incluyen `expiresAt` a 30 días y la app deja de mostrarlos después de esa fecha. Para borrar los documentos automáticamente, activa una política TTL en Firestore para el campo `expiresAt` del grupo de colecciones `comments` desde Google Cloud/Firebase.

## 7. Reiniciar Expo

Detén el servidor con `Ctrl+C` y vuelve a iniciarlo:

```powershell
npm.cmd start -- --clear
```

En Cuenta podrás registrar un usuario y confirmar el correo. La pantalla Datos de direcciones permite adjuntar fotos comunitarias para revisión y dejar comentarios con vigencia de 30 días. Las fotos son independientes del estado de las paradas; la aprobación/moderación, el cálculo real de credibilidad, las recompensas y el teléfono verificado todavía no están conectados.

## 8. Enlaces HTTPS para compartir rutas

Connect publica una página de solo lectura en el sitio separado `oliva-connect-cybmzx-rutas.web.app`, para conservar el sitio Hosting principal del proyecto. Al compartir, la app crea un código aleatorio y envía un enlace corto `https://oliva-connect-cybmzx-rutas.web.app/r/{código}`; no incluye las direcciones dentro del URL. El enlace permite ver direcciones, números de paquete, nombres y teléfonos durante 7 días. Quien tenga el enlace puede consultar esos datos de contacto.

Si cambia la configuración Firebase web, regenera el archivo local de configuración pública del sitio y despliega Hosting:

```powershell
npm.cmd run build:share-site
npx.cmd firebase-tools deploy --only hosting --project oliva-connect-cybmzx
```

El archivo `public/r/firebase-config.js` se genera desde `.env` y está excluido de Git. Las reglas `sharedRoutes` se publican con Firestore Rules. La página ofrece **Abrir en Connect** para dispositivos que ya tengan la app instalada; el despliegue de Connect en las tiendas y los enlaces universales quedan para la publicación final.
