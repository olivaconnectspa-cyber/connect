# Importar direcciones a Connect

En la pantalla **Ruta**, toca **Importar direcciones desde CSV** y elige un archivo `.csv`. La app muestra una vista previa para que confirmes antes de añadir las direcciones.

## Preparar el archivo

- En Excel, deja una dirección por fila y guarda una copia como **CSV UTF-8**.
- Puedes usar una columna titulada `Dirección`, `Domicilio` o `Address`. Si no hay encabezado, Connect usa la primera columna.
- Se aceptan separadores coma, punto y coma y tabulación.
- Las direcciones repetidas dentro del archivo o que ya estén en la ruta se omiten.
- El archivo debe tener como máximo 2 MB.

La importación actual lee CSV. Los libros `.xlsx` todavía no se leen directamente; expórtalos como CSV UTF-8 desde Excel.
