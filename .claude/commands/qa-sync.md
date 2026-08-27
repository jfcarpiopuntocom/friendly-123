# qa-sync

Compuerta de regresión del **sync y el team/PIN system** de friendly-123. Úsala
SIEMPRE que vayas a tocar `sync-realtime.js`, `mock-backend.js` (roster/merge/
tienda), `auth-ui.js` (heartbeat/licencia), `crypto-store.js` (maestro/lord) o
`panel.html` (licencias), y ANTES de decirle a JFC "el sync funciona" o de
pushear cualquier cambio de esos. Si JFC pregunta "¿esta vez sí funciona?",
"¿está tip top?", "corre el QA", "las pasadas Hugo/Paco/Luis" — es esto.

## Por qué existe

El sync y el team system se "arreglaron" y se rompieron **12 veces**. No porque
los arreglos fueran malos, sino porque cada uno se verificaba a mano UNA vez y se
olvidaba: no había una red que atrapara la regresión siguiente. Un cliente real
(idiomARTE: Sarah y Belén) usa esto en producción; una regresión aquí le pierde
datos o la deja fuera de su app. Por eso "funciona" no es una opinión que se
declara: es un test que corre solo y se pone rojo si algo se rompe.

## La compuerta: un solo comando

```bash
bash .claude/test-todo.sh
```

Corre, de más barato a más caro: `node --check` de todo el shell → `guards.sh`
→ `check-sw.sh` → el test de mesa del reloj lógico del roster → los DOS arneses
de navegador con dos aparatos aislados (`harness-team-sync.cjs`,
`harness-join-identity.cjs`). Sale 0 = **TODO VERDE**; !=0 = hay rojo y dice cuál.

**Regla dura:** si está rojo, NO se dice "funciona" y NO se pushea. Se arregla y
se vuelve a correr hasta verde. Un verde a mano no cuenta; el verde es el de la
compuerta.

## Los invariantes que JAMÁS pueden romperse

Son las propiedades que costaron sangre. Cada una tiene su prueba en la compuerta;
si tocas el sync, piensa cuál de estas podrías estar rompiendo y confírmalo con el
arnés (amplíalo si tu cambio abre un caso nuevo — es más barato un caso de prueba
que otra regresión en producción).

1. **Una licencia de cliente NUNCA desaparece.** El heartbeat jamás reporta una
   licencia vacía (recupera de la sala; si no, omite el campo). Borrar en
   `panel.html` exige teclear la licencia completa y avisa del último device.
2. **La baja de un miembro PROPAGA entre aparatos.** DELETE es un tombstone
   (`borrado:true` + rev), no un splice; se filtra de las lecturas y viaja. El
   tombstone GANA al re-add rancio de un tercer aparato (anti-zombie).
3. **El roster converge por reloj LÓGICO, no de pared.** Cada edición se sella
   con `rev = {c: Lamport, d: deviceId}`; promover/degradar/PIN gana por
   causalidad aunque el reloj del otro aparato esté mal puesto. Fallback al reloj
   de pared solo si NINGÚN lado tiene rev (dato viejo).
4. **Tu licencia propia SIEMPRE resuelve a tu tienda propia** en `OCTienda.cambiar`,
   pase lo que pase con el registro `f123_tiendas`.
5. **Identidad al unirse:** usuario normal SE VUELVE device de ese negocio (cuenta
   en el panel); el **lord** (marcado al verificar el código maestro) NO adopta la
   licencia ajena y queda como observador con el acceso registrado (auditoría).
6. **Sin `f123_tienda_activa`, el estado es byte-idéntico al de antes** del
   multi-tienda (propiedad de seguridad; no la rompas namespaceando de más).

## Cómo se corren las pasadas Hugo/Paco/Luis

No es probar el camino feliz: son tres usuarios de IQ distinto rompiendo la app a
propósito (ver `verificar-ui.md`). Se corren de verdad con los arneses de dos
aparatos, que cargan el app REAL en contextos aislados y ejercen el camino REAL
(POST/PATCH/DELETE + catalogoPropio + aplicarCatalogo + aplicarEquipoRemoto +
OCTienda.cambiar + unirse). Si tu cambio abre un caso nuevo, agrégalo al arnés
correspondiente y déjalo verde antes de pushear.

## Al terminar

Cerrar el ciclo como siempre (modus-operandi): snapshot → commit → push →
mergear cuando la compuerta esté verde y comprobado. La compuerta verde ES la
prueba que se le muestra a JFC, en vez de "ya quedó".
