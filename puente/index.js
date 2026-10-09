// ============================================================
//  PUENTE WHATSAPP — Consignas GECEM
//  Corre en un servidor (VPS). Usa el celular "GECEM Evidencias" (WhatsApp Web).
//  Cada 30 s pregunta a la app qué evidencias faltan por publicar, manda la(s) foto(s)
//  con el texto al grupo de la mesa directiva y le avisa a la app que ya quedó.
//  Config por variables de entorno (archivo /etc/puente-gecem.env):
//    EXEC_URL   = URL /exec de Apps Script
//    PUENTE_KEY = clave que aparece en Admin → Ajustes → Envío automático
//    PORT       = puerto de la página del QR (default 3000)
// ============================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const QRCode = require('qrcode');

const EXEC_URL = process.env.EXEC_URL || '';
const PUENTE_KEY = process.env.PUENTE_KEY || '';
const PORT = parseInt(process.env.PORT || '3000', 10);
const CADA_MS = parseInt(process.env.CADA_SEG || '30', 10) * 1000;
const DATOS = process.env.DATOS || path.join(__dirname, 'datos');
if (!EXEC_URL || !PUENTE_KEY) { console.error('Faltan EXEC_URL o PUENTE_KEY en el entorno.'); process.exit(1); }

const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), ...a);
let estado = { listo: false, qr: null, ultimoCiclo: null, enviados: 0, errores: 0, ultimoError: '', grupos: [] };

// ---------- API de la app (Apps Script) ----------
async function api(accion, params) {
  const r = await fetch(EXEC_URL, { method: 'POST', body: JSON.stringify({ accion, params: Object.assign({ k: PUENTE_KEY }, params || {}) }), redirect: 'follow' });
  const txt = await r.text();
  let j; try { j = JSON.parse(txt); } catch (e) { throw new Error('Respuesta no válida de la app: ' + txt.slice(0, 120)); }
  if (!j.ok) throw new Error(j.error || 'Error de la app');
  return j;
}

// ---------- WhatsApp ----------
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: DATOS }),
  puppeteer: { headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', '--no-zygote', '--single-process'] }
});
client.on('qr', qr => { estado.qr = qr; estado.listo = false; log('QR nuevo: abre http://<ip>:' + PORT + '/qr?k=... y escanéalo con el celular GECEM Evidencias'); });
client.on('ready', async () => { estado.listo = true; estado.qr = null; log('WhatsApp conectado.'); await cargarGrupos(); });
client.on('authenticated', () => log('Sesión autenticada.'));
client.on('auth_failure', m => { estado.listo = false; log('FALLO de autenticación:', m); });
client.on('disconnected', r => { estado.listo = false; log('Desconectado:', r, '— reintentando en 20 s'); setTimeout(() => client.initialize().catch(e => log('init:', e.message)), 20000); });

let grupos = new Map();
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
async function cargarGrupos() {
  try {
    const chats = await client.getChats();
    grupos = new Map(); chats.filter(c => c.isGroup).forEach(c => grupos.set(norm(c.name), c.id._serialized));
    estado.grupos = [...grupos.keys()];
    log('Grupos disponibles:', estado.grupos.join(' | '));
  } catch (e) { log('No pude leer los grupos:', e.message); }
}
async function idGrupo(nombre) {
  let id = grupos.get(norm(nombre));
  if (!id) { await cargarGrupos(); id = grupos.get(norm(nombre)); }
  if (!id) throw new Error('No encuentro el grupo "' + nombre + '" en este WhatsApp. Grupos: ' + estado.grupos.join(', '));
  return id;
}

// ---------- ciclo ----------
let ocupado = false;
async function ciclo() {
  if (ocupado) return; ocupado = true;
  try {
    const r = await api('puente_pendientes', {});
    estado.ultimoCiclo = new Date().toISOString();
    if (!estado.listo) { if (r.pendientes.length) log(r.pendientes.length + ' pendiente(s), pero WhatsApp no está conectado.'); return; }
    for (const p of r.pendientes) {
      try {
        const gid = await idGrupo(p.grupo);
        const fotos = (p.fotos || []).filter(f => f.b64);
        if (!fotos.length) { await client.sendMessage(gid, p.texto); }
        else {
          for (let i = 0; i < fotos.length; i++) {
            const media = new MessageMedia(fotos[i].tipo || 'image/jpeg', fotos[i].b64, fotos[i].nombre || 'evidencia.jpg');
            await client.sendMessage(gid, media, i === 0 ? { caption: p.texto } : {});
            if (i < fotos.length - 1) await new Promise(res => setTimeout(res, 1500));
          }
        }
        await api('puente_marcar', { id: p.id, ok: true });
        estado.enviados++; log('Enviado al grupo "' + p.grupo + '":', p.evidencia_id);
        await new Promise(res => setTimeout(res, 3000)); // pausa entre envíos: no parecer spam
      } catch (e) {
        estado.errores++; estado.ultimoError = e.message; log('ERROR enviando', p.evidencia_id, ':', e.message);
        try { await api('puente_marcar', { id: p.id, ok: false, error: e.message }); } catch (e2) { log('No pude marcar el error:', e2.message); }
      }
    }
  } catch (e) { estado.ultimoError = e.message; log('Ciclo:', e.message); }
  finally { ocupado = false; }
}

// ---------- página del QR / estado ----------
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.searchParams.get('k') !== PUENTE_KEY) { res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Falta la clave (?k=...)'); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  let cuerpo;
  if (u.pathname === '/qr' && estado.qr) {
    const img = await QRCode.toDataURL(estado.qr, { width: 320 });
    cuerpo = '<h2>Escanea con el celular GECEM Evidencias</h2><p>WhatsApp → ⋮ → Dispositivos vinculados → Vincular un dispositivo</p><img src="' + img + '"><p>La página se actualiza sola cada 20 s.</p><meta http-equiv="refresh" content="20">';
  } else {
    cuerpo = '<h2>Puente WhatsApp — Consignas GECEM</h2><p>Estado: <b>' + (estado.listo ? '🟢 conectado' : estado.qr ? '🟡 esperando QR (abre /qr)' : '🔴 iniciando…') + '</b></p>' +
      '<p>Último ciclo: ' + (estado.ultimoCiclo || '—') + '<br>Enviados desde que arrancó: ' + estado.enviados + ' · errores: ' + estado.errores + '</p>' +
      (estado.ultimoError ? '<p style="color:#b00">Último error: ' + estado.ultimoError + '</p>' : '') +
      '<p>Grupos que ve este WhatsApp:<br>' + (estado.grupos.map(g => '• ' + g).join('<br>') || '(aún no)') + '</p><meta http-equiv="refresh" content="30">';
  }
  res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font-family:sans-serif;max-width:480px;margin:20px auto;padding:0 12px">' + cuerpo + '</body>');
}).listen(PORT, () => log('Página de estado/QR en el puerto ' + PORT));

client.initialize().catch(e => log('init:', e.message));
setInterval(ciclo, CADA_MS);
setTimeout(ciclo, 10000);
