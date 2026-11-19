import AuthorizedYProvider from './authorized-yprovider.mjs';
import {createOwnerTicketParams} from './ws-owner-ticket-params.mjs';
import {createPhotoShaBridge} from './photo-sha-bridge.mjs';
import {openCertifiedReadOnlyPublicCatalog} from './port2-readonly-catalog-session.mjs';
import {dispatchTypedCommercialCommand} from './port2-typed-ops-client.mjs';
import {createTypedOpsReconciler} from './port2-typed-ops-reconciler.mjs';
import {createTeamTicketParams} from './ws-team-ticket-params.mjs';
import {createTypedOpsIdbStore} from './port2-typed-ops-idb-store.mjs';
import {createOwnerPhotoShaClient,createTeamPhotoShaReader} from './port2-photo-sha-client.mjs';
import {openCertifiedPublicCatalogWriter} from './port2-catalog-delta-writer.mjs';
import {createVerifiedCrossDeviceFailbackCoordinator} from './port2-cross-device-failback.mjs';

const host = 'friendly123-yparty-port2-canary-qa.jfcarpio.workers.dev';
const relayLayer = 'f123_yparty_v1';
const plazoReconectar = 7500;

window.F123YPartyPilot = function (sala, licencia) {
  function readOwnedInstance() {
    let owned;
    try { owned = JSON.parse(localStorage.getItem('f123_owned') || 'null'); } catch (_) {}
    const instanceId = owned?.instanceId;
    if (String(owned?.licenseCode || '').trim().toUpperCase() !== licencia ||
        !/^[A-Za-z0-9_-]{6,120}$/.test(instanceId || '') ||
        !/^[a-f0-9]{32}$/.test(sala || '')) {
      return null;
    }
    return instanceId;
  }
  function ownerCredentials(instanceId) {
    let current;
    try { current = JSON.parse(localStorage.getItem('f123_owned') || 'null'); } catch (_) {}
    if (String(current?.licenseCode || '').trim().toUpperCase() !== licencia ||
        current?.instanceId !== instanceId ||
        window.OCAuth?.rolActual?.() !== 'dueno') throw new Error('owner-session-unavailable');
    const pin = window.OCSecure?.leerPinQueAbre?.()?.owner;
    if (typeof pin !== 'string' || !/^[0-9]{3}$/.test(pin) ||
        pin === '456' || pin === '789') throw new Error('owner-session-unavailable');
    return { kind: 'owner', licenseCode: licencia, instanceId, pin };
  }
  return {
    // PORT2 C23/C16b-store: durable IndexedDB store factory isolated by SHA-256
    // 64-hex namespace (never persisting plaintext license code in IndexedDB).
    async crearAlmacenDurableOpsTipadas({
      indexedDB = globalThis.indexedDB || window.indexedDB,
      openTimeoutMs = 2500
    } = {}) {
      const instanceId = readOwnedInstance();
      if (!instanceId) throw new Error('owner-session-unavailable');
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(licencia + ':' + sala)
      );
      const namespace = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
      return createTypedOpsIdbStore({ indexedDB, namespace, openTimeoutMs });
    },
    // PORT2 C23/C18a: hardened SHA photo client for Owner (PUT/GET) and Team
    // (admin/empleado read-only GET, no put method). Legacy fotoSha() stays null.
    crearClienteFotosShaCertificado({
      fetch: send = globalThis.fetch?.bind(globalThis),
      timeoutMs = 6000
    } = {}) {
      const unavailable = () => new Error('photo sha client unavailable');
      const instanceId = readOwnedInstance();
      if (!instanceId || document.hidden) throw unavailable();
      const role = window.OCAuth?.rolActual?.();
      const isVisible = () => !document.hidden;
      if (role === 'dueno') {
        try { ownerCredentials(instanceId); } catch (_) { throw unavailable(); }
        return createOwnerPhotoShaClient({
          host,
          room: sala,
          licenseCode: licencia,
          instanceId,
          getCredentials: () => ownerCredentials(instanceId),
          isVisible,
          timeoutMs,
          fetch: send
        });
      }
      if (role === 'admin' || role === 'empleado') {
        const teamCredentials = () => {
          let current;
          try { current = JSON.parse(localStorage.getItem('f123_owned') || 'null'); } catch (_) {}
          const activeRole = window.OCAuth?.rolActual?.();
          const team = window.OCSecure?.leerPinQueAbre?.()?.team;
          if (String(current?.licenseCode || '').trim().toUpperCase() !== licencia ||
              current?.instanceId !== instanceId ||
              !['admin', 'empleado'].includes(activeRole) ||
              !team || typeof team !== 'object') {
            throw unavailable();
          }
          return {
            kind: 'team',
            licenseCode: licencia,
            instanceId,
            subject: team.subject,
            role: activeRole,
            pin: team.pin
          };
        };
        teamCredentials();
        return createTeamPhotoShaReader({
          host,
          room: sala,
          licenseCode: licencia,
          instanceId,
          getCredentials: teamCredentials,
          isVisible,
          timeoutMs,
          fetch: send
        });
      }
      throw unavailable();
    },
    // PORT2 C23/C19a: certified single-writer typed delta publisher for -cat.
    async abrirEscritorDeltaCatalogoCertificado(privateDoc, expectedFrozenHead, {
      createProvider,
      fetch: send = globalThis.fetch?.bind(globalThis),
      timeoutMs = 6000,
      onWriterConflict = null
    } = {}) {
      const unavailable = () => new Error('certified catalog writer unavailable');
      const instanceId = readOwnedInstance();
      if (!instanceId || document.hidden) throw unavailable();
      try { ownerCredentials(instanceId); } catch (_) { throw unavailable(); }
      return openCertifiedPublicCatalogWriter({
        privateDoc,
        Y: window.Y,
        room: sala + '-cat',
        licenseCode: licencia,
        instanceId,
        expectedFrozenHead,
        getCredentials: () => ownerCredentials(instanceId),
        createProvider,
        fetch: send,
        isVisible: () => !document.hidden,
        timeoutMs,
        onWriterConflict
      });
    },
    // PORT2 C25: one explicitly activated cutover coordinator, assembling
    // existing C21a/C21b irreversible opId fence + C23 durable IDB and C19a
    // independently certified -cat writer. No automatic network activity.
    async crearCoordinadorCorte20(privateDoc, expectedFrozenHead, {
      indexedDB = globalThis.indexedDB || window.indexedDB,
      createProvider,
      fetch: send = globalThis.fetch?.bind(globalThis),
      timeoutMs = 5000,
      onModeChange = null
    } = {}) {
      const unavailable = () => new Error('certified cutover coordinator unavailable');
      const instanceId = readOwnedInstance();
      if (!instanceId || document.hidden) throw unavailable();
      try { ownerCredentials(instanceId); } catch (_) { throw unavailable(); }
      if (!privateDoc || typeof expectedFrozenHead !== 'string' ||
          !/^[A-Za-z0-9_.:-]{3,128}$/.test(expectedFrozenHead) ||
          typeof createProvider !== 'function') throw unavailable();
      const store = await this.crearAlmacenDurableOpsTipadas({indexedDB});
      if (typeof store.loadCommittedOpIds !== 'function' ||
          typeof store.markCommitted !== 'function') throw unavailable();
      const reconciler = this.crearDespachadorComercialTipado({
        store, fetch: send, timeoutMs
      });
      let coordinator;
      try {
        coordinator = createVerifiedCrossDeviceFailbackCoordinator({
          store,
          reconciler,
          isVisible: () => !document.hidden,
          onModeChange,
          openCatalogSession: ({onWriterConflict}) =>
            this.abrirEscritorDeltaCatalogoCertificado(privateDoc, expectedFrozenHead, {
              createProvider,
              fetch: send,
              timeoutMs,
              onWriterConflict
            })
        });
      } catch (error) {
        reconciler.destroy();
        throw error;
      }
      const onHidden = () => {
        if (document.hidden) void coordinator.failbackToLegacy('document-hidden');
      };
      const onPageHide = () => {
        void coordinator.failbackToLegacy('pagehide');
      };
      document.addEventListener('visibilitychange', onHidden);
      window.addEventListener('pagehide', onPageHide);
      return Object.freeze({
        ...coordinator,
        destroy() {
          document.removeEventListener('visibilitychange', onHidden);
          window.removeEventListener('pagehide', onPageHide);
          coordinator.destroy();
        }
      });
    },
    // PORT2 C16b: explicit opt-in typed commercial command dispatcher backed by
    // C15 business-committed HTTP client + C16a durable same-do-only reconciler.
    // Requires a real caller-supplied durable store (no volatile RAM fallback).
    crearDespachadorComercialTipado({
      store,
      fetch: send = globalThis.fetch?.bind(globalThis),
      timeoutMs = 5000,
      maxAttempts = 5,
      maxPending = 64,
      baseDelayMs = 800,
      maxDelayMs = 15000,
      onSettled = null
    } = {}) {
      if (!store || typeof store.loadAll !== 'function' ||
          typeof store.save !== 'function' || typeof store.remove !== 'function') {
        throw new TypeError('durable store required for typed commercial dispatcher');
      }
      const instanceId = readOwnedInstance();
      if (!instanceId) throw new Error('owner-session-unavailable');
      const opsRoom = sala + '-ops';
      const isVisible = () => !document.hidden;
      const reconciler = createTypedOpsReconciler({
        store,
        isVisible,
        maxAttempts,
        maxPending,
        baseDelayMs,
        maxDelayMs,
        onSettled,
        dispatch: (command) => dispatchTypedCommercialCommand({
          host,
          room: opsRoom,
          licenseCode: licencia,
          instanceId,
          command,
          getCredentials: () => ownerCredentials(instanceId),
          isVisible,
          timeoutMs,
          fetch: send
        })
      });
      const onVisibility = () => {
        if (document.hidden) reconciler.pause();
        else void reconciler.resume();
      };
      const onPageShow = (ev) => {
        if (ev?.persisted && !document.hidden) {
          reconciler.pause();
          void reconciler.resume();
        }
      };
      document.addEventListener('visibilitychange', onVisibility);
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('pageshow', onPageShow);
      }
      return Object.freeze({
        ready: reconciler.ready,
        submit: reconciler.submit,
        reconcileNow: reconciler.reconcileNow,
        pause: reconciler.pause,
        resume: reconciler.resume,
        pending: reconciler.pending,
        quarantined: reconciler.quarantined,
        destroy() {
          document.removeEventListener('visibilitychange', onVisibility);
          if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
            window.removeEventListener('pageshow', onPageShow);
          }
          reconciler.destroy();
        }
      });
    },
    // PORT2 C17b: explicit one-use single-scope HTTP ticket seam for Team roles
    // (admin / empleado). Never grants raw Yjs room access or persists PINs.
    async solicitarTicketComercialEquipo(scope, { fetch: send = globalThis.fetch?.bind(globalThis) } = {}) {
      const unavailable = () => new Error('WS authorization unavailable');
      const instanceId = readOwnedInstance();
      if (!instanceId || document.hidden) throw unavailable();
      const targetRoom = scope === 'fotos:read'
        ? sala + '-fotos'
        : ['ops:sale', 'ops:adjust', 'ops:payment'].includes(scope)
          ? sala + '-ops'
          : null;
      if (!targetRoom) throw unavailable();
      const getCredentials = () => {
        let current;
        try { current = JSON.parse(localStorage.getItem('f123_owned') || 'null'); } catch (_) {}
        const role = window.OCAuth?.rolActual?.();
        const team = window.OCSecure?.leerPinQueAbre?.()?.team;
        if (String(current?.licenseCode || '').trim().toUpperCase() !== licencia ||
            current?.instanceId !== instanceId ||
            !['admin', 'empleado'].includes(role) ||
            !team || typeof team !== 'object') {
          throw unavailable();
        }
        return {
          kind: 'team',
          licenseCode: licencia,
          instanceId,
          subject: team.subject,
          role,
          pin: team.pin
        };
      };
      const fresh = createTeamTicketParams({
        licenseCode: licencia,
        instanceId,
        room: targetRoom,
        scope,
        getCredentials,
        fetch: send
      });
      return fresh();
    },
    // The first real browser seam for C8-C12. This is READ ONLY and requires
    // explicit caller-supplied verified historical HEAD. The default legacy
    // catalog and money paths below remain unchanged until the canary is ready.
    async leerCatalogoPublicoCertificado(privateDoc, expectedFrozenHead, createProvider) {
      let owned;
      try { owned=JSON.parse(localStorage.getItem('f123_owned')||'null'); } catch (_) {}
      const instanceId=owned?.instanceId;
      const getCredentials=()=>{
        let current;
        try { current=JSON.parse(localStorage.getItem('f123_owned')||'null'); } catch (_) {}
        if(String(current?.licenseCode||'').trim().toUpperCase()!==licencia||
           current?.instanceId!==instanceId||
           window.OCAuth?.rolActual?.()!=='dueno')throw new Error('owner-session-unavailable');
        const pin=window.OCSecure?.leerPinQueAbre?.()?.owner;
        if(typeof pin!=='string'||!/^[0-9]{3}$/.test(pin)||
           pin==='456'||pin==='789')throw new Error('owner-session-unavailable');
        return{kind:'owner',licenseCode:licencia,instanceId,pin};
      };
      if(String(owned?.licenseCode||'').trim().toUpperCase()!==licencia||
         !/^[A-Za-z0-9_-]{6,128}$/.test(instanceId||'')||
         !/^[a-f0-9]{32}$/.test(sala||'')||
         document.hidden)throw new Error('certified read-only catalog unavailable');
      return openCertifiedReadOnlyPublicCatalog({
        privateDoc,Y:window.Y,room:sala+'-cat',licenseCode:licencia,
        instanceId,expectedFrozenHead,getCredentials,createProvider
      });
    },
    // HTTP-only transport for immutable SHA photo bytes. Do not give this
    // capability to an authorized Yjs WebSocket provider.
    fotoSha() {
      // P0 #765: legacy photo bridge lacks end-to-end sealing; keep it disabled.
      return null;
      // Original bridge retained for a separately reviewed sealed-photo design.
      if (!/^[a-f0-9]{32}$/.test(sala || '')) return null;
      let owned;
      try { owned=JSON.parse(localStorage.getItem('f123_owned')||'null'); } catch (_) {}
      const instancia=owned?.instanceId;
      if(String(owned?.licenseCode||'').trim().toUpperCase()!==licencia||
         !/^[A-Za-z0-9_-]{6,128}$/.test(instancia||''))return null;
      const getCredentials=()=>{
        let current;
        try { current=JSON.parse(localStorage.getItem('f123_owned')||'null'); } catch (_) {}
        const pin=window.OCSecure?.leerPinQueAbre?.()?.owner;
        if(String(current?.licenseCode||'').trim().toUpperCase()!==licencia||
           current?.instanceId!==instancia||
           window.OCAuth?.rolActual?.()!=='dueno'||
           typeof pin!=='string'||!/^\d{3}$/.test(pin)||['456','789'].includes(pin))
          throw new Error('owner-session-unavailable');
        return{kind:'owner',licenseCode:licencia,instanceId:instancia,pin};
      };
      try {
        getCredentials();
        return createPhotoShaBridge({host,licenseCode:licencia,instanceId:instancia,room:sala,getCredentials});
      } catch (_) { return null; }
    },
    canal(doc, tipo, idb, aplicar, usarRelayHabitual, legadoListo) {
      let plazo = null;
      let revision = 0;
      let enRespaldo = false; // Visibility restores legacy, never creates a competing catalog writer.
      const canal = {
        proveedor: null,
        recuperando: true,
        get recuperacionLocal() { return !idb ? 'sin-almacenamiento' : idb.synced ? 'listo' : 'cargando'; },
        get ws() { return canal.proveedor?.ws; },
        accesoListo() {
          return !canal.recuperando && typeof legadoListo === 'function' &&
            legadoListo() === true && !doc.store.pendingStructs && !doc.store.pendingDs;
        },
        enviarUpdate() {}, // El proveedor escucha el mismo documento Yjs.
        certificar() {
          const proveedor = canal.proveedor;
          if (!proveedor) return Promise.resolve(null);
          return new Promise(resolve => {
            let leer, pendiente, enviado = false, calculando = false, terminado = false;
            const timer = setTimeout(() => terminar(null), 8000);
            function terminar(prueba) {
              if (terminado) return;
              terminado = true;
              clearTimeout(timer);
              clearTimeout(pendiente);
              doc.off('update', programar);
              proveedor.off('synced', programar);
              if (leer) proveedor.off('custom-message', leer);
              resolve(prueba);
            }
            function listo() {
              return !terminado && !enviado && !calculando && canal.proveedor === proveedor &&
                proveedor.synced && canal.accesoListo();
            }
            function programar() {
              if (!listo()) return;
              clearTimeout(pendiente);
              pendiente = setTimeout(solicitar, 300);
            }
            async function solicitar() {
              if (!listo()) return;
              calculando = true;
              const socket = proveedor.ws;
              const corte = revision;
              const vigente = () => canal.proveedor === proveedor && proveedor.ws === socket &&
                proveedor.synced && revision === corte && canal.accesoListo();
              try {
                const estado = window.Y.encodeStateAsUpdate(doc);
                const bytes = await crypto.subtle.digest('SHA-256', estado);
                if (terminado || !vigente()) return;
                const huella = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
                leer = mensaje => terminar(mensaje === 'estado-durable:' + huella ? vigente : null);
                proveedor.on('custom-message', leer);
                enviado = true;
                proveedor.sendMessage('estado-durable');
              } catch (_) { terminar(null); }
              finally { calculando = false; programar(); }
            }
            doc.on('update', programar);
            proveedor.on('synced', programar);
            programar();
          });
        },
        pausar() {
          cancelarPlazo();
          const proveedor = canal.proveedor;
          if (!proveedor) return;
          canal.proveedor = null;
          proveedor.destroy();
          proveedor.awareness.destroy();
        },
        conectar() {
          if (document.hidden || canal.proveedor || doc.isDestroyed) return;
          let instancia;
          try {
            const owned = JSON.parse(localStorage.getItem('f123_owned') || 'null');
            if (String(owned?.licenseCode || '').trim().toUpperCase() === licencia) instancia = owned.instanceId;
          } catch (_) {}
          if (!/^[A-Za-z0-9_-]{6,128}$/.test(instancia || '')) {
            enRespaldo = true; usarRelayHabitual(); return;
          }
          // The private owner path deliberately handles only the channels for
          // which server-side one-use tickets exist. Never pipe photo bytes to
          // an unauthorized/private Yjs room; keep the encrypted old relay.
          // #765 fail-closed: even the catalog carries PIN metadata, finances
          // and customer details. Never pass its raw Y.Doc into the Worker.
          // The existing encrypted legacy relay is still the only transport.
          enRespaldo = true;
          usarRelayHabitual();
          return;
          const getCredentials = () => {
            let owned;
            try { owned = JSON.parse(localStorage.getItem('f123_owned') || 'null'); } catch (_) {}
            if (String(owned?.licenseCode || '').trim().toUpperCase() !== licencia ||
                owned?.instanceId !== instancia ||
                window.OCAuth?.rolActual?.() !== 'dueno') throw new Error('owner-session-unavailable');
            // Only read the transient PIN that already opened the session.
            // No PIN is put in localStorage, module globals, logs or WebSocket URL.
            const pin = window.OCSecure?.leerPinQueAbre?.()?.owner;
            if (typeof pin !== 'string' || !/^\d{3}$/.test(pin) ||
                pin === '456' || pin === '789') throw new Error('owner-session-unavailable');
            return {kind:'owner',licenseCode:licencia,instanceId:instancia,pin};
          };
          let params;
          try {
            getCredentials();
            params = createOwnerTicketParams({
              licenseCode:licencia,instanceId:instancia,room:sala+'-'+tipo,getCredentials
            });
          } catch (_) { enRespaldo = true; usarRelayHabitual(); return; }
          const proveedor = new AuthorizedYProvider(host, sala + '-' + tipo, doc, {
            party:'tienda',params,disableBc:true,connect:false,
            maxBackoffTime:plazoReconectar
          });
          canal.proveedor = proveedor;
          enRespaldo = false;
          esperarConexion(proveedor);
          proveedor.on('authorization-error', () => volverAlRelay(proveedor));
          proveedor.on('status', ({ status }) => {
            if (status === 'connecting' && proveedor.ws) proveedor.ws.relayLayer = relayLayer;
          });
          proveedor.on('synced', listo => {
            if (listo) {
              cancelarPlazo();
              completar();
            } else esperarConexion(proveedor);
          });
          // connect() refreshes params asynchronously. A tab hidden during that
          // turn must still disconnect the provider before it can send data.
          proveedor.connect().then(() => {
            if (document.hidden || canal.proveedor !== proveedor || doc.isDestroyed) proveedor.disconnect();
          }).catch(() => volverAlRelay(proveedor));
        }
      };
      function cancelarPlazo() {
        clearTimeout(plazo);
        plazo = null;
      }
      function volverAlRelay(proveedor) {
        if (canal.proveedor !== proveedor) return;
        // No uncommitted local Y.Doc or encrypted outbox is discarded.
        canal.proveedor = null;
        enRespaldo = true;
        cancelarPlazo();
        try { proveedor.destroy(); } catch (_) {}
        usarRelayHabitual();
      }
      function esperarConexion(proveedor) {
        if (plazo !== null || canal.proveedor !== proveedor) return;
        plazo = setTimeout(() => {
          plazo = null;
          if (canal.proveedor === proveedor && !proveedor.synced && !document.hidden && !doc.isDestroyed) volverAlRelay(proveedor);
        }, plazoReconectar);
      }
      function completar() {
        if (!canal.proveedor?.synced || !idb?.synced ||
            typeof legadoListo !== 'function' || legadoListo() !== true ||
            doc.store.pendingStructs || doc.store.pendingDs) return;
        if (!canal.recuperando) return;
        canal.recuperando = false;
        aplicar();
      }
      doc.on('update', () => { revision++; completar(); });
      if (idb) idb.once('synced', completar);
      // Safari/PWA and Android can restore without a fresh app bootstrap.
      // A previously failed catalog is already on legacy: never spawn a
      // second writer on foreground; explicit, verified rejoin remains allowed.
      function alVolverVisible() {
        if (document.hidden) { canal.pausar(); return; }
        if (!enRespaldo && !doc.isDestroyed) canal.conectar();
      }
      document.addEventListener('visibilitychange', alVolverVisible);
      doc.once('destroy', () => {
        document.removeEventListener('visibilitychange', alVolverVisible);
        canal.pausar();
      });
      canal.reanudar = canal.conectar;
      return canal;
    }
  };
};
