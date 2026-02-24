import os
import smtplib
from email.message import EmailMessage

from dotenv import load_dotenv


def test_smtp():
    load_dotenv()

    host = os.getenv("SMTP_HOST", "mail.nyoholding.com")
    port = int(os.getenv("SMTP_PORT", 465))
    user = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASS")
    sender = os.getenv("FROM_EMAIL")

    print(f"Probando conexión a {host}:{port}")
    print(f"Usuario: {user}")

    msg = EmailMessage()
    msg.set_content("Prueba de conexión SMTP exitosa en Python.")
    msg["Subject"] = "Prueba SMTP Python"
    msg["From"] = sender
    msg["To"] = sender

    try:
        # Usar SMTP_SSL para el puerto 465, o SMTP con starttls para 587
        if port == 465:
            print("Usando SSL (Puerto 465)")
            server = smtplib.SMTP_SSL(host, port)
        else:
            print("Usando STARTTLS (Puerto 587)")
            server = smtplib.SMTP(host, port)
            server.set_debuglevel(1)  # Mostrar todos los logs
            server.ehlo()
            server.starttls()
            server.ehlo()

        print("\n--- Intentando Login ---")
        server.login(user, password)
        print("✅ Login Exitoso!")

        server.send_message(msg)
        print("✅ Mensaje Enviado!")

        server.quit()

    except smtplib.SMTPAuthenticationError as e:
        print("\n❌ Error de Autenticación (Usuario o Contraseña incorrectos)")
        print(f"Detalle: {e.smtp_code} - {e.smtp_error.decode()}")
    except Exception as e:
        print("\n❌ Error de conexión general:")
        print(str(e))


if __name__ == "__main__":
    test_smtp()
