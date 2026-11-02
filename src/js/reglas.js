/* REGLAS DE NEGOCIO DEL PORTAL DOCENTE
   Este mismo archivo lo usan el navegador (portal) y el servidor (backend/):
   una sola definición de qué es una nota válida, en el mismo lenguaje. */

(function (exportar) {
  const NOTA_MINIMA = 6.0;
  const NOTA_MAXIMA = 10;
  const TIPOS_EVALUACION = ["TAREA", "PARCIAL", "PROYECTO"];

  // null o "" = pendiente; si no, número entre 0 y 10 con máximo 2 decimales (NUMERIC(4,2))
  function esNotaValida(valor){
    if (valor === null || valor === undefined || valor === "") return true;
    const nota = Number(valor);
    if (!Number.isFinite(nota) || nota < 0 || nota > NOTA_MAXIMA) return false;
    const decimales = String(valor).split(".")[1] || "";
    return decimales.length <= 2;
  }

  function estadoDeNota(nota){
    if (nota === null || nota === undefined || nota === "") return "PENDIENTE";
    return Number(nota) >= NOTA_MINIMA ? "APROBADO" : "REPROBADO";
  }

  // Devuelve el mensaje de error, o "" si el cambio es válido.
  // "confirmacion" solo existe en el formulario del navegador.
  function validarCambioContrasena({ actual, nueva, confirmacion }){
    const conConfirmacion = confirmacion !== undefined;
    if (!actual || !nueva || (conConfirmacion && !confirmacion)) {
      return conConfirmacion ? "Completa los tres campos." : "Envía la contraseña actual y la nueva.";
    }
    if (nueva.length < 8) return "La nueva contraseña debe tener al menos 8 caracteres.";
    if (nueva === actual) return "La nueva contraseña debe ser diferente de la actual.";
    if (conConfirmacion && nueva !== confirmacion) return "La confirmación no coincide con la nueva contraseña.";
    return "";
  }

  Object.assign(exportar, {
    NOTA_MINIMA, NOTA_MAXIMA, TIPOS_EVALUACION,
    esNotaValida, estadoDeNota, validarCambioContrasena
  });
})(typeof module === "object" && module.exports ? module.exports : (window.Reglas = {}));
