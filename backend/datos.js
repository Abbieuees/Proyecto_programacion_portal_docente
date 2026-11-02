/* BASE DE DATOS SIMULADA (en memoria)
   Mismas tablas y columnas que docs/script_base_datos.sql. Los datos se reinician
   cada vez que arranca el servidor. Al pasar a PostgreSQL este archivo deja de usarse.

   ESTRUCTURA (tres niveles de ponderacion, cada uno suma 100):
     ciclo -> registros (30/30/40) -> evaluaciones (% del registro)
                                   -> componentes  (% de la evaluacion)  <- aqui la nota */

// Hashes de las contraseñas de prueba (las contraseñas están en el README, no aquí)
const HASH_DOCENTE = "scrypt$b26562c56fade2b89895927663a7dbfb$f14160d61089d8084646308242fff2feddbb2d521b7de4dcd430636089b3a10fd552f5a7ac708d2c482fe030b0335661110ece5fc28d1ffebb7828af131ad2f5";
const HASH_INVITADO = "scrypt$54e9c526c5810ad86e7478940f5c9c83$86667c238a243f675bd2ab551b1e9210015995dc71eb39935feff14fd5b90a095ec9d22ee7a66121ef7790f403647c65308093711e2b56a7520073464f52627d";

// Nóminas de los mockups (los CIF se asignan en orden a partir del primero)
const NOMINA_BD = [
  "Abbie Córdova", "Jackie Bolaños", "Edgar González", "Mariana García", "Laura Martínez",
  "Ana Reyes", "Carlos Pineda", "Diana Flores", "Elmer Ruiz", "Fátima Chávez",
  "Gabriel Hernández", "Hilda López", "Iván Rivas", "Julia Mejía", "Kevin Castillo",
  "Lucía Romero", "Mario Ayala", "Nadia Portillo", "Óscar Guevara", "Paola Rosales",
  "Rodrigo Orellana", "Sofía Cruz"
];
const NOMINA_PW = [
  "Tomás Aguilar", "Valeria Menjívar", "Walter Campos", "Andrea Molina", "Bryan Alvarenga",
  "Camila Serrano", "Daniel Quintanilla", "Elena Barahona", "Fernando Cáceres", "Gabriela Vásquez",
  "Héctor Linares", "Isabel Sorto", "Jorge Villalta", "Karla Henríquez", "Luis Escobar",
  "María Fuentes", "Nelson Argueta", "Patricia Bonilla", "Raúl Contreras", "Sara Palacios",
  "Samuel Recinos", "Tatiana Marroquín", "Uriel Salazar", "Vanessa Duarte", "William Arévalo",
  "Ximena Galdámez", "Yesenia Ramos"
];

// Notas de ejemplo entre 5.0 y 10.0 (siempre las mismas) para componentes ya calificados
function notasDeEjemplo(cantidad, semilla){
  return Array.from({ length: cantidad }, (_, i) => ((i * 37 + semilla * 13) % 51 + 50) / 10);
}

function crearDatosIniciales(){
  const docentes = [
    { id_docente: 1, cif_docente: "D2026001", nombre_docente: "Docente", apellido_docente: "UEES",
      correo: "docente@uees.edu.sv", contrasena_hash: HASH_DOCENTE, activo: true },
    // Segundo docente: solo sirve para comprobar que nadie ve los grupos de otro
    { id_docente: 2, cif_docente: "D2026002", nombre_docente: "Docente", apellido_docente: "Invitado",
      correo: "docente.invitado@uees.edu.sv", contrasena_hash: HASH_INVITADO, activo: true }
  ];

  // unidades_valorativas: el peso de la asignatura en el pensum (la 'UV' del CUM).
  // OJO: confirmar estos valores contra el plan de estudios oficial.
  const asignaturas = [
    { id_asignatura: 1, codigo_asignatura: "BD",     nombre_asignatura: "Base de datos",                unidades_valorativas: 4 },
    { id_asignatura: 2, codigo_asignatura: "PW",     nombre_asignatura: "Programación web",             unidades_valorativas: 4 },
    { id_asignatura: 3, codigo_asignatura: "MAT-I",  nombre_asignatura: "Matemática I",                 unidades_valorativas: 5 },
    { id_asignatura: 4, codigo_asignatura: "CONT-I", nombre_asignatura: "Contabilidad I",               unidades_valorativas: 4 },
    { id_asignatura: 5, codigo_asignatura: "SOC-I",  nombre_asignatura: "Sociología I",                 unidades_valorativas: 3 },
    { id_asignatura: 6, codigo_asignatura: "ECO-I",  nombre_asignatura: "Introducción a la Economía I", unidades_valorativas: 4 }
  ];

  const ciclos = [
    { id_ciclo: 1, codigo_ciclo: "01-2026", fecha_inicio: "2026-01-12", fecha_fin: "2026-06-20", estado: "CERRADO" },
    { id_ciclo: 2, codigo_ciclo: "02-2026", fecha_inicio: "2026-07-20", fecha_fin: "2026-12-05", estado: "ABIERTO" }
  ];

  // Tres registros por ciclo: 30 / 30 / 40 = 100 % del ciclo
  const registros = [
    { id_registro: 1, id_ciclo: 1, numero: 1, nombre: "Registro 1", ponderacion: 30, fecha_inicio: "2026-01-12", fecha_fin: "2026-02-28", estado: "CERRADO" },
    { id_registro: 2, id_ciclo: 1, numero: 2, nombre: "Registro 2", ponderacion: 30, fecha_inicio: "2026-03-01", fecha_fin: "2026-04-30", estado: "CERRADO" },
    { id_registro: 3, id_ciclo: 1, numero: 3, nombre: "Registro 3", ponderacion: 40, fecha_inicio: "2026-05-01", fecha_fin: "2026-06-20", estado: "CERRADO" },
    { id_registro: 4, id_ciclo: 2, numero: 1, nombre: "Registro 1", ponderacion: 30, fecha_inicio: "2026-07-20", fecha_fin: "2026-09-05", estado: "ABIERTO" },
    { id_registro: 5, id_ciclo: 2, numero: 2, nombre: "Registro 2", ponderacion: 30, fecha_inicio: "2026-09-08", fecha_fin: "2026-10-24", estado: "ABIERTO" },
    { id_registro: 6, id_ciclo: 2, numero: 3, nombre: "Registro 3", ponderacion: 40, fecha_inicio: "2026-10-27", fecha_fin: "2026-12-05", estado: "ABIERTO" }
  ];

  const grupos = [
    // Ciclo en curso
    { id_grupo: 1, id_docente: 1, id_asignatura: 1, id_ciclo: 2, codigo_grupo: "BD-01", horario: "Lunes y miércoles 07:00-08:40", nota_minima: 6 },
    { id_grupo: 2, id_docente: 1, id_asignatura: 2, id_ciclo: 2, codigo_grupo: "PW-01", horario: "Martes y jueves 07:00-08:40",   nota_minima: 6 },
    { id_grupo: 3, id_docente: 2, id_asignatura: 1, id_ciclo: 2, codigo_grupo: "BD-02", horario: "Viernes 13:00-16:20",           nota_minima: 6 },
    // Ciclo anterior ya cerrado: solo alimenta el CUM, por eso no tiene evaluaciones
    { id_grupo: 4, id_docente: 2, id_asignatura: 3, id_ciclo: 1, codigo_grupo: "MAT-01",  horario: "Lunes y miércoles 09:00-10:40", nota_minima: 6 },
    { id_grupo: 5, id_docente: 2, id_asignatura: 4, id_ciclo: 1, codigo_grupo: "CONT-01", horario: "Martes y jueves 09:00-10:40",   nota_minima: 6 },
    { id_grupo: 6, id_docente: 2, id_asignatura: 5, id_ciclo: 1, codigo_grupo: "SOC-01",  horario: "Viernes 07:00-09:40",           nota_minima: 6 },
    { id_grupo: 7, id_docente: 2, id_asignatura: 6, id_ciclo: 1, codigo_grupo: "ECO-01",  horario: "Viernes 10:00-12:40",           nota_minima: 6 }
  ];

  /* ---- Evaluaciones y componentes ----
     Cada registro lleva su propia tanda de tareas/actividades mas su parcial, y el
     docente reparte el 100 % DE ESE REGISTRO entre ellas. Por eso 'Tarea 1' y
     'Parcial' se repiten de un registro a otro dentro del mismo grupo. */
  const evaluaciones = [];
  const componentes = [];

  // partes: [[nombre, ponderacion], ...]; una sola parte = nota unica al 100 %
  function crearEvaluacion(idGrupo, idRegistro, nombre, tipo, ponderacion, fecha, limite, partes, estado = "BORRADOR"){
    const grupo = grupos.find(g => g.id_grupo === idGrupo);
    const ev = {
      id_evaluacion: evaluaciones.length + 1, id_grupo: idGrupo, id_registro: idRegistro,
      id_ciclo: grupo.id_ciclo, nombre, tipo, ponderacion,
      fecha_evaluacion: fecha, fecha_limite: limite, estado,
      fecha_traslado: estado === "TRASLADADA" ? `${limite}T16:00:00.000Z` : null
    };
    evaluaciones.push(ev);
    partes.forEach(([nombreParte, peso], i) => componentes.push({
      id_componente: componentes.length + 1, id_evaluacion: ev.id_evaluacion,
      id_grupo: idGrupo, nombre: nombreParte, ponderacion: peso, orden: i + 1
    }));
    return ev.id_evaluacion;
  }

  const UNICA = [["Nota única", 100]];
  const AVANCES = [["Avance 1", 50], ["Avance 2", 50]];
  const TEO_PRA = [["Teórico", 60], ["Práctico", 40]];

  // BD-01 (grupo 1) — Registro 1: 30 + 30 + 40 = 100
  crearEvaluacion(1, 4, "Tarea 1", "TAREA",   30, "2026-08-10", "2026-08-14", AVANCES, "TRASLADADA");
  crearEvaluacion(1, 4, "Tarea 2", "TAREA",   30, "2026-08-12", "2026-08-16", UNICA,   "TRASLADADA");
  crearEvaluacion(1, 4, "Parcial", "PARCIAL", 40, "2026-08-15", "2026-08-21", TEO_PRA);
  // BD-01 — Registro 2: 25 + 25 + 50 = 100
  crearEvaluacion(1, 5, "Tarea 1",     "TAREA",   25, "2026-09-14", "2026-09-18", UNICA);
  crearEvaluacion(1, 5, "Actividad 1", "TAREA",   25, "2026-09-28", "2026-10-02", UNICA);
  crearEvaluacion(1, 5, "Parcial",     "PARCIAL", 50, "2026-10-15", "2026-10-21", TEO_PRA);
  // BD-01 — Registro 3: 60 + 40 = 100
  crearEvaluacion(1, 6, "Proyecto", "PROYECTO", 60, "2026-11-10", "2026-11-20", AVANCES);
  crearEvaluacion(1, 6, "Parcial",  "PARCIAL",  40, "2026-11-28", "2026-12-04", UNICA);

  // PW-01 (grupo 2) — Registro 1: 40 + 60 = 100
  crearEvaluacion(2, 4, "Tarea 1", "TAREA",   40, "2026-08-11", "2026-08-15", UNICA, "TRASLADADA");
  crearEvaluacion(2, 4, "Parcial", "PARCIAL", 60, "2026-08-16", "2026-08-22", [["Teórico", 70], ["Práctico", 30]]);
  // PW-01 — Registro 2: 50 + 50 = 100
  crearEvaluacion(2, 5, "Tarea 1", "TAREA",   50, "2026-09-15", "2026-09-19", UNICA);
  crearEvaluacion(2, 5, "Parcial", "PARCIAL", 50, "2026-10-16", "2026-10-22", TEO_PRA);
  // PW-01 — Registro 3: 100
  crearEvaluacion(2, 6, "Proyecto Final", "PROYECTO", 100, "2026-11-12", "2026-11-25", AVANCES);

  // BD-02 (grupo 3, del otro docente) — solo para las pruebas de autorización
  crearEvaluacion(3, 4, "Tarea 1", "TAREA", 100, "2026-08-10", "2026-08-14", UNICA);

  /* ---- Estudiantes y matrículas ---- */
  const estudiantes = [];
  const matriculas = [];

  function inscribir(nombres, primerCif, idGrupo, estado = "ACTIVA", notaFinal = null){
    nombres.forEach((nombre, i) => {
      const cif = String(primerCif + i);
      let estudiante = estudiantes.find(e => e.cif_estudiante === cif);
      if (!estudiante) {
        estudiante = { id_estudiante: estudiantes.length + 1, nombre_estudiante: nombre,
                       cif_estudiante: cif, correo_institucional: `${cif}@uees.edu.sv` };
        estudiantes.push(estudiante);
      }
      matriculas.push({
        id_matricula: matriculas.length + 1, id_estudiante: estudiante.id_estudiante,
        id_grupo: idGrupo, fecha_matricula: "2026-07-20", estado,
        // 'Nota ganada en el ciclo': se congela al cerrar y es la que alimenta el CUM
        nota_final: notaFinal,
        fecha_cierre: notaFinal === null ? null : "2026-06-15T18:00:00.000Z"
      });
    });
  }

  inscribir(NOMINA_BD, 2025010212, 1);
  inscribir(NOMINA_PW, 2025010300, 2);
  inscribir(NOMINA_PW.slice(0, 2), 2025010300, 3);

  // Expediente del ciclo 01-2026, ya cerrado. Reproduce el ejemplo del instructivo
  // del CUM: 9.0x5 + 7.4x4 + 8.2x3 + 6.3x4 = 124.4 ; 124.4 / 16 = 7.78
  [[4, 9.0], [5, 7.4], [6, 8.2], [7, 6.3]].forEach(([idGrupo, nota]) =>
    inscribir([NOMINA_BD[0]], 2025010212, idGrupo, "FINALIZADA", nota));
  // Jackie cursa solo dos: 6.0x5 + 8.0x4 = 62.0 ; 62.0 / 9 = 6.89
  [[4, 6.0], [5, 8.0]].forEach(([idGrupo, nota]) =>
    inscribir([NOMINA_BD[1]], 2025010213, idGrupo, "FINALIZADA", nota));

  /* ---- Calificaciones (cuelgan del componente, no de la evaluación) ---- */
  const calificaciones = [];

  // Califica un componente completo, en el orden de la nómina del grupo.
  // notas más cortas que la nómina dejan al resto PENDIENTE (sin fila).
  function calificar(idComponente, notas){
    const comp = componentes.find(c => c.id_componente === idComponente);
    const delGrupo = matriculas.filter(m => m.id_grupo === comp.id_grupo && m.estado === "ACTIVA");
    notas.forEach((nota, i) => {
      if (nota === null || nota === undefined || !delGrupo[i]) return;
      calificaciones.push({
        id_calificacion: calificaciones.length + 1, id_matricula: delGrupo[i].id_matricula,
        id_componente: idComponente, id_grupo: comp.id_grupo, nota
      });
    });
  }

  // Todos los componentes de las evaluaciones ya trasladadas van completos
  componentes
    .filter(c => evaluaciones.find(e => e.id_evaluacion === c.id_evaluacion).estado === "TRASLADADA")
    .forEach(c => {
      const total = matriculas.filter(m => m.id_grupo === c.id_grupo && m.estado === "ACTIVA").length;
      calificar(c.id_componente, notasDeEjemplo(total, c.id_componente));
    });

  // BD-01 / Registro 1 / Parcial (componentes 4 y 5): los tres primeros calificados,
  // el resto PENDIENTE, igual que el mockup
  calificar(4, [8.5, 9.2, 3.0]);
  calificar(5, [8.5, 9.2, 4.25]);

  // BD-01 / Registro 2 / Tarea 1 y Actividad 1: nómina completa
  calificar(componentes.find(c => c.id_evaluacion === 4).id_componente, notasDeEjemplo(NOMINA_BD.length, 7));
  calificar(componentes.find(c => c.id_evaluacion === 5).id_componente, notasDeEjemplo(NOMINA_BD.length, 8));

  return { ciclos, registros, docentes, asignaturas, grupos, evaluaciones,
           componentes, estudiantes, matriculas, calificaciones, historial: [] };
}

const db = crearDatosIniciales();

// Vuelve a los datos iniciales (lo usan las pruebas automáticas)
function reiniciarDatos(){
  Object.assign(db, crearDatosIniciales());
}

module.exports = { db, reiniciarDatos };
