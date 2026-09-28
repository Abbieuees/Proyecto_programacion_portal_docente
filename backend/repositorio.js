/* REPOSITORIO: única capa que accede a los datos.
   Cada función equivale a la consulta SQL que tiene encima. Para usar PostgreSQL,
   reemplaza el cuerpo por esa consulta con el paquete "pg" (las rutas no cambian:
   todas las funciones ya son asíncronas, igual que las consultas reales). */

const { db } = require("./datos");
const Reglas = require("../src/js/reglas");

const copia = (fila) => ({ ...fila });
const matriculasActivas = (idGrupo) =>
  db.matriculas.filter(m => m.id_grupo === idGrupo && m.estado === "ACTIVA");

/* ---------- Docentes ---------- */

// SELECT * FROM docentes WHERE lower(correo) = lower($1)
async function buscarDocentePorCorreo(correo){
  const buscado = String(correo).trim().toLowerCase();
  const docente = db.docentes.find(d => d.correo.toLowerCase() === buscado);
  return docente ? copia(docente) : null;
}

// SELECT * FROM docentes WHERE id_docente = $1
async function buscarDocente(idDocente){
  const docente = db.docentes.find(d => d.id_docente === idDocente);
  return docente ? copia(docente) : null;
}

// SELECT id_docente, cif_docente, nombre_docente, apellido_docente, correo
// FROM docentes WHERE id_docente = $1
async function buscarPerfil(idDocente){
  const docente = await buscarDocente(idDocente);
  if (!docente) return null;
  const { contrasena_hash, ...perfil } = docente; // el hash nunca sale del servidor
  return perfil;
}

// UPDATE docentes SET contrasena_hash = $2 WHERE id_docente = $1
async function actualizarContrasena(idDocente, contrasenaHash){
  db.docentes.find(d => d.id_docente === idDocente).contrasena_hash = contrasenaHash;
}

/* ---------- Grupos ---------- */

function filaGrupo(grupo){
  const asignatura = db.asignaturas.find(a => a.id_asignatura === grupo.id_asignatura);
  return {
    ...grupo,
    codigo_asignatura: asignatura.codigo_asignatura,
    nombre_asignatura: asignatura.nombre_asignatura,
    total_estudiantes: matriculasActivas(grupo.id_grupo).length
  };
}

// SELECT g.*, a.codigo_asignatura, a.nombre_asignatura, COUNT(m.id_matricula) AS total_estudiantes
// FROM grupos g
// JOIN asignaturas a ON a.id_asignatura = g.id_asignatura
// LEFT JOIN matriculas m ON m.id_grupo = g.id_grupo AND m.estado = 'ACTIVA'
// WHERE g.id_docente = $1
// GROUP BY g.id_grupo, a.id_asignatura
// ORDER BY a.nombre_asignatura, g.codigo_grupo
async function gruposDelDocente(idDocente){
  return db.grupos
    .filter(g => g.id_docente === idDocente)
    .map(filaGrupo)
    .sort((a, b) => a.nombre_asignatura.localeCompare(b.nombre_asignatura) || a.codigo_grupo.localeCompare(b.codigo_grupo));
}

// La misma consulta anterior, con WHERE g.id_grupo = $1
async function buscarGrupo(idGrupo){
  const grupo = db.grupos.find(g => g.id_grupo === idGrupo);
  return grupo ? filaGrupo(grupo) : null;
}

// SELECT m.id_matricula, e.id_estudiante, e.cif_estudiante, e.nombre_estudiante, e.correo_institucional
// FROM matriculas m JOIN estudiantes e ON e.id_estudiante = m.id_estudiante
// WHERE m.id_grupo = $1 AND m.estado = 'ACTIVA'
// ORDER BY m.id_matricula
async function estudiantesDelGrupo(idGrupo){
  return matriculasActivas(idGrupo).map(m => {
    const e = db.estudiantes.find(x => x.id_estudiante === m.id_estudiante);
    return { id_matricula: m.id_matricula, ...e };
  });
}

/* ---------- Evaluaciones ---------- */

// SELECT * FROM evaluaciones WHERE id_grupo = $1 [AND tipo = $2] ORDER BY fecha_evaluacion
async function evaluacionesDelGrupo(idGrupo, tipo = null){
  return db.evaluaciones
    .filter(e => e.id_grupo === idGrupo && (!tipo || e.tipo === tipo))
    .sort((a, b) => a.fecha_evaluacion.localeCompare(b.fecha_evaluacion))
    .map(copia);
}

// SELECT ev.*, g.id_docente, g.codigo_grupo, a.nombre_asignatura
// FROM evaluaciones ev
// JOIN grupos g ON g.id_grupo = ev.id_grupo
// JOIN asignaturas a ON a.id_asignatura = g.id_asignatura
// WHERE ev.id_evaluacion = $1
async function buscarEvaluacion(idEvaluacion){
  const ev = db.evaluaciones.find(e => e.id_evaluacion === idEvaluacion);
  if (!ev) return null;
  const grupo = filaGrupo(db.grupos.find(g => g.id_grupo === ev.id_grupo));
  return { ...ev, id_docente: grupo.id_docente, codigo_grupo: grupo.codigo_grupo,
           nombre_asignatura: grupo.nombre_asignatura };
}

// UPDATE evaluaciones SET estado = 'TRASLADADA', fecha_traslado = now()
// WHERE id_evaluacion = $1 AND estado = 'BORRADOR'
async function trasladarEvaluacion(idEvaluacion){
  const ev = db.evaluaciones.find(e => e.id_evaluacion === idEvaluacion);
  ev.estado = "TRASLADADA";
  ev.fecha_traslado = new Date().toISOString();
  return buscarEvaluacion(idEvaluacion);
}

/* ---------- Calificaciones ---------- */

// SELECT m.id_matricula, e.id_estudiante, e.cif_estudiante, e.nombre_estudiante, c.nota
// FROM evaluaciones ev
// JOIN matriculas m ON m.id_grupo = ev.id_grupo AND m.estado = 'ACTIVA'
// JOIN estudiantes e ON e.id_estudiante = m.id_estudiante
// LEFT JOIN calificaciones c ON c.id_matricula = m.id_matricula AND c.id_evaluacion = ev.id_evaluacion
// WHERE ev.id_evaluacion = $1
// ORDER BY m.id_matricula
async function calificacionesDeEvaluacion(idEvaluacion){
  const ev = db.evaluaciones.find(e => e.id_evaluacion === idEvaluacion);
  return matriculasActivas(ev.id_grupo).map(m => {
    const e = db.estudiantes.find(x => x.id_estudiante === m.id_estudiante);
    const c = db.calificaciones.find(x => x.id_matricula === m.id_matricula && x.id_evaluacion === idEvaluacion);
    return { id_matricula: m.id_matricula, id_estudiante: e.id_estudiante, cif_estudiante: e.cif_estudiante,
             nombre_estudiante: e.nombre_estudiante, nota: c ? c.nota : null };
  });
}

// En PostgreSQL, dentro de una transacción (BEGIN ... COMMIT), por cada nota:
// INSERT INTO calificaciones (id_matricula, id_evaluacion, id_grupo, nota) VALUES ($1, $2, $3, $4)
// ON CONFLICT (id_matricula, id_evaluacion) DO UPDATE SET nota = EXCLUDED.nota
async function guardarCalificaciones(idEvaluacion, lista){
  const { id_grupo } = db.evaluaciones.find(e => e.id_evaluacion === idEvaluacion);
  for (const { id_matricula, nota } of lista) {
    const fila = db.calificaciones.find(c => c.id_matricula === id_matricula && c.id_evaluacion === idEvaluacion);
    if (fila) fila.nota = nota;
    else db.calificaciones.push({ id_calificacion: db.calificaciones.length + 1, id_matricula,
                                  id_evaluacion: idEvaluacion, id_grupo, nota });
  }
}

/* ---------- Historial ---------- */

// SELECT ev.id_evaluacion, ev.nombre, ev.tipo, ev.fecha_traslado, g.id_grupo, g.codigo_grupo, a.nombre_asignatura,
//        COUNT(m.id_matricula) AS total,
//        COUNT(*) FILTER (WHERE c.nota >= 6) AS aprobados,
//        COUNT(*) FILTER (WHERE c.nota < 6) AS reprobados,
//        ROUND(AVG(c.nota), 2) AS promedio
// FROM evaluaciones ev
// JOIN grupos g ON g.id_grupo = ev.id_grupo
// JOIN asignaturas a ON a.id_asignatura = g.id_asignatura
// JOIN matriculas m ON m.id_grupo = g.id_grupo AND m.estado = 'ACTIVA'
// LEFT JOIN calificaciones c ON c.id_matricula = m.id_matricula AND c.id_evaluacion = ev.id_evaluacion
// WHERE g.id_docente = $1 AND ev.estado = 'TRASLADADA'
// GROUP BY ev.id_evaluacion, g.id_grupo, a.nombre_asignatura
// ORDER BY ev.fecha_traslado DESC
async function historialDelDocente(idDocente){
  const idsGrupos = db.grupos.filter(g => g.id_docente === idDocente).map(g => g.id_grupo);
  const trasladadas = db.evaluaciones.filter(e => idsGrupos.includes(e.id_grupo) && e.estado === "TRASLADADA");
  const filas = await Promise.all(trasladadas.map(async (ev) => {
    const notas = (await calificacionesDeEvaluacion(ev.id_evaluacion)).map(c => c.nota).filter(n => n !== null);
    const grupo = filaGrupo(db.grupos.find(g => g.id_grupo === ev.id_grupo));
    const aprobados = notas.filter(n => n >= Reglas.NOTA_MINIMA).length;
    return {
      id_evaluacion: ev.id_evaluacion, nombre: ev.nombre, tipo: ev.tipo, fecha_traslado: ev.fecha_traslado,
      id_grupo: grupo.id_grupo, codigo_grupo: grupo.codigo_grupo, nombre_asignatura: grupo.nombre_asignatura,
      total: grupo.total_estudiantes, aprobados, reprobados: notas.length - aprobados,
      promedio: notas.length ? Math.round(notas.reduce((a, b) => a + b, 0) / notas.length * 100) / 100 : null
    };
  }));
  return filas.sort((a, b) => b.fecha_traslado.localeCompare(a.fecha_traslado));
}

module.exports = {
  buscarDocentePorCorreo, buscarDocente, buscarPerfil, actualizarContrasena,
  gruposDelDocente, buscarGrupo, estudiantesDelGrupo,
  evaluacionesDelGrupo, buscarEvaluacion, trasladarEvaluacion,
  calificacionesDeEvaluacion, guardarCalificaciones,
  historialDelDocente
};
