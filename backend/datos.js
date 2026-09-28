/* BASE DE DATOS SIMULADA (en memoria)
   Mismas tablas y columnas que docs/script_base_datos.sql. Los datos se reinician
   cada vez que arranca el servidor. Al pasar a PostgreSQL este archivo deja de usarse. */

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

// Notas de ejemplo entre 5.0 y 10.0 (siempre las mismas) para evaluaciones ya calificadas
function notasDeEjemplo(cantidad, semilla){
  return Array.from({ length: cantidad }, (_, i) => ((i * 37 + semilla * 13) % 51 + 50) / 10);
}

function crearDatosIniciales(){
  const docentes = [
    { id_docente: 1, cif_docente: "D2026001", nombre_docente: "Docente", apellido_docente: "UEES",
      correo: "docente@uees.edu.sv", contrasena_hash: HASH_DOCENTE },
    // Segundo docente: solo sirve para comprobar que nadie ve los grupos de otro
    { id_docente: 2, cif_docente: "D2026002", nombre_docente: "Docente", apellido_docente: "Invitado",
      correo: "docente.invitado@uees.edu.sv", contrasena_hash: HASH_INVITADO }
  ];

  const asignaturas = [
    { id_asignatura: 1, codigo_asignatura: "BD", nombre_asignatura: "Base de datos" },
    { id_asignatura: 2, codigo_asignatura: "PW", nombre_asignatura: "Programación web" }
  ];

  const grupos = [
    { id_grupo: 1, id_docente: 1, id_asignatura: 1, codigo_grupo: "BD-01", horario: "Lunes y miércoles 07:00-08:40", ciclo: "02-2026" },
    { id_grupo: 2, id_docente: 1, id_asignatura: 2, codigo_grupo: "PW-01", horario: "Martes y jueves 07:00-08:40", ciclo: "02-2026" },
    { id_grupo: 3, id_docente: 2, id_asignatura: 1, codigo_grupo: "BD-02", horario: "Viernes 13:00-16:20", ciclo: "02-2026" }
  ];

  const evaluaciones = [
    { id_evaluacion: 1, id_grupo: 1, nombre: "Tarea 1",        tipo: "TAREA",    fecha_evaluacion: "2026-08-10", fecha_limite: "2026-08-14", estado: "TRASLADADA", fecha_traslado: "2026-08-12T16:00:00.000Z" },
    { id_evaluacion: 2, id_grupo: 1, nombre: "Tarea 2",        tipo: "TAREA",    fecha_evaluacion: "2026-08-12", fecha_limite: "2026-08-16", estado: "BORRADOR",   fecha_traslado: null },
    { id_evaluacion: 3, id_grupo: 1, nombre: "Parcial 1",      tipo: "PARCIAL",  fecha_evaluacion: "2026-08-15", fecha_limite: "2026-08-21", estado: "BORRADOR",   fecha_traslado: null },
    { id_evaluacion: 4, id_grupo: 1, nombre: "Proyecto",       tipo: "PROYECTO", fecha_evaluacion: "2026-08-30", fecha_limite: "2026-09-05", estado: "BORRADOR",   fecha_traslado: null },
    { id_evaluacion: 5, id_grupo: 2, nombre: "Tarea 1",        tipo: "TAREA",    fecha_evaluacion: "2026-08-11", fecha_limite: "2026-08-15", estado: "TRASLADADA", fecha_traslado: "2026-08-13T16:00:00.000Z" },
    { id_evaluacion: 6, id_grupo: 2, nombre: "Tarea 2",        tipo: "TAREA",    fecha_evaluacion: "2026-08-13", fecha_limite: "2026-08-17", estado: "BORRADOR",   fecha_traslado: null },
    { id_evaluacion: 7, id_grupo: 2, nombre: "Parcial 1",      tipo: "PARCIAL",  fecha_evaluacion: "2026-08-16", fecha_limite: "2026-08-22", estado: "BORRADOR",   fecha_traslado: null },
    { id_evaluacion: 8, id_grupo: 2, nombre: "Proyecto Final", tipo: "PROYECTO", fecha_evaluacion: "2026-08-31", fecha_limite: "2026-09-06", estado: "BORRADOR",   fecha_traslado: null },
    { id_evaluacion: 9, id_grupo: 3, nombre: "Tarea 1",        tipo: "TAREA",    fecha_evaluacion: "2026-08-10", fecha_limite: "2026-08-14", estado: "BORRADOR",   fecha_traslado: null }
  ];

  const estudiantes = [];
  const matriculas = [];
  function inscribir(nombres, primerCif, idGrupo){
    nombres.forEach((nombre, i) => {
      const cif = String(primerCif + i);
      let estudiante = estudiantes.find(e => e.cif_estudiante === cif);
      if (!estudiante) {
        estudiante = { id_estudiante: estudiantes.length + 1, nombre_estudiante: nombre,
                       cif_estudiante: cif, correo_institucional: `${cif}@uees.edu.sv` };
        estudiantes.push(estudiante);
      }
      matriculas.push({ id_matricula: matriculas.length + 1, id_estudiante: estudiante.id_estudiante,
                        id_grupo: idGrupo, fecha_matricula: "2026-07-20", estado: "ACTIVA" });
    });
  }
  inscribir(NOMINA_BD, 2025010212, 1);
  inscribir(NOMINA_PW, 2025010300, 2);
  inscribir(NOMINA_PW.slice(0, 2), 2025010300, 3);

  // Notas en el orden de la nómina del grupo (null = pendiente)
  const calificaciones = [];
  function calificar(idEvaluacion, notas){
    const { id_grupo } = evaluaciones.find(e => e.id_evaluacion === idEvaluacion);
    const delGrupo = matriculas.filter(m => m.id_grupo === id_grupo);
    notas.forEach((nota, i) => calificaciones.push({
      id_calificacion: calificaciones.length + 1, id_matricula: delGrupo[i].id_matricula,
      id_evaluacion: idEvaluacion, id_grupo, nota
    }));
  }
  calificar(1, notasDeEjemplo(NOMINA_BD.length, 1));
  calificar(2, notasDeEjemplo(NOMINA_BD.length, 2));
  calificar(3, [8.5, 9.2, 3.5, null, null, ...notasDeEjemplo(NOMINA_BD.length - 5, 3)]);
  calificar(5, notasDeEjemplo(NOMINA_PW.length, 4));
  calificar(6, notasDeEjemplo(NOMINA_PW.length, 5).map((nota, i) => (i < 20 ? nota : null)));

  return { docentes, asignaturas, grupos, evaluaciones, estudiantes, matriculas, calificaciones };
}

const db = crearDatosIniciales();

// Vuelve a los datos iniciales (lo usan las pruebas automáticas)
function reiniciarDatos(){
  Object.assign(db, crearDatosIniciales());
}

module.exports = { db, reiniciarDatos };
