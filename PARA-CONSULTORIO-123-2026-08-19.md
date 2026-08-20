# Lo aprendido en friendly-123 el 2026-08-19 — que le sirve a consultorio-123

**Para:** quien retome consultorio-123 · **Escrito:** 2026-08-19
**Estado:** apuntes. NADA de esto se ha aplicado a consultorio-123 todavia.

---

## Antes de tocar consultorio-123, dos recordatorios

**consultorio-123 es una app DISTINTA, no amigable para medicos.** Su centro es
lo contable y financiero: abonos, pagos de pacientes, cuentas por cobrar,
visualizacion financiera facil. La unidad basica es el PACIENTE, no la percha.
El PIN es de 4 digitos POR DISENO: no es un bug y no se "corrige".

**Ante la duda, la respuesta por defecto es NO PORTAR TODAVIA.** Esta en focus
groups; meterle ahora sistemas que van a cambiar de forma es trabajo que se
bota. Este documento separa lo que si le sirve de lo que no.

---

## SI le sirve, y es urgente

### 1. Telefono/WhatsApp OBLIGATORIO al activar

**Regla de JFC para TODAS sus apps, sin excepcion:** el telefono es mas
importante que la cedula. Se exige en la activacion, no despues.

En un consultorio esto pesa aun mas que en una tienda: el medico ES el cliente
y hay que poder escribirle. Un correo rebota o se queda sin leer; un WhatsApp
llega.

**Como:** campo obligatorio en el modal de activacion, validado a mano, 7 a 15
digitos, con o sin codigo de pais. **NO depender de intl-tel-input ni de ningun
CDN:** si el CDN no responde, el medico no puede activar su consultorio. La
libreria puede mejorar el campo si carga, nunca ser requisito.

Ver `docs/auth-ui.js` en friendly-123, busca `oc-act-tel`.

### 2. Rescate de licencias

El nodo devuelve en `/checkin` el `licenseCode` que conoce, y el dispositivo lo
adopta **si le falta**. Un solo mecanismo cubre tres casos: alta normal, rescate
individual, y rescate MASIVO (se escribe el codigo en la KV de N instancias y
cada una lo adopta sola cuando su dueno entra).

**Regla de JFC:** se genera en silencio de nuestro lado, y al dueno **se le
avisa la proxima vez que entra**. Un rescate callado del todo es peor que el
problema (no puede anotar su codigo); uno que le pida hacer algo tampoco sirve
(no lo va a hacer).

Solo RELLENA huecos: el nodo nunca pisa un codigo que el dispositivo ya tiene.

Ver `RESCATE-LICENCIAS.md` en friendly-123.

### 3. El bug que hay que buscar PRIMERO en consultorio-123

En friendly-123, la activacion guardaba el codigo **solo como `syncCode`** y
nunca como `licenseCode`. El heartbeat mandaba `licenseCode:""` siempre, asi
que **NINGUNA instancia llego jamas a registrar su licencia** y el panel estaba
vacio. La app le mostraba al dueno el `syncCode` rotulado "tu licencia".

**Revisar en consultorio-123:** que se guarda en `c123_owned` al activar, y que
se manda en el checkin. Si solo hay `syncCode`, es el mismo bug.

### 4. El nodo de licencias clasificaba mal TODAS las apps

`producto = (body.producto === "amigable") ? "amigable-123" : "friendly-123"`,
comparado contra un valor que **ninguna app manda**. Todo caia al else. El
discriminador fiable es el **prefijo del licenseCode**: `AMG-`, `F123-`,
`C123-`. Si consultorio-123 comparte el mismo worker, hereda el bug.

### 5. Candado entre pestanas con Web Locks

Dos pestanas de la misma app se pisan el estado (last-writer-wins). El guard por
BroadcastChannel es una **carrera**: si las dos arrancan a la vez, las dos
pueden creerse principales. `navigator.locks` es un mutex de verdad resuelto por
el navegador. El BroadcastChannel se queda de respaldo para Safari < 15.4.

En consultorio-123 esto es MAS grave: perder un abono o un pago por un
last-writer-wins es plata de un paciente.

### 6. Cortacircuitos del heartbeat

Con el nodo caido, cada llamada esperaba los 8s del timeout y el panel de fallas
se llenaba de la MISMA falla. Tras 5 fallos seguidos se pausa 5 minutos; un
exito lo cierra. El estado vive en memoria a proposito: recargar da otra
oportunidad, que es lo que un usuario espera al recargar.

### 7. `check-sw.sh` y el bump del service worker

**Este bug costo un dia entero.** Se cambia un archivo del shell, no se sube el
CACHE de `sw.js`, y el service worker sigue sirviendo el shell viejo: la pagina
carga una MEZCLA de version vieja y nueva y algo se ve roto sin que haya un solo
error en su codigo. **En localhost es invisible** porque ahi no hay service
worker; solo aparece en un dispositivo que YA tiene la app instalada.

`check-sw.sh` verifica que cada `<script src>` de `index.html` este en el SHELL
y que `sw.js` y `version.json` declaren el mismo shell.

### 8. Reparador de estado (A2), con su leccion

Ya hay doble buffer A/B: si uno se corrompe se usa el otro. El hueco es cuando
fallan **los dos**: el estado entero se descarta y el negocio arranca en blanco.

El reparador poda lo ilegible y conserva el resto. **PERO OJO con la leccion:**
la primera version podaba la percha con el nombre corrupto, y eso se llevaba por
delante todos sus productos (medido: 2 de 3 perchas y 26 de 61 productos). El
reparador causaba mas dano que el dano. Una entidad solo se descarta si le falta
la IDENTIDAD (el id); un NOMBRE ilegible se reemplaza por uno provisional.

En consultorio-123, "percha" es "paciente": borrar un paciente por tener el
nombre corrupto se llevaria su historia de abonos entera.

---

## SI le sirve, pero adaptado

### 9. Huella (checksum) del catalogo

En friendly-123 la huella se calcula sobre perchas y productos. **En
consultorio-123 el equivalente es la lista de PACIENTES** (id + nombre) y, si
existe, la de servicios/tarifas.

**No entra el saldo ni los abonos**, por el mismo motivo por el que no entra el
stock: son movimientos que pueden diferir un instante entre dispositivos y eso
es normal, no es estar desincronizado.

Sirve para lo mismo: que el panel deje de decir "al dia" mirando **solo el
reloj** sin comparar un dato, y para que dos personas comparen `#A7F3` por
telefono.

### 10. Merge entre dispositivos

Mismas dos reglas duras, y en consultorio pesan mas todavia:

1. **SUMA, NUNCA BORRA.** Perder un paciente por unirse a un equipo es
   inaceptable.
2. **NADA SE APLICA SIN QUE UNA PERSONA LO CONFIRME**, viendo el conteo exacto.

**Jerarquia para los choques:** en friendly es dueño > admin > encargado. En
consultorio habria que definirla (medico > asistente?), y **hasta definirla, la
regla segura es la que salio de un bug real:** solo se pisa cuando se conocen
LOS DOS roles y el de enfrente es estrictamente mayor. Con el rol local
desconocido, manda quien tiene el dispositivo en la mano.

**Y lo mas importante para consultorio:** en friendly el stock llega en 0 porque
es un hecho fisico. En consultorio, **los saldos y abonos NO deben mergearse
automaticamente nunca**. Un abono duplicado o perdido es plata real de un
paciente. Si dos dispositivos tienen el mismo abono con montos distintos, se
muestra y decide una persona. Adivinar sobre plata, no.

---

## NO le sirve

- **Todo lo de i18n.** consultorio-123 es en espanol. Los ~70 strings que se
  tradujeron en friendly no aplican.
- **El bug de `simon-config` parseando prosa en espanol.** Solo se rompe cuando
  la UI cambia de idioma. En una app en espanol la regex si hace match.
  **Pero la leccion SI aplica:** parsear texto de UI para sacar un dato es un
  bug esperando el cambio de idioma. Si el dato existe, se pasa como dato.
- **El panel antifraude en UTC.** Revisar igual si consultorio calcula "hoy" con
  `toISOString()`: en Guayaquil, a partir de las 19:00 el UTC ya es el dia
  siguiente. Si lo hace, es el mismo bug con otro nombre.
- **Perchas, variantes, comisiones a asociados, eventos, reposicion de stock.**
  Un consultorio no tiene nada de eso.
- **El codigo TEAM- y su separacion de la licencia**, tal cual. El concepto SI
  aplica (el codigo de equipo no puede verse igual que una licencia o la gente
  los confunde y termina con licencias duplicadas), pero el prefijo y el formato
  hay que decidirlos para consultorio.

---

## La leccion que vale mas que todas

**El sync de friendly-123 propagaba movimientos pero nunca el catalogo, y nadie
lo noto por meses.** El propio codigo lo confesaba en un mensaje de error
—"sincroniza el catalogo primero"— sobre un paso que no existia en ninguna
parte. Dos dispositivos podian estar conectados, hablando, con el panel diciendo
"al dia", y con datos distintos para siempre.

**Antes de dar por bueno cualquier sync en consultorio-123: poner dos
dispositivos de verdad, con datos distintos, y comprobar que se juntan.** No
alcanza con que se conecten. No alcanza con que el panel diga que estan al dia.
