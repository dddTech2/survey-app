[PRD]
 PRD: Encuesta con Verificación OTP
 1. Overview
Una aplicación web de encuestas de una sola página que valida la identidad de los usuarios mediante el envío de un código OTP de 6 dígitos al correo electrónico. Garantiza que cada usuario (identificado por su email) solo pueda contestar la encuesta una sola vez. Está construido con un stack ligero de Node.js, Express, SQLite (better-sqlite3) y HTML/CSS puro para un despliegue rápido y sencillo.
 2. Goals
- Validar la identidad de los usuarios mediante correo electrónico (OTP) antes de permitirles contestar.
- Restringir estrictamente la participación a una sola respuesta por dirección de correo.
- Proporcionar una interfaz de usuario rápida, responsiva y con estilo oscuro (dark mode) sin usar frameworks de frontend pesados.
- Contar con un backend monolítico y fácil de desplegar en un VPS (usando PM2 y Nginx).
- Proveer un panel de administrador simple protegido por un parámetro en la URL para visualizar todos los resultados en tiempo real.
 3. Quality Gates
These commands must pass for every user story:
- `npm test` - Unit/Integration tests
- `npm run lint` - Code linting
For UI stories, also include:
- Verify in browser using dev-browser skill
 4. User Stories
 US-001: Configuración del Servidor y Base de Datos
**Description:** As a developer, I want to initialize the Express server and SQLite database so that the application has a foundation to store OTPs and responses.
**Acceptance Criteria:**
- [ ] Inicializar proyecto Node.js e instalar dependencias (`express`, `better-sqlite3`, `nodemailer`, `dotenv`, `express-session`).
- [ ] Configurar Express con middleware para JSON, urlencoded y manejo de sesiones (`express-session`).
- [ ] Inicializar la base de datos `survey.db` usando `better-sqlite3`.
- [ ] Crear tabla `otp_codes` (email, code, expires_at, used, created_at) y tabla `responses` (id, email UNIQUE, answer1, answer2, created_at).
- [ ] Configurar carga de variables de entorno mediante `.env` (PORT, SESSION_SECRET).
 US-002: Interfaz y Lógica de Inicio de Sesión (Login)
**Description:** As a user, I want to enter my email on the home page so that I can request access to the survey.
**Acceptance Criteria:**
- [ ] Crear la ruta GET `/` que devuelva el HTML estático con el formulario de inicio.
- [ ] El formulario debe tener un campo input de tipo email requerido y un botón de "Enviar código".
- [ ] Capturar parámetros de error en la URL (`?error=...`) y renderizarlos visualmente en la UI.
- [ ] El diseño CSS incrustado debe coincidir con el estilo oscuro definido en la guía.
 US-003: Generación y Envío de Código OTP
**Description:** As a user, I want to receive a 6-digit OTP code via email after submitting my address, so that I can verify my identity.
**Acceptance Criteria:**
- [ ] Crear la ruta POST `/send-otp` para procesar el envío del formulario inicial.
- [ ] Validar que el email ingresado no exista ya en la tabla `responses` (si existe, redirigir con error "Ya completaste la encuesta").
- [ ] Generar código numérico aleatorio de 6 dígitos de forma segura (ej. con módulo `crypto`).
- [ ] Guardar el OTP en la base de datos con una expiración de 5 minutos y marcar OTPs anteriores del mismo email como usados (`used = 1`).
- [ ] Configurar `nodemailer` con credenciales de `.env` y enviar el correo HTML al usuario.
- [ ] Guardar el email en `req.session.pendingEmail` y redirigir al usuario a `/verify`.
 US-004: Verificación de Código OTP
**Description:** As a user, I want to enter my OTP code so that I can authenticate and access the survey.
**Acceptance Criteria:**
- [ ] Crear la ruta GET `/verify` que verifique que existe `req.session.pendingEmail` (si no, redirige a `/`).
- [ ] Servir el formulario HTML para ingresar el código de 6 dígitos en `/verify`.
- [ ] Crear la ruta POST `/verify-otp` para procesar y validar el código contra la base de datos (`otp_codes`).
- [ ] El código proporcionado debe ser igual al guardado, no estar vencido y tener `used = 0`.
- [ ] Si es exitoso, actualizar `used = 1` en DB, limpiar `pendingEmail` y establecer `req.session.authenticatedEmail`, luego redirigir a `/survey`.
- [ ] En caso de error (código inválido/expirado), redirigir a `/verify` con el respectivo mensaje de error.
 US-005: Formulario de Encuesta y Guardado de Respuestas
**Description:** As a user, I want to answer the survey questions and submit them so that my feedback is recorded.
**Acceptance Criteria:**
- [ ] Crear la ruta GET `/survey` protegida (requiere `req.session.authenticatedEmail`).
- [ ] Antes de mostrar el formulario, verificar nuevamente en DB si el usuario ya respondió. Si sí, mostrar una vista de "Ya completaste la encuesta".
- [ ] Mostrar formulario HTML con 2 preguntas (1 de radio buttons para calificar experiencia y 1 textarea de respuesta libre).
- [ ] Crear ruta POST `/submit` para guardar `answer1` y `answer2` en la tabla `responses`.
- [ ] Capturar errores de inserción por email duplicado (UNIQUE constraint) y manejarlos sin que el servidor falle.
- [ ] Destruir la sesión del usuario inmediatamente después del guardado exitoso y redirigir a `/thanks`.
 US-006: Página de Agradecimiento y Panel de Administrador
**Description:** As an admin, I want to see a confirmation screen after a user submits, and have an admin view to check all survey results.
**Acceptance Criteria:**
- [ ] Crear la ruta GET `/thanks` que sirve un diseño HTML sencillo agradeciendo la participación.
- [ ] Crear ruta GET `/admin/results` que extraiga todas las filas de la tabla `responses` ordenadas de más recientes a más antiguas.
- [ ] Proteger `/admin/results` requiriendo un query parameter `key` (ej. `?key=tu-clave-secreta-admin`).
- [ ] Si la clave no coincide, devolver estado 403 No autorizado.
- [ ] Renderizar una vista de tabla HTML limpia que muestre el total de respuestas y las columnas (Email, Pregunta 1, Pregunta 2, Fecha).
 5. Functional Requirements
- FR-1: El sistema debe enviar un correo electrónico con un código numérico aleatorio de 6 dígitos cada vez que un usuario intente acceder.
- FR-2: El código OTP debe expirar automáticamente a los 5 minutos de haber sido generado.
- FR-3: Un usuario solo puede guardar un (1) registro exitoso en la tabla `responses`.
- FR-4: Cualquier intento de acceder directamente a `/survey` sin una sesión válida de email autenticado debe ser interceptado y redirigido a `/`.
 6. Non-Goals (Out of Scope)
- Autenticación compleja basada en JWT o OAuth.
- Frameworks de frontend modernos (React, Vue, etc.); todo se maneja con HTML enviado por el servidor.
- Dockerización de la aplicación; el despliegue asumido es en metal/VPS puro usando PM2.
- Recuperación de cuenta; el email y el OTP son el único método de verificación necesario.
 7. Technical Considerations
- Se usará la librería `better-sqlite3` que corre de manera síncrona en C++, ofreciendo rendimiento superior y simplificando el código al evitar Promesas/Async para la BD.
- Todo el CSS irá incrustado en el archivo del backend (o en las vistas si se separan archivos) por simplicidad de un único archivo `server.js` como dicta la guía.
- Para el envío de correos se deben proveer credenciales SMTP correctas (Gmail, Resend, etc.) a través de `.env`.
 8. Success Metrics
- 100% de éxito en la limitación de 1 respuesta por email.
- Emails de OTP enviados en menos de 3 segundos en promedio.
- Panel de administración renderiza sin problemas incluso con cientos de respuestas concurrentes guardadas en SQLite.
 9. Open Questions
- Aunque en la guía no se mencionan los tests automáticos (Jest, etc.), se han agregado `npm test` y `npm run lint` como quality gates debido a las preferencias del usuario. Esto significa que habrá que agregar configuraciones iniciales como ESLint y un test básico para que la orquestación apruebe con éxito.
[/PRD]
