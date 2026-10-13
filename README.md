# Connect

Prototipo móvil para ayudar a repartidores a organizar sus rutas y entregas. Está hecho con React Native y Expo; el código se edita en Visual Studio Code.

## Abrir en el teléfono

1. Abre esta carpeta en Visual Studio Code.
2. En la terminal integrada, ejecuta `npm.cmd start`.
3. Escanea el código QR con Expo Go.

## Estado del prototipo

- Inicio de Connect con accesos a la jornada y a la planificación.
- Pantalla de ruta donde se pueden añadir direcciones manualmente.
- Las paradas se guardan localmente si Firebase no está configurado; con Firebase y una sesión activa, las rutas y entregas del día se sincronizan con la cuenta.
- Se pueden marcar las entregas como pendientes, entregadas o fallidas; una entrega fallida requiere motivo.
- Inicio muestra la fecha y el nombre editable de la ruta de hoy, con totales de paradas y estados.
- Las cuatro pestañas móviles muestran sus nombres de forma permanente.
- Se pueden importar varias direcciones desde archivos CSV, con una vista previa para confirmarlas antes de agregarlas.
- El historial agrupa las rutas locales por fecha y, al iniciar sesión con Firebase, muestra las últimas 30 rutas de la cuenta.
- La pantalla Cuenta permite crear usuario, iniciar sesión y verificar correo.

Para configurar tu nuevo proyecto Firebase, sigue [la guía de Firebase](docs/FIREBASE_SETUP.md). No se incluyen credenciales: debes crear el proyecto y poner su configuración local en `.env`.

Consulta el [plan completo de Connect](docs/PLAN.md) para ver el alcance y el orden de desarrollo.
