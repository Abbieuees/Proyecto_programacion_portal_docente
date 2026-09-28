/* Comprobaciones comunes de las rutas: id válido y que el recurso sea del docente de la sesión. */

const repo = require("./repositorio");
const { HttpError } = require("./errores");

function leerId(valor){
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "El id debe ser un número entero positivo.");
  return id;
}

async function grupoPropio(req){
  const grupo = await repo.buscarGrupo(leerId(req.params.id));
  if (!grupo) throw new HttpError(404, "Grupo no encontrado.");
  if (grupo.id_docente !== req.idDocente) throw new HttpError(403, "No tienes acceso a este grupo.");
  return grupo;
}

async function evaluacionPropia(req){
  const evaluacion = await repo.buscarEvaluacion(leerId(req.params.id));
  if (!evaluacion) throw new HttpError(404, "Evaluación no encontrada.");
  if (evaluacion.id_docente !== req.idDocente) throw new HttpError(403, "No tienes acceso a esta evaluación.");
  return evaluacion;
}

module.exports = { leerId, grupoPropio, evaluacionPropia };
