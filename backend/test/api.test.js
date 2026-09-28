/* Pruebas de la API: npm test  (usa node:test y fetch, incluidos en Node) */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { crearApp } = require("../server");
const { reiniciarDatos } = require("../datos");
const { reiniciarSesiones } = require("../sesiones");
const Reglas = require("../../src/js/reglas");

const DOCENTE = { correo: "docente@uees.edu.sv", contrasena: "Docente2026" };
const INVITADO = { correo: "docente.invitado@uees.edu.sv", contrasena: "Invitado2026" };

let servidor;
let base;

before(async () => {
  servidor = crearApp().listen(0);
  await once(servidor, "listening");
  base = `http://localhost:${servidor.address().port}/api`;
});
after(() => servidor.close());
beforeEach(() => {
  reiniciarDatos();
  reiniciarSesiones();
});

async function api(metodo, ruta, { token, body } = {}){
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + ruta, {
    method: metodo,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body)
  });
  return { status: res.status, data: res.status === 204 ? null : await res.json() };
}

async function login(credenciales = DOCENTE){
  const { status, data } = await api("POST", "/auth/login", { body: credenciales });
  assert.equal(status, 200);
  return data.token;
}

test("reglas compartidas con el navegador", () => {
  assert.ok(Reglas.esNotaValida(null) && Reglas.esNotaValida("") && Reglas.esNotaValida(0) && Reglas.esNotaValida(10));
  assert.ok(Reglas.esNotaValida(8.55) && Reglas.esNotaValida("7.5"));
  assert.ok(!Reglas.esNotaValida(10.5) && !Reglas.esNotaValida(-1) && !Reglas.esNotaValida(8.555) && !Reglas.esNotaValida("abc"));
  assert.equal(Reglas.estadoDeNota(6), "APROBADO");
  assert.equal(Reglas.estadoDeNota(5.99), "REPROBADO");
  assert.equal(Reglas.estadoDeNota(null), "PENDIENTE");
});

test("login: 400 sin datos, 401 con credenciales incorrectas y 200 con las correctas", async () => {
  assert.equal((await api("POST", "/auth/login", { body: {} })).status, 400);
  assert.equal((await api("POST", "/auth/login", { body: { ...DOCENTE, contrasena: "incorrecta" } })).status, 401);
  assert.equal((await api("POST", "/auth/login", { body: { ...DOCENTE, correo: "nadie@uees.edu.sv" } })).status, 401);

  const { status, data } = await api("POST", "/auth/login", { body: { ...DOCENTE, correo: "Docente@UEES.edu.sv" } });
  assert.equal(status, 200);
  assert.match(data.token, /^[0-9a-f]{64}$/);
  assert.equal(data.docente.correo, DOCENTE.correo);
  assert.equal(data.docente.contrasena_hash, undefined, "el hash nunca se envía");
});

test("las rutas protegidas exigen un token válido", async () => {
  assert.equal((await api("GET", "/grupos")).status, 401);
  assert.equal((await api("GET", "/grupos", { token: "token-falso" })).status, 401);
});

test("grupos del docente con su total de estudiantes", async () => {
  const token = await login();
  const { status, data } = await api("GET", "/grupos", { token });
  assert.equal(status, 200);
  assert.deepEqual(data.map(g => [g.codigo_grupo, g.nombre_asignatura, g.total_estudiantes]),
    [["BD-01", "Base de datos", 22], ["PW-01", "Programación web", 27]]);
});

test("un docente no puede ver grupos ni evaluaciones de otro (403)", async () => {
  const token = await login();
  assert.equal((await api("GET", "/grupos/3", { token })).status, 403);
  assert.equal((await api("GET", "/evaluaciones/9/calificaciones", { token })).status, 403);
  assert.equal((await api("GET", "/grupos/99", { token })).status, 404);
  assert.equal((await api("GET", "/grupos/abc", { token })).status, 400);

  const tokenInvitado = await login(INVITADO);
  assert.equal((await api("GET", "/grupos/1", { token: tokenInvitado })).status, 403);
});

test("evaluaciones del grupo, con filtro por tipo", async () => {
  const token = await login();
  assert.equal((await api("GET", "/grupos/1/evaluaciones", { token })).data.length, 4);
  const tareas = await api("GET", "/grupos/1/evaluaciones?tipo=tarea", { token });
  assert.deepEqual(tareas.data.map(e => e.nombre), ["Tarea 1", "Tarea 2"]);
  assert.equal((await api("GET", "/grupos/1/evaluaciones?tipo=EXAMEN", { token })).status, 400);
});

test("calificaciones del Parcial 1 de BD-01: las mismas del mockup", async () => {
  const token = await login();
  const { data } = await api("GET", "/evaluaciones/3/calificaciones", { token });
  assert.equal(data.length, 22);
  assert.deepEqual(data.slice(0, 5).map(f => [f.cif_estudiante, f.nombre_estudiante, f.nota]), [
    ["2025010212", "Abbie Córdova", 8.5], ["2025010213", "Jackie Bolaños", 9.2], ["2025010214", "Edgar González", 3.5],
    ["2025010215", "Mariana García", null], ["2025010216", "Laura Martínez", null]
  ]);
});

test("guardar rechaza notas inválidas sin guardar ninguna", async () => {
  const token = await login();
  const { data: filas } = await api("GET", "/evaluaciones/3/calificaciones", { token });
  const [mariana, laura] = [filas[3].id_matricula, filas[4].id_matricula];

  const res = await api("PUT", "/evaluaciones/3/calificaciones", { token, body: { calificaciones: [
    { id_matricula: mariana, nota: 7 },       // válida, pero no se guarda porque hay errores
    { id_matricula: laura, nota: 10.5 },      // fuera de rango
    { id_matricula: 999, nota: 8 }            // matrícula de otro grupo
  ] } });
  assert.equal(res.status, 400);
  assert.equal(res.data.detalles.length, 2);

  assert.equal((await api("PUT", "/evaluaciones/3/calificaciones", { token, body: { calificaciones: [{ id_matricula: laura, nota: "8" }] } })).status, 400);
  assert.equal((await api("PUT", "/evaluaciones/3/calificaciones", { token, body: { calificaciones: [{ id_matricula: laura, nota: 8.555 }] } })).status, 400);

  const despues = await api("GET", "/evaluaciones/3/calificaciones", { token });
  assert.equal(despues.data[3].nota, null, "no se guardó ningún cambio");
});

test("guardar notas y volver a leerlas", async () => {
  const token = await login();
  const { data: filas } = await api("GET", "/evaluaciones/3/calificaciones", { token });
  const res = await api("PUT", "/evaluaciones/3/calificaciones", { token, body: { calificaciones: [
    { id_matricula: filas[3].id_matricula, nota: 7.25 },
    { id_matricula: filas[0].id_matricula, nota: null }
  ] } });
  assert.equal(res.status, 200);
  assert.equal(res.data[3].nota, 7.25);
  assert.equal(res.data[0].nota, null);
  assert.equal((await api("GET", "/evaluaciones/3/calificaciones", { token })).data[3].nota, 7.25);
});

test("trasladar exige todas las notas, bloquea cambios y aparece en el historial", async () => {
  const token = await login();
  const pendiente = await api("POST", "/evaluaciones/3/traslado", { token });
  assert.equal(pendiente.status, 409);
  assert.equal(pendiente.data.pendientes, 2);

  const { data: filas } = await api("GET", "/evaluaciones/3/calificaciones", { token });
  await api("PUT", "/evaluaciones/3/calificaciones", { token, body: { calificaciones: [
    { id_matricula: filas[3].id_matricula, nota: 6 }, { id_matricula: filas[4].id_matricula, nota: 9 }
  ] } });

  const traslado = await api("POST", "/evaluaciones/3/traslado", { token });
  assert.equal(traslado.status, 200);
  assert.equal(traslado.data.estado, "TRASLADADA");
  assert.ok(traslado.data.fecha_traslado);

  assert.equal((await api("POST", "/evaluaciones/3/traslado", { token })).status, 409);
  assert.equal((await api("PUT", "/evaluaciones/3/calificaciones", { token, body: { calificaciones: [{ id_matricula: filas[0].id_matricula, nota: 1 }] } })).status, 409);

  const historial = await api("GET", "/historial", { token });
  assert.deepEqual(historial.data.map(h => `${h.codigo_grupo} ${h.nombre}`), ["BD-01 Parcial 1", "PW-01 Tarea 1", "BD-01 Tarea 1"]);
  const parcial = historial.data[0];
  assert.equal(parcial.total, 22);
  assert.equal(parcial.aprobados + parcial.reprobados, 22);
  assert.equal(typeof parcial.promedio, "number");
});

test("cambio de contraseña", async () => {
  const token = await login();
  const otraSesion = await login();
  const cambiar = (body) => api("PUT", "/perfil/contrasena", { token, body });

  assert.equal((await cambiar({ actual: "incorrecta", nueva: "NuevaClave2026" })).status, 400);
  assert.equal((await cambiar({ actual: DOCENTE.contrasena, nueva: "corta" })).status, 400);
  assert.equal((await cambiar({ actual: DOCENTE.contrasena, nueva: DOCENTE.contrasena })).status, 400);
  assert.equal((await cambiar({ actual: DOCENTE.contrasena, nueva: "NuevaClave2026" })).status, 204);

  assert.equal((await api("POST", "/auth/login", { body: DOCENTE })).status, 401, "la contraseña anterior ya no sirve");
  assert.equal((await api("POST", "/auth/login", { body: { ...DOCENTE, contrasena: "NuevaClave2026" } })).status, 200);
  assert.equal((await api("GET", "/perfil", { token })).status, 200, "la sesión actual sigue abierta");
  assert.equal((await api("GET", "/perfil", { token: otraSesion })).status, 401, "las demás sesiones se cierran");
});

test("cerrar sesión invalida el token", async () => {
  const token = await login();
  assert.equal((await api("POST", "/auth/logout", { token })).status, 204);
  assert.equal((await api("GET", "/perfil", { token })).status, 401);
});

test("los errores siempre son JSON", async () => {
  const noExiste = await api("GET", "/no-existe");
  assert.equal(noExiste.status, 404);
  assert.ok(noExiste.data.error);

  const jsonRoto = await api("POST", "/auth/login", { body: "{ esto no es json" });
  assert.equal(jsonRoto.status, 400);
  assert.match(jsonRoto.data.error, /JSON/);
});
