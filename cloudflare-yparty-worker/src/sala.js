// Nombre de la sala de una licencia. Sin dependencias: lo usan igual el Worker,
// el cliente (navegador) y las pruebas (Node), todos con crypto.subtle.
// Cambiar el prefijo "f123-yparty-v1:" mueve TODAS las tiendas a salas nuevas (vacias).
export async function salaDeLicencia(licencia) {
  const datos = new TextEncoder().encode("f123-yparty-v1:" + String(licencia).trim().toUpperCase());
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", datos));
  return [...hash.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
