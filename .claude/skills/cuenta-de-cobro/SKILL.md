---
name: cuenta-de-cobro
description: Genera la cuenta de cobro en PDF que se le envía a Lora Motors S.A.S. por el CRM (mensualidad de mantenimiento, saldo de la inversión inicial u horas extra de desarrollo), con consecutivo, valor en letras y datos bancarios, y lleva el registro de lo cobrado y lo pagado. Úsala siempre que el usuario pida "la cuenta de cobro", "la factura del mes", "cobrarle a Lora Motors / al cliente", "la mensualidad de octubre", o pregunte qué le debe el cliente o qué cuentas están pendientes de pago, aunque diga "factura" en lugar de "cuenta de cobro".
---

# Cuenta de cobro para Lora Motors

El usuario (Zait Jose Paulo Puello) le cobra a Lora Motors S.A.S. **como persona natural,
sin IVA**, con una cuenta de cobro en PDF. Aunque la pida como "factura", lo que se genera
es una cuenta de cobro. Nunca una factura electrónica: esa la emite la DIAN por otro
medio, y el usuario ya decidió que no aplica.

## Archivos

Todo vive en `.claude/skills/cuenta-de-cobro/`:

| Archivo | Qué es | ¿Va en git? |
|---|---|---|
| `scripts/generar.py` | Genera el PDF, pasa el valor a letras y actualiza el registro | Sí |
| `datos.local.json` | Emisor (cédula), cuenta bancaria, cliente, valores del contrato, carpeta de salida | **No** |
| `registro.local.json` | Todas las cuentas emitidas: número, fecha, conceptos, total y si ya se pagó | **No** |
| `datos.ejemplo.json` | Plantilla vacía de `datos.local.json` | Sí |

El repositorio es un fork público, así que los `*.local.*` están en `.gitignore`. La
cédula y la cuenta bancaria no pueden terminar en un commit ni en un archivo versionado.
Si `datos.local.json` no existe (por ejemplo, en otra máquina), cópialo desde
`datos.ejemplo.json` y pídele al usuario los datos que falten.

## Condiciones del contrato

Salen de `docs/Propuesta-CRM-LoraMotors.pdf`, con los valores que se renegociaron después:

- Inversión inicial: **$6.000.000**. Se pagó un anticipo del 50% en agosto de 2026, y el
  saldo de $3.000.000 se cobró en la cuenta No. 001.
- Mensualidad: **$1.000.000**, por mes calendario y **por anticipado**. La mensualidad de
  octubre se cobra a comienzos de octubre, no a final de mes.
- El servicio empezó el **1 de septiembre de 2026**. Es la fecha que el usuario tomó
  como salida en vivo, aunque el servidor ya estaba montado desde el 20 de agosto.
- Plazo de pago de la propuesta: 15 días calendario desde la cuenta de cobro. Solo se
  imprime si se pasa `--plazo-dias`.
- Horas de desarrollo extra: $120.000 la hora, siempre aprobadas antes por el cliente.
  La bolsa de 10 horas cuesta $1.200.000 y la de 20 horas, $2.400.000.

Si el usuario menciona otro valor (un reajuste por IPC en enero, un descuento), cámbialo
en `datos.local.json` en vez de pasarlo a mano en cada corrida.

## Flujo

1. **Lee el registro** (`registro.local.json`) y **decide qué cobrar**. Por defecto es la
   mensualidad del mes en curso. Revisa también si hay meses sin cobrar entre la última
   mensualidad del registro y el mes actual. Si los hay, pregúntale al usuario si los
   incluye en esta cuenta: no los agregues por tu cuenta.
2. **Prueba en seco** para ver conceptos, total y consecutivo:
   ```bash
   cd .claude/skills/cuenta-de-cobro/scripts
   python generar.py --mensualidad 2026-10 --dry-run
   ```
   El script se niega a cobrar dos veces el mismo mes o el saldo inicial. Si sale ese
   error, el concepto ya estaba en una cuenta anterior: díselo al usuario y no lo fuerces.
3. **Genera el PDF** con vista previa:
   ```bash
   python generar.py --mensualidad 2026-10 --preview
   ```
   Otras opciones: `--extra "Bolsa de 10 horas de desarrollo=1200000"` (se puede repetir),
   `--plazo-dias 15`, `--fecha 2026-10-01`, `--numero N` y `--mensualidad` repetido para
   cobrar varios meses en una sola cuenta.
4. **Revisa la vista previa** (`preview.local.png`) con la herramienta Read antes de
   entregarla. Debe tener una sola página, el total en letras debe coincidir con el
   número, y el periodo y el consecutivo deben ser los correctos. Si algo está mal, borra
   la última entrada de `registro.local.json` antes de volver a generar, para no quemar
   un consecutivo.
5. **Entrega al usuario:** la ruta del PDF (queda en `carpeta_salida`, hoy
   `D:/Descargas`), una tabla corta con los conceptos y el total, y el recordatorio de
   que debe **firmarla** antes de enviarla. Menciona también las cuentas anteriores que
   sigan sin pagar según el registro.

## Registrar pagos

Cuando el usuario diga que el cliente ya pagó ("ya me pagó la 002"), cambia `"pagada"`
a `true` en esa cuenta de `registro.local.json` y agrega `"fecha_pago": "AAAA-MM-DD"`.
Si pregunta qué le deben, suma las cuentas con `"pagada": false` y muéstralas con su
número, fecha y total.

## Si cambia algo

- **Otro cliente u otro contrato:** no reutilices este registro. Así se mezclarían los
  consecutivos y la detección de meses repetidos. Pregunta si quiere un registro aparte.
- **Si tiene que llevar IVA** (cambió su régimen o factura la S.A.S.): la declaración de
  no responsable de IVA que trae el PDF (`declaracion` en `datos.local.json`) deja de
  ser cierta, y firmarla sería declarar algo falso bajo juramento. Avísale al usuario
  antes de generar nada.
