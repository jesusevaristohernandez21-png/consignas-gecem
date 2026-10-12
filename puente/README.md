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

## v1.5 — también Operación GECEM
El mismo puente (mismo número, mismo servidor) manda y recibe los WhatsApp del **agente de Operación GECEM**.
1. En la app Operación: Cuenta → **Agente** → *Generar clave nueva* (empieza con `OP-`).
2. En el puente: `http://IP:3000/operacion?k=PT-...` → pegar la URL de la app y esa clave → Guardar. Debe decir "🟢 La app responde".
3. Actualizar el puente a v1.5 con `http://IP:3000/actualizar?k=PT-...` (o `bash /opt/puente-gecem/actualizar.sh`).
Qué hace: cada 30 s manda lo que la app tenga pendiente (a personas o al grupo del equipo), cada minuto le da "tick" al reloj del agente,
y cada mensaje que llegue en **chat privado** (no del grupo) se lo pasa a la app. Cada 10 min manda la lista de participantes del grupo
para que Jesús ligue número ↔ usuario sin capturarlos.
