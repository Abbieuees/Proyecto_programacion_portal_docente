-- ===========================================================================
-- BASE DE DATOS: portal_docente_uees
-- MOTOR: PostgreSQL 14+
-- PROYECTO: Examen Primer Periodo - Programación Web (Ciclo II-2026)
-- ===========================================================================
-- Reglas de diseño aplicadas en todo el script:
--   1. Las claves foráneas usan ON DELETE RESTRICT: no se puede borrar un
--      docente, asignatura, estudiante o grupo con registros académicos.
--      Las únicas excepciones son las entidades débiles (los componentes de una
--      evaluación), que sí se borran en cascada con su evaluación.
--   2. Toda regla de negocio que la aplicación promete se valida también aquí.
--      Si el navegador falla o alguien entra por psql, la base no se corrompe.
--   3. Toda columna usada para filtrar o unir tiene índice. PostgreSQL NO crea
--      índices automáticos para las claves foráneas (solo para PK y UNIQUE).
--
-- JERARQUIA DE PONDERACIONES (tres niveles anidados, cada uno suma 100):
--
--   ciclo 02-2026 ................................ sus registros suman 100
--    |
--    +-- Registro 1 (30% del ciclo) ............... sus evaluaciones suman 100
--    |    +-- "Tarea 1"  (30% del registro) ....... sus componentes suman 100
--    |    |    +-- "Avance 1"  (50%)  <- aqui vive la nota
--    |    |    +-- "Avance 2"  (50%)  <- aqui vive la nota
--    |    +-- "Tarea 2"  (30% del registro)
--    |    |    +-- "Nota unica" (100%)
--    |    +-- "Parcial"  (40% del registro)
--    |         +-- "Teorico"  (60%)
--    |         +-- "Practico" (40%)
--    |
--    +-- Registro 2 (30% del ciclo) ............... otra tanda, otro reparto
--    |    +-- "Tarea 1" (25%) + "Actividad 1" (25%) + "Parcial" (50%)
--    |
--    +-- Registro 3 (40% del ciclo)
--         +-- "Proyecto" (60%) + "Parcial" (40%)
--
-- Cada registro lleva su propia tanda de N tareas/actividades mas su parcial, y
-- el docente reparte libremente el 100% DE ESE REGISTRO entre ellas. Por eso
-- los nombres se repiten de un registro a otro dentro del mismo grupo.
--
-- La nota de la asignatura sube por esa cadena y termina congelada en
-- matriculas.nota_final, que es la que alimenta el CUM.
-- ===========================================================================

DROP VIEW IF EXISTS v_cum_estudiante CASCADE;
DROP VIEW IF EXISTS v_cum_ciclo CASCADE;
DROP VIEW IF EXISTS v_record_academico CASCADE;
DROP VIEW IF EXISTS v_ponderaciones_invalidas CASCADE;
DROP VIEW IF EXISTS v_nota_ciclo CASCADE;
DROP VIEW IF EXISTS v_nota_registro CASCADE;
DROP VIEW IF EXISTS v_nota_evaluacion CASCADE;
DROP VIEW IF EXISTS v_carga_notas CASCADE;
DROP VIEW IF EXISTS v_registros_docente CASCADE;
DROP VIEW IF EXISTS v_grupos_docente CASCADE;
DROP TABLE IF EXISTS calificaciones_historial CASCADE;
DROP TABLE IF EXISTS calificaciones CASCADE;
DROP TABLE IF EXISTS componentes_evaluacion CASCADE;
DROP TABLE IF EXISTS matriculas CASCADE;
DROP TABLE IF EXISTS evaluaciones CASCADE;
DROP TABLE IF EXISTS registros CASCADE;
DROP TABLE IF EXISTS grupos CASCADE;
DROP TABLE IF EXISTS ciclos CASCADE;
DROP TABLE IF EXISTS asignaturas CASCADE;
DROP TABLE IF EXISTS estudiantes CASCADE;
DROP TABLE IF EXISTS docentes CASCADE;


-- ===========================================================================
-- TABLAS
-- ===========================================================================

CREATE TABLE docentes(
  id_docente SERIAL PRIMARY KEY,
  cif_docente VARCHAR(100) UNIQUE NOT NULL,
  nombre_docente VARCHAR(100) NOT NULL,
  apellido_docente VARCHAR(100) NOT NULL,
  correo VARCHAR(100) UNIQUE NOT NULL,
  contrasena_hash VARCHAR(255) NOT NULL, -- hash bcrypt/argon2, nunca texto plano
  activo BOOLEAN NOT NULL DEFAULT TRUE   -- baja lógica: RESTRICT impide borrarlo
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
  nombre_asignatura VARCHAR(100) NOT NULL,
  -- Unidades valorativas: el peso de la asignatura dentro del pensum.
  -- Es la 'UV' de la formula del CUM; debe coincidir con el plan de estudios.
  unidades_valorativas INTEGER NOT NULL CHECK (unidades_valorativas > 0)
);

-- Antes el ciclo era un VARCHAR repetido en cada grupo: un typo ('02-2026' vs
-- '2026-02') creaba un ciclo fantasma. Ahora es una entidad, y ademas es el
-- punto del que cuelgan los registros.
CREATE TABLE ciclos(
  id_ciclo SERIAL PRIMARY KEY,
  codigo_ciclo VARCHAR(20) UNIQUE NOT NULL, -- ej. '02-2026'
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'ABIERTO'
    CHECK (estado IN ('ABIERTO', 'CERRADO')),
  CHECK (fecha_fin > fecha_inicio)
);

-- REGISTRO: periodo de evaluacion dentro de un ciclo.
-- Tipicamente son tres (30% / 30% / 40%) y deben sumar 100% del ciclo.
-- Es lo primero que el docente selecciona en pantalla; dentro de el ve todas
-- sus asignaturas.
CREATE TABLE registros(
  id_registro SERIAL PRIMARY KEY,
  id_ciclo INTEGER NOT NULL REFERENCES ciclos ON DELETE RESTRICT,
  numero INTEGER NOT NULL CHECK (numero > 0),
  nombre VARCHAR(100) NOT NULL, -- ej. 'Registro 1'
  -- porcentaje que este registro aporta a la nota del ciclo
  ponderacion NUMERIC(5,2) NOT NULL
    CHECK (ponderacion > 0.00 AND ponderacion <= 100.00),
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'ABIERTO'
    CHECK (estado IN ('ABIERTO', 'CERRADO')),
  CHECK (fecha_fin >= fecha_inicio),
  UNIQUE (id_ciclo, numero),
  UNIQUE (id_registro, id_ciclo) -- habilita la FK compuesta de evaluaciones
);

CREATE TABLE grupos(
  id_grupo SERIAL PRIMARY KEY,
  id_docente INTEGER NOT NULL REFERENCES docentes ON DELETE RESTRICT,
  id_asignatura INTEGER NOT NULL REFERENCES asignaturas ON DELETE RESTRICT,
  id_ciclo INTEGER NOT NULL REFERENCES ciclos ON DELETE RESTRICT,
  codigo_grupo VARCHAR(20) NOT NULL, -- ej. 'BD-01'
  horario VARCHAR(100) NOT NULL,
  -- equivale a MIN_GRADE en src/js/main.js; configurable por grupo
  nota_minima NUMERIC(4,2) NOT NULL DEFAULT 6.00
    CHECK (nota_minima >= 0.00 AND nota_minima <= 10.00),
  UNIQUE (codigo_grupo, id_ciclo),
  UNIQUE (id_grupo, id_ciclo) -- habilita la FK compuesta de evaluaciones
);

-- Una evaluacion vive dentro de UN registro y de UN grupo. La columna id_ciclo
-- es redundante a proposito: con las dos FK compuestas de abajo, la base
-- garantiza que el registro y el grupo pertenezcan al MISMO ciclo. Sin eso se
-- podria colgar una evaluacion de 02-2026 de un registro de 01-2026.
CREATE TABLE evaluaciones(
  id_evaluacion SERIAL PRIMARY KEY,
  id_grupo INTEGER NOT NULL,
  id_registro INTEGER NOT NULL,
  id_ciclo INTEGER NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('TAREA', 'PARCIAL', 'PROYECTO')),
  -- porcentaje que esta evaluacion aporta a la nota del REGISTRO (no del ciclo)
  ponderacion NUMERIC(5,2) NOT NULL
    CHECK (ponderacion > 0.00 AND ponderacion <= 100.00),
  fecha_evaluacion DATE NOT NULL,
  fecha_limite DATE NOT NULL, -- fecha máxima para ingresar y trasladar notas
  estado VARCHAR(20) NOT NULL DEFAULT 'BORRADOR'
    CHECK (estado IN ('BORRADOR', 'TRASLADADA')),
  fecha_traslado TIMESTAMPTZ,
  fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (fecha_limite >= fecha_evaluacion),
  -- una evaluación trasladada siempre registra cuándo se trasladó, y una en
  -- borrador nunca tiene fecha de traslado
  CHECK ((estado = 'BORRADOR'   AND fecha_traslado IS NULL)
      OR (estado = 'TRASLADADA' AND fecha_traslado IS NOT NULL)),
  -- El nombre se repite dentro del grupo porque cada registro reinicia su
  -- propia numeracion: BD-01 tiene un 'Parcial' en el Registro 1, otro en el 2
  -- y otro en el 3. Lo que no se permite es repetirlo DENTRO del mismo registro.
  UNIQUE (id_grupo, id_registro, nombre),
  UNIQUE (id_evaluacion, id_grupo), -- habilita la FK compuesta de componentes
  FOREIGN KEY (id_grupo,    id_ciclo) REFERENCES grupos    (id_grupo,    id_ciclo) ON DELETE RESTRICT,
  FOREIGN KEY (id_registro, id_ciclo) REFERENCES registros (id_registro, id_ciclo) ON DELETE RESTRICT
);

-- COMPONENTE: la parte de una evaluacion que realmente se califica.
-- Sirve tanto para los avances de una tarea como para partir un parcial en
-- teorico / practico. TODA evaluacion tiene al menos uno: cuando la nota es
-- una sola, se crea un componente unico al 100%. De esa forma hay un solo
-- lugar donde puede vivir una nota, en vez de dos (ver fn_crea_evaluacion).
--
-- Es una entidad debil: se borra en cascada con su evaluacion. Lo que protege
-- los datos reales es el RESTRICT de calificaciones hacia aca, que impide
-- borrar un componente que ya tenga notas.
CREATE TABLE componentes_evaluacion(
  id_componente SERIAL PRIMARY KEY,
  id_evaluacion INTEGER NOT NULL,
  id_grupo INTEGER NOT NULL, -- redundante: propaga la FK compuesta hacia abajo
  nombre VARCHAR(100) NOT NULL, -- ej. 'Teórico', 'Práctico', 'Avance 1'
  -- porcentaje que este componente aporta a la nota de la EVALUACION
  ponderacion NUMERIC(5,2) NOT NULL
    CHECK (ponderacion > 0.00 AND ponderacion <= 100.00),
  orden INTEGER NOT NULL DEFAULT 1,
  UNIQUE (id_evaluacion, nombre),
  UNIQUE (id_componente, id_grupo), -- habilita la FK compuesta de calificaciones
  FOREIGN KEY (id_evaluacion, id_grupo) REFERENCES evaluaciones (id_evaluacion, id_grupo) ON DELETE CASCADE
);

-- La matricula es el registro historico de "este estudiante curso esta
-- asignatura en este ciclo y gano esta nota". Es el eslabon que conecta las
-- calificaciones del dia a dia con el CUM de toda la carrera.
CREATE TABLE matriculas(
  id_matricula SERIAL PRIMARY KEY,
  id_estudiante INTEGER NOT NULL REFERENCES estudiantes ON DELETE RESTRICT,
  id_grupo INTEGER NOT NULL REFERENCES grupos ON DELETE RESTRICT,
  fecha_matricula DATE NOT NULL DEFAULT CURRENT_DATE,
  estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVA'
    CHECK (estado IN ('ACTIVA', 'RETIRADA', 'FINALIZADA')),
  -- 'Nota ganada en el ciclo'. Se congela al cerrar la matricula y ya no se
  -- recalcula: si manana alguien corrige la ponderacion de una evaluacion, el
  -- expediente de ciclos pasados no cambia.
  nota_final NUMERIC(4,2) CHECK (nota_final >= 0.00 AND nota_final <= 10.00),
  fecha_cierre TIMESTAMPTZ,
  UNIQUE (id_estudiante, id_grupo),
  UNIQUE (id_matricula, id_grupo), -- necesario para la FK compuesta de calificaciones
  -- solo una matricula cerrada tiene nota; una activa o retirada nunca
  CHECK ((estado =  'FINALIZADA' AND nota_final IS NOT NULL AND fecha_cierre IS NOT NULL)
      OR (estado <> 'FINALIZADA' AND nota_final IS     NULL AND fecha_cierre IS     NULL))
);

-- Una fila en calificaciones significa "esta nota ya fue ingresada".
-- PENDIENTE no se guarda como fila con nota NULL: simplemente no existe la fila.
-- Así hay una sola forma de representar cada estado (ver v_carga_notas).
CREATE TABLE calificaciones(
  id_calificacion SERIAL PRIMARY KEY,
  id_matricula INTEGER NOT NULL,
  id_componente INTEGER NOT NULL,
  id_grupo INTEGER NOT NULL, -- redundante a propósito: habilita la FK compuesta
  nota NUMERIC(4,2) NOT NULL CHECK (nota >= 0.00 AND nota <= 10.00),
  fecha_registro TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id_matricula, id_componente),
  -- la matrícula y el componente deben pertenecer al mismo grupo
  FOREIGN KEY (id_matricula,  id_grupo) REFERENCES matriculas             (id_matricula,  id_grupo) ON DELETE RESTRICT,
  FOREIGN KEY (id_componente, id_grupo) REFERENCES componentes_evaluacion (id_componente, id_grupo) ON DELETE RESTRICT
);

-- Tabla de auditoría (alimenta la vista "Historial" del portal).
-- Es solo-anexado y a propósito NO tiene FK hacia calificaciones: el historial
-- debe sobrevivir aunque la calificación original se elimine.
CREATE TABLE calificaciones_historial(
  id_historial SERIAL PRIMARY KEY,
  id_calificacion INTEGER NOT NULL,
  id_matricula INTEGER NOT NULL,
  id_componente INTEGER NOT NULL,
  operacion VARCHAR(10) NOT NULL CHECK (operacion IN ('INSERT','UPDATE','DELETE')),
  nota_anterior NUMERIC(4,2),
  nota_nueva NUMERIC(4,2),
  id_docente INTEGER, -- quién hizo el cambio; lo provee la aplicación
  fecha_cambio TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ===========================================================================
-- ÍNDICES
-- Solo se crean los que ningún índice de PK/UNIQUE ya cubre. Un índice
-- compuesto sirve para filtrar por su PRIMERA columna, no por las siguientes:
-- por eso UNIQUE (id_matricula, id_componente) no ayuda a buscar por componente.
-- ===========================================================================

CREATE INDEX idx_registros_ciclo         ON registros(id_ciclo);
CREATE INDEX idx_grupos_docente          ON grupos(id_docente, id_ciclo);
CREATE INDEX idx_grupos_asignatura       ON grupos(id_asignatura);
CREATE INDEX idx_grupos_ciclo            ON grupos(id_ciclo);
CREATE INDEX idx_evaluaciones_grupo      ON evaluaciones(id_grupo);
CREATE INDEX idx_evaluaciones_registro   ON evaluaciones(id_registro);
CREATE INDEX idx_componentes_evaluacion  ON componentes_evaluacion(id_evaluacion);
CREATE INDEX idx_matriculas_grupo        ON matriculas(id_grupo, estado);
CREATE INDEX idx_calificaciones_comp     ON calificaciones(id_componente);
CREATE INDEX idx_historial_calificacion  ON calificaciones_historial(id_calificacion);


-- ===========================================================================
-- REGLAS DE NEGOCIO (TRIGGERS Y FUNCIONES)
-- Un CHECK no puede consultar otra tabla ni sumar varias filas, así que estas
-- reglas requieren triggers. Son las mismas que valida src/js/main.js, pero
-- aquí no se pueden saltar desde la consola del navegador.
-- ===========================================================================

-- Regla 1: las notas de una evaluación TRASLADADA no se insertan, modifican
-- ni borran. Regla 2: no se califica a un estudiante RETIRADO.
CREATE OR REPLACE FUNCTION fn_valida_calificacion()
RETURNS TRIGGER AS $$
DECLARE
  v_id_componente INTEGER;
  v_id_matricula  INTEGER;
  v_id_evaluacion INTEGER;
  v_estado_eval   VARCHAR(20);
  v_estado_matr   VARCHAR(20);
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_id_componente := OLD.id_componente;
    v_id_matricula  := OLD.id_matricula;
  ELSE
    v_id_componente := NEW.id_componente;
    v_id_matricula  := NEW.id_matricula;
  END IF;

  SELECT e.id_evaluacion, e.estado
    INTO v_id_evaluacion, v_estado_eval
    FROM componentes_evaluacion co
    JOIN evaluaciones e ON e.id_evaluacion = co.id_evaluacion
   WHERE co.id_componente = v_id_componente;

  IF v_estado_eval = 'TRASLADADA' THEN
    RAISE EXCEPTION
      'La evaluacion % ya fue trasladada: sus calificaciones no se pueden modificar.',
      v_id_evaluacion
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF TG_OP <> 'DELETE' THEN
    SELECT estado INTO v_estado_matr
      FROM matriculas WHERE id_matricula = v_id_matricula;

    IF v_estado_matr <> 'ACTIVA' THEN
      RAISE EXCEPTION
        'La matricula % esta en estado %: no se le puede registrar nota.',
        v_id_matricula, v_estado_matr
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_valida_calificacion
  BEFORE INSERT OR UPDATE OR DELETE ON calificaciones
  FOR EACH ROW EXECUTE FUNCTION fn_valida_calificacion();


-- Regla 3: el traslado es irreversible, y solo se puede trasladar una
-- evaluación cuyos componentes sumen exactamente 100%.
--
-- Por qué aquí y no en un CHECK: la suma abarca varias filas, y un trigger por
-- fila bloquearía estados intermedios legítimos (el docente no puede agregar
-- tres componentes de un solo golpe). Validar en el traslado deja trabajar en
-- borrador y exige el 100% justo cuando la nota se vuelve oficial.
CREATE OR REPLACE FUNCTION fn_valida_traslado()
RETURNS TRIGGER AS $$
DECLARE
  v_suma NUMERIC(6,2);
  v_n    INTEGER;
BEGIN
  IF OLD.estado = 'TRASLADADA' AND NEW.estado = 'BORRADOR' THEN
    RAISE EXCEPTION
      'La evaluacion % ya fue trasladada y no puede regresar a BORRADOR.',
      OLD.id_evaluacion
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.estado = 'TRASLADADA' AND OLD.estado <> 'TRASLADADA' THEN
    SELECT COUNT(*), COALESCE(SUM(ponderacion), 0)
      INTO v_n, v_suma
      FROM componentes_evaluacion
     WHERE id_evaluacion = NEW.id_evaluacion;

    IF v_n = 0 THEN
      RAISE EXCEPTION
        'La evaluacion % no tiene componentes: no hay nada que trasladar.',
        NEW.id_evaluacion
        USING ERRCODE = 'restrict_violation';
    END IF;

    IF v_suma <> 100.00 THEN
      RAISE EXCEPTION
        'Los componentes de la evaluacion % suman %%%, deben sumar 100%%.',
        NEW.id_evaluacion, v_suma
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_valida_traslado
  BEFORE UPDATE ON evaluaciones
  FOR EACH ROW EXECUTE FUNCTION fn_valida_traslado();


-- Regla 3b: un REGISTRO solo se cierra si su reparto esta completo.
-- Aqui es donde se exige el 100% del registro. No se puede exigir antes: el
-- docente arma sus tareas de a una y entre insercion e insercion la suma nunca
-- da 100. El cierre del registro es el momento en que ese reparto se vuelve
-- definitivo, porque es cuando la nota del registro empieza a contar.
CREATE OR REPLACE FUNCTION fn_valida_cierre_registro()
RETURNS TRIGGER AS $$
DECLARE
  v_grupo VARCHAR(20);
  v_suma  NUMERIC(6,2);
  v_n     INTEGER;
BEGIN
  IF NEW.estado = 'CERRADO' AND OLD.estado <> 'CERRADO' THEN

    -- a) ningun grupo del ciclo puede quedar sin evaluaciones en este registro
    SELECT g.codigo_grupo INTO v_grupo
      FROM grupos g
     WHERE g.id_ciclo = NEW.id_ciclo
       AND NOT EXISTS (SELECT 1
                         FROM evaluaciones e
                        WHERE e.id_registro = NEW.id_registro
                          AND e.id_grupo    = g.id_grupo)
     LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION
        'El grupo % no tiene ninguna evaluacion en %: no se puede cerrar el registro.',
        v_grupo, NEW.nombre
        USING ERRCODE = 'restrict_violation';
    END IF;

    -- b) las evaluaciones de cada grupo deben repartirse el 100% del registro
    SELECT g.codigo_grupo, SUM(e.ponderacion)
      INTO v_grupo, v_suma
      FROM evaluaciones e
      JOIN grupos g ON g.id_grupo = e.id_grupo
     WHERE e.id_registro = NEW.id_registro
     GROUP BY e.id_grupo, g.codigo_grupo
    HAVING SUM(e.ponderacion) <> 100.00
     LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION
        'Las evaluaciones de % en % suman %%%, deben sumar 100%%.',
        v_grupo, NEW.nombre, v_suma
        USING ERRCODE = 'restrict_violation';
    END IF;

    -- c) no puede quedar nota sin trasladar
    SELECT COUNT(*) INTO v_n
      FROM evaluaciones
     WHERE id_registro = NEW.id_registro
       AND estado <> 'TRASLADADA';

    IF v_n > 0 THEN
      RAISE EXCEPTION
        'Quedan % evaluaciones sin trasladar en %: no se puede cerrar el registro.',
        v_n, NEW.nombre
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_valida_cierre_registro
  BEFORE UPDATE ON registros
  FOR EACH ROW EXECUTE FUNCTION fn_valida_cierre_registro();


-- Regla 3c: un CICLO solo se cierra si sus registros se reparten el 100%
-- y todos estan cerrados. Es el mismo criterio, un nivel mas arriba.
CREATE OR REPLACE FUNCTION fn_valida_cierre_ciclo()
RETURNS TRIGGER AS $$
DECLARE
  v_suma NUMERIC(6,2);
  v_n    INTEGER;
BEGIN
  IF NEW.estado = 'CERRADO' AND OLD.estado <> 'CERRADO' THEN

    SELECT COALESCE(SUM(ponderacion), 0) INTO v_suma
      FROM registros WHERE id_ciclo = NEW.id_ciclo;

    IF v_suma <> 100.00 THEN
      RAISE EXCEPTION
        'Los registros del ciclo % suman %%%, deben sumar 100%%.',
        NEW.codigo_ciclo, v_suma
        USING ERRCODE = 'restrict_violation';
    END IF;

    SELECT COUNT(*) INTO v_n
      FROM registros WHERE id_ciclo = NEW.id_ciclo AND estado <> 'CERRADO';

    IF v_n > 0 THEN
      RAISE EXCEPTION
        'Quedan % registros abiertos en el ciclo %.',
        v_n, NEW.codigo_ciclo
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_valida_cierre_ciclo
  BEFORE UPDATE ON ciclos
  FOR EACH ROW EXECUTE FUNCTION fn_valida_cierre_ciclo();


-- Regla 4: toda alta, cambio o baja de nota queda registrada.
-- El docente responsable se toma de una variable de sesión que fija la
-- aplicación al abrir la conexión:
--     SET LOCAL app.id_docente = '1';
-- El segundo argumento TRUE de current_setting devuelve NULL si no está fijada,
-- en vez de lanzar error (útil al cargar datos de prueba desde psql).
CREATE OR REPLACE FUNCTION fn_audita_calificacion()
RETURNS TRIGGER AS $$
DECLARE
  v_docente INTEGER := NULLIF(current_setting('app.id_docente', TRUE), '')::INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO calificaciones_historial
      (id_calificacion, id_matricula, id_componente, operacion, nota_anterior, nota_nueva, id_docente)
    VALUES (NEW.id_calificacion, NEW.id_matricula, NEW.id_componente, 'INSERT', NULL, NEW.nota, v_docente);
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.nota IS DISTINCT FROM OLD.nota THEN
      INSERT INTO calificaciones_historial
        (id_calificacion, id_matricula, id_componente, operacion, nota_anterior, nota_nueva, id_docente)
      VALUES (NEW.id_calificacion, NEW.id_matricula, NEW.id_componente, 'UPDATE', OLD.nota, NEW.nota, v_docente);
    END IF;
    RETURN NEW;

  ELSE
    INSERT INTO calificaciones_historial
      (id_calificacion, id_matricula, id_componente, operacion, nota_anterior, nota_nueva, id_docente)
    VALUES (OLD.id_calificacion, OLD.id_matricula, OLD.id_componente, 'DELETE', OLD.nota, NULL, v_docente);
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audita_calificacion
  AFTER INSERT OR UPDATE OR DELETE ON calificaciones
  FOR EACH ROW EXECUTE FUNCTION fn_audita_calificacion();


-- Regla 5: al cerrar una matricula se congela la nota ganada en el ciclo.
-- Si la aplicacion no la envia, se calcula recorriendo los tres niveles de
-- ponderacion (ver v_nota_ciclo). Este es el valor que alimenta el CUM.
CREATE OR REPLACE FUNCTION fn_cierra_matricula()
RETURNS TRIGGER AS $$
DECLARE
  v_nota NUMERIC(4,2);
BEGIN
  IF NEW.estado = 'FINALIZADA' AND OLD.estado <> 'FINALIZADA' THEN

    IF NEW.nota_final IS NULL THEN
      SELECT nota_proyectada INTO v_nota
        FROM v_nota_ciclo
       WHERE id_matricula = NEW.id_matricula;

      IF v_nota IS NULL THEN
        RAISE EXCEPTION
          'La matricula % no tiene ninguna nota registrada: no se puede finalizar.',
          NEW.id_matricula
          USING ERRCODE = 'restrict_violation';
      END IF;

      NEW.nota_final := v_nota;
    END IF;

    IF NEW.fecha_cierre IS NULL THEN
      NEW.fecha_cierre := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cierra_matricula
  BEFORE UPDATE ON matriculas
  FOR EACH ROW EXECUTE FUNCTION fn_cierra_matricula();


-- Atajo para el caso comun: una evaluacion con nota unica, sin partes.
-- Crea la evaluacion y su componente al 100% en una sola llamada, para que la
-- aplicacion no tenga que acordarse de hacerlo en dos pasos.
--
--   SELECT fn_crea_evaluacion(1, 1, 'Tarea 3', 'TAREA', 25.00,
--                             '2026-09-01', '2026-09-05');
CREATE OR REPLACE FUNCTION fn_crea_evaluacion(
  p_id_grupo    INTEGER,
  p_id_registro INTEGER,
  p_nombre      VARCHAR,
  p_tipo        VARCHAR,
  p_ponderacion NUMERIC,
  p_fecha       DATE,
  p_fecha_limite DATE
) RETURNS INTEGER AS $$
DECLARE
  v_id_ciclo     INTEGER;
  v_id_evaluacion INTEGER;
BEGIN
  SELECT id_ciclo INTO v_id_ciclo FROM grupos WHERE id_grupo = p_id_grupo;

  INSERT INTO evaluaciones
    (id_grupo, id_registro, id_ciclo, nombre, tipo, ponderacion, fecha_evaluacion, fecha_limite)
  VALUES
    (p_id_grupo, p_id_registro, v_id_ciclo, p_nombre, p_tipo, p_ponderacion, p_fecha, p_fecha_limite)
  RETURNING id_evaluacion INTO v_id_evaluacion;

  INSERT INTO componentes_evaluacion (id_evaluacion, id_grupo, nombre, ponderacion, orden)
  VALUES (v_id_evaluacion, p_id_grupo, 'Nota única', 100.00, 1);

  RETURN v_id_evaluacion;
END;
$$ LANGUAGE plpgsql;


-- ===========================================================================
-- VISTAS
-- ===========================================================================

-- Pantalla 1: el docente elige el REGISTRO en el que va a trabajar.
CREATE OR REPLACE VIEW v_registros_docente AS
SELECT DISTINCT
  r.id_registro,
  r.id_ciclo,
  c.codigo_ciclo,
  r.numero,
  r.nombre,
  r.ponderacion,
  r.fecha_inicio,
  r.fecha_fin,
  r.estado,
  g.id_docente
FROM registros r
JOIN ciclos c ON c.id_ciclo = r.id_ciclo
JOIN grupos g ON g.id_ciclo = r.id_ciclo;

-- Pantalla 2: dentro del registro elegido, las asignaturas del docente.
CREATE OR REPLACE VIEW v_grupos_docente AS
SELECT
  g.id_grupo,
  g.id_docente,
  g.id_ciclo,
  c.codigo_ciclo,
  a.codigo_asignatura,
  a.nombre_asignatura,
  a.unidades_valorativas,
  g.codigo_grupo,
  g.horario,
  g.nota_minima,
  COUNT(m.id_matricula) FILTER (WHERE m.estado = 'ACTIVA') AS estudiantes_activos
FROM grupos g
JOIN ciclos c       ON c.id_ciclo      = g.id_ciclo
JOIN asignaturas a  ON a.id_asignatura = g.id_asignatura
LEFT JOIN matriculas m ON m.id_grupo   = g.id_grupo
GROUP BY g.id_grupo, c.codigo_ciclo, a.codigo_asignatura, a.nombre_asignatura,
         a.unidades_valorativas;

-- Pantalla 3: carga de notas. Una fila por estudiante activo y componente,
-- tenga nota o no. El LEFT JOIN es lo que produce el estado PENDIENTE sin
-- guardar filas vacías en calificaciones.
CREATE OR REPLACE VIEW v_carga_notas AS
SELECT
  e.id_evaluacion,
  e.id_registro,
  e.id_grupo,
  e.nombre   AS nombre_evaluacion,
  e.tipo,
  e.fecha_limite,
  e.estado   AS estado_evaluacion,
  co.id_componente,
  co.nombre  AS nombre_componente,
  co.ponderacion AS ponderacion_componente,
  co.orden,
  m.id_matricula,
  es.cif_estudiante,
  es.nombre_estudiante,
  c.nota,
  CASE
    WHEN c.nota IS NULL          THEN 'PENDIENTE'
    WHEN c.nota >= g.nota_minima THEN 'APROBADO'
    ELSE 'REPROBADO'
  END AS estado_nota
FROM evaluaciones e
JOIN grupos g                   ON g.id_grupo      = e.id_grupo
JOIN componentes_evaluacion co  ON co.id_evaluacion = e.id_evaluacion
JOIN matriculas m               ON m.id_grupo      = e.id_grupo AND m.estado = 'ACTIVA'
JOIN estudiantes es             ON es.id_estudiante = m.id_estudiante
LEFT JOIN calificaciones c
       ON c.id_matricula  = m.id_matricula
      AND c.id_componente = co.id_componente;


-- ---------------------------------------------------------------------------
-- ROLLUP DE NOTAS: componente -> evaluacion -> registro -> ciclo
--
-- En los tres niveles se divide entre la ponderacion REALMENTE calificada, no
-- entre el total. Asi, a mitad de ciclo, lo que todavia no se evalua no
-- castiga el promedio: lo que se ve es la nota proyectada con lo que hay.
-- ---------------------------------------------------------------------------

-- Nivel 1: nota de cada evaluación, a partir de sus componentes.
CREATE OR REPLACE VIEW v_nota_evaluacion AS
SELECT
  m.id_matricula,
  e.id_evaluacion,
  e.id_registro,
  e.id_grupo,
  ROUND(
    SUM(c.nota * co.ponderacion)
    / NULLIF(SUM(co.ponderacion) FILTER (WHERE c.nota IS NOT NULL), 0)
  , 2) AS nota,
  COALESCE(SUM(co.ponderacion) FILTER (WHERE c.nota IS NOT NULL), 0) AS ponderacion_calificada
FROM matriculas m
JOIN evaluaciones e            ON e.id_grupo       = m.id_grupo
JOIN componentes_evaluacion co ON co.id_evaluacion = e.id_evaluacion
LEFT JOIN calificaciones c
       ON c.id_matricula  = m.id_matricula
      AND c.id_componente = co.id_componente
GROUP BY m.id_matricula, e.id_evaluacion, e.id_registro, e.id_grupo;

-- Nivel 2: nota de cada registro, a partir de sus evaluaciones.
CREATE OR REPLACE VIEW v_nota_registro AS
SELECT
  ne.id_matricula,
  ne.id_registro,
  ne.id_grupo,
  ROUND(
    SUM(ne.nota * e.ponderacion)
    / NULLIF(SUM(e.ponderacion) FILTER (WHERE ne.nota IS NOT NULL), 0)
  , 2) AS nota,
  COALESCE(SUM(e.ponderacion) FILTER (WHERE ne.nota IS NOT NULL), 0) AS ponderacion_calificada
FROM v_nota_evaluacion ne
JOIN evaluaciones e ON e.id_evaluacion = ne.id_evaluacion
GROUP BY ne.id_matricula, ne.id_registro, ne.id_grupo;

-- Nivel 3: nota del ciclo, a partir de los registros. Esta es la que el
-- trigger congela en matriculas.nota_final al cerrar.
CREATE OR REPLACE VIEW v_nota_ciclo AS
SELECT
  nr.id_matricula,
  nr.id_grupo,
  ROUND(
    SUM(nr.nota * r.ponderacion)
    / NULLIF(SUM(r.ponderacion) FILTER (WHERE nr.nota IS NOT NULL), 0)
  , 2) AS nota_proyectada,
  COALESCE(SUM(r.ponderacion) FILTER (WHERE nr.nota IS NOT NULL), 0) AS ponderacion_calificada
FROM v_nota_registro nr
JOIN registros r ON r.id_registro = nr.id_registro
GROUP BY nr.id_matricula, nr.id_grupo;


-- Diagnóstico: todo lo que no suma 100%, en los tres niveles, en una sola
-- consulta. Es lo que la pantalla debe mostrar como advertencia al docente
-- mientras arma sus tareas.
CREATE OR REPLACE VIEW v_ponderaciones_invalidas AS
  -- registros de un ciclo
  SELECT
    'REGISTROS DEL CICLO'::VARCHAR(30) AS nivel,
    c.codigo_ciclo                     AS contexto,
    SUM(r.ponderacion)                 AS suma
  FROM ciclos c
  JOIN registros r ON r.id_ciclo = c.id_ciclo
  GROUP BY c.id_ciclo, c.codigo_ciclo
  HAVING SUM(r.ponderacion) <> 100.00

UNION ALL
  -- evaluaciones de un grupo dentro de un registro
  SELECT
    'EVALUACIONES DEL REGISTRO'::VARCHAR(30),
    g.codigo_grupo || ' / ' || r.nombre,
    SUM(e.ponderacion)
  FROM evaluaciones e
  JOIN grupos g    ON g.id_grupo    = e.id_grupo
  JOIN registros r ON r.id_registro = e.id_registro
  GROUP BY e.id_grupo, e.id_registro, g.codigo_grupo, r.nombre
  HAVING SUM(e.ponderacion) <> 100.00

UNION ALL
  -- componentes de una evaluación
  SELECT
    'COMPONENTES DE LA EVALUACION'::VARCHAR(30),
    g.codigo_grupo || ' / ' || e.nombre,
    SUM(co.ponderacion)
  FROM componentes_evaluacion co
  JOIN evaluaciones e ON e.id_evaluacion = co.id_evaluacion
  JOIN grupos g       ON g.id_grupo      = e.id_grupo
  GROUP BY co.id_evaluacion, g.codigo_grupo, e.nombre
  HAVING SUM(co.ponderacion) <> 100.00;


-- ---------------------------------------------------------------------------
-- CUM (Coeficiente de Unidades de Merito)
--
--              SUM(nota ganada x UV)       unidades de merito
--     CUM = --------------------------- = --------------------
--                    SUM(UV)                   total de UV
--
-- El CUM NO se guarda como columna en estudiantes: es un valor derivado y una
-- columna almacenada se desincronizaria en cuanto se cierre una matricula mas.
-- Lo que si se congela es la materia prima (matriculas.nota_final), asi que
-- estas vistas siempre dan el mismo resultado para los ciclos ya cerrados.
-- ---------------------------------------------------------------------------

-- Expediente academico: una fila por asignatura cursada y cerrada.
-- Es exactamente la tabla del instructivo institucional del CUM.
CREATE OR REPLACE VIEW v_record_academico AS
SELECT
  m.id_matricula,
  m.id_estudiante,
  es.cif_estudiante,
  es.nombre_estudiante,
  ci.codigo_ciclo                                 AS ciclo,
  a.codigo_asignatura,
  a.nombre_asignatura,
  m.nota_final                                    AS nota_ganada,
  a.unidades_valorativas                          AS uv,
  ROUND(m.nota_final * a.unidades_valorativas, 2) AS unidades_merito,
  (m.nota_final >= g.nota_minima)                 AS aprobada
FROM matriculas m
JOIN estudiantes es ON es.id_estudiante = m.id_estudiante
JOIN grupos g       ON g.id_grupo       = m.id_grupo
JOIN ciclos ci      ON ci.id_ciclo      = g.id_ciclo
JOIN asignaturas a  ON a.id_asignatura  = g.id_asignatura
WHERE m.estado = 'FINALIZADA';

-- CUM de cada ciclo por separado (el que aparece en la boleta del ciclo).
CREATE OR REPLACE VIEW v_cum_ciclo AS
SELECT
  id_estudiante,
  cif_estudiante,
  nombre_estudiante,
  ciclo,
  COUNT(*)                                            AS asignaturas_cursadas,
  SUM(uv)                                             AS total_uv,
  SUM(unidades_merito)                                AS total_unidades_merito,
  ROUND(SUM(unidades_merito) / NULLIF(SUM(uv), 0), 2) AS cum_ciclo
FROM v_record_academico
GROUP BY id_estudiante, cif_estudiante, nombre_estudiante, ciclo;

-- CUM acumulado de toda la carrera. Este es el que se usa al graduarse.
CREATE OR REPLACE VIEW v_cum_estudiante AS
SELECT
  id_estudiante,
  cif_estudiante,
  nombre_estudiante,
  COUNT(*)                                            AS asignaturas_cursadas,
  COUNT(*) FILTER (WHERE aprobada)                    AS asignaturas_aprobadas,
  COUNT(*) FILTER (WHERE NOT aprobada)                AS asignaturas_reprobadas,
  SUM(uv)                                             AS total_uv,
  SUM(unidades_merito)                                AS total_unidades_merito,
  ROUND(SUM(unidades_merito) / NULLIF(SUM(uv), 0), 2) AS cum
FROM v_record_academico
GROUP BY id_estudiante, cif_estudiante, nombre_estudiante;

-- DECISION PENDIENTE: asignaturas repetidas.
-- Tal como esta, si un estudiante cursa dos veces la misma asignatura, los dos
-- intentos cuentan en el CUM (es la formula literal del instructivo). Si el
-- reglamento de la UEES indica que solo cuenta el ultimo intento, hay que
-- filtrar v_record_academico asi antes de agrupar:
--
--   SELECT DISTINCT ON (id_estudiante, codigo_asignatura) *
--     FROM v_record_academico
--    ORDER BY id_estudiante, codigo_asignatura, ciclo DESC;
--
-- Confirmar con el docente cual de las dos reglas aplica.


-- ===========================================================================
-- DATOS DE PRUEBA
-- ===========================================================================

-- Hash bcrypt de ejemplo. Sustituir por el hash real que genere la aplicación.
INSERT INTO docentes (cif_docente, nombre_docente, apellido_docente, correo, contrasena_hash) VALUES
  ('D2026001', 'Ricardo Ernesto', 'Alvarado Martinez', 'docente@uees.edu.sv',
   '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'),
  ('D2026002', 'Claudia Beatriz', 'Portillo Rivas', 'cportillo@uees.edu.sv',
   '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy');

-- OJO: las unidades valorativas deben tomarse del pensum oficial de la carrera.
-- Las de BD y PW son un valor plausible puesto para poder probar; confirmarlas.
-- Las cuatro ultimas reproducen el ejemplo del instructivo institucional.
INSERT INTO asignaturas (codigo_asignatura, nombre_asignatura, unidades_valorativas) VALUES
  ('BD',     'Base de datos',                 4),
  ('PW',     'Programación web',              4),
  ('MAT-I',  'Matemática I',                  5),
  ('CONT-I', 'Contabilidad I',                4),
  ('SOC-I',  'Sociología I',                  3),
  ('ECO-I',  'Introducción a la Economía I',  4);

INSERT INTO ciclos (codigo_ciclo, fecha_inicio, fecha_fin, estado) VALUES
  ('01-2026', '2026-01-12', '2026-06-20', 'CERRADO'),  -- id_ciclo 1
  ('02-2026', '2026-07-20', '2026-12-05', 'ABIERTO');  -- id_ciclo 2

-- Tres registros por ciclo: 30 / 30 / 40 = 100.
INSERT INTO registros (id_ciclo, numero, nombre, ponderacion, fecha_inicio, fecha_fin, estado) VALUES
  (1, 1, 'Registro 1', 30.00, '2026-01-12', '2026-02-28', 'CERRADO'), -- id 1
  (1, 2, 'Registro 2', 30.00, '2026-03-01', '2026-04-30', 'CERRADO'), -- id 2
  (1, 3, 'Registro 3', 40.00, '2026-05-01', '2026-06-20', 'CERRADO'), -- id 3
  (2, 1, 'Registro 1', 30.00, '2026-07-20', '2026-09-05', 'ABIERTO'), -- id 4
  (2, 2, 'Registro 2', 30.00, '2026-09-08', '2026-10-24', 'ABIERTO'), -- id 5
  (2, 3, 'Registro 3', 40.00, '2026-10-27', '2026-12-05', 'ABIERTO'); -- id 6

INSERT INTO grupos (id_docente, id_asignatura, id_ciclo, codigo_grupo, horario) VALUES
  -- ciclo anterior, ya cerrado: alimenta el CUM
  (2, 3, 1, 'MAT-01',  'Lunes y miércoles 09:00-10:40'),  -- id_grupo 1
  (2, 4, 1, 'CONT-01', 'Martes y jueves 09:00-10:40'),    -- id_grupo 2
  (2, 5, 1, 'SOC-01',  'Viernes 07:00-09:40'),            -- id_grupo 3
  (2, 6, 1, 'ECO-01',  'Viernes 10:00-12:40'),            -- id_grupo 4
  -- ciclo en curso
  (1, 1, 2, 'BD-01',   'Lunes y miércoles 07:00-08:40'),  -- id_grupo 5
  (1, 2, 2, 'PW-01',   'Martes y jueves 07:00-08:40');    -- id_grupo 6

-- Evaluaciones. Cada registro lleva su propia tanda de tareas/actividades mas
-- su parcial, y el docente reparte el 100% DE ESE REGISTRO entre ellas.
-- Fijate que 'Tarea 1' y 'Parcial' se repiten de un registro a otro dentro del
-- mismo grupo: cada registro reinicia su numeracion.
--
--   BD-01 / Registro 1:  Tarea 1 30 + Tarea 2 30 + Parcial 40  = 100
--   BD-01 / Registro 2:  Tarea 1 25 + Actividad 1 25 + Parcial 50 = 100
--   BD-01 / Registro 3:  Proyecto 60 + Parcial 40 = 100
--   PW-01 / Registro 1:  Tarea 1 40 + Parcial 60 = 100
--
-- PW-01 queda a proposito sin evaluaciones en los registros 2 y 3, para que la
-- prueba de integridad del cierre de registro tenga algo que detectar.
INSERT INTO evaluaciones (id_grupo, id_registro, id_ciclo, nombre, tipo, ponderacion, fecha_evaluacion, fecha_limite) VALUES
  -- BD-01, Registro 1
  (5, 4, 2, 'Tarea 1',     'TAREA',    30.00, '2026-08-10', '2026-08-14'), -- id 1
  (5, 4, 2, 'Tarea 2',     'TAREA',    30.00, '2026-08-12', '2026-08-16'), -- id 2
  (5, 4, 2, 'Parcial',     'PARCIAL',  40.00, '2026-08-15', '2026-08-21'), -- id 3
  -- PW-01, Registro 1
  (6, 4, 2, 'Tarea 1',     'TAREA',    40.00, '2026-08-11', '2026-08-15'), -- id 4
  (6, 4, 2, 'Parcial',     'PARCIAL',  60.00, '2026-08-16', '2026-08-22'), -- id 5
  -- BD-01, Registro 2
  (5, 5, 2, 'Tarea 1',     'TAREA',    25.00, '2026-09-14', '2026-09-18'), -- id 6
  (5, 5, 2, 'Actividad 1', 'TAREA',    25.00, '2026-09-28', '2026-10-02'), -- id 7
  (5, 5, 2, 'Parcial',     'PARCIAL',  50.00, '2026-10-15', '2026-10-21'), -- id 8
  -- BD-01, Registro 3
  (5, 6, 2, 'Proyecto',    'PROYECTO', 60.00, '2026-11-10', '2026-11-20'), -- id 9
  (5, 6, 2, 'Parcial',     'PARCIAL',  40.00, '2026-11-28', '2026-12-04'); -- id 10

-- Componentes. Cada evaluacion suma 100% entre los suyos.
-- Tarea 1 de BD se entrega por avances; el Parcial 1 va partido en teorico y
-- practico; la Tarea 2 es de nota unica.
INSERT INTO componentes_evaluacion (id_evaluacion, id_grupo, nombre, ponderacion, orden) VALUES
  -- BD-01, Registro 1
  (1,  5, 'Avance 1',   50.00, 1),  -- id_componente 1
  (1,  5, 'Avance 2',   50.00, 2),  -- id_componente 2
  (2,  5, 'Nota única', 100.00, 1), -- id_componente 3
  (3,  5, 'Teórico',    60.00, 1),  -- id_componente 4
  (3,  5, 'Práctico',   40.00, 2),  -- id_componente 5
  -- PW-01, Registro 1
  (4,  6, 'Nota única', 100.00, 1), -- id_componente 6
  (5,  6, 'Teórico',    70.00, 1),  -- id_componente 7
  (5,  6, 'Práctico',   30.00, 2),  -- id_componente 8
  -- BD-01, Registro 2
  (6,  5, 'Nota única', 100.00, 1), -- id_componente 9
  (7,  5, 'Nota única', 100.00, 1), -- id_componente 10
  (8,  5, 'Teórico',    60.00, 1),  -- id_componente 11
  (8,  5, 'Práctico',   40.00, 2),  -- id_componente 12
  -- BD-01, Registro 3
  (9,  5, 'Avance 1',   40.00, 1),  -- id_componente 13
  (9,  5, 'Avance 2',   60.00, 2),  -- id_componente 14
  (10, 5, 'Nota única', 100.00, 1); -- id_componente 15

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

-- Matriculas del ciclo en curso (ACTIVA, todavia sin nota_final).
INSERT INTO matriculas (id_estudiante, id_grupo, fecha_matricula) VALUES
  (1, 5, '2026-07-20'), (2, 5, '2026-07-20'), (3, 5, '2026-07-20'),
  (4, 5, '2026-07-20'), (5, 5, '2026-07-20'),                        -- id_matricula 1-5
  (6, 6, '2026-07-20'), (7, 6, '2026-07-20'), (8, 6, '2026-07-20'),
  (9, 6, '2026-07-20'), (10, 6, '2026-07-20');                       -- id_matricula 6-10

-- Historial del ciclo 01-2026, ya cerrado. Se carga con nota_final directa,
-- como se migraria un expediente que viene del sistema anterior.
--
-- Abbie reproduce exactamente el ejemplo del instructivo:
--   9.0x5=45.0  7.4x4=29.6  8.2x3=24.6  6.3x4=25.2  ->  124.4 / 16 = 7.78
-- (El instructivo imprime "40.0" en la primera fila, pero su propio total de
--  124.4 solo cuadra con 45.0; es una errata del grafico.)
INSERT INTO matriculas (id_estudiante, id_grupo, fecha_matricula, estado, nota_final, fecha_cierre) VALUES
  (1, 1, '2026-01-15', 'FINALIZADA', 9.00, TIMESTAMPTZ '2026-06-15 12:00-06'),
  (1, 2, '2026-01-15', 'FINALIZADA', 7.40, TIMESTAMPTZ '2026-06-15 12:00-06'),
  (1, 3, '2026-01-15', 'FINALIZADA', 8.20, TIMESTAMPTZ '2026-06-15 12:00-06'),
  (1, 4, '2026-01-15', 'FINALIZADA', 6.30, TIMESTAMPTZ '2026-06-15 12:00-06'),
  -- Jackie cursa solo dos: 6.0x5=30.0  8.0x4=32.0  ->  62.0 / 9 = 6.89
  (2, 1, '2026-01-15', 'FINALIZADA', 6.00, TIMESTAMPTZ '2026-06-15 12:00-06'),
  (2, 2, '2026-01-15', 'FINALIZADA', 8.00, TIMESTAMPTZ '2026-06-15 12:00-06');

-- Notas de los Registros 1 y 2, cargadas mientras las evaluaciones siguen en
-- BORRADOR. El Registro 3 no tiene notas todavia.
-- BD-01, R1 / Tarea 1 (avances 50/50):
INSERT INTO calificaciones (id_matricula, id_componente, id_grupo, nota) VALUES
  (1, 1, 5, 7.00), (1, 2, 5, 9.00),   -- Abbie  -> 8.00
  (2, 1, 5, 9.00), (2, 2, 5, 9.40),   -- Jackie -> 9.20
  (3, 1, 5, 5.00), (3, 2, 5, 6.00),   -- Edgar  -> 5.50
  (4, 1, 5, 8.00), (4, 2, 5, 8.00),   -- Mariana-> 8.00
  (5, 1, 5, 6.00), (5, 2, 5, 7.00),   -- Laura  -> 6.50
-- BD-01, Tarea 2 (nota única):
  (1, 3, 5, 9.00), (2, 3, 5, 8.00), (3, 3, 5, 4.00), (4, 3, 5, 7.50), (5, 3, 5, 6.00),
-- BD-01, R1 / Parcial (teórico 60 / práctico 40). Mariana y Laura quedan
-- PENDIENTE: no existe la fila, igual que en el mockup.
  (1, 4, 5, 8.50), (1, 5, 5, 8.50),   -- Abbie  -> 8.50
  (2, 4, 5, 9.00), (2, 5, 5, 9.50),   -- Jackie -> 9.20
  (3, 4, 5, 3.00), (3, 5, 5, 4.25),   -- Edgar  -> 3.50
-- BD-01, R2 / Tarea 1 y Actividad 1 (nota única cada una). El Parcial del
-- Registro 2 todavia no se evalua, asi que ese 50% queda fuera del promedio.
  (1, 9, 5, 9.00), (1, 10, 5, 8.00),  -- Abbie   -> R2 = 8.50
  (2, 9, 5, 8.50), (2, 10, 5, 9.00),  -- Jackie  -> R2 = 8.75
  (3, 9, 5, 6.00), (3, 10, 5, 5.00),  -- Edgar   -> R2 = 5.50
  (4, 9, 5, 7.00), (4, 10, 5, 8.00),  -- Mariana -> R2 = 7.50
  (5, 9, 5, 8.00), (5, 10, 5, 7.00);  -- Laura   -> R2 = 7.50

-- Traslado de las dos tareas de BD-01. A partir de aqui el trigger bloquea
-- cualquier cambio sobre sus calificaciones.
UPDATE evaluaciones
   SET estado = 'TRASLADADA', fecha_traslado = TIMESTAMPTZ '2026-08-15 10:00-06'
 WHERE id_evaluacion IN (1, 2);


-- ===========================================================================
-- PRUEBAS DE INTEGRIDAD
-- Descomenta una a la vez: todas DEBEN fallar. Sirven para demostrar que las
-- reglas viven en la base y no solo en el JavaScript.
-- ===========================================================================

-- 1. Matricula y componente de grupos distintos (la matricula 6 es del grupo 6,
--    el componente 1 del grupo 5):
-- INSERT INTO calificaciones (id_matricula, id_componente, id_grupo) VALUES (6, 1, 5);

-- 2. Evaluacion colgada de un registro de OTRO ciclo (el registro 1 es de
--    01-2026, el grupo 5 es de 02-2026):
-- INSERT INTO evaluaciones (id_grupo, id_registro, id_ciclo, nombre, tipo, ponderacion, fecha_evaluacion, fecha_limite)
--   VALUES (5, 1, 2, 'Tarea X', 'TAREA', 10.00, '2026-09-01', '2026-09-05');

-- 3. Modificar una nota ya trasladada:
-- UPDATE calificaciones SET nota = 10.00 WHERE id_matricula = 1 AND id_componente = 1;

-- 4. Borrar una nota ya trasladada:
-- DELETE FROM calificaciones WHERE id_matricula = 1 AND id_componente = 1;

-- 5. Revertir un traslado para esquivar el bloqueo:
-- UPDATE evaluaciones SET estado = 'BORRADOR', fecha_traslado = NULL WHERE id_evaluacion = 1;

-- 6. Trasladar una evaluacion cuyos componentes NO suman 100
--    (se le quita el practico al Parcial 1, quedando en 60):
-- DELETE FROM componentes_evaluacion WHERE id_componente = 5;
-- UPDATE evaluaciones SET estado = 'TRASLADADA', fecha_traslado = now() WHERE id_evaluacion = 3;

-- 7. Nota fuera del rango 0.00 - 10.00:
-- INSERT INTO calificaciones (id_matricula, id_componente, id_grupo, nota) VALUES (4, 4, 5, 11.00);

-- 8. Dos evaluaciones con el mismo nombre DENTRO DEL MISMO REGISTRO:
-- INSERT INTO evaluaciones (id_grupo, id_registro, id_ciclo, nombre, tipo, ponderacion, fecha_evaluacion, fecha_limite)
--   VALUES (5, 4, 2, 'Parcial', 'PARCIAL', 10.00, '2026-08-25', '2026-08-30');
--
--    En cambio esto SI debe funcionar: el mismo nombre en otro registro.
--    (Ya esta en los datos de prueba: 'Parcial' existe en los registros 4, 5 y 6.)

-- 8b. Cerrar un registro donde un grupo del ciclo no tiene evaluaciones
--     (PW-01 no tiene nada en el Registro 2):
-- UPDATE registros SET estado = 'CERRADO' WHERE id_registro = 5;

-- 8c. Cerrar un registro cuyas evaluaciones no se reparten el 100%
--     (se le quita el Parcial al Registro 1 de BD-01, quedando en 60):
-- DELETE FROM componentes_evaluacion WHERE id_evaluacion = 3;
-- DELETE FROM evaluaciones WHERE id_evaluacion = 3;
-- UPDATE registros SET estado = 'CERRADO' WHERE id_registro = 4;

-- 8d. Cerrar un ciclo que todavia tiene registros abiertos:
-- UPDATE ciclos SET estado = 'CERRADO' WHERE id_ciclo = 2;

-- 9. Dos registros con el mismo numero en el mismo ciclo:
-- INSERT INTO registros (id_ciclo, numero, nombre, ponderacion, fecha_inicio, fecha_fin)
--   VALUES (2, 1, 'Registro 1 bis', 10.00, '2026-07-20', '2026-09-05');

-- 10. Asignatura sin unidades valorativas validas:
-- INSERT INTO asignaturas (codigo_asignatura, nombre_asignatura, unidades_valorativas)
--   VALUES ('FIL-I', 'Filosofía I', 0);

-- 11. Matricula cerrada sin nota ganada:
-- INSERT INTO matriculas (id_estudiante, id_grupo, estado) VALUES (7, 5, 'FINALIZADA');

-- 12. Nota ganada en una matricula que sigue activa:
-- UPDATE matriculas SET nota_final = 8.00 WHERE id_matricula = 1;

-- 13. Calificar a un estudiante retirado:
-- UPDATE matriculas SET estado = 'RETIRADA' WHERE id_matricula = 4;
-- INSERT INTO calificaciones (id_matricula, id_componente, id_grupo, nota) VALUES (4, 4, 5, 7.00);

-- 14. Borrar un componente que ya tiene notas:
-- DELETE FROM componentes_evaluacion WHERE id_componente = 1;


-- ===========================================================================
-- CONSULTAS DE EJEMPLO (el recorrido de las pantallas)
-- ===========================================================================

-- Paso 1 - el docente elige registro:
--   SELECT id_registro, codigo_ciclo, nombre, ponderacion, estado
--     FROM v_registros_docente WHERE id_docente = 1 AND estado = 'ABIERTO'
--    ORDER BY codigo_ciclo, numero;

-- Paso 2 - sus asignaturas dentro de ese registro:
--   SELECT codigo_grupo, nombre_asignatura, estudiantes_activos
--     FROM v_grupos_docente WHERE id_docente = 1 AND id_ciclo = 2;

-- Paso 3 - evaluaciones de una asignatura en ese registro:
--   SELECT DISTINCT id_evaluacion, nombre_evaluacion, tipo, estado_evaluacion
--     FROM v_carga_notas WHERE id_grupo = 5 AND id_registro = 4;

-- Paso 4 - carga de notas del Parcial 1, una columna por componente:
--   SELECT cif_estudiante, nombre_estudiante, nombre_componente,
--          ponderacion_componente, nota, estado_nota
--     FROM v_carga_notas WHERE id_evaluacion = 3
--    ORDER BY nombre_estudiante, orden;

-- ---------------------------------------------------------------------------
-- Rollup: la misma nota vista en los tres niveles
-- ---------------------------------------------------------------------------

-- Nota de cada evaluacion (Abbie en Parcial 1 debe dar 8.50):
--   SELECT id_evaluacion, nota FROM v_nota_evaluacion
--    WHERE id_matricula = 1 ORDER BY id_evaluacion;

-- Nota del Registro 1 por estudiante:
--   SELECT id_matricula, nota, ponderacion_calificada
--     FROM v_nota_registro WHERE id_registro = 4 ORDER BY id_matricula;

-- Nota proyectada del ciclo (solo con el Registro 1 cargado, por eso
-- ponderacion_calificada = 30):
--   SELECT id_matricula, nota_proyectada, ponderacion_calificada
--     FROM v_nota_ciclo WHERE id_grupo = 5 ORDER BY id_matricula;

-- Advertencias de ponderacion (deberia salir vacia con estos datos):
--   SELECT * FROM v_ponderaciones_invalidas;

-- ---------------------------------------------------------------------------
-- CUM
-- ---------------------------------------------------------------------------

-- Expediente de Abbie, tal como lo muestra el instructivo (124.4 / 16):
--   SELECT nombre_asignatura, nota_ganada, uv, unidades_merito
--     FROM v_record_academico WHERE cif_estudiante = '2025010212';

-- CUM acumulado (Abbie 7.78, Jackie 6.89):
--   SELECT cif_estudiante, nombre_estudiante, total_uv, total_unidades_merito, cum
--     FROM v_cum_estudiante ORDER BY cum DESC;

-- CUM ciclo por ciclo (evolucion a lo largo de la carrera):
--   SELECT ciclo, asignaturas_cursadas, total_uv, cum_ciclo
--     FROM v_cum_ciclo WHERE cif_estudiante = '2025010212' ORDER BY ciclo;

-- Cerrar el ciclo en curso: el trigger recorre los tres niveles, congela
-- nota_final y el CUM se actualiza solo en la siguiente consulta.
--   UPDATE matriculas SET estado = 'FINALIZADA' WHERE id_grupo = 5;
--   SELECT * FROM v_cum_estudiante WHERE cif_estudiante = '2025010212';
