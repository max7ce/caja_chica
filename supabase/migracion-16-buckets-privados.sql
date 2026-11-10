-- =====================================================================
-- caja_chica · Migración 16 · Paso B: buckets privados
-- ⚠️ Aplicar SOLO después de desplegar en Netlify el frontend que usa
--    createSignedUrl (src/lib/storageUrls.ts). Antes de eso, las imágenes
--    de comprobantes y QR dejarían de verse.
-- Reversible al instante con: update storage.buckets set public = true where id in ('comprobantes','qr');
-- =====================================================================
update storage.buckets set public = false where id in ('comprobantes', 'qr');
