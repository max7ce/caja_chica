# Caja Chica — Fase 3

React + TypeScript (Vite) · Supabase con anon key y RLS · Netlify · WhatsApp Cloud API + Resend.

---

## 1. Árbol

```
caja-chica/
├── netlify.toml               build, redirect SPA y carpeta de funciones
├── .env.example               variables de cliente y de servidor, separadas
├── public/_redirects          respaldo del redirect SPA
├── supabase/
│   └── schema.sql             TODO el SQL en un archivo
├── netlify/functions/
│   ├── whatsapp-webhook.mts   recibe los botones de WhatsApp
│   └── despachador.mts        envía la agenda de avisos cada 15 minutos
└── src/
    ├── index.css              sistema visual completo
    ├── lib/       supabase.ts · api.ts · formato.ts
    ├── types/     database.ts
    ├── hooks/     useAuth.tsx (sesión + perfil + parámetros + período vigente)
    ├── routes/    AppRouter.tsx · RutaProtegida.tsx
    ├── components/ Layout · Ui · ValeQR · SubirArchivo
    └── pages/     18 pantallas
```

---

## 2. Puesta en marcha

**Uno.** Supabase → SQL Editor → pegar `supabase/schema.sql` entero → Run. Es idempotente.

**Dos.** Authentication → Users → Add user con tu correo. Después, en el SQL Editor, las dos líneas del §8 del esquema: la que te asigna `super_admin` y la que abre la primera gestión de caja. **Sin período vigente las solicitudes no se pueden atribuir a ninguna gestión y el reporte del DAF sale vacío.**

**Tres.** Netlify → Environment variables. Solo estas dos llevan prefijo `VITE_`:

```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

Las demás son para las funciones y **nunca** llevan ese prefijo, porque cualquier variable `VITE_` queda incrustada en el bundle y es pública:

```
SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY · META_APP_SECRET
WHATSAPP_TOKEN · WHATSAPP_PHONE_ID · WHATSAPP_VERIFY_TOKEN
RESEND_API_KEY · CORREO_REMITENTE · URL_PUBLICA
```

Vite incrusta las variables durante el build, así que después de cargarlas hay que volver a desplegar.

**El sistema funciona sin WhatsApp.** Si no cargas las variables de Meta, el despachador manda todo por correo. Conviene arrancar así mientras se tramitan la cuenta de Meta Business, el número verificado y la aprobación de plantillas, que tardan días.

---

## 3. Decisiones que quedaron en el código

**El reloj se pausa sábados y domingos.** `vencimiento_habil()` suma hora por hora saltando el fin de semana, en hora de Bolivia. Un desembolso del viernes al mediodía vence el martes al mediodía. Se apaga con `parametros.pausar_fin_semana`.

**Una rendición vencida bloquea vales nuevos.** La política de inserción de `solicitudes` consulta `tiene_rendicion_vencida()`. El formulario también lo verifica, pero el bloqueo real está en la base: aunque alguien llame a la API directamente, no pasa. Se apaga con `parametros.bloquear_si_vencida`.

**Contabilidad es un rol de solo lectura.** Ve informes, movimientos y reportes; no aparece en ninguna política de escritura.

---

## 4. Detalles técnicos que conviene conocer

**Recursión en RLS.** Una política sobre `profiles` que consulte `profiles` se llama a sí misma y Postgres corta con error, y aparece recién cuando entra el segundo usuario. Por eso el rol se lee con `rol_actual()`, `es_admin()` y `es_operativo()`, funciones `security definer`. Lo mismo con `tiene_rendicion_vencida()`: sin ella, la política de inserción consultaría su propia tabla.

**El cambio de rol lo bloquea un trigger, no una política.** `WITH CHECK` no puede comparar el valor viejo con el nuevo; `profiles_proteger_rol` sí.

**Alta de usuarios sin service_role.** `crearClienteAltas()` usa la misma anon key con `persistSession: false` y su propio `storageKey`, así el `signUp` no reemplaza la sesión del administrador.

**El saldo es una vista, no un campo.** `v_saldo_caja` calcula reposiciones más devoluciones aprobadas menos desembolsos, agrupado por período. No se desincroniza nunca.

**Los recordatorios se agendan al desembolsar.** El trigger `marcar_desembolso` calcula el vencimiento hábil e inserta las cuatro filas de aviso con su `programada_para`. Cuando la persona rinde, los pendientes pasan a `cancelada` — quien cumple a las seis horas no recibe el recordatorio de las veinticuatro.

**Los botones de WhatsApp son tokens de un solo uso.** El despachador genera un token aleatorio por botón y guarda solo su hash; el webhook verifica la firma de Meta con comparación en tiempo constante, resuelve el token y lo marca usado. Un mensaje reenviado no sirve dos veces. La identidad sigue siendo el teléfono: por eso los informes de rendición se aprueban solo dentro del sistema.

---

## 5. Checklist de verificación en Netlify

**Rutas**
- [ ] Iniciar sesión, ir a `/solicitudes`, refrescar con F5: no queda en blanco.
- [ ] Pegar `https://tu-sitio.netlify.app/reportes` directo en la barra: carga.
- [ ] Escribir `/pepito`: redirige al panel, no da 404 de Netlify.
- [ ] Consola del navegador sin el error "Faltan VITE_SUPABASE_URL".

**Roles**
- [ ] Como super_admin, crear un usuario `solicitante` y confirmar que **tu sesión sigue abierta** (valida el cliente de altas).
- [ ] Entrar con ese usuario: la barra lateral muestra solo Panel, Solicitudes, Pedir un vale y Mi perfil.
- [ ] Con ese usuario, escribir `/usuarios` en la URL: sale el aviso de rol.
- [ ] Crear un usuario `contabilidad`: ve rendiciones y reportes, y ningún botón de acción.

**Plazo de 48 horas**
- [ ] Desembolsar un vale un viernes y revisar `limite_tiempo_devolucion`: debe caer el martes, no el domingo. Para probarlo sin esperar, ejecutar en el SQL Editor:
      `select public.vencimiento_habil('2026-09-11 12:00-04', 48);`
- [ ] Verificar que se crearon cuatro filas en `notificaciones` para esa solicitud.
- [ ] Rendir el gasto y confirmar que las pendientes pasaron a `cancelada`.

**Bloqueo**
- [ ] Poner a mano un `limite_tiempo_devolucion` en el pasado y confirmar que el solicitante no puede crear un vale nuevo, ni desde el formulario ni forzando el insert.

**Flujo completo**
- [ ] Solicitante pide 500 Bs → DAF autoriza → admin de caja genera QR y confirma → el saldo baja 500.
- [ ] Solicitante reporta 420 Bs, sube comprobante, deposita la diferencia.
- [ ] Admin valida el depósito → la solicitud cierra y el saldo sube 80.
- [ ] Armar informe, DAF lo aprueba, registrar la reposición → el saldo sube 7.000.
- [ ] Entrar como DAF a `/rendiciones-admin`: la gestión aparece con su monto rendido y su porcentaje en plazo.

**Avisos**
- [ ] Netlify → Functions → `despachador`: debe correr cada 15 minutos y responder "procesados: N".
- [ ] Con las variables de Meta cargadas, verificar en Functions → `whatsapp-webhook` que la verificación inicial de Meta devolvió el challenge.

---

## 6. Lo que no está implementado

El envío por WhatsApp está escrito pero no probado contra Meta: hace falta la cuenta, el número y las plantillas aprobadas con los mismos nombres que usa `TEXTOS` en el despachador. El correo funciona apenas cargues `RESEND_API_KEY` y verifiques el dominio remitente por DNS.

El reenvío diario del aviso vencido está previsto en el diseño pero el despachador solo envía la fila agendada una vez. Para que insista todos los días falta agregar, al marcar `plazo_vencido` como enviada, una fila nueva programada 24 horas después.

---

## 7. PWA — instalación en el celular

La aplicación es instalable: se agrega a la pantalla de inicio y se abre sin barra de navegador, como una app más.

**Qué incluye**

- `manifest.webmanifest` con el nombre, los iconos, el color institucional y dos accesos directos (Pedir un vale, Mis solicitudes).
- Service worker generado por `vite-plugin-pwa`, que precarga el armazón de la aplicación: al abrirla, arranca al instante en lugar de descargar todo otra vez.
- Franja de aviso cuando no hay conexión y cuando hay una versión nueva publicada.

**Qué NO hace, a propósito**

No funciona sin internet. El armazón abre, pero las consultas a Supabase están configuradas como `NetworkOnly`: sin conexión no se ve ningún dato ni se puede guardar nada. Es deliberado — en un sistema de dinero, mostrar un saldo cacheado de ayer o aceptar una solicitud que quizá nunca se envíe es peor que decir "sin conexión".

**Actualizaciones.** El service worker detecta la versión nueva y muestra un botón "Actualizar" en lugar de recargar solo, porque recargar en medio de un formulario borraría lo escrito. El archivo `public/_headers` impide que `sw.js` quede cacheado; sin eso las actualizaciones no llegarían nunca.

**Cómo se instala**

- Android (Chrome): al entrar aparece el aviso "Instalar aplicación", o desde el menú de tres puntos → Instalar.
- iPhone (Safari): botón Compartir → Añadir a pantalla de inicio. iOS no muestra aviso automático; hay que indicárselo a la gente.
- Escritorio (Chrome o Edge): ícono de instalación en la barra de direcciones.

**Iconos y logo — falta reemplazarlos**

Los iconos de `public/` (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`) son provisionales: un recuadro azul con las iniciales. Reemplazalos por el escudo oficial respetando los mismos nombres y tamaños.

Para el logo de la barra lateral, coloca el archivo oficial en `public/logo-ucb.png`. Si no está, la aplicación muestra automáticamente un recuadro azul con el nombre de la universidad, así que nunca queda rota.

---

## 8. Carga masiva de usuarios desde Excel

En **Usuarios** hay una sección para dar de alta a mucha gente de una vez.

**Cómo funciona.** Se descarga la plantilla `.xlsx` (trae dos filas de ejemplo y una hoja de instrucciones), se llena con una fila por persona y se sube. Antes de crear nada, la aplicación muestra una tabla de revisión: fila por fila, qué está lista y qué tiene problemas. Solo se crean las filas válidas; las demás se omiten y se informan.

**Columnas**: `nombre`, `email`, `departamento`, `telefono`, `rol`, `contrasena`. Los encabezados se reconocen sin distinguir mayúsculas ni tildes, y el rol acepta tanto la clave interna (`admin_caja`) como el nombre en español ("administrador de caja").

**Contraseñas.** Si la columna va vacía, el sistema genera una contraseña legible por persona. Al terminar se descarga un Excel con el resultado y las contraseñas generadas: es el único momento en que se pueden ver. Hay que entregarlo y después borrarlo.

**Dos límites de Supabase que conviene conocer antes de cargar una lista larga:**

El registro de usuarios tiene un tope de intentos por ventana de tiempo (por defecto unas decenas cada cinco minutos). La importación deja una pausa de 600 ms entre altas, pero con listas de más de veinticinco personas conviene subir el límite en Authentication → Rate Limits, o cargar en tandas.

Si la confirmación de correo está activada, Supabase envía un correo por cada alta, y el servidor de correo incluido tiene un tope muy bajo. Para una carga masiva: desactivar la confirmación, o configurar un SMTP propio antes.

**Los correos repetidos no se pisan.** Si una fila trae un correo que ya tiene cuenta, se informa como "ya existía" y no se modifica nada: ni el rol, ni la contraseña, ni los datos.

---

## 9. Aval del coordinador (migración 02)

La cadena de aprobación tiene dos niveles: el coordinador de la oficina avala, y recién entonces la solicitud llega al DAF.

**Cómo enruta.** Al crearse la solicitud, un trigger busca el coordinador de la oficina del solicitante y la manda a `pendiente_coordinador`. Va directo a `pendiente_daf` en tres casos: cuando la persona no tiene oficina o la oficina no tiene coordinador; cuando quien pide **es** el coordinador, porque nadie se avala a sí mismo; y cuando quien coordina esa oficina es además el DAF que aprueba después, para que no vea la misma solicitud dos veces.

**Quién puede pedir vales.** Solo los roles `solicitante` y `super_admin`. Quien tiene rol `daf`, `admin_caja` o `contabilidad` no crea solicitudes: si necesita algo, lo pide el coordinador de su oficina. Está en la política de inserción de `solicitudes`, no solo en la interfaz.

**El aval no corta el circuito.** Avalada o no, la solicitud pasa al DAF. Lo que cambia es el dictamen que va adjunto: `aval_coordinador` más la observación, que el DAF ve en un recuadro al abrir la solicitud y que también le llega al solicitante. No avalar exige escribir el motivo.

**Estructura.** La tabla `oficinas` tiene un coordinador por oficina; `profiles` gana `oficina_id` y `cargo`. Cambiar quién coordina es actualizar una fila, no migrar usuarios.

**Quién ve qué.** El coordinador ve y puede avalar únicamente las solicitudes donde figura como coordinador, y solo mientras están pendientes de aval. Está en la política de RLS, no solo en la interfaz.

**Cómo aplicarla.** En el SQL Editor: primero la línea del §1 sola —Postgres no permite usar un valor nuevo de un enum en la misma transacción en que se crea— y después todo el §2 junto.

**Importación con oficinas.** La plantilla ahora incluye `oficina` y `cargo`. Al importar se crean las oficinas que falten y quien tenga cargo `COORDINADOR` queda asignado como responsable de la suya. Si el correo ya existía, no se toca ni el rol ni la contraseña, pero sí se actualiza la oficina: es lo que define quién avala.

---

## 10. Notificaciones push (migración 07)

**Qué es y qué no es.** Una PWA no se ejecuta en segundo plano. Lo que sí ocurre: el sistema operativo despierta al service worker cuando llega un push, muestra la notificación y lo vuelve a dormir. El resultado práctico es el mismo —el aviso aparece con la app cerrada— pero la aplicación no está corriendo ni consumiendo batería.

**Cómo se activa.** Cada persona entra a Mi perfil y pulsa "Activar notificaciones aquí". Es por dispositivo: el celular y la computadora se registran por separado y ambos reciben.

**iPhone.** Solo funciona si la aplicación está instalada desde Safari con Compartir → Añadir a pantalla de inicio. Abierta como pestaña del navegador, iOS no entrega push. Hay que decírselo a la gente o la mitad va a creer que no funciona.

**Variables que hay que cargar en Netlify** (sin prefijo `VITE_`):

```
VAPID_PUBLIC_KEY   = BMYuTFRU9SnE7dyCmlN1JBYzF6nOLY9lI6YM2yHMfuZxcisQBFU73r--iy2ZiJLoXSc_Ma-1kGv_hMvx1tkRIFc
VAPID_PRIVATE_KEY  = f_lT7sEABnAPf_jBp_6YZEQr6thiEAzDiv-1w0WiYlw
VAPID_SUBJECT      = mailto:cajachica@ucb.edu.bo
```

La pública además se guarda en `parametros.vapid_public_key`, y la migración 07 ya la deja escrita. Si alguna vez se regenera el par, hay que actualizar las dos.

**Cómo llegan los avisos.** El despachador manda push a todos los dispositivos registrados de la persona, además del canal que corresponda al aviso. El push es el más inmediato y el que no cuesta nada, así que se envía siempre; WhatsApp y correo siguen sus propias reglas.

**Suscripciones caducadas.** Cuando un dispositivo se formatea o se desinstala la app, el servidor de push responde 404 o 410 y el despachador borra esa suscripción automáticamente. Sin eso, la tabla se llenaría de dispositivos muertos que se reintentan para siempre.

---

## 11. Datos fiscales desde el QR de la factura (migración 09)

Contabilidad carga cada factura a mano en su sistema. Cuatro de los cinco datos que necesita ya están en el QR fiscal.

**Qué trae el QR.** Las facturas de facturación en línea llevan una URL del SIAT con el NIT del vendedor, el CUF —que es el código de autorización— y el número de factura. La fecha y hora exactas no están en la URL pero sí dentro del propio CUF: es la representación en base 16 de una cadena que empieza con el NIT del emisor seguido de la fecha. `fechaDesdeCUF` la reconstruye probando corte por corte hasta que el resultado empieza con el NIT.

Comprobado contra una factura real: el CUF devolvió 29/05/2025 10:06:23, idéntico a lo impreso.

**Lo único que se escribe es el monto.** El QR no lo incluye.

**Facturas antiguas.** Las de facturación computarizada llevan en el QR una cadena suelta con el código de autorización, sin NIT ni número separables. El sistema la reconoce, la guarda como código de autorización y deja los demás campos para completar a mano. La columna "Origen" del Excel distingue lo leído por QR de lo escrito.

**Cómo se usa.** En el detalle de la solicitud, sección "Facturas de esta compra": escanear con la cámara, o leer el QR desde una foto ya tomada. Después, el botón "Datos fiscales para contabilidad" en el informe de rendición exporta una fila por factura, en el orden en que se tipean.

**Dos detalles que evitan errores caros:**

Los códigos van como texto en el Excel, no como número. Un CUF de 56 caracteres o un NIT que empiece en cero se corrompen si Excel los interpreta como cifra.

El NIT de la universidad, 1020141023, es el del comprador. Si aparece cargado como NIT del vendedor, el formulario lo advierte: significa que se está copiando el campo equivocado.

**Límite conocido.** Una foto de la hoja completa suele dejar el QR con muy pocos píxeles para decodificar. Hay que acercarse al código: en las pruebas, las fotos en primer plano se leyeron cuatro de cinco veces; las de la hoja entera, ninguna.

---

## 12. Facturas desde el PDF (migración 10)

El camino principal para registrar los datos fiscales es el PDF que entrega el portal de Impuestos Nacionales. Trae el texto seleccionable, así que se leen los seis datos sin escribir ninguno: NIT del vendedor, número, fecha, monto, código de autorización y a nombre de quién está emitida. El QR, en cambio, no incluye el monto.

**Cómo lo hace.** `pdf.js` extrae el texto en el navegador y lo reagrupa por línea usando la coordenada vertical de cada fragmento, porque los rótulos y sus valores viven en columnas distintas del mismo renglón. Después, expresiones regulares sacan cada campo.

**Dos trampas resueltas:**

El código de autorización viene partido en varias líneas, y en la maquetación de hoja ancha el teléfono del proveedor cae en la misma zona. Un teléfono son dígitos, y los dígitos son hexadecimal válido, así que ninguna validación de formato lo detectaría: se descarta por su rótulo.

El código resultante se valida decodificándolo. Un CUF correcto empieza siempre con el NIT del emisor seguido de la fecha y hora, de modo que si quedó mal recortado simplemente no decodifica. Esa misma decodificación da la fecha exacta, que prevalece sobre la impresa por no depender de cómo cada proveedor maquete su factura.

**Verificado contra cuatro facturas reales**, de tres proveedores y dos maquetaciones distintas: los seis campos salieron correctos en las cuatro, y las fechas derivadas del código coinciden al segundo con las impresas.

**La factura tiene que estar emitida a la universidad.** El NIT institucional vive en `parametros.nit_institucion`. Si el cliente de la factura no coincide, el formulario lo advierte en rojo: sin ese NIT no hay crédito fiscal y contabilidad no la puede cargar.

---

## 13. Carga contable antes del envío al DAF (migración 11)

Quien registra las facturas en el sistema contable de la universidad es el **administrador de caja**, con su rol habilitado en ese sistema, y lo hace antes de remitir el informe. El reporte que ese sistema emite se adjunta al informe: es el respaldo con el que el DAF autoriza la reposición.

Contabilidad ya no carga facturas. Solo procesa la transferencia.

**El informe nace en borrador.** Antes se creaba ya enviado al DAF. Ahora queda en borrador con tres pasos a la vista: descargar la planilla de datos fiscales, cargarla en el sistema contable y subir su reporte, y recién entonces enviar.

**El requisito está en la base.** El trigger `exigir_reporte_contable` rechaza el paso de borrador a pendiente_daf sin `reporte_contable_url`. No es solo un botón deshabilitado en la interfaz.

**El aviso al DAF se movió.** Antes se enviaba al crear el informe; ahora al remitirlo. Sin ese cambio el DAF recibiría un aviso por un informe que todavía no puede revisar.

---

## 14. Respuesta a una observación (migración 12)

Cuando el administrador de caja observaba una rendición, el solicitante veía el motivo y nada más: no podía subsanar ni contestar, y la solicitud quedaba trabada sin salida.

Ahora, con la rendición observada, el solicitante puede corregir sus facturas, adjuntar un comprobante más y escribir una respuesta. Al enviarla, el cotejo vuelve a quedar en blanco para que el administrador lo revise de nuevo, y recibe el aviso.

**Lo que no puede hacer es darse por conforme.** El trigger `proteger_observacion` rechaza que el propio solicitante marque su rendición como conforme. Sin esa restricción, alguien con la observación encima podría cerrarla escribiendo una respuesta.

El administrador ve las dos cosas al volver a cotejar: su observación anterior y la respuesta recibida, con su fecha.

## Corrección: el QR de caja se revertía

`guardarParametros` recibía el objeto de parámetros completo tal como estaba al abrir la pantalla. Si alguien subía un QR nuevo y después tocaba "Guardar parámetros", ese botón reescribía la ruta vieja y el QR volvía al anterior, sin ningún error visible.

Ahora el guardado envía solo los campos de ese formulario. Además, las dos pantallas de QR muestran el nombre del archivo vigente, para poder confirmar de un vistazo que efectivamente cambió.
