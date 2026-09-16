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

**Monto de la reposición: decidido.** Es fijo de 7.000 Bs y se suma al saldo anterior. El código ya funciona así; no hay nada que cambiar.

**Separación de funciones en caja.** El administrador de caja no puede pedir vales, así que hoy no puede autodesembolsarse. Si eso cambiara, habría que bloquearlo en la base.

## Reportes — siguiente frente

Ya responden: en qué categoría cae más gasto, cuántos vales por categoría, quién pide de qué, gasto por oficina y por mes, con filtros de fecha y oficina.

Ya se exporta a Excel el informe de rendición (resumen firmable + detalle de vales) y el historial completo de rendiciones.

Falta, en orden de utilidad:
- Exportar también los reportes por categoría y por persona.
- Comparar períodos: este mes contra el anterior, esta gestión contra la pasada.
- Tiempos del circuito: cuánto tarda cada eslabón desde que se pide hasta que se desembolsa. La vista `v_tiempos_aprobacion` ya calcula parte de esto pero ninguna pantalla la usa.
- Informe de rendición en PDF, con los comprobantes adjuntos, para el expediente físico.

## Circuito de la reposición

Cerrado: el administrador arma el informe, el DAF lo aprueba, contabilidad transfiere al QR del administrador y registra el ingreso. El administrador ya no registra su propia reposición — quien recibe el dinero no puede ser quien declara haberlo recibido.

Contabilidad solo puede cerrar informes ya aprobados por el DAF, y no puede tocar los montos: lo garantiza el trigger `proteger_informe`, no la interfaz.

## Verificación física (migración 06)

Ninguna solicitud se cierra sin que el administrador de caja reciba el vale y las facturas en papel, con firma y sello del coordinador al reverso, y confirme que coinciden con lo cargado. Antes, una rendición sin diferencia que devolver se cerraba sola.

Un trigger impide que alguien cierre su propia solicitud, incluso con permisos de administrador.

Pendiente de contrastar con la norma vigente (ver INVENTARIO-Y-ANALISIS de la documentación histórica):
- Plazo: el reglamento de 2016 dice 24 horas; el sistema aplica 48 horas hábiles.
- Fondo: las planillas históricas del Campus Central usan Bs 3.500; el sistema está en Bs 7.000.
- Formularios del reglamento que el sistema no emite: vale (Anexo 2), descargo de pasajes (Anexo 3), arqueo (Anexo 5).
- Categorías: conviene adoptar la lista taxativa del artículo 6° en lugar de las inventadas.

## Deuda conocida

- El bundle pesa 1 MB sin dividir. Carga bien, pero conviene separarlo por rutas si crece.
- Las pruebas del circuito dejaron datos en producción; limpiar solicitudes, movimientos y comprobantes antes de abrir el sistema a la gente.
