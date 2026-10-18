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
- Añadir en cada ruta diaria una opción para crear y compartir un enlace, con acciones para copiarlo o enviarlo por WhatsApp u otra app.
- El enlace abre una vista de solo lectura con el nombre y la fecha de la ruta, el orden de las paradas y su progreso de entrega.
- Usar un enlace universal: si Connect está instalada, abrir la ruta dentro de la app; si no, mostrar una página de descarga que dirija a Google Play o App Store según el dispositivo.
- Permitir revocar el enlace y hacer que caduque al terminar la jornada; no compartir ubicación en vivo ni datos de la cuenta del repartidor por defecto.
- No imponer un límite de paradas a usuarios Pro.

### 2. Control de entregas

- Registrar cada entrega como pendiente, entregada o fallida.
- Guardar el motivo cuando una entrega falla.
- Guardar el progreso automáticamente.
- Permitir fotos opcionales como comprobante, sin bloquear el cambio de estado.
- Consultar el historial de rutas y entregas.

### 3. Información comunitaria

- Lanzar inicialmente esta función solo en Las Condes, Vitacura, Providencia y Lo Barnechea; ampliar la cobertura después.
- Compartir datos sobre estacionamientos, accesos, conserjería y edificios.
- Aportar fotos reales con ubicación GPS y comentarios sobre las direcciones.
- Capturar la foto desde la app y comprobar que la ubicación del teléfono coincida con las coordenadas de la dirección dentro de un radio configurable; guardar ubicación, precisión GPS y fecha de captura.
- Evitar aportes falsos: detectar fotos repetidas, exigir cuenta verificada, permitir reportes y enviar fotos dudosas a revisión administrativa. No confiar solo en metadatos GPS, que pueden falsificarse.
- Mostrar la credibilidad de cada dirección como porcentaje calculado a partir de fotos aprobadas y confirmaciones comunitarias.
- Marcar una dirección como punto verificado cuando alcance el umbral de credibilidad (meta inicial: 90 %), supere la comprobación de ubicación y tenga aprobaciones de varias cuentas distintas; un solo “Me gusta” no basta para verificar.
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
- En cada ruta diaria, ofrecer desde las paradas una acción para aportar una foto comunitaria de la dirección; mostrar el avance de fotos válidas de esa jornada (por ejemplo, 6 de 10).
- Crear una pestaña de Aportes con el desglose mensual y una barra diaria de domicilios con aporte válido (x/10) para mostrar el avance hacia el día Pro adicional. Contar solo aportes aprobados y evitar duplicados del mismo domicilio en el conteo.
- Las fotos comunitarias deben ser distintas de las fotos opcionales de comprobante de entrega; solo las comunitarias aprobadas cuentan para el premio.
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
- La pantalla de ruta permite importar CSV y libros de Excel (`.xlsx` y `.xls`), con vista previa antes de agregar las direcciones. Los libros Excel importan su primera hoja; se admiten columnas llamadas Dirección, Domicilio o Address, o la primera columna.
- Inicio muestra la fecha, el nombre editable de la ruta actual y los totales de paradas entregadas, pendientes y fallidas; el resumen se actualiza al volver a Inicio.
- Las pestañas móviles muestran siempre los nombres Inicio, Ruta, Cuenta e Historial.
- La app tiene registro e inicio de sesión por correo con verificación de correo.
- Cuando Firebase está configurado, Connect inicia en Cuenta si no hay una sesión con correo verificado; después de verificar se abre Inicio.
- La verificación del teléfono por SMS o WhatsApp aún requiere implementar un proveedor y configurarlo en un servidor.
- Cuenta muestra acceso a Planes; la pantalla describe Gratis y Pro, pero las suscripciones y cobros todavía no están conectados.
- Con Firebase configurado y sesión activa, las rutas y entregas del día se guardan en Firestore con reglas de acceso por usuario.
- Las entregas admiten estados pendiente, entregada y fallida; esta última requiere registrar el motivo.
- Ruta muestra un mapa integrado con ubicaciones aproximadas, búsqueda de direcciones y tarjeta flotante para la próxima parada. En Android, ubicar direcciones solicita permiso de ubicación.
- El repartidor puede elegir mapa integrado, Google Maps o Waze; al iniciar y avanzar por las entregas se abre la próxima parada en el proveedor elegido. Una entrega fuera de orden no cambia las etiquetas; al llegar a una ya entregada, se salta a la siguiente pendiente.
- La estimación visible calcula un minuto por parada y excluye traslados. El botón actual ordena por cercanía en línea recta; falta conectar un motor vial para calcular calles, tráfico y duración real.
- Al importar Excel o CSV, agrupar filas del mismo domicilio en una sola parada, contar nombres de clientes distintos cuando el archivo los incluya y conservar aparte cuántos registros se agruparon. Mantener separados los departamentos diferentes y no duplicar domicilios al reimportar.
- Cada parada debe recordar al repartidor que anote cuántos paquetes debe bajar y permitir guardar una nota libre; nunca deducir paquetes del ID ni de la cantidad de clientes.
- Connect asigna automáticamente el número de cada parada; la pantalla ya no pide escribir manualmente el número que aparece en el paquete.
- La eliminación de una parada pide confirmación y el cambio de estado ofrece la acción «Deshacer».
- Inicio enlaza al historial completo. Cada ruta del historial muestra un nombre editable para el control del repartidor.
- La pestaña futura de Aportes mostrará el desglose por mes y el avance diario hacia 10 domicilios comunitarios con aporte aprobado; todavía depende de implementar la base y moderación comunitarias.
- Inicio y Ruta muestran el flujo visual de tres pasos inspirado en Circuit (añadir paradas, optimizar y navegar) con la paleta verde de Connect; Circuit no está integrado.
- Datos de direcciones ya tiene una pantalla para consultar la credibilidad, tomar o elegir una foto comunitaria, adjuntar GPS opcional y dejar comentarios visibles por 30 días. Los aportes requieren correo verificado; la pantalla de fotos es independiente del estado Entregada/Fallida.
- Las fotos comunitarias se guardan como pendientes y Storage/Firestore tienen reglas preparadas para limitar archivos a 10 MB, permitir un aporte por cuenta y domicilio, y bloquear nuevas fotos si el documento de dirección alcanza 90 %. Aún falta desplegar estas reglas, habilitar Storage en la consola y crear la moderación confiable que apruebe fotos y actualice la credibilidad.
- Los comentarios llevan fecha de expiración y la pantalla filtra los vencidos; la eliminación física automática necesita activar TTL en Firebase. Las recompensas de días Pro todavía no están implementadas.
- Git está inicializado en la rama `main`; todavía falta enlazar un repositorio remoto de GitHub.
- Faltan moderación de aportes, teléfono verificado por SMS/WhatsApp, optimización vial real, suscripciones, recompensas y pagos. La recompensa por fotos debe estar disponible desde las paradas de cada ruta diaria y contar únicamente aportes comunitarios validados, no fotos de comprobante.
- Falta compartir una ruta diaria mediante un enlace universal revocable y de solo lectura, con redirección a la tienda cuando Connect no está instalada.

La preparación de Firebase y sus pasos de configuración están en [FIREBASE_SETUP.md](FIREBASE_SETUP.md).
