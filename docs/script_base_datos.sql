-- ===========================================================================
-- BASE DE DATOS: portal_docente_uees
-- MOTOR: PostgreSQL 14+
-- PROYECTO: Examen Primer Periodo - Programación Web (Ciclo II-2026)
-- ===========================================================================

DROP TABLE IF EXISTS calificaciones CASCADE;
DROP TABLE IF EXISTS matriculas CASCADE;
DROP TABLE IF EXISTS evaluaciones CASCADE;
DROP TABLE IF EXISTS grupos CASCADE;
DROP TABLE IF EXISTS asignaturas CASCADE;
DROP TABLE IF EXISTS estudiantes CASCADE;
DROP TABLE IF EXISTS docentes CASCADE;

-- Todas las claves foráneas usan ON DELETE RESTRICT: no se puede borrar un
-- docente, asignatura, estudiante o grupo que tenga registros académicos asociados.

CREATE TABLE docentes(
  id_docente SERIAL PRIMARY KEY,
  cif_docente VARCHAR(100) UNIQUE NOT NULL,
  nombre_docente  VARCHAR(100) NOT NULL,
  apellido_docente VARCHAR(100) NOT NULL,
  correo VARCHAR(100) UNIQUE NOT NULL,
  contrasena_hash VARCHAR(255) NOT NULL -- hash bcrypt/argon2, nunca la contraseña en texto plano
);

CREATE TABLE estudiantes(
  id_estudiante SERIAL PRIMARY KEY,
  nombre_estudiante VARCHAR(100) NOT NULL,
  cif_estudiante VARCHAR(100) UNIQUE NOT NULL,
  correo_institucional VARCHAR(100) UNIQUE NOT NULL
);

CREATE TABLE asignaturas(
  id_asignatura SERIAL PRIMARY KEY,
  codigo_asignatura VARCHAR(100) UNIQUE NOT NULL,
  nombre_asignatura VARCHAR(100) NOT NULL
);



CREATE TABLE grupos(
  id_grupo SERIAL PRIMARY KEY,
  id_docente INTEGER NOT NULL REFERENCES docentes ON DELETE RESTRICT,
  id_asignatura INTEGER NOT NULL REFERENCES asignaturas ON DELETE RESTRICT,
  codigo_grupo VARCHAR(20) NOT NULL, -- ej. 'BD-01'
  horario VARCHAR(100) NOT NULL,
  ciclo VARCHAR(100) NOT NULL,
  UNIQUE (codigo_grupo, ciclo)
);

CREATE TABLE evaluaciones(
  id_evaluacion SERIAL PRIMARY KEY,
  id_grupo INTEGER NOT NULL REFERENCES grupos ON DELETE RESTRICT,
  nombre VARCHAR(100) NOT NULL,
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('TAREA', 'PARCIAL', 'PROYECTO')),
  fecha_evaluacion DATE,
  fecha_limite DATE, -- fecha máxima para ingresar y trasladar las notas
  estado VARCHAR(20) NOT NULL DEFAULT 'BORRADOR' CHECK (estado IN ('BORRADOR', 'TRASLADADA')),
  fecha_traslado TIMESTAMP,
  CHECK (fecha_limite >= fecha_evaluacion),
  -- una evaluación trasladada siempre registra cuándo se trasladó
  CHECK ((estado = 'BORRADOR' AND fecha_traslado IS NULL)
      OR (estado = 'TRASLADADA' AND fecha_traslado IS NOT NULL)),
  UNIQUE (id_evaluacion, id_grupo) -- necesario para la FK compuesta de calificaciones
);

CREATE TABLE matriculas(
  id_matricula SERIAL PRIMARY KEY,
  id_estudiante INTEGER NOT NULL REFERENCES estudiantes ON DELETE RESTRICT,
  id_grupo INTEGER NOT NULL REFERENCES grupos ON DELETE RESTRICT,
  fecha_matricula DATE,
  estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVA' CHECK (estado IN ('ACTIVA', 'RETIRADA', 'FINALIZADA')),
  UNIQUE (id_estudiante, id_grupo),
  UNIQUE (id_matricula, id_grupo) -- necesario para la FK compuesta de calificaciones
);

CREATE TABLE calificaciones(
  id_calificacion SERIAL PRIMARY KEY,
  id_matricula INTEGER NOT NULL,
  id_evaluacion INTEGER NOT NULL,
  id_grupo INTEGER NOT NULL,
  nota NUMERIC(4,2) CHECK (nota >= 0.00 AND nota <= 10.00), -- NULL = pendiente
  UNIQUE (id_matricula, id_evaluacion),
  -- la matrícula y la evaluación deben pertenecer al mismo grupo
  FOREIGN KEY (id_matricula, id_grupo) REFERENCES matriculas (id_matricula, id_grupo) ON DELETE RESTRICT,
  FOREIGN KEY (id_evaluacion, id_grupo) REFERENCES evaluaciones (id_evaluacion, id_grupo) ON DELETE RESTRICT
);


-- ===========================================================================
-- DATOS DE PRUEBA (tomados de los mockups y de src/js/main.js)
-- Se incluyen los primeros 5 estudiantes de cada grupo; el prototipo simula
-- la nómina completa (22 en BD-01 y 27 en PW-01).
-- Los id empiezan en 1 porque las tablas se acaban de crear.
-- ===========================================================================

INSERT INTO docentes (cif_docente, nombre_docente, apellido_docente, correo, contrasena_hash) VALUES
  ('D2026001', 'Docente', 'UEES', 'docente@uees.edu.sv', 'hash_de_ejemplo_no_valido'); -- la aplicación guarda aquí el hash real

INSERT INTO asignaturas (codigo_asignatura, nombre_asignatura) VALUES
  ('BD', 'Base de datos'),
  ('PW', 'Programación web');

INSERT INTO grupos (id_docente, id_asignatura, codigo_grupo, horario, ciclo) VALUES
  (1, 1, 'BD-01', 'Lunes y miércoles 07:00-08:40', '02-2026'),
  (1, 2, 'PW-01', 'Martes y jueves 07:00-08:40', '02-2026');

INSERT INTO evaluaciones (id_grupo, nombre, tipo, fecha_evaluacion, fecha_limite, estado, fecha_traslado) VALUES
  (1, 'Tarea 1',        'TAREA',    '2026-08-10', '2026-08-14', 'TRASLADADA', '2026-08-12 10:00'),
  (1, 'Tarea 2',        'TAREA',    '2026-08-12', '2026-08-16', 'BORRADOR',   NULL),
  (1, 'Parcial 1',      'PARCIAL',  '2026-08-15', '2026-08-21', 'BORRADOR',   NULL),
  (1, 'Proyecto',       'PROYECTO', '2026-08-30', '2026-09-05', 'BORRADOR',   NULL),
  (2, 'Tarea 1',        'TAREA',    '2026-08-11', '2026-08-15', 'TRASLADADA', '2026-08-13 10:00'),
  (2, 'Tarea 2',        'TAREA',    '2026-08-13', '2026-08-17', 'BORRADOR',   NULL),
  (2, 'Parcial 1',      'PARCIAL',  '2026-08-16', '2026-08-22', 'BORRADOR',   NULL),
  (2, 'Proyecto Final', 'PROYECTO', '2026-08-31', '2026-09-06', 'BORRADOR',   NULL);

INSERT INTO estudiantes (nombre_estudiante, cif_estudiante, correo_institucional) VALUES
  ('Abbie Córdova',    '2025010212', '2025010212@uees.edu.sv'),
  ('Jackie Bolaños',   '2025010213', '2025010213@uees.edu.sv'),
  ('Edgar González',   '2025010214', '2025010214@uees.edu.sv'),
  ('Mariana García',   '2025010215', '2025010215@uees.edu.sv'),
  ('Laura Martínez',   '2025010216', '2025010216@uees.edu.sv'),
  ('Tomás Aguilar',    '2025010300', '2025010300@uees.edu.sv'),
  ('Valeria Menjívar', '2025010301', '2025010301@uees.edu.sv'),
  ('Walter Campos',    '2025010302', '2025010302@uees.edu.sv'),
  ('Andrea Molina',    '2025010303', '2025010303@uees.edu.sv'),
  ('Bryan Alvarenga',  '2025010304', '2025010304@uees.edu.sv');

INSERT INTO matriculas (id_estudiante, id_grupo, fecha_matricula) VALUES
  (1, 1, '2026-07-20'), (2, 1, '2026-07-20'), (3, 1, '2026-07-20'), (4, 1, '2026-07-20'), (5, 1, '2026-07-20'),
  (6, 2, '2026-07-20'), (7, 2, '2026-07-20'), (8, 2, '2026-07-20'), (9, 2, '2026-07-20'), (10, 2, '2026-07-20');

INSERT INTO calificaciones (id_matricula, id_evaluacion, id_grupo, nota) VALUES
  -- BD-01 / Tarea 1 (trasladada)
  (1, 1, 1, 6.30), (2, 1, 1, 10.00), (3, 1, 1, 8.60), (4, 1, 1, 7.20), (5, 1, 1, 5.80),
  -- BD-01 / Parcial 1 (en borrador, NULL = pendiente; igual que el mockup)
  (1, 3, 1, 8.50), (2, 3, 1, 9.20), (3, 3, 1, 3.50), (4, 3, 1, NULL), (5, 3, 1, NULL),
  -- PW-01 / Tarea 1 (trasladada)
  (6, 5, 2, 5.10), (7, 5, 2, 8.80), (8, 5, 2, 7.40), (9, 5, 2, 6.00), (10, 5, 2, 9.70);

-- Prueba de integridad (debe fallar): la matrícula 6 es del grupo 2 y la evaluación 1 del grupo 1
-- INSERT INTO calificaciones (id_matricula, id_evaluacion, id_grupo, nota) VALUES (6, 1, 1, 8.00);
