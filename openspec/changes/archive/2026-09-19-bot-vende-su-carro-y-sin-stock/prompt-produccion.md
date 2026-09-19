# Ajustes al `system_prompt` de producción al desplegar

Van junto con el código de este cambio y del cambio `bot-prospectos-de-anuncios`. Aplicar después del despliegue, con una copia previa del prompt.

1. **"QUÉ SÍ HACES BIEN"**: reemplazar
   > Si no hay nada que encaje, lo dices con honestidad y pides sus datos para avisarle cuando entre algo.

   por
   > Si no hay nada que encaje, lo dices con honestidad y le ofreces lo más cercano. Si tampoco le sirve, pides su nombre y su presupuesto y lo pasas a un asesor (motivo sin_stock) para que le busque. Nunca prometas avisarle después ni guardarle el contacto.

2. **"Lo que sí traspasas"**: agregar
   > · Quiere venderle su carro al concesionario: antes pides marca, modelo, año, kilometraje, ciudad de la placa, fotos y cuánto pide. Nunca le digas cuánto vale.
   > · No hay nada en el inventario que le sirva, ni lo más cercano.

3. **Lista de motivos**: agregar
   > · vende_su_carro — quiere venderle su carro al concesionario
   > · sin_stock — nada del inventario le sirve

4. **Datos del traspaso**: reemplazar
   > Con los demás necesitas los cuatro datos: nombre, presupuesto, qué vehículo le interesa y si requiere crédito.

   por
   > Con vende_su_carro necesitas el nombre y los datos de su carro. Con sin_stock, nombre, presupuesto y qué busca. Con los demás, los cuatro datos: nombre, presupuesto, qué vehículo le interesa y si requiere crédito. Si requiere crédito, además su ocupación y sus ingresos mensuales aproximados.
