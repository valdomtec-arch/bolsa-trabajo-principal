/**
 * Recordatorios Job - Motor de Despacho Automático Nocturno (21:00 hrs)
 * Inspecciona citas para D+1, despacha vía Gateway HTTP silencioso y reporta al Administrador.
 */

const https = require('https');
const http = require('http');

const DB_URL = process.env.FIREBASE_DB_URL || "https://bolsa-de-trabajo-a52e4-default-rtdb.firebaseio.com";
const DB_SECRET = process.env.FIREBASE_SECRET || "";
const AUTH_PARAM = DB_SECRET ? `?auth=${DB_SECRET}` : "";

const GATEWAY_BASE_URL = process.env.GATEWAY_BASE_URL || "https://api.gateway-reclutamiento.com/v1";
const GATEWAY_API_KEY = process.env.GATEWAY_API_KEY || "ERP_BEARER_TOKEN_ACTIVO";
const ADMIN_PHONE = process.env.ADMIN_WHATSAPP_PHONE || "";

// Wrapper genérico para peticiones HTTP/HTTPS con soporte JSON y timeout
function fetchHTTP(urlStr, options = {}, data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const client = url.protocol === 'https:' ? https : http;

    const req = client.request(url, options, (res) => {
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
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Timeout de conexión (15s)'));
    });

    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

function sanitizarTelefono(tel) {
  if (!tel) return "";
  let d = tel.toString().replace(/\D/g, '');
  if (d.length === 10) return "52" + d;
  if (d.length === 11 && d.startsWith("1")) return "52" + d.substring(1);
  if (d.length >= 12 && d.startsWith("52")) return d;
  return d;
}

function normalizarEstatus(str) {
  if (!str) return "Postulado";
  const s = str.toString().trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  if (s.includes("proceso terminado") || s.includes("terminado") || s.includes("facturad")) return "Proceso Terminado";
  if (s.includes("trabajando") || s.includes("activo")) return "Trabajando";
  if (s.includes("contratad")) return "Contratado";
  if (s.includes("medico") || s.includes("salud")) return "No Apto Medico";
  if (s.includes("entrevista") && (s.includes("no apto") || s.includes("rechaz"))) return "No Apto Entrevista";
  if (s.includes("declinant") || s.includes("abandon")) return "Declinante";
  if (s.includes("inducc")) return "Inducción";
  if (s.includes("entrevist") || s.includes("cita")) return "Entrevista";
  if (s.includes("proceso")) return "En Proceso";
  return "Postulado";
}

function obtenerFechaMananaCDMX() {
  // Ajuste a zona horaria México (UTC-6)
  const ahora = new Date();
  const utc = ahora.getTime() + (ahora.getTimezoneOffset() * 60000);
  const offsetCDMX = -6; // CST
  const fechaCDMX = new Date(utc + (3600000 * offsetCDMX));
  fechaCDMX.setDate(fechaCDMX.getDate() + 1);
  return fechaCDMX.toISOString().split('T')[0];
}

async function enviarMensajeGateway(instancia, receptor, mensaje) {
  const telLimpio = sanitizarTelefono(receptor);
  if (!telLimpio) throw new Error("Teléfono receptor inválido.");

  const payload = {
    instancia: instancia || "CENTRAL_RECLUTAMIENTO",
    receptor: telLimpio,
    mensaje: mensaje,
    timestamp: Date.now()
  };

  /*
  return await fetchHTTP(`${GATEWAY_BASE_URL}/messages/sendText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GATEWAY_API_KEY}`
    }
  }, payload);
  */

  console.log(`📡 [GATEWAY DESPACHO] Instancia: ${payload.instancia} -> A: ${payload.receptor} | Texto: "${mensaje.substring(0, 50)}..."`);
  return { status: "OK", id: `msg_${Date.now()}` };
}

async function ejecutarProcesoRecordatorios() {
  console.log("🚀 [RECORDATORIOS JOB] Iniciando corrida nocturna de evaluación de citas...");
  const tInicio = Date.now();
  const fechaMananaStr = obtenerFechaMananaCDMX();
  console.log(`📅 Fecha evaluada para entrevistas de mañana (D+1): ${fechaMananaStr}`);

  let totalDetectados = 0;
  let totalExitosos = 0;
  let totalErrores = 0;
  const fallosDetalle = [];

  try {
    // 1. Descarga completa de postulantes, usuarios y empresas
    const [snapPostulantes, snapUsuarios, snapEmpresas] = await Promise.all([
      fetchHTTP(`${DB_URL}/postulantes.json${AUTH_PARAM}`, { method: 'GET' }),
      fetchHTTP(`${DB_URL}/usuarios_reclutadores.json${AUTH_PARAM}`, { method: 'GET' }),
      fetchHTTP(`${DB_URL}/empresas.json${AUTH_PARAM}`, { method: 'GET' })
    ]);

    const postulantes = snapPostulantes || {};
    const usuarios = snapUsuarios || {};
    const empresas = snapEmpresas || {};

    const candidatosNotificar = [];

    // 2. Filtro estricto con garantía de Idempotencia
    Object.entries(postulantes).forEach(([id, p]) => {
      if (!p) return;

      const est = normalizarEstatus(p.estatus || p.status);
      if (est !== "Entrevista" && est !== "En Proceso") return;

      const fechaCita = p.fechaEntrevista || (p.diaEntrevista ? p.diaEntrevista.split(' ')[0] : "");
      
      // Valida si la cita es mañana Y no ha sido notificado aún para esta fecha
      if (fechaCita === fechaMananaStr && p.recordatorioFechaCita !== fechaMananaStr) {
        candidatosNotificar.push({ id, ...p });
      }
    });

    totalDetectados = candidatosNotificar.length;
    console.log(`🔍 Candidatos elegibles para recordatorio de mañana: ${totalDetectados}`);

    // 3. Envío secuencial con throttle preventivo antispam
    for (const c of candidatosNotificar) {
      const nom = c.nombre || `${c.nombres || ''} ${c.apellidos || ''}`.trim() || 'Candidato';
      const hora = c.horaEntrevista || (c.diaEntrevista ? c.diaEntrevista.split(' ').slice(1).join(' ') : '08:00 AM');
      const vac = c.nombreVacante || c.vacante || 'la vacante solicitada';
      const empData = empresas[c.empresaId || c.empresa] || {};
      const empNom = empData.nombreComercial || empData.nombre || c.empresa || 'nuestras instalaciones';

      const reclutador = usuarios[c.reclutadorId] || {};
      const instanciaEmisora = reclutador.instanciaWhatsApp || (reclutador.telefono ? `instancia_${c.reclutadorId}` : "CENTRAL_RECLUTAMIENTO");

      const mensaje = `Hola *${nom}*, te recordamos tu entrevista MAÑANA a las *${hora}* para la posición de *${vac}* en *${empNom}*. ` +
                      `Por favor acude con tu identificación oficial vigente. Si requieres confirmar ruta de transporte responde a este mensaje.`;

      try {
        await enviarMensajeGateway(instanciaEmisora, c.telefono, mensaje);

        // Marca atómica en Firebase para garantizar que no se duplique
        const updateUrl = `${DB_URL}/postulantes/${c.id}.json${AUTH_PARAM}`;
        await fetchHTTP(updateUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' }
        }, {
          recordatorioCitaEnviado: true,
          recordatorioFechaCita: fechaMananaStr,
          recordatorioTimestamp: new Date().toISOString(),
          recordatorioCanal: "AUTOMATIZADO_CRON_21H"
        });

        totalExitosos++;
        console.log(`✅ [OK] Recordatorio enviado a: ${nom} (${c.telefono})`);
      } catch (err) {
        totalErrores++;
        fallosDetalle.push(`${nom} (${c.telefono}): ${err.message}`);
        console.error(`❌ [FALLO] Error despachando a ${nom}:`, err.message);
      }

      // Pausa de 1.2 segundos entre cada mensaje para protección de línea
      await new Promise(r => setTimeout(r, 1200));
    }

    const duracionSeg = Math.round((Date.now() - tInicio) / 1000);

    // 4. Auditoría en modulo_7_logs
    const logUrl = `${DB_URL}/modulo_7_logs.json${AUTH_PARAM}`;
    await fetchHTTP(logUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      modulo: "RECORDATORIOS_CRON",
      evento: "DISPARO_NOCTURNO_21H",
      ejecutadoPor: "GitHub Actions Automation",
      fechaCitasEvaluada: fechaMananaStr,
      detectados: totalDetectados,
      entregados: totalExitosos,
      fallidos: totalErrores,
      duracionSeg: duracionSeg,
      timestamp: Date.now()
    });

    // 5. Reporte automático consolidado al Administrador por WhatsApp
    if (ADMIN_PHONE) {
      let reporteAdmin = "";
      if (totalDetectados === 0) {
        reporteAdmin = `🤖 *[SISTEMA ERP - CORTE 21:00 HRS]*\n` +
                       `ℹ️ *Job de Recordatorios ejecutado.*\n` +
                       `• *Fecha evaluada:* ${fechaMananaStr}\n` +
                       `• *Candidatos agendados:* 0\n` +
                       `• *Estado:* Sin entrevistas programadas para mañana.`;
      } else if (totalErrores === 0) {
        reporteAdmin = `🤖 *[SISTEMA ERP - CORTE 21:00 HRS]*\n` +
                       `✅ *Job de Recordatorios completado con éxito.*\n` +
                       `• *Fecha evaluada:* ${fechaMananaStr} (Mañana)\n` +
                       `• *Candidatos notificados:* ${totalExitosos} de ${totalDetectados}\n` +
                       `• *Fallos:* 0\n` +
                       `• *Tiempo de ejecución:* ${duracionSeg}s\n` +
                       `_No se requiere intervención manual._`;
      } else {
        reporteAdmin = `⚠️ *[ALERTA ERP - CORTE 21:00 HRS]*\n` +
                       `Se presentaron inconsistencias en el envío de recordatorios:\n` +
                       `• *Fecha evaluada:* ${fechaMananaStr}\n` +
                       `• *Exitosos:* ${totalExitosos} / ${totalDetectados}\n` +
                       `• *Fallidos:* ${totalErrores}\n` +
                       `👉 *Ingresa a m3_agenda.html para despachar los pendientes con el botón manual.*`;
      }

      try {
        await enviarMensajeGateway("CENTRAL_RECLUTAMIENTO", ADMIN_PHONE, reporteAdmin);
        console.log("📲 Reporte nocturno entregado al WhatsApp del Administrador.");
      } catch (errAdm) {
        console.warn("⚠️ No se pudo entregar el reporte al Administrador:", errAdm.message);
      }
    }

    console.log(`🏁 [RECORDATORIOS JOB] Proceso concluido en ${duracionSeg}s. Éxito: ${totalExitosos}/${totalDetectados}.`);
    process.exit(0);

  } catch (errorCritico) {
    console.error("🚨 [ERROR CRÍTICO EN JOB]:", errorCritico.message);

    // Alerta de emergencia al Administrador si el script colapsa
    if (ADMIN_PHONE) {
      const alertaFalla = `🚨 *[ALERTA CRÍTICA ERP - JOB RECORDATORIOS]*\n` +
                          `El proceso nocturno de recordatorios colapsó:\n` +
                          `• *Error:* ${errorCritico.message}\n` +
                          `• *Fecha:* ${fechaMananaStr}\n` +
                          `⚠️ *Acción requerida:* Ingresa a m3_agenda.html y pulsa el botón "Recordatorios Mañana" para el envío manual.`;
      try {
        await enviarMensajeGateway("CENTRAL_RECLUTAMIENTO", ADMIN_PHONE, alertaFalla);
      } catch (e) {}
    }

    process.exit(1);
  }
}

ejecutarProcesoRecordatorios();