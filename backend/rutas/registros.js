/* /api/registros — periodos de evaluación del ciclo (requiere token)
   Es la primera pantalla del portal: el docente elige el registro en el que
   va a trabajar y dentro de él ve sus asignaturas. */

const express = require("express");
const repo = require("../repositorio");
const { leerId } = require("../acceso");
const { HttpError } = require("../errores");

const router = express.Router();

// Un registro es "propio" si el docente tiene al menos un grupo en ese ciclo.
async function registroPropio(req){
  const registro = await repo.buscarRegistro(leerId(req.params.id));
  if (!registro) throw new HttpError(404, "Registro no encontrado.");
  const grupos = await repo.gruposDelDocente(req.idDocente, registro.id_ciclo);
  if (grupos.length === 0) throw new HttpError(403, "No tienes grupos en el ciclo de este registro.");
  return { registro, grupos };
}

// GET /api/registros
router.get("/", async (req, res) => {
  res.json(await repo.registrosDelDocente(req.idDocente));
});

// GET /api/registros/:id
router.get("/:id", async (req, res) => {
  const { registro } = await registroPropio(req);
  res.json(registro);
});

// GET /api/registros/:id/grupos — las asignaturas del docente dentro del registro,
// cada una con cuántas de sus evaluaciones ya se trasladaron.
router.get("/:id/grupos", async (req, res) => {
  const { registro, grupos } = await registroPropio(req);

  const filas = await Promise.all(grupos.map(async (grupo) => {
    const evaluaciones = await repo.evaluacionesDelGrupo(grupo.id_grupo, { idRegistro: registro.id_registro });
    const reparto = evaluaciones.reduce((total, e) => total + e.ponderacion, 0);
    return {
      ...grupo,
      total_evaluaciones: evaluaciones.length,
      trasladadas: evaluaciones.filter(e => e.estado === "TRASLADADA").length,
      reparto,                       // debe llegar a 100 antes de cerrar el registro
      reparto_completo: reparto === 100
    };
  }));

  res.json(filas);
});

module.exports = router;
