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

// PUT /api/perfil/correo   { contrasena, correo }
router.put("/correo", async (req, res) => {
  const { contrasena, correo } = req.body ?? {};
  if (typeof contrasena !== "string" || typeof correo !== "string" || !contrasena) {
    throw new HttpError(400, "Envía tu contraseña y el nuevo correo.");
  }
  const nuevo = correo.trim().toLowerCase();
  if (nuevo.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nuevo)) {
    throw new HttpError(400, "Escribe un correo institucional válido.");
  }

  const docente = await repo.buscarDocente(req.idDocente);
  if (!(await verificarContrasena(contrasena, docente.contrasena_hash))) {
    throw new HttpError(400, "La contraseña no es correcta.");
  }
  const existente = await repo.buscarDocentePorCorreo(nuevo);
  if (existente && existente.id_docente !== req.idDocente) {
    throw new HttpError(409, "Ese correo ya está en uso por otra cuenta.");
  }

  await repo.actualizarCorreo(req.idDocente, nuevo);
  res.json(await repo.buscarPerfil(req.idDocente));
});

module.exports = router;
