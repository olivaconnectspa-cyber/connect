# Importar direcciones a Connect

En la pantalla **Ruta**, toca **Importar Excel o CSV** y elige un archivo `.xlsx`, `.xls` o `.csv`. La app muestra una vista previa para que confirmes antes de añadir las direcciones.

## Preparar el archivo

- En Excel, deja cada registro en una fila. Puedes importar el libro directamente en formato `.xlsx` o `.xls`, o guardarlo como `.csv`.
- De los libros Excel se importa la primera hoja.
- Puedes usar una columna titulada `Dirección`, `Domicilio`, `Address` o `Calle`. Si hay una columna `Nombre`, `Cliente`, `Customer` o `Destinatario`, Connect cuenta los nombres distintos para cada domicilio. Si no hay encabezado de dirección, usa la primera columna.
- Se aceptan separadores coma, punto y coma y tabulación.
- Las direcciones repetidas se agrupan en una sola parada; los departamentos o casas con un identificador distinto permanecen separados. Si el archivo trae nombres, se cuenta cuántos clientes distintos hay en el domicilio. Sin una columna de nombre, se muestra el número de registros agrupados, sin interpretarlo como clientes ni paquetes.
- El número de paquetes no se deduce de los ID del archivo. El repartidor puede anotar cuántos paquetes debe bajar en la nota de la parada.
- Los domicilios que ya están en la ruta se omiten al reimportar para evitar duplicados.

La app lee directamente Excel (`.xlsx` y `.xls`) y CSV, sin un límite fijo de tamaño. Los libros muy grandes pueden tardar más y depender de la memoria disponible en el teléfono.
