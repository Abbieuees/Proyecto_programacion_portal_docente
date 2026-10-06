/* /api/grupos — grupos del docente, su nómina y sus evaluaciones (requiere token) */

const express = require("express");
const repo = require("../repositorio");
const Reglas = require("../../src/js/reglas");
const { grupoPropio, leerId } = require("../acceso");
const { HttpError } = require("../errores");

const router = express.Router();

// GET /api/grupos?ciclo=2
router.get("/", async (req, res) => {
  const idCiclo = req.query.ciclo === undefined ? null : leerId(req.query.ciclo);
  res.json(await repo.gruposDelDocente(req.idDocente, idCiclo));
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

// GET /api/grupos/:id/evaluaciones?registro=4&tipo=TAREA|PARCIAL|PROYECTO
router.get("/:id/evaluaciones", async (req, res) => {
  const grupo = await grupoPropio(req);

  const tipo = req.query.tipo ? String(req.query.tipo).toUpperCase() : null;
  if (tipo && !Reglas.TIPOS_EVALUACION.includes(tipo)) {
    throw new HttpError(400, `Tipo de evaluación no válido. Usa: ${Reglas.TIPOS_EVALUACION.join(", ")}.`);
  }
  const idRegistro = req.query.registro === undefined ? null : leerId(req.query.registro);

  res.json(await repo.evaluacionesDelGrupo(grupo.id_grupo, { tipo, idRegistro }));
});

// GET /api/grupos/:id/registros/:idRegistro/notas
// Resumen del registro: la nota ponderada de cada estudiante y su proyección del ciclo.
router.get("/:id/registros/:idRegistro/notas", async (req, res) => {
  const grupo = await grupoPropio(req);
  const idRegistro = leerId(req.params.idRegistro);

  const registro = await repo.buscarRegistro(idRegistro);
  if (!registro) throw new HttpError(404, "Registro no encontrado.");
  if (registro.id_ciclo !== grupo.id_ciclo) {
    throw new HttpError(400, "El registro no pertenece al ciclo de este grupo.");
  }

  res.json(await repo.notasDelRegistro(grupo.id_grupo, idRegistro));
});

module.exports = router;
