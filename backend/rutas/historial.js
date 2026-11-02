/* /api/historial — evaluaciones ya trasladadas, con sus estadísticas (requiere token) */

const express = require("express");
const repo = require("../repositorio");

const router = express.Router();

// GET /api/historial
router.get("/", async (req, res) => {
  res.json(await repo.historialDelDocente(req.idDocente));
});

module.exports = router;
