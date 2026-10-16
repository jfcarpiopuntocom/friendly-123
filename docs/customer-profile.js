/* Customer presentation adapter. No inference, storage, network or mutation. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OCCustomerProfile = api;
})(globalThis, function () {
  'use strict';
  function whatsapp(value) {
    const text = String(value || '').trim();
    // Preserve extensions/unrecognized text rather than silently changing contacts.
    if (!/^[+\d\s().-]+$/.test(text)) return text;
    const digits = text.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) return text;
    if (digits.startsWith('593') && digits.length === 12) return '+' + digits.slice(0, 3) + '-' + digits.slice(3, 5) + '-' + digits.slice(5, 8) + '-' + digits.slice(8);
    if (digits.length === 10) return (text.startsWith('+') ? '+' : '') + digits.slice(0, 3) + '-' + digits.slice(3, 6) + '-' + digits.slice(6);
    if (digits.startsWith('1') && digits.length === 11) return '+1-' + digits.slice(1, 4) + '-' + digits.slice(4, 7) + '-' + digits.slice(7);
    const groups = text.replace(/[()]/g, '').split(/[\s.-]+/).filter(Boolean);
    if (groups.length > 1) return groups.join('-');
    return (text.startsWith('+') ? '+' : '') + digits.slice(0, -4).replace(/(\d)(?=(\d{3})+$)/g, '$1-') + '-' + digits.slice(-4);
  }
  function gender(value) { return ['male', 'female', 'unknown'].includes(value) ? value : 'unknown'; }
  function resident(value) { return typeof value === 'boolean' ? value : null; }
  function genderLabel(value, es) {
    return (es ? { male: 'Masculino', female: 'Femenino', unknown: 'Desconocido' } : { male: 'Male', female: 'Female', unknown: 'Unknown' })[gender(value)];
  }
  function residentLabel(value, es) {
    return resident(value) === null ? (es ? 'Sin registrar' : 'Not recorded') : value ? (es ? 'Sí' : 'Yes') : 'No';
  }
  return { whatsapp, gender, resident, genderLabel, residentLabel };
});
