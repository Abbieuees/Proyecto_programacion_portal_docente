// Error con código HTTP: las rutas lo lanzan y server.js lo responde como JSON { error, ... }
class HttpError extends Error {
  constructor(status, mensaje, extra = {}){
    super(mensaje);
    this.status = status;
    this.extra = extra;
  }
}

module.exports = { HttpError };
