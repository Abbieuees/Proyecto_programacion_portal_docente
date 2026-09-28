/* Sesiones simuladas: token aleatorio guardado en memoria (se pierden al reiniciar el servidor). */

const { generarToken } = require("./seguridad");
const { HttpError } = require("./errores");

const HORA = 60 * 60 * 1000;
const DURACION = 8 * HORA;               // sesión normal
const DURACION_RECORDADA = 7 * 24 * HORA; // casilla "Recordar sesión"

const sesiones = new Map(); // token -> { idDocente, expira }

function crearSesion(idDocente, recordar = false){
  const token = generarToken();
  const expira = Date.now() + (recordar ? DURACION_RECORDADA : DURACION);
  sesiones.set(token, { idDocente, expira });
  return { token, expira: new Date(expira).toISOString() };
}

function cerrarSesion(token){
  sesiones.delete(token);
}

// Tras cambiar la contraseña se cierran las demás sesiones del docente
function cerrarOtrasSesiones(idDocente, tokenActual){
  for (const [token, sesion] of sesiones) {
    if (sesion.idDocente === idDocente && token !== tokenActual) sesiones.delete(token);
  }
}

function reiniciarSesiones(){
  sesiones.clear();
}

// Middleware: exige la cabecera "Authorization: Bearer <token>" con una sesión vigente
function requireAuth(req, res, next){
  const [tipo, token] = (req.get("Authorization") || "").split(" ");
  const sesion = tipo === "Bearer" ? sesiones.get(token) : undefined;
  if (!sesion || sesion.expira < Date.now()) {
    if (sesion) sesiones.delete(token);
    return next(new HttpError(401, "Sesión no válida o expirada. Inicia sesión de nuevo."));
  }
  req.idDocente = sesion.idDocente;
  req.token = token;
  next();
}

module.exports = { crearSesion, cerrarSesion, cerrarOtrasSesiones, reiniciarSesiones, requireAuth };
