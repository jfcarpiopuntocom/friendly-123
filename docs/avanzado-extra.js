

["oc-sync-compartir", "oc-sync-resincronizar", "oc-sync-desactivar"].forEach(function (id) {
   var el = document.getElementById(id);
   if (el) el.style.display = (_rolSync !== "dueno" && !_esLordSync) ? "none" : "";
});
