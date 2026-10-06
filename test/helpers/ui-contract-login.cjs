// Login REAL por PIN para el contrato de UI. Nunca se fuerza OCAuth.rolActual:
// el rol sale del flujo real de docs/auth-ui.js (validar -> alinearYEntrar).
// El teclado se re-baraja (nuevoTeclado) y cada tecla lleva un emoji aleatorio,
// asi que se hace clic por el DIGITO (<span class="dig"> y data-d), jamas por
// posicion ni por el texto completo del boton. PINs ficticios de prueba.
const PINS = { dueno: '682', admin: '514', empleado: '260', contador: '357' };

async function loginAs(page, rol) {
  const pin = PINS[rol];
  if (!pin) throw new Error('rol desconocido: ' + rol);
  // Salir de la sesion previa (si hay) para volver a la pantalla de PIN.
  await page.evaluate(() => { try { window.OCAuth.salir && window.OCAuth.salir(); } catch (_) {} });
  await page.waitForSelector('#oc-pad button', { state: 'visible', timeout: 10000 });
  for (const d of pin) {
    await page.locator('#oc-pad button[data-d="' + d + '"]').click();
  }
  // Entrar = el rol de la sesion coincide. Se espera el valor real, no un selector.
  await page.waitForFunction((r) => window.OCAuth.rolActual && window.OCAuth.rolActual() === r, rol, { timeout: 10000 });
}
module.exports = { loginAs, PINS };
