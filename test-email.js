require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  // Opcional: ignorar certificados auto-firmados si es tu propio servidor
  tls: {
    rejectUnauthorized: false
  },
  logger: true,
  debug: true // Muestra la conversación SMTP completa
});

async function main() {
  console.log("Intentando conectar al SMTP...");
  console.log("Host:", process.env.SMTP_HOST);
  console.log("Puerto:", process.env.SMTP_PORT);
  console.log("Usuario:", process.env.SMTP_USER);
  
  try {
    let info = await transporter.sendMail({
      from: process.env.FROM_EMAIL,
      to: process.env.FROM_EMAIL, // enviarse a sí mismo para prueba
      subject: "Test de conexión SMTP",
      text: "Si ves esto, la configuración funciona.",
    });
    console.log("¡ÉXITO! Mensaje enviado: %s", info.messageId);
  } catch (error) {
    console.error("ERROR DE CONEXIÓN:");
    console.error(error);
  }
}

main();