require("dotenv").config();
const express = require("express");
const session = require("express-session");
const Database = require("better-sqlite3");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

const app = express();
const dbFile = process.env.NODE_ENV === "test" ? ":memory:" : "survey.db";
const db = new Database(dbFile);

// ============================================
// BASE DE DATOS
// ============================================
db.exec(`
  CREATE TABLE IF NOT EXISTS socios (
    email TEXT PRIMARY KEY,
    name TEXT,
    created_at DATETIME DEFAULT (datetime('now', '-5 hours'))
  );

  CREATE TABLE IF NOT EXISTS otp_codes (
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now', '-5 hours'))
  );

  CREATE TABLE IF NOT EXISTS responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    answer1 TEXT NOT NULL,
    answer2 TEXT NOT NULL,
    created_at DATETIME DEFAULT (datetime('now', '-5 hours'))
  );
`);

// ============================================
// CONFIGURACIÓN EXPRESS
// ============================================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
    session({
        secret: process.env.SESSION_SECRET || "fallback-secret-for-dev",
        resave: true,
        saveUninitialized: true,
        cookie: { maxAge: 24 * 60 * 60 * 1000 }, // 24 hours para admin
    }),
);

// ============================================
// CONFIGURACIÓN EMAIL
// ============================================
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "localhost",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_PORT === "465",
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

function generateOTP() {
    return crypto.randomInt(100000, 999999).toString();
}

// ============================================
// RUTAS PÚBLICAS (SOCIOS)
// ============================================

// --- Página de login (pedir email) ---
app.get("/", (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Votaciones</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-50 min-h-screen flex items-center justify-center font-sans text-slate-800">
      <div class="bg-white border border-slate-200 rounded-xl p-8 w-full max-w-md shadow-sm">
        <h1 class="text-2xl font-bold mb-2 text-center text-indigo-600">Votaciones</h1>
        <p class="text-slate-500 text-center mb-6 text-sm">Ingresa tu correo de registrado para recibir acceso</p>
        ${req.query.error ? '<div class="bg-rose-50 border border-rose-200 text-rose-600 p-3 rounded-lg mb-4 text-sm text-center">' + decodeURIComponent(req.query.error) + "</div>" : ""}
        <form method="POST" action="/send-otp" class="space-y-4">
          <div>
            <label for="email" class="block text-sm font-medium text-slate-700 mb-1">Correo electrónico</label>
            <input type="email" id="email" name="email" placeholder="tu@correo.com" required
                   class="w-full px-4 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors">
          </div>
          <button type="submit" class="w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-sm transition-colors">
            Enviar código de acceso
          </button>
        </form>
      </div>
    </body>
    </html>
  `);
});

// --- Enviar OTP ---
app.post("/send-otp", async (req, res) => {
    const email = req.body.email?.toLowerCase().trim();

    if (!email) {
        return res.redirect(
            "/?error=" + encodeURIComponent("Ingresa un correo válido"),
        );
    }

    // 1. VALIDAR QUE SEA SOCIO
    const isSocio = db
        .prepare("SELECT email FROM socios WHERE email = ?")
        .get(email);
    if (!isSocio) {
        return res.redirect(
            "/?error=" +
                encodeURIComponent(
                    "Este correo no está registrado como socio.",
                ),
        );
    }

    // 2. Verificar si ya votó
    const existing = db
        .prepare("SELECT id FROM responses WHERE email = ?")
        .get(email);
    if (existing) {
        return res.redirect(
            "/?error=" +
                encodeURIComponent("Ya emitiste tu voto anteriormente."),
        );
    }

    // 3. Generar y guardar OTP
    const code = generateOTP();
    const expiresAt = Date.now() + 5 * 60 * 1000;

    db.prepare("UPDATE otp_codes SET used = 1 WHERE email = ?").run(email);
    db.prepare(
        "INSERT INTO otp_codes (email, code, expires_at, created_at) VALUES (?, ?, ?, datetime('now', '-5 hours'))",
    ).run(email, code, expiresAt);

    // 4. Enviar email
    if (process.env.NODE_ENV !== "test") {
        try {
            await transporter.sendMail({
                from: process.env.FROM_EMAIL || "encuesta@club.com",
                to: email,
                subject: "🔐 Tu código para votar",
                html: `
          <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 20px;">
            <h2>Tu código de acceso</h2>
            <p style="font-size: 36px; font-weight: bold; letter-spacing: 8px;
                      background: #f0f0f0; padding: 20px; text-align: center;
                      border-radius: 8px; color: #4f46e5;">${code}</p>
            <p style="color: #666;">Este código expira en 5 minutos.</p>
          </div>
        `,
            });
        } catch (err) {
            console.error("Error enviando email:", err);
            return res.redirect(
                "/?error=" +
                    encodeURIComponent(
                        "Error enviando el correo. Contacta al administrador.",
                    ),
            );
        }
    }

    req.session.pendingEmail = email;
    res.redirect("/verify");
});

// --- Página verificar OTP ---
app.get("/verify", (req, res) => {
    if (!req.session.pendingEmail) return res.redirect("/");

    res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Verificar código</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-50 min-h-screen flex items-center justify-center font-sans text-slate-800">
      <div class="bg-white border border-slate-200 rounded-xl p-8 w-full max-w-md shadow-sm text-center">
        <h1 class="text-2xl font-bold mb-2">🔐 Verificación</h1>
        <p class="text-slate-500 mb-6 text-sm">Enviamos un código a <span class="text-indigo-600 font-semibold">${req.session.pendingEmail}</span></p>
        ${req.query.error ? '<div class="bg-rose-50 border border-rose-200 text-rose-600 p-3 rounded-lg mb-4 text-sm">' + decodeURIComponent(req.query.error) + "</div>" : ""}
        <form method="POST" action="/verify-otp" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-2">Código de 6 dígitos</label>
            <input type="text" name="code" maxlength="6" pattern="[0-9]{6}" required autofocus
                   class="w-full px-4 py-3 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-2xl tracking-[0.5em] text-center font-mono">
          </div>
          <button type="submit" class="w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-sm transition-colors">
            Verificar y Votar
          </button>
        </form>
      </div>
    </body>
    </html>
  `);
});

// --- Verificar OTP ---
app.post("/verify-otp", (req, res) => {
    const email = req.session.pendingEmail;
    const code = req.body.code?.trim();

    if (!email) return res.redirect("/");

    const otp = db
        .prepare(
            "SELECT * FROM otp_codes WHERE email = ? AND code = ? AND used = 0 AND expires_at > ?",
        )
        .get(email, code, Date.now());

    if (!otp) {
        return res.redirect(
            "/verify?error=" + encodeURIComponent("Código inválido o expirado"),
        );
    }

    db.prepare("UPDATE otp_codes SET used = 1 WHERE email = ?").run(email);

    const existing = db
        .prepare("SELECT id FROM responses WHERE email = ?")
        .get(email);
    if (existing) {
        return res.redirect(
            "/?error=" + encodeURIComponent("Ya emitiste tu voto."),
        );
    }

    req.session.authenticatedEmail = email;
    req.session.pendingEmail = null;
    res.redirect("/survey");
});

// --- Página de la votación ---
app.get("/survey", (req, res) => {
    const email = req.session.authenticatedEmail;
    if (!email) return res.redirect("/");

    const existing = db
        .prepare("SELECT id FROM responses WHERE email = ?")
        .get(email);
    if (existing) {
        return res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Voto Registrado</title>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body class="bg-slate-50 min-h-screen flex items-center justify-center font-sans text-slate-800">
        <div class="bg-white border border-slate-200 rounded-xl p-8 w-full max-w-md shadow-sm text-center">
          <h1 class="text-2xl font-bold mb-2 text-indigo-600">⚠️ Voto ya registrado</h1>
          <p class="text-slate-500">Solo se permite un voto por socio.</p>
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
      <title>Emisión de Voto</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-50 min-h-screen flex items-center justify-center font-sans text-slate-800 p-4">
      <div class="bg-white border border-slate-200 rounded-xl p-8 w-full max-w-lg shadow-sm">
        <h1 class="text-2xl font-bold mb-2 text-center text-indigo-600">📋 Emisión de Voto</h1>
        <p class="text-slate-500 text-center mb-8 text-sm">Por favor, responde las siguientes preguntas. (Esta acción es definitiva)</p>
        <form method="POST" action="/submit" class="space-y-6">

          <div class="space-y-3">
            <label class="block text-base font-semibold text-slate-800">
              <span class="inline-flex items-center justify-center w-6 h-6 bg-indigo-100 text-indigo-700 rounded-full text-xs font-bold mr-2">1</span>
              Pregunta 1: Nueva Normativa
            </label>
            <div class="flex gap-4">
              <label class="flex-1 cursor-pointer">
                <input type="radio" name="answer1" value="Si" required class="peer sr-only">
                <div class="px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-center peer-checked:bg-indigo-50 peer-checked:border-indigo-500 peer-checked:text-indigo-700 hover:border-indigo-300 transition-all font-medium">Sí</div>
              </label>
              <label class="flex-1 cursor-pointer">
                <input type="radio" name="answer1" value="No" class="peer sr-only">
                <div class="px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-center peer-checked:bg-indigo-50 peer-checked:border-indigo-500 peer-checked:text-indigo-700 hover:border-indigo-300 transition-all font-medium">No</div>
              </label>
            </div>
          </div>

          <div class="space-y-3">
            <label class="block text-base font-semibold text-slate-800">
              <span class="inline-flex items-center justify-center w-6 h-6 bg-indigo-100 text-indigo-700 rounded-full text-xs font-bold mr-2">2</span>
              Pregunta 2: Presupuesto
            </label>
            <div class="flex gap-4">
              <label class="flex-1 cursor-pointer">
                <input type="radio" name="answer2" value="Si" required class="peer sr-only">
                <div class="px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-center peer-checked:bg-indigo-50 peer-checked:border-indigo-500 peer-checked:text-indigo-700 hover:border-indigo-300 transition-all font-medium">Sí</div>
              </label>
              <label class="flex-1 cursor-pointer">
                <input type="radio" name="answer2" value="No" class="peer sr-only">
                <div class="px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-center peer-checked:bg-indigo-50 peer-checked:border-indigo-500 peer-checked:text-indigo-700 hover:border-indigo-300 transition-all font-medium">No</div>
              </label>
            </div>
          </div>

          <button type="submit" class="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg shadow-sm transition-colors mt-4">
            ✅ Emitir Voto
          </button>
        </form>
      </div>
    </body>
    </html>
  `);
});

// --- Guardar respuestas ---
app.post("/submit", (req, res) => {
    const email = req.session.authenticatedEmail;
    if (!email) return res.redirect("/");

    const { answer1, answer2 } = req.body;
    if (!answer1 || !answer2) return res.redirect("/survey");

    try {
        db.prepare(
            "INSERT INTO responses (email, answer1, answer2, created_at) VALUES (?, ?, ?, datetime('now', '-5 hours'))",
        ).run(email, answer1, answer2);
    } catch (err) {
        return res.redirect("/survey");
    }

    delete req.session.authenticatedEmail; delete req.session.pendingEmail;
    res.redirect("/thanks");
});

// --- Página de gracias ---
app.get("/thanks", (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>¡Gracias!</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-50 min-h-screen flex items-center justify-center font-sans text-slate-800">
      <div class="bg-white border border-slate-200 rounded-xl p-10 w-full max-w-md shadow-sm text-center">
        <div class="text-5xl mb-4">🎉</div>
        <h1 class="text-2xl font-bold mb-2 text-emerald-600">¡Voto Registrado!</h1>
        <p class="text-slate-500">Tu respuesta ha sido guardada de forma segura.</p>
      </div>
    </body>
    </html>
  `);
});

// ============================================
// 🔒 ADMIN AUTH & DASHBOARD
// ============================================

// Middleware
const requireAdmin = (req, res, next) => {
    if (!req.session.isAdmin) return res.redirect("/admin/login");
    next();
};

app.get("/admin/login", (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Admin Login</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-50 min-h-screen flex items-center justify-center font-sans text-slate-800">
      <div class="bg-white border border-slate-200 rounded-xl p-8 w-full max-w-sm shadow-sm">
        <h1 class="text-2xl font-bold mb-6 text-center">Admin Access</h1>
        ${req.query.error ? '<div class="bg-rose-50 text-rose-600 p-2 rounded mb-4 text-sm text-center">Credenciales incorrectas</div>' : ""}
        <form method="POST" action="/admin/login" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Usuario</label>
            <input type="text" name="username" required class="w-full px-3 py-2 border rounded-lg focus:ring-indigo-500 focus:border-indigo-500">
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Contraseña</label>
            <input type="password" name="password" required class="w-full px-3 py-2 border rounded-lg focus:ring-indigo-500 focus:border-indigo-500">
          </div>
          <button type="submit" class="w-full py-2 bg-slate-800 hover:bg-slate-900 text-white font-semibold rounded-lg">Entrar</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

app.post("/admin/login", (req, res) => {
    const adminUser = process.env.ADMIN_USER || "admin";
    const adminPass = process.env.ADMIN_PASS || "admin123";

    if (req.body.username === adminUser && req.body.password === adminPass) {
        req.session.isAdmin = true;
        req.session.save(() => {
            res.redirect("/admin/dashboard");
        });
    } else {
        res.redirect("/admin/login?error=1");
    }
});

app.get("/admin/logout", (req, res) => {
    req.session.destroy();
    res.redirect("/admin/login");
});

app.get("/admin/dashboard", requireAdmin, (req, res) => {
    // Queries
    const totalSocios = db
        .prepare("SELECT COUNT(*) as count FROM socios")
        .get().count;
    const totalVotos = db
        .prepare("SELECT COUNT(*) as count FROM responses")
        .get().count;
    const participacion =
        totalSocios > 0 ? Math.round((totalVotos / totalSocios) * 100) : 0;

    const p1Si = db
        .prepare("SELECT COUNT(*) as count FROM responses WHERE answer1 = ?")
        .get("Si").count;
    const p1No = db
        .prepare("SELECT COUNT(*) as count FROM responses WHERE answer1 = ?")
        .get("No").count;
    const p2Si = db
        .prepare("SELECT COUNT(*) as count FROM responses WHERE answer2 = ?")
        .get("Si").count;
    const p2No = db
        .prepare("SELECT COUNT(*) as count FROM responses WHERE answer2 = ?")
        .get("No").count;

    const p1Total = p1Si + p1No || 1; // avoid div by 0 for percentages
    const p2Total = p2Si + p2No || 1;

    const sociosList = db
        .prepare(
            `
    SELECT s.email, s.name, CASE WHEN r.id IS NOT NULL THEN 1 ELSE 0 END as has_voted
    FROM socios s LEFT JOIN responses r ON s.email = r.email
    ORDER BY s.created_at DESC
  `,
        )
        .all();

    let rows = sociosList
        .map(
            (s) => `
    <tr class="border-b border-slate-100 last:border-0 hover:bg-slate-50">
      <td class="py-3 px-4">
        <div class="font-medium text-slate-800">${s.email}</div>
        ${s.name ? `<div class="text-xs text-slate-500">${s.name}</div>` : '<div class="text-xs text-slate-400">Sin nombre</div>'}
      </td>
            <td class="py-3 px-4 text-center">
        ${
            s.has_voted
                ? '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 border border-emerald-200"><svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>VOTÓ</span>'
                : '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">PENDIENTE</span>'
        }
      </td>
      <td class="py-3 px-4 text-right">
        <form action="/admin/socios/delete" method="POST" onsubmit="return confirm('¿Seguro que quieres eliminar al socio ' + s.email + '?')" class="inline-block">
          <input type="hidden" name="email" value="${s.email}">
          <button type="submit" class="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-md transition-colors" title="Eliminar socio">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
          </button>
        </form>
      </td>
    </tr>
  `,
        )
        .join("");

    res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Admin - Votaciones</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-50 min-h-screen font-sans text-slate-800 pb-12">

      <!-- Navbar -->
      <nav class="bg-white border-b border-slate-200 px-6 py-3 flex justify-between items-center sticky top-0 z-10 shadow-sm">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center text-white font-bold">V</div>
          <span class="font-bold text-lg text-slate-800">Votaciones</span>
        </div>
        <a href="/admin/logout" class="text-sm text-slate-500 hover:text-slate-800 flex items-center gap-1 transition-colors">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
          Salir
        </a>
      </nav>

      <div class="max-w-6xl mx-auto px-6 mt-8">

        <!-- Metrics -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div class="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <div class="flex items-center gap-2 text-slate-500 mb-2">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
              <span class="text-sm font-medium">Total Socios</span>
            </div>
            <div class="text-3xl font-bold text-slate-800">${totalSocios}</div>
          </div>
          <div class="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <div class="flex items-center gap-2 text-slate-500 mb-2">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
              <span class="text-sm font-medium">Votos Emitidos</span>
            </div>
            <div class="text-3xl font-bold text-slate-800">${totalVotos}</div>
          </div>
          <div class="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <div class="flex items-center gap-2 text-slate-500 mb-2">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
              <span class="text-sm font-medium">Participación</span>
            </div>
            <div class="text-3xl font-bold text-slate-800">${participacion}%</div>
          </div>
        </div>

        <!-- Realtime Results -->
        <div class="bg-white rounded-xl border border-slate-200 p-6 shadow-sm mb-8 relative">
          <div class="flex justify-between items-center mb-6">
            <h2 class="text-lg font-bold text-slate-800">Resultados en Tiempo Real</h2>
            <div class="flex gap-3">
              <button onclick="window.location.reload()" class="p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition" title="Actualizar">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
              </button>
              <a href="/admin/export.csv" class="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-lg transition">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                Exportar CSV
              </a>
              <form action="/admin/clear-votes" method="POST" onsubmit="return confirm('¿Seguro que quieres borrar todos los votos emitidos? Esto no borrará a los socios, pero vaciará la tabla de respuestas.')" class="inline">
                <button type="submit" class="flex items-center gap-2 px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 text-sm font-semibold rounded-lg transition">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                  Reset
                </button>
              </form>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-10">
            <!-- P1 -->
            <div>
              <h3 class="text-sm font-medium text-slate-600 mb-4">Pregunta 1: Nueva Normativa</h3>
              <div class="space-y-4">
                <div>
                  <div class="flex justify-between text-sm mb-1 font-semibold">
                    <span>SÍ</span>
                    <span>${p1Si}</span>
                  </div>
                  <div class="w-full bg-slate-100 rounded-full h-2.5">
                    <div class="bg-emerald-500 h-2.5 rounded-full" style="width: ${(p1Si / p1Total) * 100}%"></div>
                  </div>
                </div>
                <div>
                  <div class="flex justify-between text-sm mb-1 font-semibold">
                    <span>NO</span>
                    <span>${p1No}</span>
                  </div>
                  <div class="w-full bg-slate-100 rounded-full h-2.5">
                    <div class="bg-rose-500 h-2.5 rounded-full" style="width: ${(p1No / p1Total) * 100}%"></div>
                  </div>
                </div>
              </div>
            </div>

            <!-- P2 -->
            <div>
              <h3 class="text-sm font-medium text-slate-600 mb-4">Pregunta 2: Presupuesto</h3>
              <div class="space-y-4">
                <div>
                  <div class="flex justify-between text-sm mb-1 font-semibold">
                    <span>SÍ</span>
                    <span>${p2Si}</span>
                  </div>
                  <div class="w-full bg-slate-100 rounded-full h-2.5">
                    <div class="bg-emerald-500 h-2.5 rounded-full" style="width: ${(p2Si / p2Total) * 100}%"></div>
                  </div>
                </div>
                <div>
                  <div class="flex justify-between text-sm mb-1 font-semibold">
                    <span>NO</span>
                    <span>${p2No}</span>
                  </div>
                  <div class="w-full bg-slate-100 rounded-full h-2.5">
                    <div class="bg-rose-500 h-2.5 rounded-full" style="width: ${(p2No / p2Total) * 100}%"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Bottom Row: Load Socios & List -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">

          <!-- Cargar Socios Form -->
          <div class="bg-white rounded-xl border border-slate-200 p-6 shadow-sm h-fit">
            <h2 class="text-lg font-bold text-slate-800 flex items-center gap-2 mb-2">
              <svg class="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
              Cargar Socios
            </h2>
            <p class="text-xs text-slate-500 mb-4">Ingresa un socio por línea: Nombre, Correo (opcional la coma, puedes poner solo el correo)</p>
            <form action="/admin/socios" method="POST">
              <textarea name="socios_data" rows="8" required placeholder="Juan Perez, juan@email.com&#10;maria@email.com" class="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm mb-4 focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none"></textarea>
              <button type="submit" class="w-full py-2 bg-indigo-400 hover:bg-indigo-500 text-white font-semibold rounded-lg transition-colors shadow-sm">
                Cargar Registros
              </button>
            </form>
          </div>

          <!-- Listado de Socios -->
          <div class="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-full min-h-[400px]">
            <div class="p-6 border-b border-slate-200 flex justify-between items-center bg-white">
              <h2 class="text-lg font-bold text-slate-800">Listado de Socios</h2>
              <span class="px-3 py-1 bg-slate-100 text-slate-600 text-xs font-semibold rounded-md">${sociosList.length} registros</span>
            </div>

            <div class="flex-1 overflow-auto bg-white max-h-[400px]">
              <table class="w-full text-left text-sm">
                <thead class="bg-slate-50 text-slate-500 text-xs uppercase sticky top-0">
                  <tr>
                    <th class="py-3 px-4 font-semibold">Socio</th>
                    <th class="py-3 px-4 font-semibold text-center">Estado</th>
                    <th class="py-3 px-4 font-semibold text-right">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows || '<tr><td colspan="3" class="py-8 text-center text-slate-500">No hay socios cargados aún</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>

        </div>

      </div>
    </body>
    </html>
  `);
});

// Procesa el text area de carga masiva
app.post("/admin/socios", requireAdmin, (req, res) => {
    const data = req.body.socios_data || "";
    const lines = data.split("\n");
    const insert = db.prepare(
        "INSERT OR IGNORE INTO socios (email, name, created_at) VALUES (?, ?, datetime('now', '-5 hours'))",
    );

    db.transaction(() => {
        for (let line of lines) {
            line = line.trim();
            if (!line) continue;

            let name = "";
            let email = "";

            if (line.includes(",")) {
                const parts = line.split(",");
                name = parts[0].trim();
                email = parts[1].trim().toLowerCase();
            } else {
                email = line.trim().toLowerCase();
            }

            if (email && email.includes("@")) {
                insert.run(email, name);
            }
        }
    })();

    res.redirect("/admin/dashboard");
});


app.post("/admin/socios/delete", requireAdmin, (req, res) => {
    const email = req.body.email;
    if (email) {
        db.prepare("DELETE FROM socios WHERE email = ?").run(email);
    }
    res.redirect("/admin/dashboard");
});

app.post("/admin/clear-votes", requireAdmin, (req, res) => {
    db.prepare("DELETE FROM responses").run();
    db.prepare("UPDATE otp_codes SET used = 1").run();
    res.redirect("/admin/dashboard");
});

app.get("/admin/export.csv", requireAdmin, (req, res) => {
    const responses = db
        .prepare(
            "SELECT email, answer1, answer2, created_at FROM responses ORDER BY created_at DESC",
        )
        .all();

    let csv = "Email,Pregunta 1 (Normativa),Pregunta 2 (Presupuesto),Fecha\n";
    responses.forEach((r) => {
        csv += `${r.email},${r.answer1},${r.answer2},${r.created_at}\n`;
    });

    res.header("Content-Type", "text/csv");
    res.attachment("resultados_votacion.csv");
    return res.send(csv);
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
