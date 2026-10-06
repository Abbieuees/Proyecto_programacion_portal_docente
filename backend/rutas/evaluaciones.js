/* /api/evaluaciones — carga, guardado y traslado de calificaciones (requiere token)

   Las notas cuelgan de los COMPONENTES de la evaluación, no de la evaluación:
   una tarea puede ir por avances y un parcial puede partirse en teórico y práctico.
   Cuando la nota es una sola, la evaluación tiene un único componente al 100 %. */

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

// GET /api/evaluaciones/:id  → incluye sus componentes con la ponderación de cada uno
router.get("/:id", async (req, res) => {
  res.json(await evaluacionPropia(req));
});

// GET /api/evaluaciones/:id/calificaciones
router.get("/:id/calificaciones", async (req, res) => {
  const evaluacion = await evaluacionPropia(req);
  res.json(await repo.calificacionesDeEvaluacion(evaluacion.id_evaluacion));
});

// PUT /api/evaluaciones/:id/calificaciones
//   { "calificaciones": [ { "id_matricula": 1, "notas": { "4": 8.5, "5": 9.0 } } ] }
// Las claves de "notas" son id_componente. null = pendiente (borra la nota).
// Se valida toda la lista antes de guardar: o se guardan todas las notas o ninguna.
router.put("/:id/calificaciones", async (req, res) => {
  const evaluacion = await evaluacionPropia(req);
  exigirBorrador(evaluacion);

  const lista = req.body?.calificaciones;
  if (!Array.isArray(lista) || lista.length === 0) {
    throw new HttpError(400,
      "Envía la lista de notas: { \"calificaciones\": [{ \"id_matricula\": 1, \"notas\": { \"4\": 8.5 } }] }.");
  }

  const nomina = new Set((await repo.calificacionesDeEvaluacion(evaluacion.id_evaluacion)).map(f => f.id_matricula));
  const componentesValidos = new Set(evaluacion.componentes.map(c => c.id_componente));
  const vistas = new Set();
  const detalles = [];

  lista.forEach((item, indice) => {
    const { id_matricula, notas } = item ?? {};

    if (!nomina.has(id_matricula)) {
      detalles.push({ indice, id_matricula, error: "La matrícula no pertenece al grupo de esta evaluación." });
      return;
    }
    if (vistas.has(id_matricula)) {
      detalles.push({ indice, id_matricula, error: "La matrícula está repetida en la lista." });
      return;
    }
    vistas.add(id_matricula);

    if (!notas || typeof notas !== "object" || Array.isArray(notas) || Object.keys(notas).length === 0) {
      detalles.push({ indice, id_matricula, error: "Envía \"notas\" como objeto { id_componente: nota }." });
      return;
    }

    for (const [clave, nota] of Object.entries(notas)) {
      const id_componente = Number(clave);
      if (!componentesValidos.has(id_componente)) {
        detalles.push({ indice, id_matricula, id_componente: clave,
                        error: "El componente no pertenece a esta evaluación." });
      } else if (!(nota === null || typeof nota === "number") || !Reglas.esNotaValida(nota)) {
        detalles.push({ indice, id_matricula, id_componente,
                        error: "La nota debe estar entre 0.00 y 10.00, con máximo 2 decimales (o null si está pendiente)." });
      }
    }
  });

  if (detalles.length) throw new HttpError(400, "Hay notas inválidas; no se guardó ningún cambio.", { detalles });

  await repo.guardarCalificaciones(evaluacion.id_evaluacion, lista, req.idDocente);
  res.json(await repo.calificacionesDeEvaluacion(evaluacion.id_evaluacion));
});

// POST /api/evaluaciones/:id/traslado
// Solo si el reparto de componentes llega al 100 % y no falta ninguna nota.
router.post("/:id/traslado", async (req, res) => {
  const evaluacion = await evaluacionPropia(req);
  exigirBorrador(evaluacion);

  // Mismo criterio que el trigger fn_valida_traslado de la base de datos
  const errorReparto = repo.validarReparto(evaluacion.id_evaluacion);
  if (errorReparto) {
    throw new HttpError(409, `No se puede trasladar: ${errorReparto}`, {
      componentes: evaluacion.componentes.map(c => ({ id_componente: c.id_componente, nombre: c.nombre, ponderacion: c.ponderacion }))
    });
  }

  const filas = await repo.calificacionesDeEvaluacion(evaluacion.id_evaluacion);
  const pendientes = filas.reduce((total, f) => total + f.pendientes, 0);
  if (pendientes > 0) {
    const mensaje = pendientes === 1
      ? "No se puede trasladar: falta 1 nota por ingresar."
      : `No se puede trasladar: faltan ${pendientes} notas por ingresar.`;
    throw new HttpError(409, mensaje, { pendientes });
  }

  res.json(await repo.trasladarEvaluacion(evaluacion.id_evaluacion));
});

module.exports = router;
