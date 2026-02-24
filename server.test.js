process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret';

const request = require('supertest');
const { app, db } = require('./server');

describe('Encuesta OTP App', () => {
  afterAll(() => {
    // Cerrar la base de datos al finalizar
    db.close();
  });

  beforeEach(() => {
    // Limpiar tablas antes de cada test
    db.prepare('DELETE FROM otp_codes').run();
    db.prepare('DELETE FROM responses').run();
  });

  it('GET / deberia cargar el formulario de login', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('<form method="POST" action="/send-otp">');
  });

  it('POST /send-otp sin email redirige a / con error', async () => {
    const res = await request(app).post('/send-otp').send({ email: '' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('/?error=');
  });

  it('POST /send-otp con email valido redirige a /verify y guarda OTP', async () => {
    const email = 'test@example.com';
    const res = await request(app)
      .post('/send-otp')
      .send({ email });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/verify');

    const otpRecord = db.prepare('SELECT * FROM otp_codes WHERE email = ?').get(email);
    expect(otpRecord).toBeDefined();
    expect(otpRecord.email).toBe(email);
    expect(otpRecord.code).toMatch(/^[0-9]{6}$/);
    expect(otpRecord.used).toBe(0);
  });

  it('GET /admin/results sin key da 403', async () => {
    const res = await request(app).get('/admin/results');
    expect(res.statusCode).toBe(403);
    expect(res.text).toBe('No autorizado');
  });

  it('GET /admin/results con key valida muestra resultados', async () => {
    const res = await request(app).get('/admin/results?key=tu-clave-secreta-admin');
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('Resultados de la encuesta');
  });
});
