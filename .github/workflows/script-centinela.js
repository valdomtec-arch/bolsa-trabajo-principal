const admin = require("firebase-admin");

// 1. Inicializar la conexión segura con tu Realtime Database
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DB_URL
});

const db = admin.database();

async function ejecutarCentinela() {
    console.log("⏰ Iniciando el Centinela de las 9:00 PM...");
    
    // Obtener la fecha de mañana en formato local de México (YYYY-MM-DD)
    const opciones = { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' };
    const hoyEnMexico = new Intl.DateTimeFormat('es-MX', opciones).format(new Date());
    
    // Formatear la fecha de mañana para que coincida con tus registros
    const [dia, mes, anio] = hoyEnMexico.split('/');
    const fechaMañanaObj = new Date(`${anio}-${mes}-${dia}`);
    fechaMañanaObj.setDate(fechaMañanaObj.getDate() + 1);
    
    const mañanaISO = fechaMañanaObj.toISOString().split('T')[0]; // Ejemplo: "2026-07-19"
    console.log(`🔍 Buscando entrevistas agendadas para el día (mañana): ${mañanaISO}`);

    // Leer el nodo de postulantes
    const snapshot = await db.ref("postulantes").once("value");
    const postulantes = snapshot.val() || {};

    let envios = 0;

    for (const [id, p] of Object.entries(postulantes)) {
        // REGLA: Estatus "En Entrevista" y que su diaEntrevista coincida con la fecha de mañana
        if (p.estatus === "En Entrevista" && p.diaEntrevista === mañanaISO) {
            console.log(`📢 Disparando recordatorio para: ${p.nombre} (${p.telefono})`);
            
            // Construcción del mensaje de texto inteligente
            let mensaje = `Hola ${p.nombre}, te recordamos tu asistencia el día de mañana a tu entrevista para la vacante de ${p.vacante} en la empresa ${p.empresa}. Favor de presentarte con tu documentación obligatoria completa.`;
            
            if (p.logistica_ruta_id) {
                mensaje += ` Tu ruta de transporte asignada es: ${p.logistica_ruta_id}.`;
            }

            // Enviar vía API Gateway de WhatsApp
            await enviarMensajeGateway(p.telefono, mensaje);
            envios++;
        }
    }

    console.log(`✅ Tarea finalizada. Se procesaron y enviaron ${envios} recordatorios.`);
    process.exit(0);
}

// Conector genérico para la pasarela de envío
async function enviarMensajeGateway(telefono, texto) {
    // Aquí se conectará tu proveedor de WhatsApp masivo (como UltraMsg, Twilio, etc.)
    console.log(`📡 Mensaje enviado simulado a +52${telefono}: "${texto}"`);
    return Promise.resolve();
}

ejecutarCentinela().catch(err => {
    console.error("❌ Error crítico en el Centinela:", err);
    process.exit(1);
});
