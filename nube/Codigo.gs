/**
 * Sistema PSA - almacén en Google Drive.
 *
 * Este programa se instala en la cuenta de Google dueña de la carpeta "Proyecto PSA" y se publica como aplicación web
 * (Implementar > Nueva implementación > Aplicación web; Ejecutar como: Yo; Acceso: Cualquier persona).
 * El servidor del Sistema PSA le pide leer y guardar archivos dentro de esa carpeta, y solo dentro de ella.
 * Cada petición trae la contraseña TOKEN; sin ella no hace nada.
 */
var TOKEN = 'PON_AQUI_UN_TOKEN_LARGO_Y_SECRETO';
var CARPETA = 'Proyecto PSA';

function doGet() {
  return ContentService.createTextOutput('Sistema PSA: almacen en Drive activo.');
}

function doPost(e) {
  var r;
  try {
    var p = JSON.parse(e.postData.contents);
    if (!TOKEN || TOKEN.length < 20 || p.token !== TOKEN) throw new Error('no autorizado');
    r = { ok: true, datos: ejecutar(p) };
  } catch (err) {
    r = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(r)).setMimeType(ContentService.MimeType.JSON);
}

/** Ejecutar una vez desde el editor para dar los permisos y comprobar que encuentra la carpeta. */
function probar() {
  Logger.log('Carpeta: ' + raiz().getName() + ' (' + raiz().getUrl() + ') - cuenta: ' + Session.getEffectiveUser().getEmail());
  UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/about?fields=user', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
}

function ejecutar(p) {
  if (p.accion === 'ping') return { carpeta: raiz().getName(), cuenta: Session.getEffectiveUser().getEmail() };
  if (p.accion === 'leer') {
    var a = archivo(p.ruta);
    return a ? { base64: Utilities.base64Encode(a.getBlob().getBytes()) } : null;
  }
  if (p.accion === 'listar') {
    var c = carpeta(partir(p.ruta), false), lista = [];
    if (c) recorrer(c, '', lista);
    return lista;
  }
  if (p.accion === 'escribir' || p.accion === 'borrar') {
    var candado = LockService.getScriptLock();
    candado.waitLock(120000);
    try {
      return p.accion === 'escribir' ? escribir(p) : quitarTodos(partir(p.ruta));
    } finally {
      candado.releaseLock();
    }
  }
  throw new Error('accion desconocida');
}

function escribir(p) {
  var partes = partir(p.ruta), nombre = partes[partes.length - 1];
  var destino = carpeta(partes.slice(0, -1), true);
  var bytes = Utilities.base64Decode(p.base64);
  if (p.anterior) {
    // El archivo que habia pasa a ser "el anterior" (y el anterior de antes se elimina).
    var pa = partir(p.anterior), nombreAnterior = pa[pa.length - 1];
    quitarTodos(pa);
    var it = destino.getFilesByName(nombre), primero = true;
    while (it.hasNext()) { var f = it.next(); if (primero) { f.setName(nombreAnterior); primero = false; } else eliminar(f); }
  } else {
    quitarTodos(partes);
  }
  destino.createFile(Utilities.newBlob(bytes, 'application/octet-stream', nombre));
  return { tamano: bytes.length };
}

/** Carpeta raiz del proyecto: la que se llame "Proyecto PSA" (sin importar mayusculas) en Mi unidad; se crea si no existe. */
function raiz() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('raiz');
  if (id) {
    try { var guardada = DriveApp.getFolderById(id); if (!guardada.isTrashed()) return guardada; } catch (e) { /* se busca de nuevo */ }
  }
  var it = DriveApp.getRootFolder().getFolders(), hallada = null;
  while (it.hasNext() && !hallada) { var c = it.next(); if (c.getName().trim().toLowerCase() === CARPETA.toLowerCase()) hallada = c; }
  if (!hallada) hallada = DriveApp.getRootFolder().createFolder(CARPETA);
  props.setProperty('raiz', hallada.getId());
  return hallada;
}

function partir(ruta) {
  var partes = String(ruta || '').split('/').filter(function (s) { return s; });
  if (!partes.length) throw new Error('ruta vacia');
  partes.forEach(function (s) { if (s === '.' || s === '..' || s.indexOf('\\') >= 0) throw new Error('ruta no valida'); });
  return partes;
}

function carpeta(partes, crear) {
  var f = raiz();
  for (var i = 0; i < partes.length; i++) {
    var it = f.getFoldersByName(partes[i]);
    if (it.hasNext()) f = it.next(); else if (crear) f = f.createFolder(partes[i]); else return null;
  }
  return f;
}

function archivo(ruta) {
  var partes = partir(ruta), c = carpeta(partes.slice(0, -1), false);
  if (!c) return null;
  var it = c.getFilesByName(partes[partes.length - 1]);
  return it.hasNext() ? it.next() : null;
}

function quitarTodos(partes) {
  var c = carpeta(partes.slice(0, -1), false), n = 0;
  if (!c) return { quitados: 0 };
  var it = c.getFilesByName(partes[partes.length - 1]);
  while (it.hasNext()) { eliminar(it.next()); n++; }
  return { quitados: n };
}

/** Elimina del todo (sin pasar por la papelera, que ocuparia el espacio de Drive); si no se puede, a la papelera. */
function eliminar(f) {
  var r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + f.getId(), { method: 'delete', headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (r.getResponseCode() >= 300) f.setTrashed(true);
}

function recorrer(c, prefijo, lista) {
  var fs = c.getFiles();
  while (fs.hasNext()) { var f = fs.next(); lista.push({ ruta: prefijo + f.getName(), tamano: f.getSize() }); }
  var cs = c.getFolders();
  while (cs.hasNext()) { var s = cs.next(); recorrer(s, prefijo + s.getName() + '/', lista); }
}
