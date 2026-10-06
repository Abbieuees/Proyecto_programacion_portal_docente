/* REPOSITORIO: única capa que accede a los datos.
   Cada función equivale a la consulta SQL que tiene encima. Para usar PostgreSQL,
   reemplaza el cuerpo por esa consulta con el paquete "pg" (las rutas no cambian:
   todas las funciones ya son asíncronas, igual que las consultas reales).

   Varias consultas ya están escritas contra las vistas de docs/script_base_datos.sql
   (v_registros_docente, v_grupos_docente, v_carga_notas, v_nota_ciclo, v_cum_estudiante):
   al migrar, el SELECT es casi literal. */

const { db } = require("./datos");
const Reglas = require("../src/js/reglas");

const copia = (fila) => ({ ...fila });
const matriculasActivas = (idGrupo) =>
  db.matriculas.filter(m => m.id_grupo === idGrupo && m.estado === "ACTIVA");

// NUMERIC(4,2) redondea los medios alejándose de cero. En JavaScript el binario
// puede caer del otro lado, así que la base de datos manda: esto es solo para mostrar.
const redondear2 = (valor) => Math.round(valor * 100) / 100;

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

/* ---------- Registros (periodos del ciclo) ----------
   Es la primera pantalla: el docente elige en qué registro va a trabajar. */

// SELECT * FROM v_registros_docente WHERE id_docente = $1
// ORDER BY codigo_ciclo DESC, numero
async function registrosDelDocente(idDocente){
  const ciclosDelDocente = new Set(
    db.grupos.filter(g => g.id_docente === idDocente).map(g => g.id_ciclo)
  );
  return db.registros
    .filter(r => ciclosDelDocente.has(r.id_ciclo))
    .map(r => {
      const ciclo = db.ciclos.find(c => c.id_ciclo === r.id_ciclo);
      return { ...r, codigo_ciclo: ciclo.codigo_ciclo, estado_ciclo: ciclo.estado };
    })
    .sort((a, b) => b.codigo_ciclo.localeCompare(a.codigo_ciclo) || a.numero - b.numero);
}

// SELECT * FROM registros WHERE id_registro = $1
async function buscarRegistro(idRegistro){
  const registro = db.registros.find(r => r.id_registro === idRegistro);
  if (!registro) return null;
  const ciclo = db.ciclos.find(c => c.id_ciclo === registro.id_ciclo);
  return { ...registro, codigo_ciclo: ciclo.codigo_ciclo, estado_ciclo: ciclo.estado };
}

/* ---------- Grupos ---------- */

function filaGrupo(grupo){
  const asignatura = db.asignaturas.find(a => a.id_asignatura === grupo.id_asignatura);
  const ciclo = db.ciclos.find(c => c.id_ciclo === grupo.id_ciclo);
  return {
    ...grupo,
    codigo_asignatura: asignatura.codigo_asignatura,
    nombre_asignatura: asignatura.nombre_asignatura,
    unidades_valorativas: asignatura.unidades_valorativas,
    codigo_ciclo: ciclo.codigo_ciclo,
    total_estudiantes: matriculasActivas(grupo.id_grupo).length
  };
}

// SELECT * FROM v_grupos_docente WHERE id_docente = $1 [AND id_ciclo = $2]
// ORDER BY nombre_asignatura, codigo_grupo
async function gruposDelDocente(idDocente, idCiclo = null){
  return db.grupos
    .filter(g => g.id_docente === idDocente && (idCiclo === null || g.id_ciclo === idCiclo))
    .map(filaGrupo)
    .sort((a, b) => a.nombre_asignatura.localeCompare(b.nombre_asignatura) || a.codigo_grupo.localeCompare(b.codigo_grupo));
}

// La misma consulta anterior, con WHERE id_grupo = $1
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

/* ---------- Evaluaciones y sus componentes ---------- */

// SELECT * FROM componentes_evaluacion WHERE id_evaluacion = $1 ORDER BY orden
function componentesDe(idEvaluacion){
  return db.componentes
    .filter(c => c.id_evaluacion === idEvaluacion)
    .sort((a, b) => a.orden - b.orden)
    .map(copia);
}

// SELECT * FROM evaluaciones
// WHERE id_grupo = $1 [AND id_registro = $2] [AND tipo = $3]
// ORDER BY fecha_evaluacion
async function evaluacionesDelGrupo(idGrupo, { tipo = null, idRegistro = null } = {}){
  return db.evaluaciones
    .filter(e => e.id_grupo === idGrupo
              && (!tipo || e.tipo === tipo)
              && (idRegistro === null || e.id_registro === idRegistro))
    .sort((a, b) => a.fecha_evaluacion.localeCompare(b.fecha_evaluacion))
    .map(e => ({ ...e, componentes: componentesDe(e.id_evaluacion) }));
}

// SELECT ev.*, g.id_docente, g.codigo_grupo, g.nota_minima, a.nombre_asignatura, r.nombre AS nombre_registro
// FROM evaluaciones ev
// JOIN grupos g    ON g.id_grupo = ev.id_grupo
// JOIN asignaturas a ON a.id_asignatura = g.id_asignatura
// JOIN registros r ON r.id_registro = ev.id_registro
// WHERE ev.id_evaluacion = $1
async function buscarEvaluacion(idEvaluacion){
  const ev = db.evaluaciones.find(e => e.id_evaluacion === idEvaluacion);
  if (!ev) return null;
  const grupo = filaGrupo(db.grupos.find(g => g.id_grupo === ev.id_grupo));
  const registro = db.registros.find(r => r.id_registro === ev.id_registro);
  return {
    ...ev,
    id_docente: grupo.id_docente,
    codigo_grupo: grupo.codigo_grupo,
    nombre_asignatura: grupo.nombre_asignatura,
    nota_minima: grupo.nota_minima,
    nombre_registro: registro.nombre,
    ponderacion_registro: registro.ponderacion,
    componentes: componentesDe(idEvaluacion)
  };
}

// Equivale al trigger fn_valida_traslado: una evaluación solo se traslada si
// tiene componentes y si éstos se reparten exactamente el 100 %.
// Devuelve el mensaje de error, o "" si el reparto es válido.
function validarReparto(idEvaluacion){
  const comps = componentesDe(idEvaluacion);
  if (comps.length === 0) return "La evaluación no tiene componentes: no hay nada que trasladar.";
  const suma = comps.reduce((total, c) => total + c.ponderacion, 0);
  if (suma !== 100) return `Los componentes de la evaluación suman ${suma}%, deben sumar 100%.`;
  return "";
}

// UPDATE evaluaciones SET estado = 'TRASLADADA', fecha_traslado = now()
// WHERE id_evaluacion = $1 AND estado = 'BORRADOR'
async function trasladarEvaluacion(idEvaluacion){
  const ev = db.evaluaciones.find(e => e.id_evaluacion === idEvaluacion);
  ev.estado = "TRASLADADA";
  ev.fecha_traslado = new Date().toISOString();
  return buscarEvaluacion(idEvaluacion);
}

/* ---------- Rollup de notas: componente -> evaluacion -> registro -> ciclo ----------
   En los tres niveles se divide entre la ponderación REALMENTE calificada, no entre
   el total: lo que todavía no se evalúa no castiga el promedio. Son las vistas
   v_nota_evaluacion, v_nota_registro y v_nota_ciclo. */

function notaDeEvaluacion(idMatricula, idEvaluacion){
  let acumulado = 0, peso = 0;
  for (const c of componentesDe(idEvaluacion)) {
    const cal = db.calificaciones.find(x => x.id_matricula === idMatricula && x.id_componente === c.id_componente);
    if (cal && cal.nota !== null) { acumulado += cal.nota * c.ponderacion; peso += c.ponderacion; }
  }
  return peso ? redondear2(acumulado / peso) : null;
}

function notaDeRegistro(idMatricula, idRegistro, idGrupo){
  let acumulado = 0, peso = 0;
  for (const ev of db.evaluaciones.filter(e => e.id_registro === idRegistro && e.id_grupo === idGrupo)) {
    const nota = notaDeEvaluacion(idMatricula, ev.id_evaluacion);
    if (nota !== null) { acumulado += nota * ev.ponderacion; peso += ev.ponderacion; }
  }
  return { nota: peso ? redondear2(acumulado / peso) : null, ponderacion_calificada: peso };
}

// SELECT * FROM v_nota_ciclo WHERE id_matricula = $1
function notaDeCiclo(idMatricula, idGrupo){
  const grupo = db.grupos.find(g => g.id_grupo === idGrupo);
  let acumulado = 0, peso = 0;
  for (const r of db.registros.filter(r => r.id_ciclo === grupo.id_ciclo)) {
    const { nota } = notaDeRegistro(idMatricula, r.id_registro, idGrupo);
    if (nota !== null) { acumulado += nota * r.ponderacion; peso += r.ponderacion; }
  }
  return { nota_proyectada: peso ? redondear2(acumulado / peso) : null, ponderacion_calificada: peso };
}

// Nota de cada estudiante del grupo en un registro (pantalla de resumen del registro)
async function notasDelRegistro(idGrupo, idRegistro){
  return matriculasActivas(idGrupo).map(m => {
    const e = db.estudiantes.find(x => x.id_estudiante === m.id_estudiante);
    const { nota, ponderacion_calificada } = notaDeRegistro(m.id_matricula, idRegistro, idGrupo);
    return {
      id_matricula: m.id_matricula, cif_estudiante: e.cif_estudiante, nombre_estudiante: e.nombre_estudiante,
      nota, ponderacion_calificada, estado: Reglas.estadoDeNota(nota),
      ...notaDeCiclo(m.id_matricula, idGrupo)
    };
  });
}

/* ---------- Calificaciones ----------
   Una nota vive en el COMPONENTE, no en la evaluación. PENDIENTE no se guarda como
   fila con nota NULL: simplemente no existe la fila (igual que en la base). */

// SELECT * FROM v_carga_notas WHERE id_evaluacion = $1 ORDER BY nombre_estudiante, orden
async function calificacionesDeEvaluacion(idEvaluacion){
  const ev = db.evaluaciones.find(e => e.id_evaluacion === idEvaluacion);
  const comps = componentesDe(idEvaluacion);
  return matriculasActivas(ev.id_grupo).map(m => {
    const e = db.estudiantes.find(x => x.id_estudiante === m.id_estudiante);
    const notas = {};
    for (const c of comps) {
      const cal = db.calificaciones.find(x => x.id_matricula === m.id_matricula && x.id_componente === c.id_componente);
      notas[c.id_componente] = cal ? cal.nota : null;
    }
    const nota = notaDeEvaluacion(m.id_matricula, idEvaluacion);
    return {
      id_matricula: m.id_matricula, id_estudiante: e.id_estudiante,
      cif_estudiante: e.cif_estudiante, nombre_estudiante: e.nombre_estudiante,
      notas,                                              // { id_componente: nota | null }
      pendientes: comps.filter(c => notas[c.id_componente] === null).length,
      nota,                                               // nota ponderada de la evaluación
      estado: Reglas.estadoDeNota(nota)
    };
  });
}

// En PostgreSQL, dentro de una transacción (BEGIN ... COMMIT), por cada nota:
//   nota con valor -> INSERT INTO calificaciones (id_matricula, id_componente, id_grupo, nota)
//                     VALUES ($1,$2,$3,$4)
//                     ON CONFLICT (id_matricula, id_componente) DO UPDATE SET nota = EXCLUDED.nota
//   nota en null   -> DELETE FROM calificaciones WHERE id_matricula = $1 AND id_componente = $2
// El trigger trg_audita_calificacion llena calificaciones_historial por su cuenta;
// aquí se hace a mano para que el historial funcione igual con datos en memoria.
async function guardarCalificaciones(idEvaluacion, lista, idDocente = null){
  const { id_grupo } = db.evaluaciones.find(e => e.id_evaluacion === idEvaluacion);

  for (const { id_matricula, notas } of lista) {
    for (const [idComponenteTexto, nota] of Object.entries(notas)) {
      const id_componente = Number(idComponenteTexto);
      const indice = db.calificaciones.findIndex(c => c.id_matricula === id_matricula && c.id_componente === id_componente);
      const anterior = indice >= 0 ? db.calificaciones[indice].nota : null;

      if (nota === null || nota === "") {
        if (indice >= 0) {
          db.calificaciones.splice(indice, 1);
          auditar({ id_matricula, id_componente, operacion: "DELETE", anterior, nueva: null, idDocente });
        }
      } else if (indice >= 0) {
        if (db.calificaciones[indice].nota !== nota) {
          db.calificaciones[indice].nota = nota;
          auditar({ id_matricula, id_componente, operacion: "UPDATE", anterior, nueva: nota, idDocente });
        }
      } else {
        db.calificaciones.push({ id_calificacion: db.calificaciones.length + 1, id_matricula, id_componente, id_grupo, nota });
        auditar({ id_matricula, id_componente, operacion: "INSERT", anterior: null, nueva: nota, idDocente });
      }
    }
  }
}

function auditar({ id_matricula, id_componente, operacion, anterior, nueva, idDocente }){
  db.historial.push({
    id_historial: db.historial.length + 1, id_matricula, id_componente, operacion,
    nota_anterior: anterior, nota_nueva: nueva, id_docente: idDocente,
    fecha_cambio: new Date().toISOString()
  });
}

/* ---------- Historial ---------- */

// SELECT ev.id_evaluacion, ev.nombre, ev.tipo, ev.fecha_traslado, r.nombre AS nombre_registro,
//        g.id_grupo, g.codigo_grupo, a.nombre_asignatura, ...
// FROM evaluaciones ev
// JOIN grupos g    ON g.id_grupo = ev.id_grupo
// JOIN asignaturas a ON a.id_asignatura = g.id_asignatura
// JOIN registros r ON r.id_registro = ev.id_registro
// WHERE g.id_docente = $1 AND ev.estado = 'TRASLADADA'
// ORDER BY ev.fecha_traslado DESC
// (los conteos salen de v_nota_evaluacion, que ya pondera los componentes)
async function historialDelDocente(idDocente){
  const idsGrupos = db.grupos.filter(g => g.id_docente === idDocente).map(g => g.id_grupo);
  const trasladadas = db.evaluaciones.filter(e => idsGrupos.includes(e.id_grupo) && e.estado === "TRASLADADA");

  const filas = trasladadas.map((ev) => {
    const grupo = filaGrupo(db.grupos.find(g => g.id_grupo === ev.id_grupo));
    const registro = db.registros.find(r => r.id_registro === ev.id_registro);
    const notas = matriculasActivas(ev.id_grupo)
      .map(m => notaDeEvaluacion(m.id_matricula, ev.id_evaluacion))
      .filter(n => n !== null);
    const aprobados = notas.filter(n => n >= grupo.nota_minima).length;
    return {
      id_evaluacion: ev.id_evaluacion, nombre: ev.nombre, tipo: ev.tipo, fecha_traslado: ev.fecha_traslado,
      id_registro: ev.id_registro, nombre_registro: registro.nombre,
      id_grupo: grupo.id_grupo, codigo_grupo: grupo.codigo_grupo, nombre_asignatura: grupo.nombre_asignatura,
      total: grupo.total_estudiantes, aprobados, reprobados: notas.length - aprobados,
      promedio: notas.length ? redondear2(notas.reduce((a, b) => a + b, 0) / notas.length) : null
    };
  });
  return filas.sort((a, b) => b.fecha_traslado.localeCompare(a.fecha_traslado));
}

/* ---------- CUM (Coeficiente de Unidades de Merito) ----------
       CUM = SUM(nota ganada x UV) / SUM(UV)
   Solo cuentan las matriculas cerradas (FINALIZADA), porque su nota_final ya esta
   congelada. El CUM no se guarda en ninguna columna: se calcula siempre. */

// SELECT * FROM v_record_academico WHERE id_estudiante = $1 ORDER BY ciclo
async function recordAcademico(idEstudiante){
  return db.matriculas
    .filter(m => m.id_estudiante === idEstudiante && m.estado === "FINALIZADA")
    .map(m => {
      const grupo = db.grupos.find(g => g.id_grupo === m.id_grupo);
      const asignatura = db.asignaturas.find(a => a.id_asignatura === grupo.id_asignatura);
      const ciclo = db.ciclos.find(c => c.id_ciclo === grupo.id_ciclo);
      return {
        ciclo: ciclo.codigo_ciclo,
        codigo_asignatura: asignatura.codigo_asignatura,
        nombre_asignatura: asignatura.nombre_asignatura,
        nota_ganada: m.nota_final,
        uv: asignatura.unidades_valorativas,
        unidades_merito: redondear2(m.nota_final * asignatura.unidades_valorativas),
        aprobada: m.nota_final >= grupo.nota_minima
      };
    })
    .sort((a, b) => a.ciclo.localeCompare(b.ciclo) || a.nombre_asignatura.localeCompare(b.nombre_asignatura));
}

// SELECT * FROM v_cum_estudiante WHERE id_estudiante = $1
async function cumDelEstudiante(idEstudiante){
  const estudiante = db.estudiantes.find(e => e.id_estudiante === idEstudiante);
  if (!estudiante) return null;
  const record = await recordAcademico(idEstudiante);
  const totalUv = record.reduce((total, f) => total + f.uv, 0);
  const totalUm = record.reduce((total, f) => total + f.unidades_merito, 0);
  return {
    id_estudiante: idEstudiante,
    cif_estudiante: estudiante.cif_estudiante,
    nombre_estudiante: estudiante.nombre_estudiante,
    asignaturas_cursadas: record.length,
    asignaturas_aprobadas: record.filter(f => f.aprobada).length,
    asignaturas_reprobadas: record.filter(f => !f.aprobada).length,
    total_uv: totalUv,
    total_unidades_merito: redondear2(totalUm),
    cum: totalUv ? redondear2(totalUm / totalUv) : null,
    record
  };
}

module.exports = {
  buscarDocentePorCorreo, buscarDocente, buscarPerfil, actualizarContrasena,
  registrosDelDocente, buscarRegistro,
  gruposDelDocente, buscarGrupo, estudiantesDelGrupo,
  evaluacionesDelGrupo, buscarEvaluacion, componentesDe, validarReparto, trasladarEvaluacion,
  notaDeEvaluacion, notaDeRegistro, notaDeCiclo, notasDelRegistro,
  calificacionesDeEvaluacion, guardarCalificaciones,
  historialDelDocente,
  recordAcademico, cumDelEstudiante
};
