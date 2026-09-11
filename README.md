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
