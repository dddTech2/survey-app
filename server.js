require('dotenv').config();
const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
// const path = require('path');

const app = express();

const dbFile = process.env.NODE_ENV === 'test' ? ':memory:' : 'survey.db';
const db = new Database(dbFile);

// ============================================
// BASE DE DATOS
// ============================================
db.exec(`
  CREATE TABLE IF NOT EXISTS otp_codes (
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    answer1 TEXT NOT NULL,
    answer2 TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ============================================
// CONFIGURACIÓN EXPRESS
// ============================================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret-for-dev',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 15 * 60 * 1000 } // 15 min
}));

// ============================================
// CONFIGURACIÓN EMAIL
// ============================================
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'localhost',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_PORT === '465',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

function generateOTP() {
  return crypto.randomInt(100000, 999999).toString();
}

// ============================================
// RUTAS
// ============================================

// --- Página de login (pedir email) ---
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Encuesta</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background: #0f172a;
          color: #e2e8f0;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .card {
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 16px;
          padding: 40px;
          width: 100%;
          max-width: 420px;
          box-shadow: 0 25px 50px rgba(0,0,0,0.5);
        }
        h1 { font-size: 24px; margin-bottom: 8px; text-align: center; }
        .subtitle { color: #94a3b8; text-align: center; margin-bottom: 32px; font-size: 14px; }
        label { display: block; font-size: 14px; font-weight: 500; margin-bottom: 6px; color: #cbd5e1; }
        input[type="email"], input[type="text"] {
          width: 100%;
          padding: 12px 16px;
          background: #0f172a;
          border: 1px solid #475569;
          border-radius: 8px;
          color: #e2e8f0;
          font-size: 16px;
          outline: none;
          transition: border-color 0.2s;
        }
        input:focus { border-color: #3b82f6; }
        button {
          width: 100%;
          padding: 12px;
          background: #3b82f6;
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          margin-top: 20px;
          transition: background 0.2s;
        }
        button:hover { background: #2563eb; }
        button:disabled { background: #475569; cursor: not-allowed; }
        .error { background: #7f1d1d; border: 1px solid #991b1b; padding: 12px; border-radius: 8px; margin-bottom: 16px; font-size: 14px; text-align: center; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>📋 Encuesta</h1>
        <p class="subtitle">Ingresa tu correo para recibir un código de acceso</p>
        ${req.query.error ? '<div class="error">' + decodeURIComponent(req.query.error) + '</div>' : ''}
        <form method="POST" action="/send-otp">
          <label for="email">Correo electrónico</label>
          <input type="email" id="email" name="email" placeholder="tu@correo.com" required>
          <button type="submit">Enviar código</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

// --- Enviar OTP ---
app.post('/send-otp', async (req, res) => {
  const email = req.body.email?.toLowerCase().trim();

  if (!email) {
    return res.redirect('/?error=' + encodeURIComponent('Ingresa un correo válido'));
  }

  // Verificar si ya contestó
  const existing = db.prepare('SELECT id FROM responses WHERE email = ?').get(email);
  if (existing) {
    return res.redirect('/?error=' + encodeURIComponent('Ya completaste la encuesta anteriormente'));
  }

  // Generar y guardar OTP
  const code = generateOTP();
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutos

  // Invalidar OTPs anteriores
  db.prepare('UPDATE otp_codes SET used = 1 WHERE email = ?').run(email);
  db.prepare('INSERT INTO otp_codes (email, code, expires_at) VALUES (?, ?, ?)').run(email, code, expiresAt);

  // Enviar email, salvo en entorno test donde lo mockeamos para evitar fallos reales
  if (process.env.NODE_ENV !== 'test') {
    try {
      await transporter.sendMail({
        from: process.env.FROM_EMAIL || 'survey@example.com',
        to: email,
        subject: '🔐 Tu código de acceso a la encuesta',
        html: `
          <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 20px;">
            <h2>Tu código de acceso</h2>
            <p style="font-size: 36px; font-weight: bold; letter-spacing: 8px; 
                      background: #f0f0f0; padding: 20px; text-align: center; 
                      border-radius: 8px;">${code}</p>
            <p style="color: #666;">Este código expira en 5 minutos.</p>
          </div>
        `,
      });
    } catch (err) {
      console.error('Error enviando email:', err);
      return res.redirect('/?error=' + encodeURIComponent('Error enviando el correo. Intenta de nuevo.'));
    }
  }

  req.session.pendingEmail = email;
  res.redirect('/verify');
});

// --- Página verificar OTP ---
app.get('/verify', (req, res) => {
  if (!req.session.pendingEmail) return res.redirect('/');

  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Verificar código</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background: #0f172a; color: #e2e8f0;
          min-height: 100vh; display: flex; align-items: center; justify-content: center;
        }
        .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 40px; width: 100%; max-width: 420px; }
        h1 { font-size: 24px; margin-bottom: 8px; text-align: center; }
        .subtitle { color: #94a3b8; text-align: center; margin-bottom: 32px; font-size: 14px; }
        .email-badge { color: #3b82f6; font-weight: 600; }
        label { display: block; font-size: 14px; font-weight: 500; margin-bottom: 6px; color: #cbd5e1; }
        input[type="text"] {
          width: 100%; padding: 16px; background: #0f172a; border: 1px solid #475569;
          border-radius: 8px; color: #e2e8f0; font-size: 24px; text-align: center;
          letter-spacing: 12px; outline: none;
        }
        input:focus { border-color: #3b82f6; }
        button { width: 100%; padding: 12px; background: #3b82f6; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; margin-top: 20px; }
        button:hover { background: #2563eb; }
        .error { background: #7f1d1d; border: 1px solid #991b1b; padding: 12px; border-radius: 8px; margin-bottom: 16px; font-size: 14px; text-align: center; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>🔐 Verificación</h1>
        <p class="subtitle">Enviamos un código a <span class="email-badge">${req.session.pendingEmail}</span></p>
        ${req.query.error ? '<div class="error">' + decodeURIComponent(req.query.error) + '</div>' : ''}
        <form method="POST" action="/verify-otp">
          <label>Código de 6 dígitos</label>
          <input type="text" name="code" maxlength="6" pattern="[0-9]{6}" required autofocus>
          <button type="submit">Verificar</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

// --- Verificar OTP ---
app.post('/verify-otp', (req, res) => {
  const email = req.session.pendingEmail;
  const code = req.body.code?.trim();

  if (!email) return res.redirect('/');

  const otp = db.prepare(
    'SELECT * FROM otp_codes WHERE email = ? AND code = ? AND used = 0 AND expires_at > ?'
  ).get(email, code, Date.now());

  if (!otp) {
    return res.redirect('/verify?error=' + encodeURIComponent('Código inválido o expirado'));
  }

  // Marcar OTP como usado
  db.prepare('UPDATE otp_codes SET used = 1 WHERE email = ?').run(email);

  // Verificar de nuevo si ya contestó (doble check)
  const existing = db.prepare('SELECT id FROM responses WHERE email = ?').get(email);
  if (existing) {
    return res.redirect('/?error=' + encodeURIComponent('Ya completaste la encuesta'));
  }

  // Autenticar
  req.session.authenticatedEmail = email;
  req.session.pendingEmail = null;
  res.redirect('/survey');
});

// --- Página de la encuesta ---
app.get('/survey', (req, res) => {
  const email = req.session.authenticatedEmail;
  if (!email) return res.redirect('/');

  // Verificar si ya contestó
  const existing = db.prepare('SELECT id FROM responses WHERE email = ?').get(email);
  if (existing) {
    return res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Ya completada</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
          .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 40px; max-width: 420px; text-align: center; }
          h1 { margin-bottom: 12px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>⚠️ Ya respondiste</h1>
          <p style="color: #94a3b8;">Esta encuesta solo se puede completar una vez.</p>
        </div>
      </body>
      </html>
    `);
  }

  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Encuesta</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
        .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 40px; width: 100%; max-width: 520px; }
        h1 { font-size: 24px; margin-bottom: 8px; text-align: center; }
        .subtitle { color: #94a3b8; text-align: center; margin-bottom: 32px; font-size: 14px; }
        .question { margin-bottom: 28px; }
        .question label { display: block; font-size: 16px; font-weight: 600; margin-bottom: 12px; color: #f1f5f9; }
        textarea {
          width: 100%; padding: 12px 16px; background: #0f172a; border: 1px solid #475569;
          border-radius: 8px; color: #e2e8f0; font-size: 15px; resize: vertical;
          min-height: 80px; outline: none; font-family: inherit;
        }
        textarea:focus { border-color: #3b82f6; }
        .radio-group { display: flex; flex-direction: column; gap: 10px; }
        .radio-option {
          display: flex; align-items: center; gap: 10px;
          padding: 12px 16px; background: #0f172a; border: 1px solid #475569;
          border-radius: 8px; cursor: pointer; transition: border-color 0.2s;
        }
        .radio-option:hover { border-color: #3b82f6; }
        .radio-option input[type="radio"] { accent-color: #3b82f6; }
        button { width: 100%; padding: 14px; background: #10b981; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; margin-top: 12px; }
        button:hover { background: #059669; }
        .num { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: #3b82f6; border-radius: 50%; font-size: 14px; font-weight: 700; margin-right: 8px; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>📋 Encuesta</h1>
        <p class="subtitle">Responde las siguientes preguntas (solo puedes hacerlo una vez)</p>
        <form method="POST" action="/submit">

          <div class="question">
            <label><span class="num">1</span> ¿Cómo calificarías tu experiencia general?</label>
            <div class="radio-group">
              <label class="radio-option">
                <input type="radio" name="answer1" value="Excelente" required> Excelente
              </label>
              <label class="radio-option">
                <input type="radio" name="answer1" value="Buena"> Buena
              </label>
              <label class="radio-option">
                <input type="radio" name="answer1" value="Regular"> Regular
              </label>
              <label class="radio-option">
                <input type="radio" name="answer1" value="Mala"> Mala
              </label>
            </div>
          </div>

          <div class="question">
            <label><span class="num">2</span> ¿Qué mejorarías?</label>
            <textarea name="answer2" placeholder="Escribe tu respuesta aquí..." required></textarea>
          </div>

          <button type="submit">✅ Enviar respuestas</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

// --- Guardar respuestas ---
app.post('/submit', (req, res) => {
  const email = req.session.authenticatedEmail;
  if (!email) return res.redirect('/');

  const { answer1, answer2 } = req.body;

  if (!answer1 || !answer2) {
    return res.redirect('/survey');
  }

  try {
    db.prepare('INSERT INTO responses (email, answer1, answer2) VALUES (?, ?, ?)').run(email, answer1, answer2);
  } catch (err) {
    // UNIQUE constraint = ya respondió
    return res.redirect('/survey');
  }

  req.session.destroy();
  res.redirect('/thanks');
});

// --- Página de gracias ---
app.get('/thanks', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>¡Gracias!</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
        .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 50px 40px; max-width: 420px; text-align: center; }
        .icon { font-size: 64px; margin-bottom: 16px; }
        h1 { margin-bottom: 12px; color: #10b981; }
        p { color: #94a3b8; line-height: 1.6; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="icon">🎉</div>
        <h1>¡Gracias!</h1>
        <p>Tu respuesta ha sido registrada exitosamente.</p>
      </div>
    </body>
    </html>
  `);
});

// ============================================
// 🔒 RUTA ADMIN - VER RESULTADOS
// ============================================
app.get('/admin/results', (req, res) => {
  // Proteger con query param simple (cámbialo)
  if (req.query.key !== 'tu-clave-secreta-admin') {
    return res.status(403).send('No autorizado');
  }

  const results = db.prepare('SELECT * FROM responses ORDER BY created_at DESC').all();

  let rows = results.map(r => `
    <tr>
      <td>${r.email}</td>
      <td>${r.answer1}</td>
      <td>${r.answer2}</td>
      <td>${r.created_at}</td>
    </tr>
  `).join('');

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Resultados</title>
      <style>
        body { font-family: sans-serif; background: #0f172a; color: #e2e8f0; padding: 40px; }
        h1 { margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #334155; }
        th { background: #1e293b; color: #3b82f6; }
        tr:hover { background: #1e293b; }
        .count { color: #10b981; font-size: 18px; margin-bottom: 20px; }
      </style>
    </head>
    <body>
      <h1>📊 Resultados de la encuesta</h1>
      <p class="count">Total respuestas: ${results.length}</p>
      <table>
        <thead><tr><th>Email</th><th>Pregunta 1</th><th>Pregunta 2</th><th>Fecha</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4">Sin respuestas aún</td></tr>'}</tbody>
      </table>
    </body>
    </html>
  `);
});

// ============================================
// INICIAR SERVIDOR O EXPORTAR
// ============================================
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  });
} else {
  module.exports = { app, db };
}
