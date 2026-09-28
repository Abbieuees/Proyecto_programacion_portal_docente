/* /api/perfil — datos del docente de la sesión (requiere token) */

const express = require("express");
const repo = require("../repositorio");
const Reglas = require("../../src/js/reglas");
const { hashContrasena, verificarContrasena } = require("../seguridad");
const { cerrarOtrasSesiones } = require("../sesiones");
const { HttpError } = require("../errores");

const router = express.Router();

// GET /api/perfil
router.get("/", async (req, res) => {
  res.json(await repo.buscarPerfil(req.idDocente));
});

// PUT /api/perfil/contrasena   { actual, nueva }
router.put("/contrasena", async (req, res) => {
  const { actual, nueva } = req.body ?? {};
  if (typeof actual !== "string" || typeof nueva !== "string") {
    throw new HttpError(400, "Envía la contraseña actual y la nueva.");
  }
  const error = Reglas.validarCambioContrasena({ actual, nueva });
  if (error) throw new HttpError(400, error);

  const docente = await repo.buscarDocente(req.idDocente);
  if (!(await verificarContrasena(actual, docente.contrasena_hash))) {
    throw new HttpError(400, "La contraseña actual no es correcta.");
  }

  await repo.actualizarContrasena(req.idDocente, await hashContrasena(nueva));
  cerrarOtrasSesiones(req.idDocente, req.token);
  res.status(204).end();
});

module.exports = router;
