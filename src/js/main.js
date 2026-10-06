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
    evaluation: null,          // evaluación abierta en la carga de notas
    rows: [],                  // estudiantes de esa evaluación
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


  /* INICIO: el docente elige el registro en el que va a trabajar.
     Aquí ya no se muestran las asignaturas; eso vive en "Mis asignaturas". */
  function paintDashboard(registros){
    state.registros = registros;
    const wrap = $("#registro-cards");

    if (!registros.length) {
      wrap.innerHTML = `<p class="empty-state">No tienes grupos asignados en ningún ciclo.</p>`;
      return;
    }
    // Si el registro guardado ya no existe (p. ej. cambió el ciclo), se olvida
    if (state.registro && !registros.some(r => r.id_registro === state.registro.id_registro)) {
      state.registro = null;
      state.group = null;
    }

    wrap.innerHTML = registros.map(r => {
      const abierto = r.estado === "ABIERTO";
      const elegido = state.registro?.id_registro === r.id_registro;
      return `
      <article class="registro-card ${elegido ? "selected" : ""} ${abierto ? "" : "closed"}">
        <div class="registro-peso"><strong>${r.ponderacion}</strong><span>%</span></div>
        <div class="registro-body">
          <h3>${escapeHtml(r.nombre)}</h3>
          <span class="subject-meta">Ciclo ${escapeHtml(r.codigo_ciclo)}</span>
          <span class="subject-meta">
            <i class="bi bi-calendar3" aria-hidden="true"></i>${formatDate(r.fecha_inicio)} – ${formatDate(r.fecha_fin)}
          </span>
          <span class="status-pill ${abierto ? "status-aprobado" : "status-pendiente"}">${abierto ? "ABIERTO" : "CERRADO"}</span>
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
        goTo("subjects", { registroId: id });
      });
    });
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
    const [evaluation, rows] = await Promise.all([Api.evaluacion(id), Api.calificaciones(id)]);
    return { evaluation, rows };
  }

  function paintGrades({ evaluation, rows }, { from } = {}){
    if (from) state.gradesFrom = from;
    if (state.group?.id_grupo !== evaluation.id_grupo) {
      state.group = state.groups.find(g => g.id_grupo === evaluation.id_grupo)
        ?? { id_grupo: evaluation.id_grupo, codigo_grupo: evaluation.codigo_grupo, nombre_asignatura: evaluation.nombre_asignatura };
    }
    state.evaluation = evaluation;
    state.rows = rows;
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

    wireGradeInputs();
    wireAccordionToggles();

    $("#save-grades").hidden = locked;
    $("#translate-grades").hidden = locked;
    updateSaveButtonState();
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
      paintGrades({ evaluation, rows: state.rows });
      showToast("Calificaciones trasladadas correctamente");
    } catch (err) {
      handleError(err);
    } finally {
      $("#translate-grades").disabled = false;
    }
  });

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
    $("#password-error").hidden = true;
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
