/* /api/evaluaciones — carga, guardado y traslado de calificaciones (requiere token) */

const express = require("express");
const repo = require("../repositorio");
const Reglas = require("../../src/js/reglas");
const { evaluacionPropia } = require("../acceso");
const { HttpError } = require("../errores");

const router = express.Router();

function exigirBorrador(evaluacion){
  if (evaluacion.estado === "TRASLADADA") {
    throw new HttpError(409, "Estas calificaciones ya fueron trasladadas y no pueden modificarse.");
  }
}

// GET /api/evaluaciones/:id
router.get("/:id", async (req, res) => {
  res.json(await evaluacionPropia(req));
});

// GET /api/evaluaciones/:id/calificaciones
router.get("/:id/calificaciones", async (req, res) => {
  const evaluacion = await evaluacionPropia(req);
  res.json(await repo.calificacionesDeEvaluacion(evaluacion.id_evaluacion));
});

// PUT /api/evaluaciones/:id/calificaciones   { calificaciones: [{ id_matricula, nota }] }
// Se valida toda la lista antes de guardar: o se guardan todas las notas o ninguna.
router.put("/:id/calificaciones", async (req, res) => {
  const evaluacion = await evaluacionPropia(req);
  exigirBorrador(evaluacion);

  const lista = req.body?.calificaciones;
  if (!Array.isArray(lista) || lista.length === 0) {
    throw new HttpError(400, "Envía la lista de notas: { \"calificaciones\": [{ \"id_matricula\": 1, \"nota\": 8.5 }] }.");
  }

  const nomina = new Set((await repo.calificacionesDeEvaluacion(evaluacion.id_evaluacion)).map(f => f.id_matricula));
  const vistas = new Set();
  const detalles = [];
  lista.forEach((item, indice) => {
    const { id_matricula, nota } = item ?? {};
    let error = "";
    if (!nomina.has(id_matricula)) error = "La matrícula no pertenece al grupo de esta evaluación.";
    else if (vistas.has(id_matricula)) error = "La matrícula está repetida en la lista.";
    else if (!(nota === null || typeof nota === "number") || !Reglas.esNotaValida(nota)) {
      error = "La nota debe estar entre 0.00 y 10.00, con máximo 2 decimales (o null si está pendiente).";
    }
    vistas.add(id_matricula);
    if (error) detalles.push({ indice, id_matricula, error });
  });
  if (detalles.length) throw new HttpError(400, "Hay notas inválidas; no se guardó ningún cambio.", { detalles });

  await repo.guardarCalificaciones(evaluacion.id_evaluacion, lista);
  res.json(await repo.calificacionesDeEvaluacion(evaluacion.id_evaluacion));
});

// POST /api/evaluaciones/:id/traslado — solo si todas las notas están ingresadas
router.post("/:id/traslado", async (req, res) => {
  const evaluacion = await evaluacionPropia(req);
  exigirBorrador(evaluacion);

  const filas = await repo.calificacionesDeEvaluacion(evaluacion.id_evaluacion);
  const pendientes = filas.filter(f => f.nota === null).length;
  if (pendientes > 0) {
    const mensaje = pendientes === 1
      ? "No se puede trasladar: falta 1 nota por ingresar."
      : `No se puede trasladar: faltan ${pendientes} notas por ingresar.`;
    throw new HttpError(409, mensaje, { pendientes });
  }

  res.json(await repo.trasladarEvaluacion(evaluacion.id_evaluacion));
});

module.exports = router;
