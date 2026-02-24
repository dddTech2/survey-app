process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret';
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASS = 'admin123';

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
    db.prepare('DELETE FROM socios').run();
  });

  it('GET / deberia cargar el formulario de login', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('<form method="POST" action="/send-otp"');
  });

  it('POST /send-otp sin email redirige a / con error', async () => {
    const res = await request(app).post('/send-otp').send({ email: '' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('/?error=');
  });

  it('POST /send-otp con email valido de socio redirige a /verify y guarda OTP', async () => {
    const email = 'test@example.com';
    db.prepare('INSERT INTO socios (email) VALUES (?)').run(email);
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

  it('GET /admin/dashboard sin login redirige a login', async () => {
    const res = await request(app).get('/admin/dashboard');
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/admin/login');
  });

  it('POST /admin/login con key valida inicia sesion y redirige', async () => {
    const res = await request(app)
      .post('/admin/login')
      .send({ username: 'admin', password: 'admin123' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/admin/dashboard');
  });
});
