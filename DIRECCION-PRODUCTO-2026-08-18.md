# Dirección de producto — las tres apps
**Fecha:** 2026-08-18 · **Fuente:** instrucción directa de JFC
**Estado:** vigente. Reemplaza cualquier suposición anterior sobre qué es cada app.

---

## Lo que hay que tener claro antes de tocar nada

Las tres apps son forks del mismo tronco y comparten origen en GitHub Pages, pero
**ya no son la misma app con otro nombre.** Tratarlas como clones es el error que
hay que dejar de cometer: cada backport a ciegas mete en una app cosas que en esa
app no significan nada.

| | **amigable-123** | **friendly-123** | **consultorio-123** |
|---|---|---|---|
| Etapa | producción, en uso real | **listo para producción — prioridad #1** | focus groups y market research |
| Idioma | español | inglés | español |
| Unidad básica | la percha | la percha | el paciente |
| Prefijo de licencia | `AMG-` | `F123-` | (propio) |
| PIN | 3 dígitos | 3 dígitos | **4 dígitos, por diseño** |
| Qué es | inventario, clientes y comisiones | lo mismo, mercado en inglés | **otra cosa** — ver abajo |

---

## Prioridad: friendly-123 sale a producción YA

Es la que se pasa a live primero. Es la hermana gemela de amigable-123 con el
mercado en inglés, así que todo lo que ya se probó en amigable-123 le sirve tal
cual — sólo hay que llevárselo y traducirlo.

**consultorio-123 va después, y no todo.** Apenas está en focus groups; meterle
ahora sistemas que van a cambiar de forma es trabajo que se va a botar.

---

## consultorio-123 va a ser una app DISTINTA

No es "amigable-123 para médicos". Su centro es lo **contable y financiero**, no
el inventario:

- abonos y pagos de pacientes
- cuentas por cobrar
- control financiero del consultorio
- **visualización financiera fácil** — que el médico entienda su plata de un
  vistazo, sin ser contador

Consecuencia práctica, y esto es lo que hay que respetar en cada backport:

- Lo de **cartera, cuotas, abonos, caja chica, conciliación y reportes
  financieros** SÍ le sirve, y de hecho es su columna vertebral.
- Lo de **perchas, variantes de producto, comisiones a asociados, eventos y
  reposición de stock** NO le sirve. Un consultorio no tiene perchas ni le paga
  comisión a un artista. Portar eso es meterle ruido a una app que todavía se
  está definiendo con usuarios reales.
- Cuando haya duda, **la respuesta por defecto para consultorio-123 es NO
  portar todavía** y esperar a que los focus groups digan qué necesita.

---

## Vocabulario, en las tres

Decidido el 2026-08-17 y ya aplicado en las tres apps:

- **encargado/a**, nunca "empleado". No queremos que parezca que la app lleva
  control de personal: hay alguien encargado del local o de las perchas, y ya.
- **asociado/a**, nunca "promotor/a". Cubre las dos modalidades. Cuando la casa
  retiene un %, se dice **"casa anfitriona"**.
- **Bar y licores son una sola cosa.** No existe el rubro "Licores": los licores
  van dentro de "Bar".

Ojo: el rol interno sigue siendo el string `"empleado"` en PINs, endpoints y
estado guardado. Sólo cambió el texto que la gente lee. Renombrar el rol dejaría
sin acceso a todo dispositivo ya activado y a todo respaldo ya exportado.

---

## Las dos modalidades de comisión

La misma cuenta leída al revés, y las dos lecturas son igual de válidas:

- **Vendedor/a o promotora:** se lleva poco (10%), la casa retiene el resto.
- **Artista:** se lleva casi todo (85%) y **le deja un % a la casa anfitriona**
  (15%). Típico en galerías.

**La misma persona puede tener las dos a la vez**, con perchas distintas. Por eso
el porcentaje NO se guarda por persona: se suma la plata real de cada trato y el
% sale de esa plata. Un único número por persona sería mentira en cuanto alguien
tenga dos tratos — que es el caso normal, no el raro.

---

## Cómo se leen los cambios de las apps hermanas

Para no quemar contexto: **nunca leer `index.html` entero** (pasa de 1 MB).
Se compara con `git log --since`, `git show --stat`, `comm` sobre listas de
archivos, y `grep -rl` de un marcador para saber si un sistema está presente.
Ver `.claude/commands/make-plan.md`.
