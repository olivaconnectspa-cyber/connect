# Plan de Connect

## Objetivo

Crear una app móvil para repartidores que organice rutas y entregas, y que incorpore información comunitaria útil sobre los domicilios. El nombre de trabajo original fue Oliva Connect; el nombre visible actual de la app es **Connect**.

## Funciones previstas

### 1. Rutas y optimización

- Añadir direcciones manualmente, por voz o desde Excel/CSV.
- Definir punto de inicio y destino final.
- Mostrar las paradas numeradas en un mapa y permitir reordenarlas manualmente.
- Optimizar recorridos para reducir tiempo y kilómetros.
- Permitir elegir navegación con Waze, Google Maps o el mapa integrado.
- No imponer un límite de paradas a usuarios Pro.

### 2. Control de entregas

- Registrar cada entrega como pendiente, entregada o fallida.
- Guardar el motivo cuando una entrega falla.
- Guardar el progreso automáticamente.
- Permitir fotos opcionales como comprobante, sin bloquear el cambio de estado.
- Consultar el historial de rutas y entregas.

### 3. Información comunitaria

- Compartir datos sobre estacionamientos, accesos, conserjería y edificios.
- Aportar fotos reales con ubicación GPS y comentarios sobre las direcciones.
- Mostrar la credibilidad de cada dirección como porcentaje.
- Al alcanzar el 90 % de credibilidad, bloquear nuevas fotos y permitir comentarios.
- Dar a los comentarios una vigencia de 30 días o enviarlos a revisión administrativa.

### 4. Planes Gratis y Pro

- **Gratis:** optimización de hasta 10 paradas y sin acceso a información comunitaria.
- **Pro semanal o mensual:** rutas sin límite y acceso a estacionamientos, fotos y comentarios.
- Al intentar optimizar más de 10 paradas con Gratis, ofrecer la suscripción Pro.
- El límite de optimización no debe impedir registrar entregas individuales.

### 5. Bienvenida y recompensas

- Conceder 2 días de Pro tras el registro y la verificación del correo y el teléfono.
- Durante la campaña, conceder 1 día adicional por cada jornada con 10 fotos válidas.
- Contar solo fotos de direcciones con menos del 90 % de credibilidad.
- Validar los aportes antes de conceder el premio.
- Acumular el día ganado al vencimiento de una suscripción semanal.

### 6. Cuenta y almacenamiento

- Crear registro e inicio de sesión seguros.
- Guardar rutas, entregas, direcciones y aportes en Firebase.
- Almacenar las fotografías en Firebase Storage.
- Proteger los datos personales y las rutas de cada repartidor.

### 7. Administración

- Revisar aportes y comentarios reportados.
- Validar fotos para las recompensas.
- Administrar la credibilidad de las direcciones.
- Gestionar los días Pro de bienvenida y los ganados por aportes.

## Orden de desarrollo

1. Terminar las pantallas principales y conectar rutas y entregas con Firebase.
2. Implementar carga masiva, historial y estados de entrega.
3. Añadir registro de usuarios y almacenamiento de fotos.
4. Implementar información comunitaria y credibilidad.
5. Desarrollar los planes Gratis/Pro y las recompensas.
6. Probar las funciones en terreno.
7. Integrar Google Maps, Waze, el mapa integrado y la optimización real.
8. Configurar suscripciones y pagos semanales y mensuales.

## Estado actual del prototipo

- Proyecto móvil creado con React Native y Expo.
- Pantallas iniciales de Inicio y Ruta.
- Se pueden añadir y eliminar direcciones; quedan guardadas localmente mientras Firebase no esté configurado.
- La app conserva rutas locales por fecha y muestra un resumen del historial; con sesión de Firebase puede consultar las últimas 30 rutas de la cuenta.
- La pantalla de ruta permite importar direcciones desde CSV y revisar una vista previa antes de agregarlas. Los archivos de Excel se deben guardar como CSV UTF-8.
- Inicio muestra la fecha, el nombre editable de la ruta actual y los totales de paradas entregadas, pendientes y fallidas; el resumen se actualiza al volver a Inicio.
- Las pestañas móviles muestran siempre los nombres Inicio, Ruta, Cuenta e Historial.
- La app tiene registro e inicio de sesión por correo con verificación de correo.
- Con Firebase configurado y sesión activa, las rutas y entregas del día se guardan en Firestore con reglas de acceso por usuario.
- Las entregas admiten estados pendiente, entregada y fallida; esta última requiere registrar el motivo.
- Git está inicializado en la rama `main`; todavía falta enlazar un repositorio remoto de GitHub.
- Faltan lectura directa de libros Excel (`.xlsx`), fotos, teléfono verificado, mapas, optimización, funciones comunitarias, planes, recompensas y pagos.

La preparación de Firebase y sus pasos de configuración están en [FIREBASE_SETUP.md](FIREBASE_SETUP.md).
