/* Contraseñas y tokens con el módulo crypto de Node (sin dependencias externas). */

const crypto = require("node:crypto");
const { promisify } = require("node:util");

const scrypt = promisify(crypto.scrypt);

// Formato guardado en docentes.contrasena_hash: "scrypt$<sal>$<hash>" (nunca el texto plano)
async function hashContrasena(contrasena){
  const sal = crypto.randomBytes(16).toString("hex");
  const hash = await scrypt(contrasena, sal, 64);
  return `scrypt$${sal}$${hash.toString("hex")}`;
}

async function verificarContrasena(contrasena, guardado){
  const [algoritmo, sal, hash] = String(guardado).split("$");
  if (algoritmo !== "scrypt" || !sal || !hash) return false;
  const esperado = Buffer.from(hash, "hex");
  const calculado = await scrypt(String(contrasena), sal, esperado.length);
  return crypto.timingSafeEqual(esperado, calculado);
}

function generarToken(){
  return crypto.randomBytes(32).toString("hex");
}

module.exports = { hashContrasena, verificarContrasena, generarToken };
