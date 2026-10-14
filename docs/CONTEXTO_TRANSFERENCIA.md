# Oliva Connect — contexto para continuar en otra cuenta

Fecha del resumen: 13 de octubre de 2026

## Cómo abrir el proyecto

- Proyecto local: `C:\Users\jojo\Documents\Codex\OlivaConnect\app`
- Repositorio GitHub: `https://github.com/olivaconnectspa-cyber/connect`
- Abrir la carpeta `app` en Visual Studio Code. El proyecto es React Native con Expo y TypeScript; no usar Flutter.
- Para iniciar Expo desde la terminal de VS Code: `npm.cmd start -- --tunnel`. Escanear el QR con Expo Go.

## Objetivo de la aplicación

Connect es una app móvil para repartidores. La idea es crear, optimizar y completar rutas diarias, importar direcciones desde Excel/CSV, registrar entregas y compartir una ruta preparada con otro chofer. A futuro se quiere publicar en Play Store y App Store.

## Decisiones y necesidades acordadas

- La app es móvil con React Native + Expo, desarrollada desde Visual Studio Code y guardada en GitHub.
- Firebase se usa para autenticación y almacenamiento en la nube.
- El repartidor puede añadir domicilios manualmente o importar `.xlsx`, `.xls` y `.csv`.
- Al repetir una dirección se agrupan los pedidos; el conductor anota en la parada cuántos paquetes debe bajar.
- La ruta diaria registra estados pendiente, entregada o fallida, motivo de fallo, notas y progreso.
- El mapa integrado debe quedar encima del recuadro para añadir una parada e importar archivos.
- Cada parada debe tener un botón «Navegar» que use el mapa seleccionado o centre esa parada en el mapa integrado.
- La optimización debe quedar accesible junto a la lista; debe ordenar las paradas antes de iniciar la ruta.
- Compartir ruta: un conductor crea y optimiza la ruta una sola vez, y comparte un enlace para que otro chofer abra esa misma ruta y su orden, sin volver a cargar las direcciones ni anotar de nuevo los paquetes. El enlace debe dar acceso solo a esa ruta compartida; no al historial ni a las demás rutas del dueño. La función de compartir aún no está implementada.
- El primer acceso debe permitir registro/inicio de sesión; después se quiere añadir acceso con Google y verificación de teléfono. La distribución final será por tiendas móviles.

## Cambios hechos en este trabajo

- En `src/app/ruta.tsx` se movió el componente del mapa integrado para que aparezca encima de la tarjeta de añadir/importar paradas.
- Se añadió «Navegar a esta parada» en las tarjetas. En mapa integrado selecciona la parada y vuelve al mapa; con Google Maps o Waze abre esa dirección.
- Se añadió «Optimizar orden de paradas» junto a la lista. Ubica las direcciones y ofrece un orden aproximado por distancia en línea recta antes de guardar.
- Al terminar una ruta, las paradas pendientes quedan como solo consulta: ya no se pueden marcar, editar ni eliminar. Las paradas entregadas/fallidas se agrupan y quedan plegadas inicialmente.
- Durante una ruta con «Mapa integrado», `src/app/ruta.tsx` muestra una pantalla de navegación: mapa ampliado, dirección de la parada activa, avance como «3 de 20», botones Entregada/Fallida y acceso a una lista agrupada que se abre como panel. Las visitadas se pueden plegar.
- Al registrar una entrega o fallo, aparece un aviso animado con el número de la siguiente parada. La selección de una parada también centra el mapa en ella.
- `src/components/route-map.tsx` admite el modo ampliado y oculta controles de búsqueda para dejar más espacio al mapa durante la navegación.
- `app.config.js` queda preparado para leer claves de Google Maps desde variables de entorno. Verificado: falta `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY` en `.env`; por eso el mapa integrado puede mostrar fondo negro. Configurar una clave de Google Maps y crear un build nativo/de desarrollo para que se aplique el plugin. Refrescar JavaScript en Expo Go no instala una clave nativa.
- `firestore.rules` ya contiene cambios locales para que cada usuario consulte su ruta bajo su propio UID aunque la ruta del día todavía no exista, y para aceptar los campos de paradas que la app usa al guardar/importar.
- Si Metro avisa que no pudo leer su caché (`Unable to deserialize cloned data`), detener Expo con `Ctrl+C` y volver a iniciarlo desde `app` con `npx.cmd expo start --clear`. El mensaje dice que Metro intentará reconstruir la caché; no es por sí mismo un error del código de la app.
- Los cambios recientes de navegación y cierre de ruta están guardados en el proyecto local. No se han subido a GitHub ni se han probado en el teléfono en esta sesión.

## Estado actual y próximo paso urgente

- El usuario informó que pulsó **Publish** para las reglas de Firestore. Aún falta probar en Connect que se puedan guardar una parada manual y una importación Excel/CSV.
- Proyecto Firebase: `oliva-connect-cybmzx`.
- Si siguen errores en Firebase, comprobar que se publicó el borrador correcto en Firestore → Rules. Las reglas son para rutas propias por UID; no otorgan acceso a las rutas de otras cuentas ni implementan el enlace compartido.
- Waze no está instalado en el teléfono; al elegirlo, Android ofrece descargarlo. Google Maps puede usarse como alternativa.
- El mapa integrado sigue pendiente de configurar. El permiso GPS no reemplaza la clave de Google Maps SDK; crear/configurar la clave, añadirla al entorno local y generar un development build antes de comprobar las calles. Restringir la clave al identificador y certificado de la app.
- Si aún falla, copiar el mensaje completo de Expo Go y revisar las reglas activas, la sesión autenticada y los campos concretos que intenta guardar.

## Siguientes tareas de desarrollo

1. Confirmar que las reglas publicadas permiten guardar e importar paradas con el esquema actual.
2. Implementar compartir una ruta específica con enlace seguro y pantalla de apertura en Connect. Debe incluir el orden optimizado y la información de paquetes necesaria, sin exponer otras rutas. Definir si el otro chofer puede marcar entregas en la ruta compartida o solo consultarla.
3. Preparar enlaces que abran la app instalada y, cuando estén disponibles, dirijan a Play Store/App Store si no está instalada.
4. Seguir con autenticación, verificación de correo/teléfono y preparación de builds de tienda.

## Seguridad

No copiar a otra cuenta contraseñas, códigos de verificación, tokens, claves privadas ni valores secretos de `.env`. Si se vuelve a necesitar Firebase, usar la sesión de Console del propietario o iniciar sesión por el flujo oficial.
