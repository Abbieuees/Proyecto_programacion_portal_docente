/* /api/estudiantes — expediente y CUM de un estudiante (requiere token)

   CUM = SUM(nota ganada x UV) / SUM(UV), sobre las asignaturas ya cerradas.
   No se guarda en ninguna columna: se calcula siempre a partir de la nota que
   quedó congelada en cada matrícula al cerrarla. */

const express = require("express");
const repo = require("../repositorio");
const { leerId } = require("../acceso");
const { HttpError } = require("../errores");

const router = express.Router();

// El docente solo puede consultar a estudiantes inscritos en alguno de sus grupos.
async function estudiantePropio(req){
  const idEstudiante = leerId(req.params.id);
  const grupos = await repo.gruposDelDocente(req.idDocente);

  for (const grupo of grupos) {
    const nomina = await repo.estudiantesDelGrupo(grupo.id_grupo);
    if (nomina.some(e => e.id_estudiante === idEstudiante)) return idEstudiante;
  }
  throw new HttpError(403, "Este estudiante no está inscrito en ninguno de tus grupos.");
}

// GET /api/estudiantes/:id/cum
router.get("/:id/cum", async (req, res) => {
  const idEstudiante = await estudiantePropio(req);
  const cum = await repo.cumDelEstudiante(idEstudiante);
  if (!cum) throw new HttpError(404, "Estudiante no encontrado.");
  res.json(cum);
});

module.exports = router;
