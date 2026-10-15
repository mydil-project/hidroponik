/* ==========================================================
   Kontrol Pompa Hydroponik - Firebase Realtime Database
   Struktur data:
     /konfigurasi                 <- ditulis file ini
     /perangkat/<DEVICE_ID>       <- ditulis ESP32
   ========================================================== */
(function () {
  "use strict";

  var SLOT_MAX = 6;
  var DEVICE_ID = (window.DEVICE_ID || "pompa-1");
  var KONFIGURASI_AWAL = {
    mode: "auto",
    manual: false,
    durasiMenit: 5,
    jadwal: [
      { aktif: true, jam: 21, menit: 0 },
      { aktif: true, jam: 0, menit: 0 },
      { aktif: true, jam: 3, menit: 0 },
      { aktif: false, jam: 12, menit: 0 },
      { aktif: false, jam: 12, menit: 0 },
      { aktif: false, jam: 12, menit: 0 }
    ]
  };

  var konfigurasi = null;
  var perangkat = null;
  var refKonfigurasi = null;
  var refPerangkat = null;
  var toastTimer = null;

  var el = {};

  /* ---------------------------------------------------------
     Inisialisasi
     --------------------------------------------------------- */
  function init() {
    cacheElemen();

    if (!window.firebase || typeof firebase === "undefined") {
      fatal("SDK Firebase gagal dimuat. Cek koneksi internet.");
      return;
    }
    var cfg = window.FIREBASE_CONFIG || {};
    if (!cfg.databaseURL || cfg.databaseURL.indexOf("GANTI") !== -1) {
      fatal("Isi dulu web/firebase-config.js dengan apiKey, projectId, dan databaseURL milik Anda.");
      return;
    }

    try {
      if (!firebase.apps.length) firebase.initializeApp(cfg);
      var db = firebase.database();
      refKonfigurasi = db.ref("konfigurasi");
      refPerangkat = db.ref("perangkat/" + DEVICE_ID);
    } catch (e) {
      fatal("Inisialisasi Firebase gagal: " + e.message);
      return;
    }

    bangunBarisJadwal();
    pasangEvent();
    dengarkanPerangkat();

    refKonfigurasi.on("value", function (snap) {
      var nilai = snap.val();
      if (!nilai) {
        refKonfigurasi.set(KONFIGURASI_AWAL);
        return;
      }
      konfigurasi = normalisasi(nilai);
      renderKontrol();
      renderJadwal();
    }, function (err) {
      fatal("Akses database ditolak: " + err.message);
    });

    setInterval(kurangiSisa, 1000);
  }

  /* ---------------------------------------------------------
     Data
     --------------------------------------------------------- */
  function normalisasi(v) {
    var jadwal = [];
    var sumber = Array.isArray(v.jadwal) ? v.jadwal : [];
    for (var i = 0; i < SLOT_MAX; i++) {
      var s = sumber[i] || {};
      jadwal.push({
        aktif: !!s.aktif,
        jam: clamp(parseInt(s.jam, 10) || 0, 0, 23),
        menit: clamp(parseInt(s.menit, 10) || 0, 0, 59)
      });
    }
    return {
      mode: v.mode === "manual" ? "manual" : "auto",
      manual: !!v.manual,
      durasiMenit: clamp(parseInt(v.durasiMenit, 10) || KONFIGURASI_AWAL.durasiMenit, 1, 240),
      jadwal: jadwal
    };
  }

  /* ---------------------------------------------------------
     Render
     --------------------------------------------------------- */
  function bangunBarisJadwal() {
    var tbody = el.jadwalBody;
    tbody.innerHTML = "";
    for (var i = 0; i < SLOT_MAX; i++) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        '<td class="slot-label"></td>' +
        '<td><input type="checkbox" class="slot-aktif"></td>' +
        '<td><input type="number" class="slot-jam" min="0" max="23" step="1"></td>' +
        '<td><input type="number" class="slot-menit" min="0" max="59" step="5"></td>';
      tbody.appendChild(tr);
    }
  }

  function renderKontrol() {
    var mode = konfigurasi.mode;
    Array.prototype.forEach.call(el.modeBtns, function (btn) {
      btn.classList.toggle("active", btn.dataset.mode === mode);
    });

    var manual = mode === "manual";
    el.relayBtn.disabled = !manual;
    el.relayBtn.title = manual ? "Klik untuk menyalakan / mematikan pompa"
      : "Pompa dikontrol oleh jadwal. Pilih mode Manual untuk kendali langsung.";

    var hidup = !!perangkat && !!perangkat.status;
    el.relayBtn.classList.toggle("on", hidup);
    el.relayBtn.setAttribute("aria-pressed", hidup ? "true" : "false");
    el.relayText.textContent = hidup ? "MENYALAKAN" : "MEMATIKAN";
    el.relayIcon.textContent = hidup ? "\u26a1" : "\u23fb";

    if (manual) {
      el.relaySource.textContent = hidup ? "menyala sesuai perintah manual"
        : "mati, klik untuk menyalakan";
    } else {
      el.relaySource.textContent = hidup ? "menyala oleh jadwal otomatis"
        : "mati, menunggu jadwal";
    }
  }

  function renderPerangkat() {
    var d = perangkat;
    var online = !!d && !!d.lastSeen && (Date.now() / 1000 - d.lastSeen) < 30;

    el.badge.classList.toggle("online", online);
    el.badge.classList.toggle("offline", !online);
    el.badgeText.textContent = online ? "Perangkat online" : "Perangkat offline";

    el.deviceMeta.textContent = "ESP32 \u00b7 " + DEVICE_ID +
      (d && d.konek ? " \u00b7 WiFi tersambung" : " \u00b7 WiFi terputus");

    el.lastSeen.textContent = online ? waktuLokal(d.lastSeen) : "tidak ada laporan";
    el.rssi.textContent = d && typeof d.rssi === "number" ? d.rssi + " dBm" : "\u2013";
    el.ip.textContent = (d && d.ip) || "\u2013";

    renderKontrol();
    renderSisa();
  }

  function renderJadwal() {
    var rows = el.jadwalBody.querySelectorAll("tr");
    konfigurasi.jadwal.forEach(function (slot, i) {
      var tr = rows[i];
      if (!tr) return;
      tr.classList.toggle("off", !slot.aktif);
      tr.querySelector(".slot-label").textContent = "S" + (i + 1);
      tr.querySelector(".slot-aktif").checked = slot.aktif;
      tr.querySelector(".slot-jam").value = slot.jam;
      tr.querySelector(".slot-menit").value = slot.menit;
    });
    el.durasi.value = konfigurasi.durasiMenit;
  }

  function renderSisa() {
    if (!perangkat || !perangkat.status || typeof perangkat.sisaDetik !== "number") {
      el.sisa.textContent = "\u2013";
      return;
    }
    el.sisa.textContent = formatDurasi(perangkat.sisaDetik);
  }

  function kurangiSisa() {
    if (!perangkat || !perangkat.status || typeof perangkat.sisaDetik !== "number") return;
    if (perangkat.sisaDetik > 0) {
      perangkat.sisaDetik -= 1;
      renderSisa();
    }
  }

  /* ---------------------------------------------------------
     Aksi
     --------------------------------------------------------- */
  function pasangEvent() {
    Array.prototype.forEach.call(el.modeBtns, function (btn) {
      btn.addEventListener("click", function () {
        if (!konfigurasi) return;
        var mode = btn.dataset.mode;
        if (konfigurasi.mode === mode) return;
        simpan({ mode: mode }, "Mode diubah ke " + mode);
      });
    });

    el.relayBtn.addEventListener("click", function () {
      if (!konfigurasi || konfigurasi.mode !== "manual") return;
      var nyalakan = !(perangkat && perangkat.status);
      simpan({ manual: nyalakan, mode: "manual" },
        nyalakan ? "Perintah: nyalakan pompa" : "Perintah: matikan pompa");
    });

    el.saveBtn.addEventListener("click", simpanJadwal);

    el.defaultBtn.addEventListener("click", function () {
      if (!confirm("Ganti jadwal ke konfigurasi bawaan (21:00, 00:00, 03:00)?")) return;
      simpan({ jadwal: KONFIGURASI_AWAL.jadwal, durasiMenit: KONFIGURASI_AWAL.durasiMenit },
        "Jadwal dikembalikan ke bawaan");
    });

    el.jadwalBody.addEventListener("input", tandaiBelumTersimpan);
    el.durasi.addEventListener("input", tandaiBelumTersimpan);
  }

  function simpanJadwal() {
    if (!konfigurasi) return;
    var jadwal = [];
    var inputs = el.jadwalBody.querySelectorAll("tr");
    for (var i = 0; i < SLOT_MAX; i++) {
      var tr = inputs[i];
      jadwal.push({
        aktif: tr.querySelector(".slot-aktif").checked,
        jam: clamp(parseInt(tr.querySelector(".slot-jam").value, 10) || 0, 0, 23),
        menit: clamp(parseInt(tr.querySelector(".slot-menit").value, 10) || 0, 0, 59)
      });
    }
    var durasi = clamp(parseInt(el.durasi.value, 10) || KONFIGURASI_AWAL.durasiMenit, 1, 240);
    simpan({ jadwal: jadwal, durasiMenit: durasi }, "Jadwal disimpan");
  }

  function simpan(data, pesan) {
    el.saveBtn.disabled = true;
    refKonfigurasi.update(data).then(function () {
      tandaiTersimpan();
      toast(pesan, "ok");
    }).catch(function (err) {
      toast("Gagal menyimpan: " + err.message, "err");
    }).then(function () {
      el.saveBtn.disabled = false;
    });
  }

  function tandaiBelumTersimpan() {
    el.dirtyHint.textContent = "belum disimpan \u2014 tekan Simpan jadwal";
    el.dirtyHint.classList.add("dirty");
  }

  function tandaiTersimpan() {
    el.dirtyHint.textContent = "tersimpan";
    el.dirtyHint.classList.remove("dirty");
  }

  function dengarkanPerangkat() {
    refPerangkat.on("value", function (snap) {
      perangkat = snap.val();
      renderPerangkat();
    }, function (err) {
      toast("Gagal membaca status perangkat: " + err.message, "err");
    });
  }

  /* ---------------------------------------------------------
     Bantuan tampilan
     --------------------------------------------------------- */
  function waktuLokal(epochDetik) {
    try {
      return new Date(epochDetik * 1000).toLocaleString("id-ID");
    } catch (e) {
      return epochDetik;
    }
  }

  function formatDurasi(detik) {
    if (detik <= 0) return "0 detik";
    var m = Math.floor(detik / 60);
    var s = detik % 60;
    return m + " menit " + s + " detik";
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function toast(pesan, tipe) {
    clearTimeout(toastTimer);
    el.toast.textContent = pesan;
    el.toast.className = "toast show " + (tipe || "");
    toastTimer = setTimeout(function () {
      el.toast.className = "toast";
    }, 3000);
  }

  function fatal(pesan) {
    el.deviceMeta.textContent = pesan;
    el.badge.classList.add("offline");
    el.badgeText.textContent = "Konfigurasi belum lengkap";
    el.relayBtn.disabled = true;
    el.saveBtn.disabled = true;
    toast(pesan, "err");
  }

  function cacheElemen() {
    el.jadwalBody = document.getElementById("jadwalBody");
    el.durasi = document.getElementById("durasi");
    el.saveBtn = document.getElementById("saveBtn");
    el.defaultBtn = document.getElementById("defaultBtn");
    el.relayBtn = document.getElementById("relayBtn");
    el.relayText = document.getElementById("relayText");
    el.relayIcon = document.getElementById("relayIcon");
    el.relaySource = document.getElementById("relaySource");
    el.badge = document.getElementById("statusBadge");
    el.badgeText = document.getElementById("statusBadgeText");
    el.deviceMeta = document.getElementById("deviceMeta");
    el.lastSeen = document.getElementById("lastSeen");
    el.rssi = document.getElementById("rssi");
    el.ip = document.getElementById("ip");
    el.sisa = document.getElementById("sisa");
    el.dirtyHint = document.getElementById("dirtyHint");
    el.toast = document.getElementById("toast");
    el.modeBtns = document.querySelectorAll(".mode-btn");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();