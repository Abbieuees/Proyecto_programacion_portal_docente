/* /api/grupos — grupos del docente, su nómina y sus evaluaciones (requiere token) */

const express = require("express");
const repo = require("../repositorio");
const Reglas = require("../../src/js/reglas");
const { grupoPropio } = require("../acceso");
const { HttpError } = require("../errores");

const router = express.Router();

// GET /api/grupos
router.get("/", async (req, res) => {
  res.json(await repo.gruposDelDocente(req.idDocente));
});

// GET /api/grupos/:id
router.get("/:id", async (req, res) => {
  res.json(await grupoPropio(req));
});

// GET /api/grupos/:id/estudiantes
router.get("/:id/estudiantes", async (req, res) => {
  const grupo = await grupoPropio(req);
  res.json(await repo.estudiantesDelGrupo(grupo.id_grupo));
});

// GET /api/grupos/:id/evaluaciones?tipo=TAREA|PARCIAL|PROYECTO
router.get("/:id/evaluaciones", async (req, res) => {
  const grupo = await grupoPropio(req);
  const tipo = req.query.tipo ? String(req.query.tipo).toUpperCase() : null;
  if (tipo && !Reglas.TIPOS_EVALUACION.includes(tipo)) {
    throw new HttpError(400, `Tipo de evaluación no válido. Usa: ${Reglas.TIPOS_EVALUACION.join(", ")}.`);
  }
  res.json(await repo.evaluacionesDelGrupo(grupo.id_grupo, tipo));
});

module.exports = router;
