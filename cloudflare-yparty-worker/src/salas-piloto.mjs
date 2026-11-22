// C202: set of admitted store rooms (32-hex) for the 2.0 server.
// SALA_PILOTO (single, legacy) UNION SALAS_PILOTO (comma separated). Invalid
// entries are dropped; an empty set fails closed everywhere it is used.
const ROOM=/^[a-f0-9]{32}$/;
export function salasPiloto(env){
 return new Set([env?.SALA_PILOTO,...String(env?.SALAS_PILOTO||'').split(',')]
  .map(x=>typeof x==='string'?x.trim():'').filter(x=>ROOM.test(x)));
}
export const salaPilotoPermitida=(env,base)=>typeof base==='string'&&salasPiloto(env).has(base);
// Suffix ('', '-cat', '-ops', '-fotos', '-priv', ...) of a full room name whose
// first 32 chars are an admitted room; null when the room is not admitted.
// Callers compare the suffix exactly, so rules per channel are unchanged.
export const sufijoSalaPiloto=(env,name)=>
 typeof name==='string'&&salaPilotoPermitida(env,name.slice(0,32))?name.slice(32):null;
