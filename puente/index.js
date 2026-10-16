// ============================================================
//  PUENTE WHATSAPP — Consignas GECEM + Operación GECEM (v1.8: + cotizaciones)
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

// ---------- v1.5: Operación GECEM (segunda fuente) ----------
// Config en datos/operacion.json: { url: "https://operacion-gecem.vercel.app", clave: "OP-..." }. Se llena en /operacion?k=...
const OP_FILE = path.join(DATOS, 'operacion.json');
let OP = { url: '', clave: '' };
try { OP = Object.assign(OP, JSON.parse(fs.readFileSync(OP_FILE, 'utf8'))); } catch (e) { /* sin configurar */ }
const opActivo = () => !!(OP.url && OP.clave);
let opEstado = { ultimoCiclo: null, enviados: 0, recibidos: 0, errores: 0, ultimoError: '', ultimoTick: null };
async function opApi(accion, params) {
  const r = await fetch(OP.url.replace(/\/$/, '') + '/api/puente', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(Object.assign({ k: OP.clave, accion }, params || {})) });
  const txt = await r.text();
  let j; try { j = JSON.parse(txt); } catch (e) { throw new Error('Operación: respuesta no válida: ' + txt.slice(0, 120)); }
  if (!j.ok) throw new Error(j.error || 'Error de Operación');
  return j;
}

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
  puppeteer: { headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', '--disable-crash-reporter', '--disable-extensions'] }
});
client.on('qr', qr => { estado.qr = qr; estado.listo = false; log('QR nuevo: abre http://<ip>:' + PORT + '/qr?k=... y escanéalo con el celular GECEM Evidencias'); });
client.on('ready', async () => { estado.listo = true; estado.qr = null; log('WhatsApp conectado.'); await cargarGrupos(); });
client.on('authenticated', () => log('Sesión autenticada.'));
client.on('auth_failure', m => { estado.listo = false; log('FALLO de autenticación:', m); });
// v1.5: mensajes recibidos en chats privados → Operación (el grupo no se lee)
client.on('message', async msg => {
  try {
    if (!opActivo() || msg.fromMe) return;
    const from = String(msg.from || '');
    if (from.endsWith('@g.us') || from === 'status@broadcast') return;
    let num = from.replace(/@.*$/, ''), nombre = '', lid = '';
    if (from.endsWith('@lid')) lid = num;
    try { const c = await msg.getContact(); if (c) { if (c.number) num = c.number; nombre = c.pushname || c.name || c.shortName || ''; } } catch (e) { /* sin contacto */ }
    // v1.7: WhatsApp a veces manda un id "lid" en vez del número; se intenta traducirlo
    if (lid && num === lid) { const tel = await telDeLid(lid); if (tel) num = tel; }
    if (!/^\d{10,15}$/.test(num)) { log('Mensaje sin número reconocible:', from); }
    const tipo = msg.type === 'chat' ? 'chat' : (msg.type === 'ptt' || msg.type === 'audio') ? 'audio' : msg.type === 'image' ? 'imagen' : 'otro';
    const texto = msg.body || (tipo === 'imagen' ? '(foto)' : tipo === 'audio' ? '(audio)' : '(' + msg.type + ')');
    const extra = {};
    if (tipo === 'audio') {
      // v1.6: la nota de voz se manda a la app (base64) para que la transcriba
      const m = await bajarMedia(msg, 'audio');
      if (m && m.data.length < 4 * 1024 * 1024) { extra.audio_b64 = m.data; extra.mime = m.mime || 'audio/ogg'; }
    } else if (tipo === 'imagen') {
      // v1.10: la foto (pantallazo de Syscom, cita, etc.) se manda a la app para que el agente la lea
      const m = await bajarMedia(msg, 'imagen');
      if (m && m.data.length < 4300000) { extra.imagen_b64 = m.data; extra.mime = m.mime || 'image/jpeg'; }
      else if (m) log('Imagen demasiado grande para mandarla:', m.data.length);
    }
    await opApi('entrada', Object.assign({ msg_id: (msg.id && (msg.id._serialized || msg.id.$1)) || null, wa: num, lid: lid && lid !== num ? lid : '', nombre, tipo, texto }, extra));
    opEstado.recibidos++; log('Operación <- ' + (nombre || num) + ': ' + texto.slice(0, 60));
    setTimeout(opCiclo, 300);   // v1.8: manda la respuesta (y genera cotizaciones) sin esperar al siguiente ciclo
  } catch (e) { opEstado.errores++; opEstado.ultimoError = 'entrada: ' + e.message; log('entrada:', e.message); }
});
// v1.10: baja la foto/audio de un mensaje. Primero con la librería; si falla (WhatsApp Web cambió los ids a `$1`
// y la librería truena con "t"), lo intenta directo en la página: blob ya resuelto → URL renderizable → descifrado.
async function bajarMedia(msg, que) {
  try { const m = await msg.downloadMedia(); if (m && m.data) return { data: m.data, mime: m.mimetype }; log('downloadMedia sin datos (' + que + ')'); }
  catch (e) { log('downloadMedia falló (' + que + '):', String((e && (e.stack || e.message)) || e).slice(0, 300)); }
  const id = msg.id && (msg.id._serialized || msg.id.$1 || (msg.id.id && ((msg.id.fromMe ? 'true_' : 'false_') + msg.id.remote + '_' + msg.id.id)));
  try {
    const r = await client.pupPage.evaluate(async (msgId) => {
      const pasos = [];
      try {
        const C = window.require('WAWebCollections');
        let m = C.Msg.get(msgId);
        if (!m) { try { m = (await C.Msg.getMessagesById([msgId]))?.messages?.[0]; } catch (e) { pasos.push('getById:' + (e && e.message)); } }
        if (!m) return { err: 'no encontré el mensaje ' + msgId + ' · ' + pasos.join(' | ') };
        const md = m.mediaData || {};
        if (md.mediaStage !== 'RESOLVED') {
          try { await m.downloadMedia({ downloadEvenIfExpensive: true, rmrReason: 1, isUserInitiated: true }); } catch (e) { pasos.push('dm:' + (e && (e.message || e.name))); }
        }
        let blob = null;
        const mb = (m.mediaData || {}).mediaBlob;
        if (mb) { try { blob = typeof mb.forceToBlob === 'function' ? mb.forceToBlob() : (mb._blob || null); } catch (e) { pasos.push('blob:' + (e && e.message)); } }
        const url = (m.mediaData || {}).renderableUrl;
        if (!blob && url) { try { blob = await (await fetch(url)).blob(); } catch (e) { pasos.push('url:' + (e && e.message)); } }
        if (!blob) {
          try {
            const dm = window.require('WAWebDownloadManager').downloadManager;
            const buf = await dm.downloadAndMaybeDecrypt({ directPath: m.directPath, encFilehash: m.encFilehash, filehash: m.filehash, mediaKey: m.mediaKey, mediaKeyTimestamp: m.mediaKeyTimestamp, type: m.type, signal: new AbortController().signal });
            blob = new Blob([buf], { type: m.mimetype || '' });
          } catch (e) { pasos.push('descifrar:' + (e && (e.message || e.name || String(e)))); }
        }
        if (!blob) return { err: 'sin archivo · etapa ' + ((m.mediaData || {}).mediaStage || '?') + ' · ' + pasos.join(' | ') };
        const data = await new Promise((ok, mal) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1] || ''); fr.onerror = () => mal(fr.error); fr.readAsDataURL(blob); });
        return { data, mime: m.mimetype || blob.type };
      } catch (e) { return { err: pasos.concat(String((e && (e.stack || e.message)) || e)).join(' | ').slice(0, 400) }; }
    }, id);
    if (r && r.data) { log('Archivo bajado por la página (' + que + ', ' + Math.round(r.data.length / 1024) + ' KB)'); return r; }
    log('No pude bajar el archivo (' + que + '):', r && r.err);
  } catch (e) { log('No pude bajar el archivo (' + que + '):', String((e && e.message) || e).slice(0, 200)); }
  return null;
}
// v1.7: traduce un id "lid" (xxx@lid) al número de teléfono, probando lo que exponga WhatsApp Web
async function telDeLid(lid) {
  try {
    const r = await client.pupPage.evaluate(async (l) => {
      try {
        const S = window.Store || {};
        const W = window.require ? (function () { try { return window.require('WAWebApiContact'); } catch (e) { return null; } })() : null;
        const mk = (u, srv) => ({ user: u, server: srv, _serialized: u + '@' + srv });
        const cands = [];
        if (S.LidUtils && S.LidUtils.getPhoneNumber) cands.push(() => S.LidUtils.getPhoneNumber(mk(l, 'lid')));
        if (W && W.getPhoneNumber) cands.push(() => W.getPhoneNumber(mk(l, 'lid')));
        if (S.LidUtils && S.LidUtils.getCurrentLid && S.Contact) cands.push(() => { const c = S.Contact.get(l + '@lid'); return c && (c.phoneNumber || (c.userid && mk(c.userid, 'c.us'))); });
        for (const f of cands) { try { const x = await f(); const v = x && (x._serialized || x.user || x); if (v) return String(v); } catch (e) { /* siguiente */ } }
      } catch (e) { /* nada */ }
      return '';
    }, lid);
    const d = String(r || '').replace(/@.*$/, '').replace(/\D/g, '');
    if (/^\d{10,15}$/.test(d)) { log('lid ' + lid + ' → ' + d); return d; }
  } catch (e) { log('telDeLid:', e.message); }
  return '';
}
async function opParticipantes(nombreGrupo) {
  try {
    const gid = await idGrupo(nombreGrupo);
    const chat = await client.getChatById(gid);
    const lista = [];
    for (const p of (chat.participants || [])) {
      const id = (p.id && (p.id._serialized || p.id.$1)) || '';
      let num = id.replace(/@.*$/, ''), nombre = '';
      try { const c = await client.getContactById(id); if (c) { if (c.number) num = c.number; nombre = c.pushname || c.name || ''; } } catch (e) { /* sigue */ }
      if (id.endsWith('@lid') && num === id.replace(/@.*$/, '')) { const tel = await telDeLid(num); if (tel) num = tel; }
      lista.push({ wa: num, nombre });
    }
    await opApi('participantes', { grupo: nombreGrupo, lista });
    log('Operación: ' + lista.length + ' participantes de "' + nombreGrupo + '"');
  } catch (e) { opEstado.ultimoError = 'participantes: ' + e.message; log('participantes:', e.message); }
}
let opUltimoPart = 0, opOcupado = false;
// v1.5: ciclo de Operación: manda lo pendiente; cada 10 min refresca los participantes del grupo
async function opCiclo() {
  if (!opActivo() || opOcupado) return; opOcupado = true;
  try {
    await cotCiclo();
    const r = await opApi('pendientes', {});
    opEstado.ultimoCiclo = new Date().toISOString();
    if (estado.listo) {
      for (const p of r.pendientes || []) {
        try {
          let jid;
          if (p.tipo === 'grupo') jid = await idGrupo(p.wa);
          else { if (!String(p.wa).replace(/\D/g, '')) throw new Error('sin número'); jid = await idTelefono(p.wa); }
          if (p.archivo_id) {
            // v1.8: mensaje con documento (PDF de cotización): la app lo da en base64
            const a = await opApi('archivo', { id: p.archivo_id });
            const media = new MessageMedia(a.tipo || 'application/pdf', a.b64, a.nombre || 'archivo.pdf');
            // v1.9: las fotos (galería para clientes) se mandan como foto, no como documento
            const esFoto = /^image\//.test(a.tipo || '');
            await client.sendMessage(jid, media, esFoto ? (p.texto ? { caption: p.texto } : {}) : { caption: p.texto, sendMediaAsDocument: true });
          } else await client.sendMessage(jid, p.texto);
          await opApi('marcar', { id: p.id, ok: true });
          opEstado.enviados++; log('Operación -> ' + (p.tipo === 'grupo' ? 'grupo ' + p.wa : p.wa) + ': ' + p.texto.slice(0, 50).replace(/\n/g, ' '));
          await new Promise(res => setTimeout(res, 2500));
        } catch (e) {
          opEstado.errores++; opEstado.ultimoError = e.message; log('ERROR Operación', p.id, ':', e.message);
          try { await opApi('marcar', { id: p.id, ok: false, error: e.message }); } catch (e2) { log('No pude marcar:', e2.message); }
        }
      }
      if (r.grupo && Date.now() - opUltimoPart > 10 * 60000) { opUltimoPart = Date.now(); await opParticipantes(r.grupo); }
    }
  } catch (e) { opEstado.ultimoError = e.message; log('Ciclo Operación:', e.message); }
  finally { opOcupado = false; }
}
// ---------- v1.8: cotizaciones de Operación (plantilla Python + LibreOffice en este servidor) ----------
const COT_DIR = path.join(__dirname, 'cotizador');
const COT_IMG = path.join(DATOS, 'cot-img');      // fotos de productos (se bajan de la app la primera vez)
const COT_HOME = path.join(DATOS, 'lo-home');     // perfil de LibreOffice
let cotEstado = { hechas: 0, errores: 0, ultima: '', ultimoError: '' };
const cotPy = () => fs.existsSync(path.join(__dirname, 'pyenv', 'bin', 'python')) ? path.join(__dirname, 'pyenv', 'bin', 'python') : 'python3';
function cotListo() { try { require('child_process').execSync('command -v soffice', { stdio: 'ignore' }); return fs.existsSync(path.join(COT_DIR, 'correr.py')); } catch (e) { return false; } }
async function cotCiclo() {
  let r; try { r = await opApi('cot_pendientes', { listo: cotListo() }); } catch (e) { return; }
  for (const c of r.cotizaciones || []) {
    let tmp = '';
    try {
      if (!cotListo()) throw new Error('El servidor aún no tiene LibreOffice/plantilla (corre /actualizar y espera unos minutos)');
      fs.mkdirSync(COT_IMG, { recursive: true }); fs.mkdirSync(COT_HOME, { recursive: true });
      for (const sl of c.imgs || []) {
        const f = path.join(COT_IMG, sl + '.jpg');
        if (fs.existsSync(f)) continue;
        try { const ri = await fetch(OP.url.replace(/\/$/, '') + '/cot-img/' + encodeURIComponent(sl) + '.jpg'); if (ri.ok) fs.writeFileSync(f, Buffer.from(await ri.arrayBuffer())); } catch (e) { log('foto ' + sl + ':', e.message); }
      }
      tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cot-'));
      fs.writeFileSync(path.join(tmp, 'cfg.json'), JSON.stringify(c.cfg));
      const out = await new Promise((res, rej) => require('child_process').execFile(cotPy(), [path.join(COT_DIR, 'correr.py'), path.join(tmp, 'cfg.json'), COT_IMG, tmp],
        { timeout: 150000, env: Object.assign({}, process.env, { HOME: COT_HOME }) }, (e, so, se) => e ? rej(new Error(String(se || e.message).slice(-400))) : res(String(so))));
      const j = JSON.parse(out.trim().split('\n').pop());
      if (!j.pdf || !fs.existsSync(j.pdf)) throw new Error('No salió el PDF');
      await opApi('cot_resultado', { id: c.id, ok: true, pdf_b64: fs.readFileSync(j.pdf).toString('base64'), xlsx_b64: fs.existsSync(j.xlsx) ? fs.readFileSync(j.xlsx).toString('base64') : '' });
      cotEstado.hechas++; cotEstado.ultima = c.folio + ' ' + new Date().toISOString().slice(0, 16); log('Cotización ' + c.folio + ' generada');
    } catch (e) {
      cotEstado.errores++; cotEstado.ultimoError = c.folio + ': ' + e.message; log('ERROR cotización', c.folio, e.message);
      try { await opApi('cot_resultado', { id: c.id, ok: false, error: e.message }); } catch (e2) { log('No pude reportar la cotización:', e2.message); }
    } finally { if (tmp) try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* nada */ } }
  }
}
async function opTick() {
  if (!opActivo()) return;
  try { const r = await opApi('tick', {}); opEstado.ultimoTick = new Date().toISOString(); if (r.hecho && r.hecho.length) log('Operación tick:', r.hecho.join(', ')); }
  catch (e) { opEstado.ultimoError = 'tick: ' + e.message; log('tick:', e.message); }
}

client.on('disconnected', r => { estado.listo = false; log('Desconectado:', r, '— reintentando en 20 s'); setTimeout(() => client.initialize().catch(e => log('init:', e.message)), 20000); });

let grupos = new Map();
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
async function cargarGrupos() {
  try {
    let chats;
    try { chats = await client.getChats(); }
    catch (e1) {
      // v1.3: plan B si getChats falla: leer los chats directo del Store de WhatsApp Web
      log('getChats falló (' + e1.message + '), leyendo el Store directo');
      chats = await client.pupPage.evaluate(() => {
        const col = window.Store && window.Store.Chat; const arr = col ? (col.getModelsArray ? col.getModelsArray() : (col.models || [])) : [];
        return arr.filter(c => c.isGroup || (c.id && c.id.server === 'g.us')).map(c => ({ isGroup: true, name: c.formattedTitle || c.name || '', id: { _serialized: c.id._serialized || c.id.$1 || (c.id.user + '@' + c.id.server) } }));
      });
    }
    grupos = new Map(); chats.filter(c => c.isGroup).forEach(c => grupos.set(norm(c.name), c.id._serialized));
    estado.grupos = [...grupos.keys()];
    log('Grupos disponibles:', estado.grupos.join(' | '));
  } catch (e) { estado.ultimoError = 'grupos: ' + e.message; log('No pude leer los grupos:', e.message); }
}
async function idGrupo(nombre) {
  let id = grupos.get(norm(nombre));
  if (!id) { await cargarGrupos(); id = grupos.get(norm(nombre)); }
  if (!id) throw new Error('No encuentro el grupo "' + nombre + '" en este WhatsApp. Grupos: ' + estado.grupos.join(', '));
  return id;
}

// v1.6: id de WhatsApp de un número (E.164 sin +). México: WhatsApp usa 52XXXXXXXXXX (sin el 1 viejo de celular).
async function idTelefono(dig) {
  dig = String(dig).replace(/\D/g, '');
  if (/^521\d{10}$/.test(dig)) dig = '52' + dig.slice(3);
  try {
    const n = await client.getNumberId(dig);
    if (n) return n._serialized || n.$1 || (dig + '@c.us');
  } catch (e) { log('getNumberId falló:', e.message); }
  return dig + '@c.us';
}
// ---------- ciclo ----------
let ocupado = false;
async function ciclo() {
  if (ocupado) return; ocupado = true;
  try {
    const r = await api('puente_pendientes', {});
    estado.ultimoCiclo = new Date().toISOString();
    if (!estado.listo) { if (r.pendientes.length) log(r.pendientes.length + ' pendiente(s), pero WhatsApp no está conectado.'); return; }
    if (!estado.grupos.length) await cargarGrupos(); // v1.3: reintenta leer los grupos hasta que aparezcan
    for (const p of r.pendientes) {
      try {
        // v1.6: destino "tel:52442..." = mensaje directo al celular (avisos de consignas); si no, es un grupo
        const gid = /^tel:/.test(p.grupo) ? await idTelefono(p.grupo.slice(4)) : await idGrupo(p.grupo);
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
        estado.enviados++; log('Enviado a "' + (/^tel:/.test(p.grupo) ? 'tel:…' + p.grupo.slice(-4) : p.grupo) + '":', p.evidencia_id);
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
  if (u.pathname === '/grupos') { await cargarGrupos(); cuerpo = '<p>Grupos (' + estado.grupos.length + '):<br>' + (estado.grupos.map(g => '• ' + g).join('<br>') || '(ninguno)') + '</p>' + (estado.ultimoError ? '<p style="color:#b00">' + estado.ultimoError + '</p>' : ''); }
  else if (u.pathname === '/actualizar') {
    // v1.2: baja la última versión de index.js del repositorio y se reinicia (systemd lo levanta solo)
    try {
      // v1.4: corre actualizar.sh del repositorio (index.js, dependencias y parche de WhatsApp Web)
      const r = await fetch('https://raw.githubusercontent.com/jesusevaristohernandez21-png/consignas-gecem/main/puente/actualizar.sh?t=' + Date.now());
      const sh = await r.text();
      if (!r.ok || sh.indexOf('ACTUALIZADO') < 0) throw new Error('descarga inválida ' + r.status);
      fs.writeFileSync('/opt/puente-gecem/actualizar.sh', sh);
      const out = require('child_process').execSync('bash /opt/puente-gecem/actualizar.sh 2>&1', { timeout: 240000 }).toString();
      cuerpo = '<pre style="white-space:pre-wrap;font-size:12px">' + out.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])) + '</pre><p>Reiniciando en 2 s…</p><meta http-equiv="refresh" content="15;url=/?k=' + PUENTE_KEY + '">';
      setTimeout(() => process.exit(0), 2000);
    } catch (e) { cuerpo = '<p style="color:#b00">No se pudo actualizar: ' + e.message + '</p>'; }
  } else if (u.pathname === '/operacion') {
    // v1.5: conectar con la app Operación GECEM (URL y clave del agente)
    if (req.method === 'POST') {
      let body = ''; await new Promise(res => { req.on('data', d => body += d); req.on('end', res); });
      const f = new URLSearchParams(body);
      OP = { url: String(f.get('url') || '').trim(), clave: String(f.get('clave') || '').trim() };
      try { fs.mkdirSync(DATOS, { recursive: true }); fs.writeFileSync(OP_FILE, JSON.stringify(OP)); } catch (e) { log('No pude guardar operacion.json:', e.message); }
      log('Operación configurada: ' + (OP.url || '(vacío)'));
    }
    let prueba = '';
    if (opActivo()) { try { const r = await opApi('estado', {}); prueba = '🟢 La app responde · agente ' + (r.activo ? 'encendido' : 'apagado') + (r.prueba ? ' · modo prueba' : '') + ' · grupo: ' + (r.grupo || '(sin grupo)') + ' · por mandar: ' + r.pendientes; } catch (e) { prueba = '🔴 ' + e.message; } }
    const esc = t => String(t || '').replace(/"/g, '&quot;');
    cuerpo = '<h2>Operación GECEM</h2><form method="post"><label>URL de la app<br><input name="url" value="' + esc(OP.url || 'https://operacion-gecem.vercel.app') + '" style="width:100%"></label><br><br>' +
      '<label>Clave del agente (Cuenta → Agente → Generar clave)<br><input name="clave" value="' + esc(OP.clave) + '" style="width:100%"></label><br><br><button>Guardar</button></form>' +
      '<p>' + (prueba || 'Sin configurar.') + '</p>' +
      '<p>Último ciclo: ' + (opEstado.ultimoCiclo || '—') + ' · último tick: ' + (opEstado.ultimoTick || '—') + '<br>Enviados: ' + opEstado.enviados + ' · recibidos: ' + opEstado.recibidos + ' · errores: ' + opEstado.errores + '</p>' +
      (opEstado.ultimoError ? '<p style="color:#b00">Último error: ' + opEstado.ultimoError + '</p>' : '') + '<p><a href="/?k=' + PUENTE_KEY + '">← estado general</a></p>';
  } else if (u.pathname === '/log') {
    // v1.1: últimas líneas del registro, para diagnosticar sin entrar por SSH
    let txt = '';
    try { txt += '--- instalar.log ---\n' + require('child_process').execSync('tail -n 40 /root/instalar.log 2>/dev/null || true').toString(); } catch (e) { txt += e.message; }
    try { txt += '\n--- servicio ---\n' + require('child_process').execSync('journalctl -u puente-gecem -n 60 --no-pager 2>/dev/null || true').toString(); } catch (e) { txt += e.message; }
    cuerpo = '<pre style="white-space:pre-wrap;font-size:12px">' + txt.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])) + '</pre>';
  } else if (u.pathname === '/qr' && estado.qr) {
    const img = await QRCode.toDataURL(estado.qr, { width: 320 });
    cuerpo = '<h2>Escanea con el celular GECEM Evidencias</h2><p>WhatsApp → ⋮ → Dispositivos vinculados → Vincular un dispositivo</p><img src="' + img + '"><p>La página se actualiza sola cada 20 s.</p><meta http-equiv="refresh" content="20">';
  } else {
    cuerpo = '<h2>Puente WhatsApp — Consignas GECEM · v1.10</h2><p>Estado: <b>' + (estado.listo ? '🟢 conectado' : estado.qr ? '🟡 esperando QR (abre /qr)' : '🔴 iniciando…') + '</b></p>' +
      '<p>Último ciclo: ' + (estado.ultimoCiclo || '—') + '<br>Enviados desde que arrancó: ' + estado.enviados + ' · errores: ' + estado.errores + '</p>' +
      (estado.ultimoError ? '<p style="color:#b00">Último error: ' + estado.ultimoError + '</p>' : '') +
      '<p>Operación GECEM: ' + (opActivo() ? '🟢 configurada · enviados ' + opEstado.enviados + ' · recibidos ' + opEstado.recibidos + (opEstado.ultimoError ? ' · <span style="color:#b00">' + opEstado.ultimoError + '</span>' : '') : 'sin configurar') + ' · <a href="/operacion?k=' + PUENTE_KEY + '">configurar</a></p>' +
      '<p>Cotizador: ' + (cotListo() ? '🟢 listo' : '🟡 sin LibreOffice todavía (corre /actualizar)') + ' · hechas ' + cotEstado.hechas + (cotEstado.ultimoError ? ' · <span style="color:#b00">' + cotEstado.ultimoError + '</span>' : '') + '</p>' +
      '<p>Grupos que ve este WhatsApp:<br>' + (estado.grupos.map(g => '• ' + g).join('<br>') || '(aún no)') + '</p><meta http-equiv="refresh" content="30">';
  }
  res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font-family:sans-serif;max-width:480px;margin:20px auto;padding:0 12px">' + cuerpo + '</body>');
}).listen(PORT, () => log('Página de estado/QR en el puerto ' + PORT));

// v1.1: si Chrome no arranca, el error se ve en la página de estado y se reintenta cada 60 s
function iniciar() { client.initialize().catch(e => { estado.ultimoError = 'init: ' + e.message; log('init:', e.message); setTimeout(iniciar, 60000); }); }
iniciar();
setInterval(ciclo, CADA_MS);
setTimeout(ciclo, 10000);
// v1.5: Operación
setInterval(opCiclo, CADA_MS);
setTimeout(opCiclo, 15000);
setInterval(opTick, 60000);
setTimeout(opTick, 20000);
