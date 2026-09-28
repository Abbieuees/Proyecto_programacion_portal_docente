/* API REST SIMULADA DEL PORTAL DOCENTE UEES (Node.js + Express)
   Los datos viven en memoria (datos.js) con la misma estructura que la base de datos.
   Inicio: npm start  →  http://localhost:3000 (portal) y http://localhost:3000/api (API) */

const path = require("node:path");
const express = require("express");
const { HttpError } = require("./errores");
const { requireAuth } = require("./sesiones");

const RAIZ = path.join(__dirname, ".."); // carpeta del proyecto, donde está el frontend

const ENDPOINTS = [
  "POST /api/auth/login",
  "POST /api/auth/logout",
  "GET  /api/perfil",
  "PUT  /api/perfil/contrasena",
  "GET  /api/grupos",
  "GET  /api/grupos/:id",
  "GET  /api/grupos/:id/estudiantes",
  "GET  /api/grupos/:id/evaluaciones?tipo=TAREA|PARCIAL|PROYECTO",
  "GET  /api/evaluaciones/:id",
  "GET  /api/evaluaciones/:id/calificaciones",
  "PUT  /api/evaluaciones/:id/calificaciones",
  "POST /api/evaluaciones/:id/traslado",
  "GET  /api/historial"
];

function crearApp({ latenciaMs = 0 } = {}){
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());

  // CORS abierto (solo para desarrollo): permite usar el portal desde otro origen, p. ej. Live Server
  // CORS
  app.use("/api", (req, res, next) => {
    const origen = req.headers.origin;
    const frontendUrl = process.env.FRONTEND_URL;

    if (
      !origen ||
      origen === "http://localhost:5500" ||
      origen === "http://127.0.0.1:5500" ||
      origen === frontendUrl
    ) {
      res.setHeader(
        "Access-Control-Allow-Origin",
        origen || "*"
      );
    }

    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization"
    );

    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, OPTIONS"
    );

    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }

    next();
  });

  // Retraso artificial para simular la red y ver los estados de carga del portal
  if (latenciaMs > 0) app.use("/api", (req, res, next) => setTimeout(next, latenciaMs));

  app.get("/api", (req, res) => {
    res.json({ nombre: "API REST Portal Docente UEES", modo: "simulada (datos en memoria)", endpoints: ENDPOINTS });
  });
  app.use("/api/auth", require("./rutas/auth"));
  app.use("/api/perfil", requireAuth, require("./rutas/perfil"));
  app.use("/api/grupos", requireAuth, require("./rutas/grupos"));
  app.use("/api/evaluaciones", requireAuth, require("./rutas/evaluaciones"));
  app.use("/api/historial", requireAuth, require("./rutas/historial"));
  app.use("/api", (req, res, next) => next(new HttpError(404, `No existe la ruta ${req.method} ${req.originalUrl}.`)));

  // Frontend: solo las dos páginas y la carpeta src (no se expone el código del backend)
  app.get(["/", "/index.html"], (req, res) => res.sendFile(path.join(RAIZ, "index.html")));
  app.get("/portal-docente.html", (req, res) => res.sendFile(path.join(RAIZ, "portal-docente.html")));
  app.use("/src", express.static(path.join(RAIZ, "src")));

  // Todos los errores se responden en JSON: { "error": "mensaje", ...detalles }
  app.use((err, req, res, next) => {
    if (err.type === "entity.parse.failed") err = new HttpError(400, "El cuerpo de la petición no es un JSON válido.");
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    res.status(status).json({
      error: status === 500 ? "Error interno del servidor." : err.message,
      ...(err instanceof HttpError ? err.extra : {})
    });
  });

  return app;
}

if (require.main === module) {
  const puerto = Number(process.env.PORT) || 3000;
  const latenciaMs = process.env.LATENCIA_MS === undefined ? 0 : Number(process.env.LATENCIA_MS);
  crearApp({ latenciaMs }).listen(puerto, () => {
    console.log(`Portal Docente UEES  → http://localhost:${puerto}`);
    console.log(`API REST (simulada)  → http://localhost:${puerto}/api   latencia: ${latenciaMs} ms`);
  });
}

module.exports = { crearApp };
