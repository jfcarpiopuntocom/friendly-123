// umbrales.js — Puntos de reorden (rojo/amarillo) por variante de Loyverse,
// guardados localmente porque Loyverse no expone esto de forma consistente
// entre planes. No afecta el inventario real, solo el semáforo de AMIGABLE.

const path = require("path");
const fs = require("fs");

const archivo = path.join(__dirname, "data", "umbrales.json");
const DEFECTO = { umbralRojo: 5, umbralAmarillo: 15 };

function leer() {
  if (!fs.existsSync(archivo)) return {};
  try {
    return JSON.parse(fs.readFileSync(archivo, "utf8"));
  } catch {
    return {};
  }
}

function get(variantId) {
  const datos = leer();
  return datos[variantId] || DEFECTO;
}

function set(variantId, { umbralRojo, umbralAmarillo }) {
  const datos = leer();
  datos[variantId] = {
    umbralRojo: Number(umbralRojo),
    umbralAmarillo: Number(umbralAmarillo),
  };
  if (!fs.existsSync(path.dirname(archivo))) fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(archivo, JSON.stringify(datos, null, 2), "utf8");
}

module.exports = { get, set };
