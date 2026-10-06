/* CLIENTE DE LA API REST (backend/)
   Todas las peticiones del portal pasan por aquí: añade el token de sesión,
   convierte las respuestas JSON y traduce los errores a mensajes legibles. */

// Si la página la sirve el backend (npm start) se usa la misma dirección;
// si se abre desde otro servidor (p. ej. Live Server), se apunta al backend local.
const API_URL =
  location.hostname === "localhost" || location.hostname === "127.0.0.1"
    ? (location.port === "3000" ? "/api" : "http://localhost:3000/api")
    : location.hostname.endsWith("onrender.com")
      ? "/api"
      : "https://proyecto-programacion-portal-docente.onrender.com/api";

class ApiError extends Error {
  constructor(status, message, data = null){
    super(message);
    this.name = "ApiError";
    this.status = status; // 0 = no hubo respuesta del servidor
    this.data = data;
  }
}

const Api = (() => {
  const CLAVE_SESION = "portalDocente.sesion";
  let pendientes = 0;

  // sessionStorage dura mientras la pestaña esté abierta; localStorage si se marcó "Recordar sesión"
  function leerSesion(){
    try {
      return JSON.parse(sessionStorage.getItem(CLAVE_SESION) || localStorage.getItem(CLAVE_SESION));
    } catch {
      return null;
    }
  }
  function guardarSesion(sesion, recordar){
    try { (recordar ? localStorage : sessionStorage).setItem(CLAVE_SESION, JSON.stringify(sesion)); } catch {}
  }
  function borrarSesion(){
    try {
      sessionStorage.removeItem(CLAVE_SESION);
      localStorage.removeItem(CLAVE_SESION);
    } catch {}
  }

  // Avisa al portal cuántas peticiones siguen en curso (para la barra de carga)
  function avisarCarga(delta){
    pendientes += delta;
    document.dispatchEvent(new CustomEvent("api:carga", { detail: { pendientes } }));
  }

  async function request(method, path, body){
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const token = leerSesion()?.token;
    if (token) headers.Authorization = `Bearer ${token}`;

    avisarCarga(+1);
    try {
      let res;
      try {
        res = await fetch(API_URL + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      } catch {
        throw new ApiError(0, "No se pudo conectar con el servidor. Verifica que el backend esté en ejecución (npm start).");
      }
      const data = res.status === 204 ? null : await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, data?.error || `Error ${res.status} del servidor.`, data);
      return data;
    } finally {
      avisarCarga(-1);
    }
  }

  return {
    haySesion: () => !!leerSesion()?.token,
    borrarSesion,

    async login(correo, contrasena, recordar){
      const data = await request("POST", "/auth/login", { correo, contrasena, recordar });
      guardarSesion({ token: data.token, expira: data.expira }, recordar);
      return data.docente;
    },
    async logout(){
      try { await request("POST", "/auth/logout"); } finally { borrarSesion(); }
    },

    perfil: () => request("GET", "/perfil"),
    cambiarContrasena: (actual, nueva) => request("PUT", "/perfil/contrasena", { actual, nueva }),

    // Registros: el periodo del ciclo que el docente elige antes que nada
    registros: () => request("GET", "/registros"),
    registro: (idRegistro) => request("GET", `/registros/${idRegistro}`),
    gruposDelRegistro: (idRegistro) => request("GET", `/registros/${idRegistro}/grupos`),

    grupos: (idCiclo) => request("GET", `/grupos${idCiclo ? `?ciclo=${idCiclo}` : ""}`),
    grupo: (idGrupo) => request("GET", `/grupos/${idGrupo}`),

    // Las evaluaciones se piden dentro de un registro; cada una trae sus componentes
    evaluaciones: (idGrupo, { tipo, idRegistro } = {}) => {
      const filtros = new URLSearchParams();
      if (tipo) filtros.set("tipo", tipo);
      if (idRegistro) filtros.set("registro", idRegistro);
      const consulta = filtros.toString();
      return request("GET", `/grupos/${idGrupo}/evaluaciones${consulta ? `?${consulta}` : ""}`);
    },
    notasDelRegistro: (idGrupo, idRegistro) =>
      request("GET", `/grupos/${idGrupo}/registros/${idRegistro}/notas`),

    evaluacion: (idEvaluacion) => request("GET", `/evaluaciones/${idEvaluacion}`),
    calificaciones: (idEvaluacion) => request("GET", `/evaluaciones/${idEvaluacion}/calificaciones`),
    // calificaciones: [{ id_matricula, notas: { id_componente: nota | null } }]
    guardarCalificaciones: (idEvaluacion, calificaciones) =>
      request("PUT", `/evaluaciones/${idEvaluacion}/calificaciones`, { calificaciones }),
    trasladar: (idEvaluacion) => request("POST", `/evaluaciones/${idEvaluacion}/traslado`),

    cum: (idEstudiante) => request("GET", `/estudiantes/${idEstudiante}/cum`),

    historial: () => request("GET", "/historial")
  };
})();
