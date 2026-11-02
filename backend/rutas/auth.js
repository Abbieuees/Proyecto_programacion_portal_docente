/* /api/auth — inicio y cierre de sesión */

const express = require("express");
const repo = require("../repositorio");
const { verificarContrasena } = require("../seguridad");
const { crearSesion, cerrarSesion, requireAuth } = require("../sesiones");
const { HttpError } = require("../errores");

// Se compara contra este hash cuando el correo no existe, para que la respuesta tarde
// lo mismo y no revele qué correos están registrados
const HASH_FICTICIO = "scrypt$9a0dc444aa3bbf60f424b96e71a5a64a$07ec6c62ef3f177ce0dcb5cdda641e2669dd51738121d1846849f92977a0a72fbbc4002c614a021e2974cb00bafe38e975a35b6b8e0b6f48e1ce94b544c584f2";

const router = express.Router();

// POST /api/auth/login   { correo, contrasena, recordar? }
router.post("/login", async (req, res) => {
  const { correo, contrasena, recordar } = req.body ?? {};
  if (typeof correo !== "string" || typeof contrasena !== "string" || !correo.trim() || !contrasena) {
    throw new HttpError(400, "Ingresa tu usuario y contraseña para continuar.");
  }

  const docente = await repo.buscarDocentePorCorreo(correo);
  const valida = await verificarContrasena(contrasena, docente?.contrasena_hash ?? HASH_FICTICIO);
  if (!docente || !valida) throw new HttpError(401, "Usuario o contraseña incorrectos.");

  const { token, expira } = crearSesion(docente.id_docente, recordar === true);
  res.json({ token, expira, docente: await repo.buscarPerfil(docente.id_docente) });
});

// POST /api/auth/logout
router.post("/logout", requireAuth, (req, res) => {
  cerrarSesion(req.token);
  res.status(204).end();
});

module.exports = router;
