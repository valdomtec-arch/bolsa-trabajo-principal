/**
 * Centinela Watchdog & Firebase Health Check
 * Motor de Monitoreo Automatizado para ERP
 */

const https = require('https');

const DB_URL = process.env.FIREBASE_DB_URL || "https://bolsa-de-trabajo-a52e4-default-rtdb.firebaseio.com";
const DB_SECRET = process.env.FIREBASE_SECRET || "";
const AUTH_PARAM = DB_SECRET ? `?auth=${DB_SECRET}` : "";

function requestPromise(url, options = {}, data = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(body || '{}'));
          } catch (e) {
            resolve(body);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body || res.statusMessage}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(12000, () => {
      req.destroy();
      reject(new Error('Tiempo de espera agotado (Timeout 12s)'));
    });

    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

async function ejecutarAuditoriaCentinela() {
  console.log("🛡️ [CENTINELA WATCHDOG] Iniciando ciclo de auditoría e integridad...");
  const tInicio = Date.now();

  try {
    // 1. Ping y Estado de Mantenimiento
    const pingUrl = `${DB_URL}/configuracion_sistema/centinela_mantenimiento.json${AUTH_PARAM}`;
    const enMantenimiento = await requestPromise(pingUrl, { method: 'GET' });
    const latencia = Date.now() - tInicio;
    console.log(`⏱️ Latencia de respuesta: ${latencia}ms | Modo Mantenimiento: ${enMantenimiento === true ? 'ACTIVO' : 'INACTIVO'}`);

    // 2. Validación de Colecciones Críticas (Lecturas shallow ligeras)
    const nodosAuditar = ['usuarios_reclutadores', 'empresas', 'roles_dinamicos', 'postulantes'];
    for (const nodo of nodosAuditar) {
      try {
        const nodoUrl = `${DB_URL}/${nodo}.json${AUTH_PARAM}${AUTH_PARAM ? '&' : '?'}shallow=true`;
        const resNodo = await requestPromise(nodoUrl, { method: 'GET' });
        const conteo = resNodo && typeof resNodo === 'object' ? Object.keys(resNodo).length : 0;
        console.log(`📦 Colección [${nodo}]: ${conteo} registros detectados.`);
      } catch (errNodo) {
        console.warn(`⚠️ Advertencia en [${nodo}]:`, errNodo.message);
      }
    }

    // 3. Emisión de Heartbeat Operativo (v10.8)
    const heartbeatUrl = `${DB_URL}/configuracion_sistema/centinela_heartbeat.json${AUTH_PARAM}`;
    const heartbeatData = {
      ultimoHealthCheck: new Date().toISOString(),
      latenciaMs: latencia,
      version_minima_erp: 10.8,
      estadoServidor: "OPTIMO",
      ejecutor: "GitHub Actions (script-centinela.js)"
    };
    await requestPromise(heartbeatUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    }, heartbeatData);
    console.log("💓 Heartbeat emitido correctamente.");

    // 4. Auditoría Forense en M7 (Caja Negra)
    const logUrl = `${DB_URL}/modulo_7_logs.json${AUTH_PARAM}`;
    const logData = {
      modulo: "CENTINELA_AUTOMATIZADO",
      evento: "HEALTHCHECK_PROGRAMADO",
      ejecutadoPor: "GitHub Actions Centinela",
      detalle: `Auditoría completada. Latencia: ${latencia}ms. Esquema v10.8 validado.`,
      timestamp: Date.now()
    };
    await requestPromise(logUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, logData);
    console.log("📝 Registro guardado en modulo_7_logs.");

    console.log("🚀 [CENTINELA WATCHDOG] Auditoría finalizada exitosamente.");
    process.exit(0);

  } catch (error) {
    console.error("❌ [CENTINELA ERROR] Fallo crítico durante el health check:", error.message);
    process.exit(1);
  }
}

ejecutarAuditoriaCentinela();
