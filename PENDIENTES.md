# Pendientes

Estado al 14 de septiembre de 2026. Ordenado por lo que más duele si falta.

## Listo y desplegado

- Base de datos completa, 69 usuarios, 15 oficinas, 14 coordinadores.
- Circuito de vale: pedido, aval del coordinador, autorización del DAF, desembolso, rendición, devolución, validación.
- Plazo de 48 horas hábiles, con pausa de fin de semana y bloqueo por rendición vencida.
- Rendición de cuentas y reporte comparativo por administrador de caja.
- PWA instalable, estilo institucional, carga masiva desde Excel.

## Requiere acción tuya, no código

**Variables de las funciones en Netlify.** `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` son obligatorias para que funcione el restablecimiento de contraseñas. Sin ellas el botón devuelve error 500. Se cargan en Site configuration → Environment variables, **sin** el prefijo `VITE_`.

**Migración 03.** Ejecutar `supabase/migracion-03-qr.sql` antes de usar la carga de QR.

**QR de la cuenta de caja chica.** Súbelo en Gestiones de caja → Parámetros. Mientras falte, la pantalla de devolución no tiene qué mostrar.

**QR personales.** Cada persona sube el suyo desde Mi perfil. Conviene avisarlo cuando se anuncie el sistema; los desembolsos funcionan igual sin él, pero a mano.

**Iconos y logo.** Los de `public/` son provisionales. Reemplazar por el escudo oficial con los mismos nombres.

## Pendiente de programar

**Envío real de avisos.** El despachador y el webhook están escritos pero nunca se ejecutaron contra Meta ni Resend. Falta: cuenta de Meta Business, número verificado, plantillas aprobadas, dominio remitente con DNS. Hasta entonces la agenda se llena pero no sale nada.

**Reenvío diario del aviso vencido.** Hoy el aviso de plazo vencido se manda una sola vez. Falta que al enviarse agende el siguiente para 24 horas después.

**"Olvidé mi contraseña" autoservicio.** El restablecimiento por el administrador ya existe. El autoservicio desde la pantalla de ingreso necesita correo funcionando, así que depende del punto anterior.

**Monto de la reposición.** Hoy es fijo en 7.000 Bs. Si el saldo bajó a 1.860, reponer 7.000 deja la caja en 8.860 y el fondo crece cada ciclo. Lo habitual es reponer lo rendido para volver al techo. Decisión pendiente.

**Separación de funciones en caja.** El administrador de caja no puede pedir vales, así que hoy no puede autodesembolsarse. Si eso cambiara, habría que bloquearlo en la base.

## Deuda conocida

- El bundle pesa 1 MB sin dividir. Carga bien, pero conviene separarlo por rutas si crece.
- Las pruebas del circuito dejaron datos en producción; limpiar solicitudes, movimientos y comprobantes antes de abrir el sistema a la gente.
