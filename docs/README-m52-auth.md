# Autenticación para Submódulo 5.2 (Phone Auth)

Este documento describe los pasos para habilitar y desplegar la autenticación por teléfono (Phone Auth) para el submódulo m5_2_cobertura.html.

Resumen de la implementación
- Autenticación por teléfono (Firebase Phone Auth) con reCAPTCHA invisible.
- Mapeo del número autenticado al registro existente en `usuarios_reclutadores` en Realtime Database.
- Si el número autenticado no existe en la base, el acceso queda bloqueado y se muestra mensaje para contactar al administrador.
- No se suben credenciales reales al repositorio: se incluye `config/firebase.example.js` como plantilla.

Archivos añadidos en la rama fix/m52-phone-auth
- m5_2_cobertura.html (modificado): flujo de Phone Auth y mapeo a usuarios_reclutadores.
- config/firebase.example.js: plantilla para crear config/firebase.js local.
- docs/README-m52-auth.md (este archivo): instrucciones de configuración.

Pasos para configurar en Firebase Console
1. Habilitar Phone Provider:
   - Firebase Console -> Authentication -> Sign-in method -> Phone -> Habilitar.
2. Añadir dominios autorizados:
   - En Authentication -> Settings -> Authorized domains, añade tu dominio (ej. example.com) y `localhost` para pruebas.
3. (Recomendado en desarrollo) Añadir Phone numbers for testing:
   - En Authentication -> Sign-in method -> Phone -> Phone numbers for testing, agrega un número y código para evitar SMS reales.
4. Configura Realtime Database rules para restringir escrituras. Ejemplo mínimo (ajustar según necesidades):

rules_version = '2';
service cloud.firestore {
  // Si usas Realtime Database, adapta las reglas allí. Asegura que solo users autenticados puedan escribir.
}

Uso local / despliegue
1. Crea el archivo `config/firebase.js` copiando `config/firebase.example.js` y rellenando con los valores de tu proyecto.
2. Asegúrate de que `config/firebase.js` esté listado en `.gitignore` para no subir tus credenciales.
3. Despliega a tu hosting (o prueba en localhost). En localhost, si usas números de prueba, la verificación no enviará SMS.

Notas de seguridad y operación
- No expongas credenciales en repositorios públicos.
- Ajusta las reglas de Realtime Database para impedir escrituras no autorizadas. Se recomienda validar que el usuario autenticado (auth.uid) corresponde al registro operativo en `usuarios_reclutadores`.
- Para producción, considera habilitar verificación adicional (roles, 2FA por WhatsApp, auditoría) como ya está implementado en otros módulos.

Si necesitas, puedo también añadir un ejemplo de reglas de Realtime Database adaptadas al mapeo por teléfono.
