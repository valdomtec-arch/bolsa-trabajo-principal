const admin = require("firebase-admin");

// 1. Inicializar la conexión segura con Realtime Database
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DB_URL
});

const db = admin.database();

async function ejecutarCentinela() {
    console.log("⏰ Iniciando el Centinela de las 9:00 PM...");

    // 2. Verificar si el sistema se encuentra en Modo Mantenimiento
    const snapMantenimiento = await db.ref("configuracion_sistema/centinela_mantenimiento").once("value");
    if (snapMantenimiento.val() === true) {
        console.log("⏸️ Modo MANTENIMIENTO activo desde el panel. Se pausan los envíos automáticos de hoy.");
        process.exit(0);
    }
    
    // 3. Obtener la fecha de mañana en formato local de México (YYYY-MM-DD)
    const opciones = { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' };
    const hoyEnMexico = new Intl.DateTimeFormat('es-MX', opciones).format(new Date());
    
    const [dia, mes, anio] = hoyEnMexico.split('/');
    const fechaMananaObj = new Date(`${anio}-${mes}-${dia}T00:00:00`);
    fechaMananaObj.setDate(fechaMananaObj.getDate() + 1);
    
    const anioM = fechaMananaObj.getFullYear();
    const mesM = String(fechaMananaObj.getMonth() + 1).padStart(2, '0');
    const diaM = String(fechaMananaObj.getDate()).padStart(2, '0');
    const mananaISO = `${anioM}-${mesM}-${diaM}`;

    console.log(`🔍 Buscando entrevistas agendadas para el día (mañana): ${mananaISO}`);

    // 4. Leer el nodo de postulantes
    const snapshot = await db.ref("postulantes").once("value");
    const postulantes = snapshot.val() || {};

    let envios = 0;

    for (const [id, p] of Object.entries(postulantes)) {
        if (!p) continue;

        const estatus = p.estatus || "";
        const cita = p.diaEntrevista || p.fechaEntrevista || "";

        // Coincide si el estatus es 'En Entrevista' y la cita inicia con la fecha de mañana (con o sin hora)
        if (estatus === "En Entrevista" && typeof cita === "string" && cita.startsWith(mananaISO)) {
            const vacante = p.nombreVacante || p.vacante || "la vacante solicitada";
            const empresa = p.empresa || p.empresaId || "la empresa contratante";
            const hora = cita.includes(" ") ? ` a las ${cita.split(" ")[1]}` : "";

            console.log(`📢 Disparando recordatorio para: ${p.nombre} (${p.telefono})`);
            
            let mensaje = `Hola ${p.nombre}, te recordamos tu asistencia el día de mañana${hora} a tu entrevista para la vacante de ${vacante} en ${empresa}. Favor de presentarte con tu documentación completa.`;
            
            if (p.logistica_ruta_id || p.rutasTransporte) {
                mensaje += ` Tu ruta de transporte asignada es: ${p.logistica_ruta_id || p.rutasTransporte}.`;
            }

            await enviarMensajeGateway(p.telefono, mensaje);
            envios++;
        }
    }

    console.log(`✅ Tarea finalizada. Se procesaron y enviaron ${envios} recordatorios.`);
    process.exit(0);
}

// Conector para pasarela de envío (WhatsApp Gateway)
async function enviarMensajeGateway(telefono, texto) {
    console.log(`📡 Mensaje enviado simulado a +52${telefono}: "${texto}"`);
    return Promise.resolve();
}

ejecutarCentinela().catch(err => {
    console.error("❌ Error crítico en el Centinela:", err);
    process.exit(1);
});
