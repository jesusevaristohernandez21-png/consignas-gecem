# Puente WhatsApp — Consignas GECEM

Publica solo, en el grupo de WhatsApp de la mesa directiva, cada evidencia que los guardias suben en la app (las consignas marcadas "compartir al grupo").

## Qué necesitas
1. Un VPS Ubuntu 22.04/24.04 con 2 GB de RAM (Hetzner CX22, DigitalOcean 2 GB, Vultr, etc.).
2. El celular **GECEM Evidencias** con WhatsApp activo y **agregado a los grupos** de cada fraccionamiento.
3. En la app: Admin → Ajustes → *Envío automático al grupo* → Generar clave → prender **ACTIVO**. En Admin → Equipo → cada caseta → *Nombre exacto del grupo de WhatsApp*.

## Instalar (una sola vez, como root en el VPS)
```
curl -fsSL https://raw.githubusercontent.com/jesusevaristohernandez21-png/consignas-gecem/main/puente/instalar.sh -o instalar.sh
bash instalar.sh "https://script.google.com/macros/s/.../exec" "PT-XXXXXXXX"
```
Al terminar te da un link `http://IP:3000/qr?k=PT-...`: ábrelo y escanea el QR desde WhatsApp → Dispositivos vinculados.

## Ver que funciona
- `http://IP:3000/?k=PT-...` muestra estado, enviados, errores y los grupos que ve.
- En la app, Admin → Ajustes muestra "🟢 Servidor conectado" y enviados del día.
- Registro en el servidor: `journalctl -u puente-gecem -f`

## Si algo falla
- "No encuentro el grupo": el nombre en la caseta no coincide con el nombre del grupo en WhatsApp (copia el nombre exacto).
- Tras 5 intentos la evidencia queda como *fallida* y te llega un WhatsApp; el guardia la puede mandar a mano con el botón de siempre.
- Reiniciar: `systemctl restart puente-gecem`. Volver a vincular: borrar `/opt/puente-gecem/datos` y reiniciar.
