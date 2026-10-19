import fetch from 'node-fetch';

const DB_URL = (process.env.FIREBASE_URL || "https://bolsa-de-trabajo-a52e4-default-rtdb.firebaseio.com").replace(/\/$/, "");
const DB_AUTH = process.env.FIREBASE_SECRET ? `?auth=${process.env.FIREBASE_SECRET}` : "";
const ADMIN_PHONE = process.env.ADMIN_PHONE;

function obtenerFechaMananaStr() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const año = d.getFullYear();
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${año}-${mes}-${dia}`;
}

function extraerFechaEstandar(valorFecha) {
    if (!valorFecha) return "";
    const str = valorFecha.toString().trim();
    const matchIso = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (matchIso) return `${matchIso[1]}-${matchIso[2].padStart(2, '0')}-${matchIso[3].padStart(2, '0')}`;
    const matchLatam = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (matchLatam) return `${matchLatam[3]}-${matchLatam[2].padStart(2, '0')}-${matchLatam[1].padStart(2, '0')}`;
    return "";
}

async function ejecutar() {
    console.log("Iniciando Centinela de Recordatorios...");
    const inicio = Date.now();

    try {
        // 1. Leer postulantes desde Firebase con autenticación por Secreto
        const res = await fetch(`${DB_URL}/postulantes.json${DB_AUTH}`);
        if (!res.ok) throw new Error(`Fallo lectura Firebase: ${res.statusText}`);
        const postulantes = await res.json() || {};

        const mananaStr = obtenerFechaMananaStr();
        const pendientes = [];

        Object.entries(postulantes).forEach(([id, p]) => {
            if (!p) return;
            const fechaCruda = p.fechaEntrevista || p.diaEntrevista || p.citaEntrevista || "";
            const fechaCita = extraerFechaEstandar(fechaCruda);

            if (fechaCita === mananaStr && p.recordatorioCitaEnviado !== true) {
                pendientes.push({ id, ...p });
            }
        });

        console.log(`Evaluación para fecha ${mananaStr}: ${pendientes.length} candidato(s) agendados pendientes.`);

        // 2. Registrar encolamiento en Firebase para auditoría en M3 Agenda y Supervisión
        for (const c of pendientes) {
            await fetch(`${DB_URL}/cola_recordatorios_whatsapp/${mananaStr}_${c.id}.json${DB_AUTH}`, {
                method: 'PUT',
                body: JSON.stringify({
                    candidatoId: c.id,
                    nombre: c.nombre || "Candidato",
                    telefono: c.telefono,
                    fechaCita: mananaStr,
                    horaCita: c.horaEntrevista || "08:00 AM",
                    estatusCola: "ENCOLADO_CENTINELA",
                    timestamp: new Date().toISOString()
                })
            });
        }

        // 3. Heartbeat de salud operativo en Firebase
        const latencia = Date.now() - inicio;
        await fetch(`${DB_URL}/configuracion_sistema/centinela_heartbeat.json${DB_AUTH}`, {
            method: 'PATCH',
            body: JSON.stringify({
                ejecutor: "GitHub Actions (script-centinela.js)",
                estadoServidor: "OPTIMO",
                latenciaMs: latencia,
                ultimoHealthCheck: new Date().toISOString(),
                candidatosProcesados: pendientes.length
            })
        });

        console.log(`Centinela finalizado con éxito en ${latencia}ms.`);
    } catch (err) {
        console.error("Error en Centinela:", err);
        process.exit(1);
    }
}

ejecutar();