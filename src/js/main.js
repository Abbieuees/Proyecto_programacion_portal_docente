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
    groups: [],                // grupos del docente (panel)
    group: null,               // grupo abierto en "Mis asignaturas"
    evaluation: null,          // evaluación abierta en la carga de notas
    rows: [],                  // estudiantes de esa evaluación
    saved: [],                 // notas tal como están guardadas en el servidor
    draft: null,               // copia editable; se envía al pulsar "Guardar"
    gradesFrom: "evaluations", // página a la que regresa "Volver" desde la carga de notas
    navSeq: 0                  // número de la última navegación pedida
  };

  const PAGES = {
    dashboard:   { title: () => "Panel del Docente", load: () => Api.grupos(), paint: paintDashboard },
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

  $("#back-btn").addEventListener("click", () => {
    goTo(state.page === "grades" ? state.gradesFrom : "dashboard");
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


  function paintDashboard(groups){
    state.groups = groups;
    const wrap = $("#subject-cards");
    if (!groups.length) {
      wrap.innerHTML = `<p class="empty-state">No tienes grupos asignados en este ciclo.</p>`;
      return;
    }
    wrap.innerHTML = groups.map(g => {
      const style = ESTILO_ASIGNATURA[g.codigo_asignatura] ?? ESTILO_POR_DEFECTO;
      const name = escapeHtml(g.nombre_asignatura);
      const code = escapeHtml(g.codigo_grupo);
      return `
      <article class="subject-card">
        <div class="subject-banner ${style.banner}"><i class="${style.icon}" aria-hidden="true"></i></div>
        <div class="subject-body">
          <h3>${name}</h3>
          <span class="subject-meta">Grupo: ${code} · Ciclo: ${escapeHtml(g.ciclo)}</span>
          <span class="subject-meta"><i class="bi bi-people" aria-hidden="true"></i>Estudiantes: ${g.total_estudiantes}</span>
          <button class="btn btn-primary" data-group="${g.id_grupo}" aria-label="Ingresar a ${name}, grupo ${code}">Ingresar</button>
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

    // tabla (desktop)
    $("#eval-table-body").innerHTML = evaluations.length
      ? evaluations.map(e => `
      <tr>
        <td>${escapeHtml(e.nombre)}</td>
        <td>${TIPOS[e.tipo] ?? escapeHtml(e.tipo)}</td>
        <td>${formatDate(e.fecha_evaluacion)}</td>
        <td><button class="btn-select" data-eval="${e.id_evaluacion}" aria-label="Seleccionar ${escapeHtml(e.nombre)}">Seleccionar</button></td>
      </tr>`).join("")
      : `<tr><td colspan="4">No hay evaluaciones de este tipo.</td></tr>`;

    // lista (móvil)
    $("#eval-list").innerHTML = evaluations.length
      ? evaluations.map(e => `
      <button class="eval-row" data-eval="${e.id_evaluacion}">
        <span class="eval-row-main">
          <strong>${escapeHtml(e.nombre)}</strong>
          <span>${TIPOS[e.tipo] ?? escapeHtml(e.tipo)}</span>
        </span>
        <span class="eval-row-right">
          <span>${formatDate(e.fecha_evaluacion)}</span>
          <i class="bi bi-chevron-right" aria-hidden="true"></i>
        </span>
      </button>`).join("")
      : `<p class="empty-state">No hay evaluaciones de este tipo.</p>`;

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
      const evaluations = await Api.evaluaciones(groupId);
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
    state.saved = rows.map(r => r.nota);
    state.draft = [...state.saved];
    const locked = isLocked();

    $("#grades-group-title").textContent = `Grupo: ${evaluation.codigo_grupo}`;
    $("#grades-eval-title").textContent = `Evaluación: ${evaluation.nombre}`;
    $("#grades-due-date").textContent = `Fecha límite: ${formatDate(evaluation.fecha_limite)}`;
    $("#min-grade").textContent = Reglas.NOTA_MINIMA.toFixed(1);
    $("#locked-banner").hidden = !locked;
    if (locked) {
      $("#locked-text").textContent =
        `Estas calificaciones se trasladaron el ${formatDateTime(evaluation.fecha_traslado)} y no pueden modificarse.`;
    }

    // tabla (desktop)
    $("#grades-table-body").innerHTML = rows.map((row, i) => {
      const status = statusFor(state.draft[i]);
      return `
        <tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(row.cif_estudiante)}</td>
          <td>${escapeHtml(row.nombre_estudiante)}</td>
          <td>${gradeInput(row, i, "t", locked)}</td>
          <td><span class="status-pill ${status.cls}" data-status="${i}">${status.label}</span></td>
        </tr>`;
    }).join("");

    // acordeón (móvil)
    $("#grades-accordion").innerHTML = rows.map((row, i) => {
      const status = statusFor(state.draft[i]);
      const open = i === 0;
      return `
        <div class="grade-card ${open ? "open" : ""}">
          <button class="grade-card-header" aria-expanded="${open}" aria-controls="grade-card-${i}">
            <span><strong>${i + 1}. ${escapeHtml(row.nombre_estudiante)}</strong><span class="cif">${escapeHtml(row.cif_estudiante)}</span></span>
            <i class="bi bi-chevron-down chev" aria-hidden="true"></i>
          </button>
          <div class="grade-card-body" id="grade-card-${i}">
            <div class="grade-card-field">
              <label class="grade-card-label" for="grade-c-${i}">Nota</label>
              ${gradeInput(row, i, "c", locked)}
            </div>
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

  // Campo de nota; view = "t" (tabla) o "c" (tarjeta) para que los id no se repitan
  function gradeInput(row, i, view, locked){
    return `
      <div class="grade-input-wrap">
        <input type="number" step="0.01" min="0" max="${Reglas.NOTA_MAXIMA}" inputmode="decimal" class="grade-input"
               id="grade-${view}-${i}" data-idx="${i}" value="${state.draft[i] ?? ""}" placeholder="--"
               aria-label="Nota de ${escapeHtml(row.nombre_estudiante)}" ${locked ? "disabled" : ""}>
        <p class="field-error" id="grade-error-${view}-${i}" hidden>Nota entre 0.00 y 10.00, máximo 2 decimales</p>
      </div>`;
  }

  function setFieldError(idx, hasError){
    $$(`.grade-input[data-idx="${idx}"]`).forEach(inp => {
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

  function updateStatus(idx, grade){
    const st = statusFor(grade);
    $$(`[data-status="${idx}"]`).forEach(pill => {
      pill.textContent = st.label;
      pill.className = `status-pill ${st.cls}`;
    });
  }

  function hasInvalidGrades(){
    return $$("#page-grades .grade-input.input-error").length > 0;
  }

  function hasUnsavedChanges(){
    if (state.page !== "grades" || !state.draft || isLocked()) return false;
    return hasInvalidGrades() || state.draft.some((g, i) => g !== state.saved[i]);
  }

  function updateSaveButtonState(){
    $("#save-grades").disabled = hasInvalidGrades();
  }

  function wireGradeInputs(){
    $$("#page-grades .grade-input").forEach(input => {
      input.addEventListener("input", () => {
        const idx = Number(input.dataset.idx);
        const raw = input.value;
        // badInput: el navegador no pudo leer un número (p. ej. se escribió solo "e" o "-")
        const valid = !input.validity.badInput && Reglas.esNotaValida(raw);

        // sincroniza el mismo valor (válido o no) entre tabla y acordeón
        $$(`.grade-input[data-idx="${idx}"]`).forEach(other => {
          if (other !== input) other.value = raw;
        });
        setFieldError(idx, !valid);

        // solo se modifica la copia de trabajo; el servidor se actualiza al pulsar "Guardar"
        if (valid) {
          state.draft[idx] = raw === "" ? null : Number(raw);
          updateStatus(idx, state.draft[idx]);
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

    const calificaciones = state.rows.map((row, i) => ({ id_matricula: row.id_matricula, nota: state.draft[i] }));
    $("#save-grades").disabled = true;
    try {
      const rows = await Api.guardarCalificaciones(state.evaluation.id_evaluacion, calificaciones);
      state.rows = rows;
      state.saved = rows.map(r => r.nota);
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
    const pending = state.saved.filter(g => g === null).length;
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
