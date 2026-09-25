# PLAN benchmark #6: el artista carga sus piezas en SU percha (2026-09-24)

Opus 5.5, con las guardas de acceso: plan, pruebas de permisos ANTES del codigo,
respaldo SHA-256, rojo-verde contra el respaldo, dos aparatos, shell nuevo.

## Decisiones de JFC (2026-09-24, AskUserQuestion)
- **Solo agregar piezas.** Nombre, foto, precio y cantidad al crearlas. Despues
  solo el dueno o un admin las edita.
- **Ve solo sus piezas y su stock.** Ni ventas, ni plata, ni clientes. Lo vendido
  y lo pendiente de pago sigue llegando por el estado de cuenta (shell v393).
- **Etiquetas: si, solo las suyas.**
- **Tope de personas: ya no existe como concepto.** Hoy hay 30 dias de uso
  completo; sin licencia se pierden funciones, nunca datos. El acceso de artista
  no cuenta contra ningun cupo. (El codigo aun tiene `LIMITE_EMPLEADOS` en el
  alta de equipo: queda FUERA de este plan, cambio aparte.)

## Hallazgo que manda el diseno
`auth-ui.js` (validar): toda persona del equipo con PIN propio cuyo rol no sea
"admin" entra como **empleado**. Si el artista se guardara en `usuarios` con un
rol nuevo, un aparato SIN actualizar lo haria entrar como empleado (ventas,
clientes, caja). Por eso:

- **El acceso del artista NO va en `usuarios`.** Va como campo nuevo
  `accesoArtista: { pin, activo, actualizadoEn }` en su ficha de comisionista
  (`promotoras`). Un aparato viejo no conoce ese campo: su PIN no abre nada
  (falla cerrado). Campo nuevo, sin schemaVersion, compatible en las dos
  direcciones: el merge viejo hace `Object.assign` y conserva el campo.
- **SU percha** = las perchas cuyo `promotoraId` es esa persona. Sin percha
  asignada, no puede cargar y la pantalla lo dice.

## Pasos, en orden de riesgo

### 1. Pruebas de permisos por rol (ANTES del codigo) — `test/artista-permisos.test.js`
Se escriben primero y deben salir ROJAS en shell v394. Matriz:
1. Con rol `artista`, TODA ruta fuera de la lista blanca da 403 (ventas,
   clientes, liquidaciones, dashboard, usuarios, gastos, respaldo, config...).
   Deny-by-default: una ruta nueva futura queda cerrada sin tocar nada.
2. `GET /api/productos` como artista devuelve SOLO productos de sus perchas;
   sin precio de costo.
3. `POST /api/productos` como artista: la percha y el comisionista se fuerzan
   a los suyos aunque el body pida otra percha; con una percha ajena -> 403.
4. Artista sin percha asignada -> 403 claro al crear.
5. Artista no puede editar (`PUT`), archivar ni borrar productos, ni los suyos.
6. `GET /api/promotoras` NUNCA devuelve el PIN del artista (a nadie).
7. Solo dueno/admin fijan o quitan el PIN de artista; empleado/contador -> 403.
8. PIN de artista no choca con PIN de equipo, integrado ni reservado, en las
   DOS direcciones: alta/edicion de equipo y cambio de PIN integrado (dueno,
   empleado, contador) tambien rechazan un PIN de artista. RIESGO REAL que
   esto cierra: si el dueno tuviera el mismo PIN que un artista, el artista
   entraria como DUENO (el PIN integrado se revisa primero).
8b. Por sync: si llega un PIN de artista que choca con uno local, ese acceso
   queda en conflicto y NO abre en este aparato (falla cerrado) hasta que el
   dueno lo cambie. Riesgo residual anotado: un aparato SIN actualizar no sabe
   de artistas y no puede impedir que alli el dueno elija ese mismo PIN.
9. Dos aparatos: el PIN fijado en A abre en B tras el sync; quitarlo en A
   cierra en B. Un catalogo "viejo" (sin `accesoArtista`) no borra el campo.
10. Fijacion (rotulada como tal): dueno/admin/empleado siguen igual que hoy.

**Comprobacion:** `node --test test/artista-permisos.test.js` -> rojo en v394.

### 2. Backend (`mock-backend.js`) — hace verde el paso 1
- Guarda deny-by-default al entrar al router cuando `_rolLocal() === "artista"`.
- Filtro de productos/perchas del artista; alta forzada a su percha; auditoria
  `mov("alta", ..., por artista)`.
- `PUT /api/promotoras/:id/acceso` (dueno/admin) y verificacion del PIN.
- `accesoArtista` en el export del catalogo y en el alta por sync.
- PIN en GET siempre quitado (se expone `tieneAccesoArtista: true/false`).

**Comprobacion:** paso 1 verde; `node --test` completo verde; carreras de
dinero intactas.

### 3. Entrada con PIN (`auth-ui.js`)
- Tras equipo nombrado: si el PIN es de un artista activo -> `entrar("artista")`,
  `body.rol-artista`, `OCCurrentArtista`. Nada de lo de empleado se aplica.
- Timeout de inactividad igual que todos.

### 4. Vista del artista (archivo nuevo `docs/artista.js`, en el SHELL)
- Pantalla propia que tapa la app: sus piezas con cantidad, boton "Add piece"
  (nombre, foto, precio, cantidad), imprimir etiquetas SOLO de las suyas
  (reusa el generador de etiquetas existente). EN + ES en `i18n.js`.
- Sin emojis, textos >= 13 px, sin gris, cuatro esquinas completas.

### 5. Control del dueno (ficha del comisionista)
- En el editor de comisionista (dueno/admin): "Artist access" con PIN de 3
  digitos, activar/quitar. Muestra si tiene percha asignada.

### 6. Release
- Manual (`manual.html`): que hace el artista, que no ve.
- Shell nuevo (sw.js + version.json), `gen-manifest`, `check-sw.sh`, verificacion
  de hashes contra `git show HEAD:` (trampa CRLF), push, URL viva.
- Chromium real a 375 px: dueno fija PIN, artista entra, carga una pieza,
  imprime etiqueta, no llega a ninguna otra vista.

## Lo que NO entra
- El artista en SU propio telefono: exigiria darle el cuaderno completo. Solo
  entra en un aparato de la tienda.
- Editar o borrar piezas despues de creadas (decision JFC).
- Ver ventas/plata en la app (lo cubre el estado de cuenta v393).
- Quitar `LIMITE_EMPLEADOS` del codigo (cambio aparte).
- Portar a amigable-123 o consultorio-123.
