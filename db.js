// db.js — Persistencia simple en archivo JSON (lowdb).
// Por qué lowdb y no una base de datos pesada: cero dependencias nativas que puedan
// fallar al desplegar, cero configuración de servidor de base de datos, y un archivo
// db.json que se puede respaldar copiándolo. Para un negocio de 1 a 5 perchas
// es más que suficiente y es muy fácil de migrar a Postgres más adelante si crece.

const path = require("path");
const low = require("lowdb");
const FileSync = require("lowdb/adapters/FileSync");

const dbPath = path.join(__dirname, "data", "db.json");
const fs = require("fs");
if (!fs.existsSync(path.join(__dirname, "data"))) {
  fs.mkdirSync(path.join(__dirname, "data"));
}

const adapter = new FileSync(dbPath);
const db = low(adapter);

// --- Datos semilla (solo se usan la primera vez que arranca el servidor) ---
// Tienda de artesanías y licores de Cuenca. Definido en seed-data.js para
// mantenerse sincronizado con la demo estática (public/mock-backend.js).
const { ubicaciones, productos, configuracion, promotores } = require("./seed-data");
const seed = { ubicaciones, productos, ventas: [], movimientos: [], transferencias: [], promotores, configuracion };

db.defaults(seed).write();

module.exports = db;
