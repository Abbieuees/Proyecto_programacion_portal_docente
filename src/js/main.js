/* PORTAL DOCENTE UEES */
// Antes de este archivo se cargan src/js/reglas.js (objeto Reglas) y src/js/api.js (objeto Api)

const TIPOS = { TAREA: "Tarea", PARCIAL: "Parcial", PROYECTO: "Proyecto" };

// Color e ícono de la tarjeta según el código de la asignatura
const ESTILO_ASIGNATURA = {
  BD: { banner: "blue", icon: "bi bi-database" },
  PW: { banner: "orange", icon: "bi bi-code" }
};
const ESTILO_POR_DEFECTO = { banner: "blue", icon: "bi bi-journal-bookmark" };

const $  = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

// Los textos vienen del servidor: se escapan antes de insertarlos como HTML
function escapeHtml(value){
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
// "2026-08-21" → "21/08/2026" (sin usar Date, para que la zona horaria no cambie el día)
function formatDate(isoDate){
  if (!isoDate) return "—";
  const [year, month, day] = isoDate.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}
// Fecha y hora ISO (UTC) → fecha local "12/08/2026"
function formatDateTime(isoDateTime){
  return new Date(isoDateTime).toLocaleDateString("es-SV", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function formatAverage(average){
  return average === null ? "—" : average.toFixed(2);
}
function statusFor(grade){
  const label = Reglas.estadoDeNota(grade);
  return { label, cls: `status-${label.toLowerCase()}` };
}
function showToast(msg){
  const toast = $("#toast");
  if (!toast) return;
  // El contenedor es una región aria-live: el lector de pantalla anuncia el mensaje
  toast.textContent = msg;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toast.textContent = ""; }, 3500);
}

const loginForm = $("#login-form");
if (loginForm) {
  const errorBox = $("#login-error");
  const submitBtn = $("#login-form button[type=submit]");
  const showLoginError = (msg) => {
    errorBox.textContent = msg;
    errorBox.hidden = false;
  };

  // Con una sesión guardada ("Recordar sesión") se entra directo al portal
  if (Api.haySesion()) window.location.replace("portal-docente.html");
  if (new URLSearchParams(location.search).get("sesion") === "expirada") {
    showLoginError("Tu sesión expiró. Inicia sesión de nuevo.");
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const user = $("#login-user").value.trim();
    const pass = $("#login-pass").value;

    if (!user || !pass) {
      showLoginError("Ingresa tu usuario y contraseña para continuar.");
      return;
    }
    errorBox.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "INGRESANDO…";

    try {
      await Api.login(user, pass, $("#login-remember").checked);
      window.location.href = "portal-docente.html";
    } catch (err) {
      showLoginError(err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = "INICIAR SESIÓN";
    }
  });
}

   /*PAGINA: portal-docente.html  */
const sidebar = $("#sidebar");
if (sidebar) {

  const state = {
    page: null,
    registros: [],             // periodos del ciclo (Inicio)
    registro: null,            // registro en el que el docente está trabajando
    groups: [],                // sus asignaturas dentro de ese registro
    group: null,               // asignatura abierta
    cicloId: null,             // ciclo elegido en el selector de Inicio
    groupFilter: null,         // asignatura elegida en el selector de Inicio
    evaluation: null,          // evaluación abierta en la carga de notas
    rows: [],                  // estudiantes de esa evaluación
    cycleSummary: [],          // notas del período y proyección del ciclo por estudiante
    saved: [],                 // [{ id_componente: nota }] tal como están en el servidor
    draft: null,               // misma forma, editable; se envía al pulsar "Guardar"
    gradesFrom: "evaluations", // página a la que regresa "Volver" desde la carga de notas
    navSeq: 0                  // número de la última navegación pedida
  };

  // El recorrido es: Inicio (elegir registro) -> Mis asignaturas (elegir asignatura)
  // -> evaluaciones del registro -> carga de notas por componente.
  const PAGES = {
    dashboard:   { title: () => "Inicio", load: () => Api.registros(), paint: paintDashboard },
    subjects:    { title: () => state.registro?.nombre ?? "Mis asignaturas", back: true, load: loadSubjects, paint: paintSubjects },
    evaluations: { title: () => state.group.nombre_asignatura, back: true, load: loadEvaluations, paint: paintEvaluations },
    grades:      { title: () => `${state.evaluation.nombre_asignatura} / ${state.evaluation.nombre}`, back: true, load: loadGrades, paint: paintGrades },
    history:     { title: () => "Historial", load: () => Api.historial(), paint: paintHistory },
    profile:     { title: () => "Mi perfil", load: loadProfile, paint: paintProfile },
    help:        { title: () => "Ayuda" }
  };

  // Toda navegación pasa por aquí: pide los datos a la API y después dibuja la página.
  // Si mientras tanto se pidió otra página, esta respuesta se descarta.
  async function navigateTo(page, params = {}){
    const seq = ++state.navSeq;
    const def = PAGES[page];
    let data = null;
    try {
      if (def.load) data = await def.load(params);
    } catch (err) {
      if (seq === state.navSeq) handleError(err);
      return false;
    }
    if (seq !== state.navSeq) return false;

    state.page = page;
    def.paint?.(data, params);

    $$(".page").forEach(p => p.classList.toggle("active", p.id === "page-" + page));
    $$(".nav-item[data-nav]").forEach(n => {
      const active = n.dataset.nav === page;
      n.classList.toggle("active", active);
      if (active) n.setAttribute("aria-current", "page");
      else n.removeAttribute("aria-current");
    });

    $("#topbar-title").textContent = def.title();
    $("#back-btn").hidden = !def.back;
    $(".topbar").classList.toggle("has-back", !!def.back);

    closeMobileMenu();
    window.scrollTo({ top: 0, behavior: "instant" });
    return true;
  }

  async function goTo(page, params){
    if (!(await confirmLeave())) return false;
    return navigateTo(page, params);
  }

  // Sesión vencida (401): vuelve al inicio de sesión. Otros errores: aviso en pantalla.
  function handleError(err){
    if (err.status === 401) {
      Api.borrarSesion();
      state.draft = null; // sin aviso de cambios sin guardar
      window.location.replace("index.html?sesion=expirada");
      return;
    }
    showToast(err.message || "Ocurrió un error inesperado.");
  }

  // Antes de salir de la carga de notas con cambios sin guardar, pide confirmación
  async function confirmLeave(){
    if (!hasUnsavedChanges()) return true;
    return confirmDialog({
      title: "¿Descartar los cambios?",
      message: "Tienes calificaciones sin guardar. Si sales ahora se perderán.",
      confirmText: "Descartar cambios",
      cancelText: "Seguir editando",
      variant: "danger"
    });
  }

  // Diálogo de confirmación accesible (<dialog>); resuelve true si se confirma
  function confirmDialog({ title, message, confirmText, cancelText = "Cancelar", variant = "success" }){
    const dialog = $("#confirm-dialog");
    const okBtn = $("#confirm-ok");
    const cancelBtn = $("#confirm-cancel");
    $("#confirm-title").textContent = title;
    $("#confirm-message").textContent = message;
    cancelBtn.textContent = cancelText;
    okBtn.textContent = confirmText;
    okBtn.className = `btn btn-${variant}`;
    dialog.showModal(); // el foco inicia en "Cancelar", la opción segura

    return new Promise(resolve => {
      const finish = (confirmed) => {
        okBtn.removeEventListener("click", onOk);
        cancelBtn.removeEventListener("click", onCancel);
        dialog.removeEventListener("cancel", onEsc);
        dialog.close();
        resolve(confirmed);
      };
      const onOk = () => finish(true);
      const onCancel = () => finish(false);
      const onEsc = (e) => { e.preventDefault(); finish(false); }; // tecla Esc
      okBtn.addEventListener("click", onOk);
      cancelBtn.addEventListener("click", onCancel);
      dialog.addEventListener("cancel", onEsc);
    });
  }

  $$(".nav-item[data-nav]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const page = btn.dataset.nav;
      if (page === state.page) return closeMobileMenu();
      goTo(page, page === "grades" ? { from: "evaluations" } : {});
    });
  });

  // Volver sigue el recorrido al revés: notas -> evaluaciones -> asignaturas -> inicio
  const PAGINA_ANTERIOR = { subjects: "dashboard", evaluations: "subjects" };
  $("#back-btn").addEventListener("click", () => {
    goTo(state.page === "grades" ? state.gradesFrom : (PAGINA_ANTERIOR[state.page] ?? "dashboard"));
  });

  $("#user-chip").addEventListener("click", () => {
    if (state.page !== "profile") goTo("profile");
  });

  $("#logout-btn").addEventListener("click", async () => {
    if (!(await confirmLeave())) return;
    state.draft = null; // evita el aviso del navegador al salir
    await Api.logout().catch(() => {}); // aunque falle la red, la sesión local se borra
    window.location.href = "index.html";
  });

  // Aviso del navegador si se cierra o recarga la pestaña con notas sin guardar
  window.addEventListener("beforeunload", (e) => {
    if (hasUnsavedChanges()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // Barra de carga mientras hay peticiones a la API
  document.addEventListener("api:carga", (e) => {
    const busy = e.detail.pendientes > 0;
    document.body.classList.toggle("cargando", busy);
    $(".content").setAttribute("aria-busy", String(busy));
  });


  const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const MESES_CORTOS = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

  // Fecha "YYYY-MM-DD" → Date local (mediodía, evita saltos por zona horaria)
  function parseDay(iso){
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d, 12);
  }

  // Porcentaje de tiempo transcurrido entre inicio y fin del registro
  function progresoDeRegistro(r){
    if (r.estado !== "ABIERTO") return 100;
    const ini = parseDay(r.fecha_inicio).getTime();
    const fin = parseDay(r.fecha_fin).getTime();
    if (fin <= ini) return 0;
    return Math.round(Math.min(1, Math.max(0, (Date.now() - ini) / (fin - ini))) * 100);
  }

  function paintDashboardExtras(registros){
    const abiertos = registros.filter(r => r.estado === "ABIERTO");
    const pesoCerrado = registros.filter(r => r.estado !== "ABIERTO").reduce((s, r) => s + Number(r.ponderacion), 0);
    const stats = [
      { icon: "bi-journal-bookmark", tone: "navy",  value: registros.length, label: "Registros del ciclo" },
      { icon: "bi-unlock",           tone: "gold",  value: abiertos.length, label: "Registros abiertos" },
      { icon: "bi-lock",             tone: "green", value: registros.length - abiertos.length, label: "Registros cerrados" },
      { icon: "bi-graph-up-arrow",   tone: "amber", value: `${pesoCerrado}%`, label: "Ciclo completado" }
    ];
    $("#dash-stats").innerHTML = stats.map(s => `
      <div class="stat-card">
        <span class="stat-icon ${s.tone}"><i class="bi ${s.icon}" aria-hidden="true"></i></span>
        <div><strong>${s.value}</strong><span>${s.label}</span></div>
      </div>`).join("");

    // Eventos: inicio y cierre de cada registro
    state.eventos = registros.flatMap(r => [
      { fecha: r.fecha_inicio, titulo: `Inicio: ${r.nombre}`, icon: "bi-play-circle" },
      { fecha: r.fecha_fin, titulo: `Cierre: ${r.nombre}`, icon: "bi-flag" }
    ]).filter(e => e.fecha)
      .sort((a, b) => parseDay(a.fecha) - parseDay(b.fecha));
    state.diaElegido = null;
    state.mesCalendario = new Date();
    paintCalendar();
    paintEventos();
  }

  const isoDe = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  // Con un día elegido muestra sus eventos; si no, los próximos
  function paintEventos(){
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const titulo = $("#dash-events-title");
    let lista;
    if (state.diaElegido) {
      const d = parseDay(state.diaElegido);
      titulo.textContent = `Eventos del ${d.getDate()} de ${MESES[d.getMonth()].toLowerCase()}`;
      lista = state.eventos.filter(e => e.fecha.slice(0, 10) === state.diaElegido);
    } else {
      titulo.textContent = "Próximos eventos";
      const proximos = state.eventos.filter(e => parseDay(e.fecha) >= hoy);
      lista = (proximos.length ? proximos : state.eventos.slice(-3)).slice(0, 3);
    }
    $("#dash-events").innerHTML = lista.length ? lista.map(e => {
      const d = parseDay(e.fecha);
      return `
      <li class="event-item">
        <span class="stat-icon navy"><i class="bi ${e.icon}" aria-hidden="true"></i></span>
        <div><strong>${escapeHtml(e.titulo)}</strong><span>${d.getDate()} de ${MESES[d.getMonth()].toLowerCase()}, ${d.getFullYear()}</span></div>
      </li>`;
    }).join("") : `<li class="event-empty">No hay eventos ${state.diaElegido ? "este día" : "próximos"}.</li>`;
  }

  function paintCalendar(){
    const ref = state.mesCalendario;
    const year = ref.getFullYear(), month = ref.getMonth();
    const hoyIso = isoDe(new Date());
    const marcadas = new Set(state.eventos.map(e => e.fecha.slice(0, 10)));
    const primerDia = (new Date(year, month, 1).getDay() + 6) % 7; // semana desde lunes
    const diasMes = new Date(year, month + 1, 0).getDate();
    const celdas = [];
    for (let i = 0; i < primerDia; i++) celdas.push(`<span></span>`);
    for (let d = 1; d <= diasMes; d++) {
      const iso = isoDe(new Date(year, month, d));
      const cls = [iso === hoyIso ? "today" : "", marcadas.has(iso) ? "marked" : "", iso === state.diaElegido ? "picked" : ""].join(" ").trim();
      celdas.push(`<button type="button" class="${cls}" data-dia="${iso}" aria-pressed="${iso === state.diaElegido}"
        aria-label="${d} de ${MESES[month].toLowerCase()} de ${year}${marcadas.has(iso) ? ", con eventos" : ""}">${d}</button>`);
    }
    $("#mini-calendar").innerHTML = `
      <div class="mini-cal-head">
        <button type="button" class="icon-btn" data-mes="-1" aria-label="Mes anterior"><i class="bi bi-chevron-left" aria-hidden="true"></i></button>
        <p class="mini-cal-title" aria-live="polite">${MESES[month]} ${year}</p>
        <button type="button" class="icon-btn" data-mes="1" aria-label="Mes siguiente"><i class="bi bi-chevron-right" aria-hidden="true"></i></button>
      </div>
      <div class="mini-cal-grid">
        ${["Lu","Ma","Mi","Ju","Vi","Sá","Do"].map(n => `<b>${n}</b>`).join("")}
        ${celdas.join("")}
      </div>
      <button type="button" class="btn btn-outline mini-cal-today" data-hoy>Hoy</button>`;
  }

  $("#mini-calendar").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.mes) {
      const m = state.mesCalendario;
      state.mesCalendario = new Date(m.getFullYear(), m.getMonth() + Number(btn.dataset.mes), 1);
    } else if (btn.hasAttribute("data-hoy")) {
      state.mesCalendario = new Date();
      state.diaElegido = null;
    } else if (btn.dataset.dia) {
      state.diaElegido = state.diaElegido === btn.dataset.dia ? null : btn.dataset.dia;
    } else return;
    paintCalendar();
    paintEventos();
    $("#mini-calendar").querySelector(btn.dataset.dia ? `[data-dia="${btn.dataset.dia}"]` : btn.dataset.mes ? `[data-mes="${btn.dataset.mes}"]` : "[data-hoy]")?.focus();
  });

  /* INICIO: el docente elige el registro en el que va a trabajar.
     Aquí ya no se muestran las asignaturas; eso vive en "Mis asignaturas". */
  function paintDashboard(todos){
    state.registros = todos;
    const wrap = $("#registro-cards");
    const selectCiclo = $("#select-ciclo");
    const selectGrupo = $("#select-grupo");

    if (!todos.length) {
      selectCiclo.innerHTML = selectGrupo.innerHTML = "";
      selectCiclo.disabled = selectGrupo.disabled = true;
      wrap.innerHTML = `<p class="empty-state">No tienes grupos asignados en ningún ciclo.</p>`;
      return;
    }
    // Si el registro guardado ya no existe (p. ej. cambió el ciclo), se olvida
    if (state.registro && !todos.some(r => r.id_registro === state.registro.id_registro)) {
      state.registro = null;
      state.group = null;
    }

    // Ciclos distintos del docente; por defecto el ciclo abierto (el más reciente)
    const ciclos = [...new Map(todos.map(r => [r.id_ciclo, r])).values()];
    if (!ciclos.some(c => c.id_ciclo === state.cicloId)) {
      state.cicloId = (ciclos.find(c => c.estado_ciclo === "ABIERTO") ?? ciclos[0]).id_ciclo;
    }
    selectCiclo.disabled = false;
    selectCiclo.innerHTML = ciclos.map(c => `
      <option value="${c.id_ciclo}" ${c.id_ciclo === state.cicloId ? "selected" : ""}>
        Ciclo ${escapeHtml(c.codigo_ciclo)}${c.estado_ciclo === "ABIERTO" ? " (en curso)" : " (cerrado)"}
      </option>`).join("");
    selectCiclo.onchange = () => {
      state.cicloId = Number(selectCiclo.value);
      state.groupFilter = null;
      paintDashboard(state.registros);
    };

    const registros = todos.filter(r => r.id_ciclo === state.cicloId);
    paintGroupSelect(selectGrupo);
    paintDashboardExtras(registros);

    wrap.innerHTML = registros.map(r => {
      const abierto = r.estado === "ABIERTO";
      const elegido = state.registro?.id_registro === r.id_registro;
      const avance = progresoDeRegistro(r);
      return `
      <article class="registro-card ${elegido ? "selected" : ""} ${abierto ? "" : "closed"}">
        <div class="registro-peso"><strong>${r.ponderacion}</strong><span>%</span></div>
        <div class="registro-body">
          <span class="status-pill ${abierto ? "status-aprobado" : "status-pendiente"}">${abierto ? "ABIERTO" : "CERRADO"}</span>
          <h3>${escapeHtml(r.nombre)}</h3>
          <span class="subject-meta">Ciclo ${escapeHtml(r.codigo_ciclo)}</span>
          <div class="progress-row">
            <div class="progress" role="progressbar" aria-label="Avance de ${escapeHtml(r.nombre)}"
                 aria-valuemin="0" aria-valuemax="100" aria-valuenow="${avance}">
              <span style="width:${avance}%"></span>
            </div>
            <strong>${avance}%</strong>
          </div>
          <span class="subject-meta">
            <i class="bi bi-calendar3" aria-hidden="true"></i>${formatDate(r.fecha_inicio)} – ${formatDate(r.fecha_fin)}
          </span>
          <button class="btn btn-primary" data-registro="${r.id_registro}"
                  aria-label="Trabajar en ${escapeHtml(r.nombre)} del ciclo ${escapeHtml(r.codigo_ciclo)}">
            ${elegido ? "Continuar" : "Trabajar aquí"}
          </button>
        </div>
      </article>`;
    }).join("");

    $$("#registro-cards [data-registro]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = Number(btn.dataset.registro);
        const registro = state.registros.find(r => r.id_registro === id);
        if (state.registro?.id_registro !== id) state.group = null; // otro registro, otra selección
        state.registro = registro;
        // Con una asignatura elegida en el desplegable se salta directo a sus evaluaciones
        if (state.groupFilter) goTo("evaluations", { groupId: state.groupFilter });
        else goTo("subjects", { registroId: id });
      });
    });
  }

  // Desplegable de asignaturas del docente en el ciclo seleccionado (código y sección)
  async function paintGroupSelect(select){
    const idCiclo = state.cicloId;
    select.disabled = true;
    select.innerHTML = `<option value="">Cargando…</option>`;
    let grupos = [];
    try {
      grupos = await Api.grupos(idCiclo);
    } catch (err) {
      if (err.status === 401) return handleError(err);
    }
    if (idCiclo !== state.cicloId) return; // se cambió de ciclo mientras cargaba
    if (!grupos.some(g => g.id_grupo === state.groupFilter)) state.groupFilter = null;
    select.innerHTML = `<option value="">Todas mis asignaturas</option>` + grupos.map(g => `
      <option value="${g.id_grupo}" ${g.id_grupo === state.groupFilter ? "selected" : ""}>
        ${escapeHtml(g.nombre_asignatura)} · ${escapeHtml(g.codigo_asignatura)} · Sección ${escapeHtml(g.codigo_grupo)}
      </option>`).join("");
    select.disabled = false;
    select.onchange = () => { state.groupFilter = select.value ? Number(select.value) : null; };
  }


  /* MIS ASIGNATURAS: dentro del registro elegido, el docente selecciona
     cuál está revisando. */
  async function loadSubjects({ registroId } = {}){
    const id = registroId ?? state.registro?.id_registro;
    if (!id) {
      // Se entró por el menú sin haber elegido registro: se toma el primero abierto
      const registros = state.registros.length ? state.registros : await Api.registros();
      state.registros = registros;
      state.registro = registros.find(r => r.estado === "ABIERTO") ?? registros[0];
      if (!state.registro) return { registro: null, groups: [] };
    }
    const idRegistro = state.registro.id_registro;
    return { registro: state.registro, groups: await Api.gruposDelRegistro(idRegistro) };
  }

  function paintSubjects({ registro, groups }){
    state.groups = groups;
    const wrap = $("#subject-cards");

    if (!registro) {
      $("#subjects-registro-title").textContent = "Sin registros";
      $("#subjects-registro-meta").textContent = "No hay periodos de evaluación disponibles";
      wrap.innerHTML = `<p class="empty-state">No tienes grupos asignados.</p>`;
      return;
    }

    state.registro = registro;
    $("#subjects-registro-title").textContent = `${registro.nombre} · Ciclo ${registro.codigo_ciclo}`;
    $("#subjects-registro-meta").textContent =
      `Vale el ${registro.ponderacion} % del ciclo · ${registro.estado === "ABIERTO" ? "Abierto" : "Cerrado"}`;

    if (!groups.length) {
      wrap.innerHTML = `<p class="empty-state">No tienes asignaturas en este registro.</p>`;
      return;
    }

    wrap.innerHTML = groups.map(g => {
      const style = ESTILO_ASIGNATURA[g.codigo_asignatura] ?? ESTILO_POR_DEFECTO;
      const name = escapeHtml(g.nombre_asignatura);
      const code = escapeHtml(g.codigo_grupo);
      const elegida = state.group?.id_grupo === g.id_grupo;
      // El reparto debe llegar a 100 % antes de poder cerrar el registro
      const aviso = g.reparto_completo
        ? `<span class="subject-meta"><i class="bi bi-check2-circle" aria-hidden="true"></i>Reparto completo (100 %)</span>`
        : `<span class="subject-meta warn"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i>Reparto incompleto: ${g.reparto} % de 100 %</span>`;
      return `
      <article class="subject-card ${elegida ? "selected" : ""}">
        <div class="subject-banner ${style.banner}"><i class="${style.icon}" aria-hidden="true"></i></div>
        <div class="subject-body">
          <h3>${name}</h3>
          <span class="subject-meta">Grupo: ${code} · Ciclo: ${escapeHtml(g.codigo_ciclo)}</span>
          <span class="subject-meta"><i class="bi bi-people" aria-hidden="true"></i>Estudiantes: ${g.total_estudiantes}</span>
          <span class="subject-meta">
            <i class="bi bi-list-check" aria-hidden="true"></i>${g.trasladadas} de ${g.total_evaluaciones} evaluaciones trasladadas
          </span>
          ${aviso}
          <button class="btn btn-primary" data-group="${g.id_grupo}" aria-label="Revisar ${name}, grupo ${code}">
            ${elegida ? "Continuar" : "Revisar"}
          </button>
        </div>
      </article>`;
    }).join("");

    $$("#subject-cards [data-group]").forEach(btn => {
      btn.addEventListener("click", () => goTo("evaluations", { groupId: Number(btn.dataset.group) }));
    });
  }


  async function loadEvaluations({ groupId } = {}){
    const id = groupId ?? state.group?.id_grupo ?? state.groups[0]?.id_grupo;
    const tipo = $("#eval-filter").value;
    const [group, evaluations] = await Promise.all([
      Api.grupo(id),
      // Solo las evaluaciones del registro elegido: cada registro lleva su propia tanda
      Api.evaluaciones(id, { tipo: tipo === "all" ? null : tipo, idRegistro: state.registro?.id_registro })
    ]);
    return { group, evaluations };
  }

  function paintEvaluations({ group, evaluations }){
    // Al cambiar de grupo se olvida la evaluación del grupo anterior
    if (state.group?.id_grupo !== group.id_grupo) state.evaluation = null;
    state.group = group;

    $("#eval-group-title").textContent = `Grupo: ${group.codigo_grupo}`;
    $("#eval-group-count").textContent = `Estudiantes inscritos: ${group.total_estudiantes}`;
    $("#eval-registro-meta").textContent = state.registro
      ? `${state.registro.nombre} · vale el ${state.registro.ponderacion} % del ciclo`
      : "Todos los registros";

    // Aviso de reparto: las evaluaciones del registro deben sumar el 100 % de ese
    // registro. Solo tiene sentido cuando se está viendo el registro sin filtrar
    // por tipo; si no, la suma es parcial por definición.
    const sinFiltro = $("#eval-filter").value === "all" && state.registro;
    const reparto = evaluations.reduce((total, e) => total + e.ponderacion, 0);
    $("#reparto-banner").hidden = !(sinFiltro && reparto !== 100);
    if (sinFiltro && reparto !== 100) {
      $("#reparto-text").textContent =
        `Las evaluaciones de este registro suman ${reparto} %. Deben sumar 100 % antes de poder cerrarlo.`;
    }

    const partes = (e) => e.componentes.length === 1
      ? "Nota única"
      : e.componentes.map(c => `${escapeHtml(c.nombre)} ${c.ponderacion} %`).join(" · ");

    // tabla (desktop)
    $("#eval-table-body").innerHTML = evaluations.length
      ? evaluations.map(e => `
      <tr>
        <td>${escapeHtml(e.nombre)}</td>
        <td>${TIPOS[e.tipo] ?? escapeHtml(e.tipo)}</td>
        <td>${e.ponderacion} %</td>
        <td class="eval-partes">${partes(e)}</td>
        <td>${formatDate(e.fecha_evaluacion)}</td>
        <td><button class="btn-select" data-eval="${e.id_evaluacion}" aria-label="Seleccionar ${escapeHtml(e.nombre)}">Seleccionar</button></td>
      </tr>`).join("")
      : `<tr><td colspan="6">No hay evaluaciones de este tipo en este registro.</td></tr>`;

    // lista (móvil)
    $("#eval-list").innerHTML = evaluations.length
      ? evaluations.map(e => `
      <button class="eval-row" data-eval="${e.id_evaluacion}">
        <span class="eval-row-main">
          <strong>${escapeHtml(e.nombre)}</strong>
          <span>${TIPOS[e.tipo] ?? escapeHtml(e.tipo)} · vale ${e.ponderacion} %</span>
          <span class="eval-partes">${partes(e)}</span>
        </span>
        <span class="eval-row-right">
          <span>${formatDate(e.fecha_evaluacion)}</span>
          <i class="bi bi-chevron-right" aria-hidden="true"></i>
        </span>
      </button>`).join("")
      : `<p class="empty-state">No hay evaluaciones de este tipo en este registro.</p>`;

    $$("#page-evaluations [data-eval]").forEach(el => {
      el.addEventListener("click", () => goTo("grades", { evaluationId: Number(el.dataset.eval), from: "evaluations" }));
    });
  }
  $("#eval-filter").addEventListener("change", () => navigateTo("evaluations"));


  async function loadGrades({ evaluationId } = {}){
    let id = evaluationId ?? state.evaluation?.id_evaluacion;
    if (!id) {
      // Desde el menú, sin evaluación elegida: la primera sin trasladar del grupo actual
      const groupId = state.group?.id_grupo ?? state.groups[0]?.id_grupo;
      const evaluations = await Api.evaluaciones(groupId, { idRegistro: state.registro?.id_registro });
      id = (evaluations.find(e => e.estado !== "TRASLADADA") ?? evaluations[0])?.id_evaluacion;
    }
    const evaluation = await Api.evaluacion(id);
    const [rows, cycleSummary] = await Promise.all([
      Api.calificaciones(id),
      Api.notasDelRegistro(evaluation.id_grupo, evaluation.id_registro)
    ]);
    return { evaluation, rows, cycleSummary };
  }

  function paintGrades({ evaluation, rows, cycleSummary }, { from } = {}){
    if (from) state.gradesFrom = from;
    if (state.group?.id_grupo !== evaluation.id_grupo) {
      state.group = state.groups.find(g => g.id_grupo === evaluation.id_grupo)
        ?? { id_grupo: evaluation.id_grupo, codigo_grupo: evaluation.codigo_grupo, nombre_asignatura: evaluation.nombre_asignatura };
    }
    state.evaluation = evaluation;
    state.rows = rows;
    state.cycleSummary = cycleSummary;
    // Las notas cuelgan de los componentes: { id_componente: nota }
    state.saved = rows.map(r => ({ ...r.notas }));
    state.draft = rows.map(r => ({ ...r.notas }));
    const comps = evaluation.componentes;
    const locked = isLocked();

    $("#grades-group-title").textContent = `Grupo: ${evaluation.codigo_grupo}`;
    $("#grades-eval-title").textContent = `Evaluación: ${evaluation.nombre}`;
    $("#grades-registro-meta").textContent =
      `${evaluation.nombre_registro} · vale el ${evaluation.ponderacion} % del registro`;
    $("#grades-due-date").textContent = `Fecha límite: ${formatDate(evaluation.fecha_limite)}`;
    $("#min-grade").textContent = Reglas.NOTA_MINIMA.toFixed(1);
    $("#locked-banner").hidden = !locked;
    if (locked) {
      $("#locked-text").textContent =
        `Estas calificaciones se trasladaron el ${formatDateTime(evaluation.fecha_traslado)} y no pueden modificarse.`;
    }

    // Cabecera: una columna por componente. Con un solo componente al 100 %
    // se muestra "Nota" a secas, para no cargar la pantalla sin necesidad.
    const unaSolaParte = comps.length === 1;
    $("#grades-table-head").innerHTML = `
      <tr>
        <th>#</th><th>CIF</th><th>Estudiante</th>
        ${comps.map(c => `<th>${unaSolaParte ? "Nota" : `${escapeHtml(c.nombre)}<span class="th-peso">${c.ponderacion} %</span>`}</th>`).join("")}
        ${unaSolaParte ? "" : "<th>Nota final</th>"}
        <th>Estado</th>
      </tr>`;

    // tabla (desktop)
    $("#grades-table-body").innerHTML = rows.map((row, i) => {
      const nota = notaPonderada(i);
      const status = statusFor(nota);
      return `
        <tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(row.cif_estudiante)}</td>
          <td>${escapeHtml(row.nombre_estudiante)}</td>
          ${comps.map(c => `<td>${gradeInput(row, i, c, "t", locked)}</td>`).join("")}
          ${unaSolaParte ? "" : `<td><strong class="nota-final" data-nota="${i}">${formatGrade(nota)}</strong></td>`}
          <td><span class="status-pill ${status.cls}" data-status="${i}">${status.label}</span></td>
        </tr>`;
    }).join("");

    // acordeón (móvil)
    $("#grades-accordion").innerHTML = rows.map((row, i) => {
      const nota = notaPonderada(i);
      const status = statusFor(nota);
      const open = i === 0;
      return `
        <div class="grade-card ${open ? "open" : ""}">
          <button class="grade-card-header" aria-expanded="${open}" aria-controls="grade-card-${i}">
            <span><strong>${i + 1}. ${escapeHtml(row.nombre_estudiante)}</strong><span class="cif">${escapeHtml(row.cif_estudiante)}</span></span>
            <i class="bi bi-chevron-down chev" aria-hidden="true"></i>
          </button>
          <div class="grade-card-body" id="grade-card-${i}">
            ${comps.map(c => `
            <div class="grade-card-field">
              <label class="grade-card-label" for="grade-c-${i}-${c.id_componente}">
                ${unaSolaParte ? "Nota" : `${escapeHtml(c.nombre)} <span class="th-peso">${c.ponderacion} %</span>`}
              </label>
              ${gradeInput(row, i, c, "c", locked)}
            </div>`).join("")}
            ${unaSolaParte ? "" : `
            <div class="grade-card-field">
              <span class="grade-card-label">Nota final</span>
              <strong class="nota-final" data-nota="${i}">${formatGrade(nota)}</strong>
            </div>`}
            <div class="grade-card-field">
              <span class="grade-card-label">Estado</span>
              <span class="status-pill ${status.cls}" data-status="${i}">${status.label}</span>
            </div>
          </div>
        </div>`;
    }).join("");

    paintCycleSummary();
    wireGradeInputs();
    wireAccordionToggles();

    $("#save-grades").hidden = locked;
    $("#translate-grades").hidden = locked;
    $("#import-grades").hidden = locked;
    $("#template-grades").hidden = locked;
    updateSaveButtonState();
  }

  function paintCycleSummary(){
    const periodo = `${state.evaluation.nombre_registro} (${state.evaluation.ponderacion_registro} % del ciclo)`;
    $("#cycle-summary-description").textContent =
      `La nota del ciclo pondera Registro 1 (30 %), Registro 2 (30 %) y Registro 3 (40 %). ` +
      `Mientras existan períodos pendientes se muestra una proyección con las notas registradas.`;
    const porMatricula = new Map(state.cycleSummary.map(fila => [fila.id_matricula, fila]));
    $("#cycle-summary-body").innerHTML = state.rows.map(row => {
      const resumen = porMatricula.get(row.id_matricula);
      const notaCiclo = resumen?.nota_proyectada ?? null;
      const estado = statusFor(notaCiclo);
      return `
        <tr>
          <td>${escapeHtml(row.cif_estudiante)}</td>
          <td>${escapeHtml(row.nombre_estudiante)}</td>
          <td>${formatGrade(resumen?.nota ?? null)}</td>
          <td><strong>${formatGrade(notaCiclo)}</strong></td>
          <td><span class="status-pill ${estado.cls}">${estado.label}</span></td>
        </tr>`;
    }).join("");
    $("#cycle-summary-title").lastChild.textContent = `Resumen de ${periodo}`;
  }

  function isLocked(){
    return state.evaluation?.estado === "TRASLADADA";
  }

  // Nota ponderada de una fila a partir de sus componentes. Es el mismo cálculo
  // que hace el servidor: se divide entre la ponderación realmente calificada,
  // así lo que todavía no se evalúa no castiga el promedio.
  function notaPonderada(i){
    let acumulado = 0, peso = 0;
    for (const c of state.evaluation.componentes) {
      const nota = state.draft[i][c.id_componente];
      if (nota !== null && nota !== undefined && nota !== "") {
        acumulado += Number(nota) * c.ponderacion;
        peso += c.ponderacion;
      }
    }
    return peso ? Math.round(acumulado / peso * 100) / 100 : null;
  }

  const formatGrade = (nota) => nota === null ? "--" : nota.toFixed(2);

  // Campo de nota de un componente; view = "t" (tabla) o "c" (tarjeta),
  // para que los id no se repitan entre las dos vistas de la misma fila.
  function gradeInput(row, i, componente, view, locked){
    const id = componente.id_componente;
    const etiqueta = state.evaluation.componentes.length === 1
      ? `Nota de ${escapeHtml(row.nombre_estudiante)}`
      : `${escapeHtml(componente.nombre)} de ${escapeHtml(row.nombre_estudiante)}`;
    return `
      <div class="grade-input-wrap">
        <input type="number" step="0.01" min="0" max="${Reglas.NOTA_MAXIMA}" inputmode="decimal" class="grade-input"
               id="grade-${view}-${i}-${id}" data-row="${i}" data-comp="${id}"
               value="${state.draft[i][id] ?? ""}" placeholder="--"
               aria-label="${etiqueta}" ${locked ? "disabled" : ""}>
        <p class="field-error" id="grade-error-${view}-${i}-${id}" hidden>Nota entre 0.00 y 10.00, máximo 2 decimales</p>
      </div>`;
  }

  const inputsDe = (i, idComponente) => $$(`.grade-input[data-row="${i}"][data-comp="${idComponente}"]`);

  function setFieldError(i, idComponente, hasError){
    inputsDe(i, idComponente).forEach(inp => {
      const msg = inp.nextElementSibling;
      inp.classList.toggle("input-error", hasError);
      msg.hidden = !hasError;
      if (hasError) {
        inp.setAttribute("aria-invalid", "true");
        inp.setAttribute("aria-describedby", msg.id);
      } else {
        inp.removeAttribute("aria-invalid");
        inp.removeAttribute("aria-describedby");
      }
    });
  }

  // Al cambiar un componente se recalcula la nota ponderada de toda la fila
  function updateRow(i){
    const nota = notaPonderada(i);
    $$(`[data-nota="${i}"]`).forEach(celda => { celda.textContent = formatGrade(nota); });
    const st = statusFor(nota);
    $$(`[data-status="${i}"]`).forEach(pill => {
      pill.textContent = st.label;
      pill.className = `status-pill ${st.cls}`;
    });
  }

  function hasInvalidGrades(){
    return $$("#page-grades .grade-input.input-error").length > 0;
  }

  function hasUnsavedChanges(){
    if (state.page !== "grades" || !state.draft || isLocked()) return false;
    if (hasInvalidGrades()) return true;
    return state.draft.some((fila, i) =>
      Object.keys(fila).some(id => fila[id] !== state.saved[i][id]));
  }

  function updateSaveButtonState(){
    $("#save-grades").disabled = hasInvalidGrades();
  }

  function wireGradeInputs(){
    $$("#page-grades .grade-input").forEach(input => {
      input.addEventListener("input", () => {
        const i = Number(input.dataset.row);
        const idComponente = Number(input.dataset.comp);
        const raw = input.value;
        // badInput: el navegador no pudo leer un número (p. ej. se escribió solo "e" o "-")
        const valid = !input.validity.badInput && Reglas.esNotaValida(raw);

        // sincroniza el mismo valor (válido o no) entre tabla y acordeón
        inputsDe(i, idComponente).forEach(other => {
          if (other !== input) other.value = raw;
        });
        setFieldError(i, idComponente, !valid);

        // solo se modifica la copia de trabajo; el servidor se actualiza al pulsar "Guardar"
        if (valid) {
          state.draft[i][idComponente] = raw === "" ? null : Number(raw);
          updateRow(i);
        }
        updateSaveButtonState();
      });
    });
  }

  function wireAccordionToggles(){
    $$(".grade-card-header").forEach(btn => {
      btn.addEventListener("click", () => {
        const open = btn.closest(".grade-card").classList.toggle("open");
        btn.setAttribute("aria-expanded", open);
      });
    });
  }

  $("#save-grades").addEventListener("click", async () => {
    if (!state.evaluation || isLocked()) return;

    if (hasInvalidGrades()) {
      showToast("Corrige las notas fuera de rango antes de guardar");
      return;
    }
    if (!hasUnsavedChanges()) {
      showToast("No hay cambios por guardar");
      return;
    }

    // Una entrada por estudiante con las notas de todos sus componentes
    const calificaciones = state.rows.map((row, i) => ({ id_matricula: row.id_matricula, notas: state.draft[i] }));
    $("#save-grades").disabled = true;
    try {
      const rows = await Api.guardarCalificaciones(state.evaluation.id_evaluacion, calificaciones);
      state.rows = rows;
      state.saved = rows.map(r => ({ ...r.notas }));
      state.cycleSummary = await Api.notasDelRegistro(
        state.evaluation.id_grupo,
        state.evaluation.id_registro
      );
      paintCycleSummary();
      showToast("Calificaciones guardadas correctamente");
    } catch (err) {
      handleError(err);
      if (err.status === 409) navigateTo("grades"); // se trasladó en otra sesión: se recarga en modo lectura
    } finally {
      updateSaveButtonState();
    }
  });

  $("#translate-grades").addEventListener("click", async () => {
    if (!state.evaluation || isLocked()) return;

    if (hasInvalidGrades()) {
      showToast("Corrige las notas fuera de rango antes de trasladar");
      return;
    }
    if (hasUnsavedChanges()) {
      showToast("Guarda las calificaciones antes de trasladarlas");
      return;
    }
    // Falta una nota por cada componente sin calificar, no por estudiante
    const pending = state.saved.reduce((total, fila) =>
      total + Object.values(fila).filter(nota => nota === null).length, 0);
    if (pending > 0) {
      showToast(pending === 1
        ? "No se puede trasladar: falta 1 nota por ingresar"
        : `No se puede trasladar: faltan ${pending} notas por ingresar`);
      return;
    }

    const confirmed = await confirmDialog({
      title: "¿Trasladar las calificaciones?",
      message: `Vas a trasladar las notas de ${state.evaluation.nombre} del grupo ${state.evaluation.codigo_grupo}. Una vez trasladadas no podrán modificarse.`,
      confirmText: "Trasladar"
    });
    if (!confirmed) return;

    $("#translate-grades").disabled = true;
    try {
      const evaluation = await Api.trasladar(state.evaluation.id_evaluacion);
      paintGrades({ evaluation, rows: state.rows, cycleSummary: state.cycleSummary });
      showToast("Calificaciones trasladadas correctamente");
    } catch (err) {
      handleError(err);
    } finally {
      $("#translate-grades").disabled = false;
    }
  });

  /* CARGA MASIVA: lee un CSV o JSON, valida y vuelca las notas en la copia de
     trabajo. Nada se envía al servidor hasta pulsar "Guardar Calificaciones". */
  const normalizar = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

  function parseCsv(texto){
    const limpio = texto.replace(/^\uFEFF/, "");
    const primera = limpio.split(/\r?\n/).find(l => l.trim()) ?? "";
    const sep = [";", "\t", ","].map(s => [s, primera.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
    const filas = [];
    let fila = [], celda = "", comillas = false;
    for (let k = 0; k < limpio.length; k++) {
      const ch = limpio[k];
      if (comillas) {
        if (ch === '"' && limpio[k + 1] === '"') { celda += '"'; k++; }
        else if (ch === '"') comillas = false;
        else celda += ch;
      } else if (ch === '"') comillas = true;
      else if (ch === sep) { fila.push(celda); celda = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && limpio[k + 1] === "\n") k++;
        fila.push(celda); celda = "";
        if (fila.some(c => c.trim())) filas.push(fila);
        fila = [];
      } else celda += ch;
    }
    fila.push(celda);
    if (fila.some(c => c.trim())) filas.push(fila);
    return filas.map(f => f.map(c => c.trim()));
  }

  // Devuelve [{ cif, valores: { indiceComponente: texto } }]
  function registrosDeCsv(texto, comps){
    const filas = parseCsv(texto);
    if (!filas.length) throw new Error("El archivo CSV está vacío.");
    const esNumero = (c) => c === "" || /^-?\d+([.,]\d+)?$/.test(c);
    const tieneCabecera = filas[0].slice(1).some(c => !esNumero(c)) || normalizar(filas[0][0]) === "cif";
    let columnas = comps.map((_, j) => j + 1); // por posición: cif, comp 1, comp 2...
    if (tieneCabecera) {
      const porNombre = comps.map(c => filas[0].findIndex((h, idx) => idx > 0 && normalizar(h) === normalizar(c.nombre)));
      if (porNombre.some(idx => idx >= 0)) columnas = porNombre;
    }
    return filas.slice(tieneCabecera ? 1 : 0).map(f => ({
      cif: f[0],
      valores: Object.fromEntries(columnas.map((col, j) => [j, col >= 0 ? f[col] : undefined]))
    }));
  }

  function registrosDeJson(texto, comps){
    let datos;
    try { datos = JSON.parse(texto.replace(/^\uFEFF/, "")); }
    catch { throw new Error("El archivo JSON no es válido."); }
    if (!Array.isArray(datos)) datos = datos?.calificaciones;
    if (!Array.isArray(datos)) throw new Error("El JSON debe ser una lista de estudiantes con su cif y sus notas.");
    return datos.map(item => {
      const cif = String(item?.cif ?? item?.CIF ?? item?.cif_estudiante ?? "").trim();
      const buscar = (obj) => comps.map((c, j) => {
        const clave = Object.keys(obj).find(k => normalizar(k) === normalizar(c.nombre) || k === String(c.id_componente));
        return [j, clave === undefined ? undefined : obj[clave]];
      });
      let pares;
      if (Array.isArray(item?.notas)) pares = comps.map((_, j) => [j, item.notas[j]]);
      else if (item?.notas && typeof item.notas === "object") pares = buscar(item.notas);
      else {
        pares = buscar(item ?? {});
        if (item?.nota !== undefined && comps.length === 1) pares = [[0, item.nota]];
      }
      return { cif, valores: Object.fromEntries(pares.map(([j, v]) => [j, v === null || v === undefined ? undefined : String(v).trim()])) };
    });
  }

  function analizarImportacion(registros){
    const comps = state.evaluation.componentes;
    const porCif = new Map(state.rows.map((r, i) => [String(r.cif_estudiante).trim(), i]));
    const cambios = [], errores = [];
    const vistos = new Set();
    registros.forEach((reg, n) => {
      const linea = n + 1;
      const i = porCif.get(reg.cif);
      if (i === undefined) { errores.push(`Registro ${linea}: el CIF "${reg.cif}" no está inscrito en este grupo.`); return; }
      if (vistos.has(reg.cif)) { errores.push(`Registro ${linea}: el CIF ${reg.cif} aparece repetido.`); return; }
      vistos.add(reg.cif);
      comps.forEach((c, j) => {
        const raw = reg.valores[j];
        if (raw === undefined || raw === "") return;
        const texto = String(raw).replace(",", ".");
        if (!Reglas.esNotaValida(texto)) {
          errores.push(`Registro ${linea} (${reg.cif}): "${raw}" no es una nota válida para ${c.nombre} (0.00 a 10.00, máx. 2 decimales).`);
          return;
        }
        cambios.push({ i, idComponente: c.id_componente, nota: Number(texto) });
      });
    });
    return { cambios, errores };
  }

  function aplicarImportacion(cambios){
    cambios.forEach(({ i, idComponente, nota }) => {
      state.draft[i][idComponente] = nota;
      inputsDe(i, idComponente).forEach(inp => { inp.value = nota; });
      setFieldError(i, idComponente, false);
      updateRow(i);
    });
    updateSaveButtonState();
  }

  $("#import-grades").addEventListener("click", () => {
    if (!state.evaluation || isLocked()) return;
    $("#import-file").click();
  });

  $("#import-file").addEventListener("change", async (e) => {
    const archivo = e.target.files[0];
    e.target.value = "";
    if (!archivo || !state.evaluation || isLocked()) return;
    try {
      const texto = await archivo.text();
      const comps = state.evaluation.componentes;
      const esJson = /\.json$/i.test(archivo.name) || /^\s*[\[{]/.test(texto);
      const { cambios, errores } = analizarImportacion(esJson ? registrosDeJson(texto, comps) : registrosDeCsv(texto, comps));

      if (!cambios.length) {
        await confirmDialog({
          title: "No se importó ninguna nota",
          message: errores.length ? errores.slice(0, 6).join("\n") : "El archivo no contiene notas para este grupo.",
          confirmText: "Entendido", cancelText: "Cerrar", variant: "danger"
        });
        return;
      }
      const estudiantes = new Set(cambios.map(c => c.i)).size;
      const detalle = errores.length
        ? `\n\nSe omitirán ${errores.length} registro(s) con errores:\n${errores.slice(0, 5).join("\n")}${errores.length > 5 ? "\n…" : ""}`
        : "";
      const ok = await confirmDialog({
        title: "¿Importar las notas?",
        message: `Se cargarán ${cambios.length} nota(s) de ${estudiantes} estudiante(s) desde ${archivo.name}. Reemplazan las notas escritas y quedan sin guardar hasta que pulses Guardar Calificaciones.${detalle}`,
        confirmText: "Importar"
      });
      if (!ok) return;
      aplicarImportacion(cambios);
      showToast(`Se importaron ${cambios.length} nota(s). Revisa y pulsa Guardar Calificaciones.`);
    } catch (err) {
      showToast(err.message || "No se pudo leer el archivo.");
    }
  });

  // Plantilla CSV con la nómina del grupo y una columna por componente
  $("#template-grades").addEventListener("click", () => {
    if (!state.evaluation) return;
    const comps = state.evaluation.componentes;
    const celda = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lineas = [["cif", "estudiante", ...comps.map(c => c.nombre)].map(celda).join(",")];
    state.rows.forEach((r, i) => lineas.push(
      [r.cif_estudiante, r.nombre_estudiante, ...comps.map(c => state.draft[i][c.id_componente] ?? "")].map(celda).join(",")));
    const blob = new Blob(["\uFEFF" + lineas.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const enlace = document.createElement("a");
    enlace.href = URL.createObjectURL(blob);
    enlace.download = `plantilla-${state.evaluation.codigo_grupo}-${normalizar(state.evaluation.nombre).replace(/\W+/g, "-")}.csv`;
    enlace.click();
    URL.revokeObjectURL(enlace.href);
  });


  /* ACTA: exportación a CSV (abre en Excel) e impresión del registro */
  function datosActa(){
    const ev = state.evaluation;
    const comps = ev.componentes;
    const filas = state.rows.map((r, i) => {
      const nota = notaPonderada(i);
      return { r, i, nota, estado: statusFor(nota).label };
    });
    return { ev, comps, filas };
  }

  $("#export-grades").addEventListener("click", () => {
    if (!state.evaluation) return;
    const { ev, comps, filas } = datosActa();
    const celda = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const meta = [
      ["Acta de calificaciones"],
      ["Asignatura", ev.nombre_asignatura],
      ["Grupo", ev.codigo_grupo],
      ["Registro", ev.nombre_registro],
      ["Evaluación", ev.nombre],
      ["Estado", isLocked() ? `Trasladada el ${formatDateTime(ev.fecha_traslado)}` : "Borrador (sin trasladar)"],
      ["Nota mínima aprobatoria", Reglas.NOTA_MINIMA.toFixed(1)],
      []
    ];
    const cabecera = ["#", "CIF", "Estudiante", ...comps.map(c => `${c.nombre} (${c.ponderacion} %)`), "Nota final", "Estado"];
    const cuerpo = filas.map(({ r, i, nota, estado }) =>
      [i + 1, r.cif_estudiante, r.nombre_estudiante,
       ...comps.map(c => state.draft[i][c.id_componente] ?? ""), nota === null ? "" : nota.toFixed(2), estado]);
    const csv = [...meta, cabecera, ...cuerpo].map(f => f.map(celda).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const enlace = document.createElement("a");
    enlace.href = URL.createObjectURL(blob);
    enlace.download = `acta-${ev.codigo_grupo}-${normalizar(ev.nombre).replace(/\W+/g, "-")}.csv`;
    enlace.click();
    URL.revokeObjectURL(enlace.href);
    showToast(hasUnsavedChanges() ? "Acta exportada con notas aún sin guardar" : "Acta exportada correctamente");
  });

  // Encabezado que solo se ve al imprimir (también con Ctrl+P)
  function prepararImpresion(){
    if (state.page !== "grades" || !state.evaluation) return;
    const { ev, filas } = datosActa();
    const notas = filas.map(f => f.nota).filter(n => n !== null);
    const aprobados = filas.filter(f => f.estado === "APROBADO").length;
    const promedio = notas.length ? (notas.reduce((a, b) => a + b, 0) / notas.length).toFixed(2) : "--";
    $("#print-header").innerHTML = `
      <h1>Acta de calificaciones</h1>
      <p><strong>Asignatura:</strong> ${escapeHtml(ev.nombre_asignatura)} · <strong>Grupo:</strong> ${escapeHtml(ev.codigo_grupo)}</p>
      <p><strong>Registro:</strong> ${escapeHtml(ev.nombre_registro)} · <strong>Evaluación:</strong> ${escapeHtml(ev.nombre)}</p>
      <p><strong>Estado:</strong> ${isLocked() ? `Trasladada el ${formatDateTime(ev.fecha_traslado)}` : "Borrador (sin trasladar)"}
         · <strong>Promedio:</strong> ${promedio} · <strong>Aprobados:</strong> ${aprobados} de ${filas.length}</p>
      <p><strong>Docente:</strong> ${escapeHtml($("#chip-name").textContent)} · <strong>Impreso:</strong> ${new Date().toLocaleDateString("es-SV")}</p>`;
  }
  window.addEventListener("beforeprint", prepararImpresion);
  $("#print-grades").addEventListener("click", () => window.print());

  $("#cancel-grades").addEventListener("click", () => {
    goTo(state.gradesFrom);
  });


  function paintHistory(rows){
    $("#history-empty").hidden = rows.length > 0;
    $("#history-table-wrap").hidden = rows.length === 0;

    // tabla (desktop)
    $("#history-table-body").innerHTML = rows.map(h => `
      <tr>
        <td>${escapeHtml(h.nombre_asignatura)} (${escapeHtml(h.codigo_grupo)})</td>
        <td>${escapeHtml(h.nombre)}</td>
        <td>${formatDateTime(h.fecha_traslado)}</td>
        <td>${formatAverage(h.promedio)}</td>
        <td>${h.aprobados} de ${h.total}</td>
        <td><button class="btn-select" data-history="${h.id_evaluacion}" aria-label="Ver notas de ${escapeHtml(h.nombre)}, ${escapeHtml(h.nombre_asignatura)}">Ver notas</button></td>
      </tr>
    `).join("");

    // lista (móvil y tablet)
    $("#history-list").innerHTML = rows.map(h => `
      <button class="eval-row" data-history="${h.id_evaluacion}">
        <span class="eval-row-main">
          <strong>${escapeHtml(h.nombre)}</strong>
          <span>${escapeHtml(h.nombre_asignatura)} · Promedio ${formatAverage(h.promedio)} · ${h.aprobados} de ${h.total} aprobados</span>
        </span>
        <span class="eval-row-right">
          <span>${formatDateTime(h.fecha_traslado)}</span>
          <i class="bi bi-chevron-right" aria-hidden="true"></i>
        </span>
      </button>
    `).join("");

    $$("#page-history [data-history]").forEach(btn => {
      btn.addEventListener("click", () => goTo("grades", { evaluationId: Number(btn.dataset.history), from: "history" }));
    });
  }


  async function loadProfile(){
    const [profile, groups] = await Promise.all([Api.perfil(), Api.grupos()]);
    return { profile, groups };
  }

  function paintProfile({ profile, groups }){
    $("#profile-name").textContent = `${profile.nombre_docente} ${profile.apellido_docente}`;
    $("#profile-email").textContent = profile.correo;
    $("#profile-subjects").textContent =
      groups.map(g => `${g.nombre_asignatura} (${g.codigo_grupo})`).join(", ") || "Sin grupos asignados";
    $("#password-form").reset();
    $("#email-form").reset();
    $("#password-error").hidden = true;
    $("#email-error").hidden = true;
  }

  $("#password-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const actual = $("#pass-current").value;
    const nueva = $("#pass-new").value;
    const errorBox = $("#password-error");

    const error = Reglas.validarCambioContrasena({ actual, nueva, confirmacion: $("#pass-confirm").value });
    errorBox.textContent = error;
    errorBox.hidden = !error;
    if (error) return;

    const submitBtn = $("#password-form button[type=submit]");
    submitBtn.disabled = true;
    try {
      await Api.cambiarContrasena(actual, nueva);
      $("#password-form").reset();
      showToast("Contraseña actualizada correctamente");
    } catch (err) {
      if (err.status === 400) { // p. ej. la contraseña actual no es correcta
        errorBox.textContent = err.message;
        errorBox.hidden = false;
      } else {
        handleError(err);
      }
    } finally {
      submitBtn.disabled = false;
    }
  });


  $("#email-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const correo = $("#email-new").value.trim();
    const contrasena = $("#email-pass").value;
    const errorBox = $("#email-error");
    const error = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo) ? "Escribe un correo institucional válido."
      : !contrasena ? "Escribe tu contraseña actual para confirmar." : "";
    errorBox.textContent = error;
    errorBox.hidden = !error;
    if (error) return;

    const submitBtn = $("#email-form button[type=submit]");
    submitBtn.disabled = true;
    try {
      const perfil = await Api.cambiarCorreo(contrasena, correo);
      $("#profile-email").textContent = perfil.correo;
      $("#email-form").reset();
      showToast("Correo actualizado correctamente");
    } catch (err) {
      if (err.status === 400 || err.status === 409) {
        errorBox.textContent = err.message;
        errorBox.hidden = false;
      } else {
        handleError(err);
      }
    } finally {
      submitBtn.disabled = false;
    }
  });

  // Video tutorial: solo se incrusta si hay un enlace https configurado
  (function incrustarVideo(){
    const caja = $("#tutorial-video");
    const url = caja.dataset.videoUrl.trim();
    if (!/^https:\/\//.test(url)) return;
    const frame = document.createElement("iframe");
    frame.src = url;
    frame.title = "Video tutorial del Portal Docente";
    frame.loading = "lazy";
    frame.allowFullscreen = true;
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    caja.replaceChildren(frame);

    // YouTube rechaza incrustar desde file://, por eso se ofrece el enlace directo
    const enlace = document.createElement("a");
    enlace.href = url.replace("/embed/", "/watch?v=").replace("youtube-nocookie.com", "youtube.com");
    enlace.target = "_blank";
    enlace.rel = "noopener noreferrer";
    enlace.textContent = "¿No se reproduce? Ver el video en YouTube";
    enlace.className = "video-link";
    caja.insertAdjacentElement("afterend", enlace);
  })();

  function openMobileMenu(){
    $("#sidebar").classList.add("open");
    $("#mobile-overlay").classList.add("active");
    $("#menu-toggle").setAttribute("aria-expanded", "true");
  }
  function closeMobileMenu(){
    $("#sidebar").classList.remove("open");
    $("#mobile-overlay").classList.remove("active");
    $("#menu-toggle").setAttribute("aria-expanded", "false");
  }
  $("#menu-toggle").addEventListener("click", openMobileMenu);
  $("#mobile-overlay").addEventListener("click", closeMobileMenu);

  function showConnectionError(message){
    $("#subject-cards").innerHTML =
      `<p class="empty-state"><i class="bi bi-wifi-off" aria-hidden="true"></i><span>${escapeHtml(message)}</span></p>`;
  }

  // Inicio: sin sesión se vuelve al login; con sesión se valida el token y se carga el panel
  (async function init(){
    if (!Api.haySesion()) {
      window.location.replace("index.html");
      return;
    }
    try {
      const profile = await Api.perfil();
      $("#teacher-name").textContent = profile.nombre_docente;
      $("#chip-name").textContent = profile.nombre_docente;
    } catch (err) {
      if (err.status === 401) return handleError(err);
      showConnectionError(err.message);
      return;
    }
    if (!(await navigateTo("dashboard"))) showConnectionError("No se pudieron cargar tus asignaturas.");
  })();
}
