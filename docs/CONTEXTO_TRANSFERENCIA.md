# Connect — resumen de traspaso del proyecto

Actualizado: 17 de octubre de 2026

Este documento reúne el objetivo, las decisiones de producto, el estado técnico y el siguiente trabajo acordado en la conversación. Es un resumen para retomar el proyecto; no reproduce literalmente cada mensaje.

## 1. Dónde está el proyecto

- Carpeta de la app: `C:\Users\jojo\Documents\Codex\OlivaConnect\app`
- Abrir esa carpeta en Visual Studio Code.
- App móvil hecha con React Native, Expo y TypeScript. El trabajo activo está en VS Code; FlutterFlow quedó atrás.
- Proyecto Firebase: `oliva-connect-cybmzx`.
- Nombre visible actual: **Connect**. El nombre puede cambiar antes de publicar.
- Para iniciar Expo desde PowerShell en la carpeta `app`: `npm.cmd start -- --clear`. Escanear el QR con Expo Go. Detener con `Ctrl+C`.
- Hay cambios locales sin confirmar/subir a GitHub. El remoto anotado en el traspaso previo era `https://github.com/olivaconnectspa-cyber/connect`; confirmar con `git remote -v` antes de sincronizar. Revisar `git status -sb`; no asumir que el remoto contiene el estado actual.

## 2. Qué busca resolver Connect

Una herramienta para conductores y repartidores que reciben rutas con decenas de entregas. Debe facilitar la carga y orden de paradas, ayudar a seguir la ruta, conservar el control de paquetes y mejorar la información de acceso y estacionamiento en domicilios.

La experiencia se inspira en el flujo sencillo de Circuit —añadir, optimizar y navegar—, pero Connect mantiene su propio diseño y paleta verde. Circuit no se integra ni se copia como servicio.

## 3. Decisiones de producto acordadas

### Rutas, paradas y entregas

- Admitir direcciones manuales y hojas Excel/CSV; agrupar registros de un mismo domicilio cuando corresponde y preservar los datos de cliente/paquete.
- Optimizar una ruta antes de empezar a registrar estados. **Entregada** y **Fallida** deben permanecer deshabilitados hasta que la optimización se complete.
- El orden de paradas y el número que el chofer anota en el paquete tienen que coincidir. Agregar una parada después de optimizar necesita un flujo futuro que la inserte cerca del punto adecuado sin volver a ordenar los paquetes ya identificados.
- Marcar Entregada o Fallida no debe depender de una foto. La foto es opcional y nunca debe bloquear el avance.
- Una entrega fallida ofrece motivo: se puede escribir y guardar o continuar sin motivo, según el flujo configurado.
- Entregas guardadas pasan a Visitadas. Los estados Entregada/Fallida usan colores verdes/rojos; una parada seleccionada se resalta en azul.
- Mostrar el nombre/teléfono si se importaron o agregaron; permitir llamar y abrir WhatsApp cuando haya teléfono.
- Navegación prevista: mapa integrado, Google Maps o Waze. Compartir solo cuando la ruta esté optimizada.
- Al compartir con otro conductor se entrega una copia/ruta independiente para ese conductor; no sincronizar los estados entre choferes. Cada uno marca solo las entregas que asume.

### Fotos y datos comunitarios

- Desde una entrega marcada como Entregada, ofrecer aportar una foto del acceso/estacionamiento, si esa dirección aún acepta fotos.
- Al aceptar, abrir **Datos de direcciones → Aporta una foto**, con la dirección de la parada actual cargada y abrir la cámara. No usar la primera dirección de la lista por defecto.
- Antes de subir, exigir correo verificado, Firebase Storage, permiso de ubicación, precisión GPS adecuada y cercanía a la dirección (radio actual: 150 m; precisión máxima actual: 80 m). La entrega permanece guardada aunque se cancele o falle el aporte.
- El mismo apartado de Direcciones queda como alternativa manual si el chofer omitió la foto al entregar.
- No preguntar por fotos a domicilios con credibilidad de 90 % o más; permitir comentarios cuando las fotos estén bloqueadas.
- Las fotos se guardan pendientes de revisión. La credibilidad y el premio no cambian hasta aprobación/moderación confiable. El cliente no debe poder aprobar sus propios aportes.
- Comentarios vencen a los 30 días; la eliminación automática requiere configurar TTL en Firebase.
- Fotos comunitarias no son lo mismo que una foto de comprobante de entrega.

### Gratis, Pro y recompensas (para una etapa posterior)

- La versión Gratis debe seguir siendo atractiva y permitir el flujo de entrega. La limitación acordada es optimizar hasta 10 paradas; más de 10 invita a probar Pro. No debe impedir marcar estados de entregas individuales.
- Pro ofrece rutas sin límite y funciones comunitarias; se consideran suscripciones semanal y mensual.
- Se conversó regalar 2 días Pro tras registro/verificación y 1 día adicional por 10 fotos comunitarias válidas en una jornada; contar solo fotos aprobadas, de domicilios por debajo del 90 %, sin duplicar dirección.
- Suscripciones, cobros y recompensas se dejan para el final. No presentar estos incentivos como funcionales hasta implementar servidor/moderación y validación antifraude.

## 4. Estado técnico conocido

- La app contiene Inicio, Ruta, Historial, Cuenta, Planes, Direcciones y vista de ruta compartida.
- Firebase Authentication, Firestore y Storage se usan/preparan para cuentas, rutas y aportes. Las reglas locales están en `firestore.rules` y `storage.rules`; **no asumir que las reglas actuales ya están publicadas en la consola**.
- Un intento de importar paradas mostró `permission-denied` de Firestore al escribir la ruta y una entrega. El usuario hizo login en Firebase CLI, pero hace falta verificar el borrador publicado de reglas y volver a probar una cuenta autenticada.
- Las reglas y el código han cambiado varias veces. Revisar el error actual en pantalla/terminal antes de concluir que es un problema de permisos.
- Se añadió inicio de sesión Google; las dependencias `expo-auth-session` y `expo-crypto` se alinearon con Expo SDK 57 después de que una versión Expo 58 rompiera Metro con `expo/internal/bundle-origin`.
- Expo Go no completa el retorno OAuth de Google en una app propia; para probar el login Google se necesita configurar IDs OAuth y crear un development build. No incluir valores secretos ni compartir `.env`.
- La clave Android de Google Maps sigue pendiente; por eso el mapa integrado puede verse negro. La integración/configuración completa de Google Maps se reservó para el final.
- El orden actual de optimización es aproximado por cercanía en línea recta, no usa calles ni tráfico. La optimización vial real queda pendiente.
- El sitio HTTPS de ruta compartida y su página web existen localmente; revisar `docs/FIREBASE_SETUP.md` antes de desplegar. Los enlaces incluyen datos de la ruta que puede consultar quien tenga el enlace; confirmar el alcance de nombres/teléfonos antes de usar con clientes reales.
- Los datos de prueba/rutas locales pueden perderse al limpiar almacenamiento o reinstalar Expo Go; no usar Expo Go como única copia de rutas reales.

## 5. Cambios de la sesión actual (a probar en el teléfono)

- Después de Entregada, la opción **Aportar foto** abre la cámara desde el apartado comunitario con la dirección actual precargada; el GPS se valida al enviar. Si la dirección está verificada al 90 % o falla GPS, no se sube.
- Entregada/Fallida están bloqueados hasta optimizar la ruta; la misma regla protege las acciones provenientes de la notificación.
- Al guardar un estado aparece el aviso **Marcaste entregada** o **Marcaste fallida**; en la ruta en curso puede incluir la siguiente parada.
- La lista abierta desde **Paradas** en la navegación ahora tiene pestañas **Por visitar**, **Visitadas** y **Todas**. Seleccionar una fila no cierra el panel; la fila se destaca en azul y el botón **X** lo cierra. Seleccionar una pendiente también actualiza la parada activa.
- La selección de una parada en la lista principal/mapa debe resaltar en azul.
- Se reservó espacio al pie de la pantalla de navegación para que la barra flotante no tape los botones Entregada/Fallida.
- Verificación de este estado: `npx.cmd tsc --noEmit` y `git diff --check` pasaron. Todavía no se verificó la interacción visual en el dispositivo del usuario.

## 6. Próximo paso al retomar

1. Iniciar Expo y recargar la app en el teléfono.
2. Optimizar una ruta de prueba. Confirmar que antes de optimizar no se habiliten Entregada/Fallida y después sí.
3. Iniciar con mapa integrado; comprobar que Entregada/Fallida queden visibles por encima de la barra inferior.
4. Abrir **Paradas**, probar las tres pestañas, seleccionar varias paradas incluidas visitadas, comprobar el borde azul y cerrar solo con **X**. Verificar que una pendiente seleccionada se muestre como parada activa.
5. Marcar una entrega de prueba: comprobar el aviso, que el prompt de foto no afecte el estado, que la cámara abra para el domicilio correcto y que el GPS rechace una ubicación distante.
6. Repetir una importación Firestore si persiste el error de permisos: recoger el `Código:` exacto y contrastarlo con las reglas desplegadas.
7. Dejar integración final de Google Maps, suscripciones y pagos para la etapa acordada.

## 7. Comandos útiles

En PowerShell, desde `C:\Users\jojo\Documents\Codex\OlivaConnect\app`:

```powershell
npm.cmd start -- --clear
npx.cmd tsc --noEmit
git status -sb
```

No pegar en el chat contraseñas, códigos SMS, tokens, claves privadas, service accounts ni el contenido del archivo `.env`. El usuario inicia sesión personalmente en Firebase/Google.

## 8. Archivos de referencia

- `docs/PLAN.md`: funcionalidades y estado del prototipo.
- `docs/FIREBASE_SETUP.md`: Firebase, login, Storage, reglas y hosting de rutas compartidas.
- `src/app/ruta.tsx`: flujo principal de rutas y entregas.
- `src/app/direcciones.tsx`: credibilidad, aportes y comentarios.
- `src/lib/parking-photo.ts`: decide si una dirección puede ofrecer un nuevo aporte desde el flujo de entrega. La captura y carga actual están en `src/app/direcciones.tsx`.
- `src/components/app-tabs.tsx`: barra inferior.
