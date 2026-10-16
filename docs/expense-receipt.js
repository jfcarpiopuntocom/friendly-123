/* Receipt images use the existing content-addressed photo store/channel.
   Financial records contain only a hash; no photo bytes in the money stream. */
(function () {
  'use strict';
  const es = () => localStorage.getItem('f123_lang') === 'es';
  const message = (en, spanish) => es() ? spanish : en;
  let choices = new Map();
  async function capture(input) {
    const file = input && input.files && input.files[0];
    if (!file) return undefined;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      throw new Error(message('Choose a JPEG, PNG or WebP photo.', 'Elige una foto JPEG, PNG o WebP.'));
    }
    const url = URL.createObjectURL(file);
    let data;
    try {
      const img = new Image();
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      // Respect the existing photo-channel frame budget. Never silently discard a receipt.
      for (const quality of [0.85, 0.7, 0.55, 0.4]) {
        data = canvas.toDataURL('image/jpeg', quality);
        if (data.length <= 180000) break;
      }
      if (data.length > 180000) throw new Error(message('Crop the receipt photo and retry; it exceeds the photo sync size.', 'Recorta la foto y reintenta; supera el tamaño del canal de fotos.'));
    } finally { URL.revokeObjectURL(url); }
    if (!window.OCFotos) throw new Error(message('Photo storage is unavailable.', 'El almacenamiento de fotos no está disponible.'));
    const hash = await OCFotos.hashDeDataUrl(data);
    if (!await OCFotos.guardarPorHash(hash, data)) throw new Error(message('The receipt photo was not saved. Free device storage and retry.', 'No se guardó la foto. Libera espacio del aparato y reintenta.'));
    return hash;
  }
  async function open(hash) {
    if (!/^[a-f0-9]{64}$/.test(hash)) return;
    const data = window.OCFotos && await OCFotos.leerPorHash(hash);
    if (!data || !/^data:image\/(jpeg|png|webp);base64,/.test(data)) {
      await window.ocAlert(message('Receipt photo pending on this device. Keep the source device online to synchronize it.', 'Foto pendiente en este aparato. Mantén conectado el aparato de origen para sincronizarla.'));
      return;
    }
    const dialog = document.createElement('dialog');
    dialog.style.cssText = 'max-width:90vw;max-height:90vh;padding:16px;border:2px solid var(--hairline);border-radius:6px;';
    const close = document.createElement('button'); close.textContent = message('Close', 'Cerrar');
    close.onclick = () => dialog.close();
    const img = document.createElement('img'); img.src = data; img.alt = message('Receipt photo', 'Foto de factura'); img.style.cssText = 'display:block;max-width:100%;max-height:75vh;object-fit:contain;';
    dialog.append(close, img); dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); dialog.showModal();
  }
  function destinations(sales, zone, shelves = []) {
    const select = document.getElementById('gastoDestino'); if (!select) return;
    const previous = select.value;
    choices = new Map([['', { ubicacionId: 'todas' }]]);
    const labels = new Map([['', message('General business expense', 'Gasto general del negocio')]]);
    for (const sale of sales || []) {
      if (!sale || sale.borrado) continue;
      if (sale.ubicacionId) {
        const key = 'shelf:' + sale.ubicacionId;
        choices.set(key, { ubicacionId: sale.ubicacionId });
        labels.set(key, message('Shelf: ', 'Percha: ') + (sale.ubicacionNombre || sale.ubicacionId));
      }
      const eventKey = window.OCBusinessReadModel.eventKey(sale, zone);
      if (eventKey && !eventKey.startsWith('sin-dia:')) {
        const key = 'event:' + eventKey;
        choices.set(key, { ubicacionId: sale.ubicacionId || 'todas', eventKey });
        labels.set(key, message('Event: ', 'Evento: ') + (sale.eventoNombre || sale.productoNombre || '') + ' · ' + (sale.eventoFecha || ''));
      }
    }
    // Preparation expenses belong to a shelf even before its first sale.
    for (const shelf of shelves) {
      if (!shelf || !shelf.id || shelf.borrado || shelf.activa === false) continue;
      const key = 'shelf:' + shelf.id;
      choices.set(key, { ubicacionId: shelf.id });
      labels.set(key, message('Shelf: ', 'Percha: ') + (shelf.nombre || shelf.id));
    }
    select.replaceChildren();
    labels.forEach((label, key) => { const option = document.createElement('option'); option.value = key; option.textContent = label; select.append(option); });
    if (choices.has(previous)) select.value = previous;
  }
  function allocation() {
    const select = document.getElementById('gastoDestino');
    return choices.get(select ? select.value : '') || { ubicacionId: 'todas' };
  }
  window.OCExpenseReceipt = { capture, open, destinations, allocation };
})();
