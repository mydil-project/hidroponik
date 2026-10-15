/* ==========================================================
   Kontrol Pompa Hydroponik - Firebase Realtime Database
   Jadwal otomatis bersifat permanen (diatur di firmware ESP32).
   Web: lihat status, pilih mode, nyalakan/matikan manual.
   Ubah mode hanya untuk user Google yang UID-nya terdaftar
   di database (/izin/<UID> = true).

   Struktur data:
     /konfigurasi/{mode, manual}     <- ditulis file ini
     /perangkat/<DEVICE_ID>          <- ditulis ESP32
   ========================================================== */
(function () {
  "use strict";

  var DEVICE_ID = window.DEVICE_ID || "pompa-1";
  var TIMEOUT_PERINTAH_MS = 6000;

  // cadangan tampil, selalu mengikuti firmware
  var JADWAL_CADANGAN = [
    { nama: "siang", judul: "Waktu 1 - Siang", mulai: "06:00", sampai: "18:00", durasiMenit: 5, intervalMenit: 15 },
    { nama: "malam", judul: "Waktu 2 - Malam", mulai: "21:00", sampai: "03:00", durasiMenit: 5, intervalMenit: 180 }
  ];

  var mode = "auto";
  var perangkat = null;
  var perintahTertunda = null;
  var bolehKontrol = false;
  var auth = null;
  var refKonfigurasi = null;
  var refPerangkat = null;
  var toastTimer = null;
  var el = {};

  /* ---------------------------------------------------------
     Inisialisasi
     --------------------------------------------------------- */
  function init() {
    cacheElemen();
    tampilkanJadwal(JADWAL_CADANGAN);

    if (typeof firebase === "undefined") {
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
      refKonfigurasi = firebase.database().ref("konfigurasi");
      refPerangkat = firebase.database().ref("perangkat/" + DEVICE_ID);
    } catch (e) {
      fatal("Inisialisasi Firebase gagal: " + e.message);
      return;
    }

    pasangEvent();
    pasangAuth();
    dengarkanPerangkat();

    refKonfigurasi.on("value", function (snap) {
      var v = snap.val() || {};
      mode = v.mode === "manual" ? "manual" : "auto";
      renderKontrol();
    }, function (err) {
      fatal("Akses database ditolak: " + err.message);
    });

    setInterval(kurangiSisa, 1000);
    setInterval(cekPerintahTertunda, 500);
  }

  /* ---------------------------------------------------------
     Tampilan jadwal (read-only, dari laporan ESP32)
     --------------------------------------------------------- */
  function tampilkanJadwal(data) {
    el.jadwalList.innerHTML = "";
    data.forEach(function (s) {
      var jadwal = s.sampai
        ? s.mulai + " - " + s.sampai + " \u00b7 " + s.durasiMenit + " mnt tiap " +
        s.intervalMenit + " mnt"
        : s.mulai + " \u00b7 " + s.durasiMenit + " menit";
      var item = document.createElement("div");
      item.className = "waktu";
      item.innerHTML =
        '<div class="waktu-head">' +
        '<span class="waktu-title"></span>' +
        '<span class="waktu-summary"></span>' +
        '</div>';
      item.querySelector(".waktu-title").textContent = s.judul || s.nama;
      item.querySelector(".waktu-summary").textContent = jadwal;
      el.jadwalList.appendChild(item);
    });
  }

  /* ---------------------------------------------------------
     Status pompa
     --------------------------------------------------------- */
  function renderKontrol() {
    var manual = mode === "manual";
    Array.prototype.forEach.call(el.modeBtns, function (btn) {
      btn.classList.toggle("active", btn.dataset.mode === mode);
      btn.disabled = !bolehKontrol;
    });
    el.relayBtn.disabled = !bolehKontrol || !manual;
    el.relayBtn.title = !bolehKontrol
      ? "Masuk dengan Google untuk mengendalikan pompa"
      : manual
        ? "Klik untuk menyalakan / mematikan pompa"
        : "Pompa berjalan mengikuti jadwal.";

    // auto: kartu jadwal; manual: kartu tombol pompa (posisi sama)
    el.autoCard.hidden = manual;
    el.manualCard.hidden = !manual;

    var nyata = !!(perangkat && perangkat.status);
    var tampil = perintahTertunda ? perintahTertunda.hidup : nyata;

    el.relayBtn.classList.toggle("on", tampil);
    el.relayBtn.classList.toggle("pending", !!perintahTertunda);
    el.relayBtn.setAttribute("aria-pressed", tampil ? "true" : "false");
    el.relayText.textContent = tampil ? "MENYALAKAN" : "MEMATIKAN";
    el.relayIcon.textContent = tampil ? "\u26a1" : "\u23fb";

    if (perintahTertunda) {
      el.relaySource.textContent = "menunggu konfirmasi perangkat...";
    } else if (manual) {
      el.relaySource.textContent = nyata ? "menyala sesuai perintah manual"
        : "mati, klik untuk menyalakan";
    } else {
      el.relaySource.textContent = nyata ? "menyala oleh jadwal otomatis"
        : "mati, menunggu jadwal";
    }
  }

  function renderPerangkat() {
    var d = perangkat;
    var online = !!d && !!d.lastSeen && Date.now() / 1000 - d.lastSeen < 45;

    el.badge.classList.toggle("online", online);
    el.badge.classList.toggle("offline", !online);
    el.badgeText.textContent = online ? "Perangkat online" : "Perangkat offline";

    el.deviceMeta.textContent = "ESP32 \u00b7 " + DEVICE_ID +
      (d && d.konek ? " \u00b7 WiFi tersambung" : " \u00b7 WiFi terputus");

    el.lastSeen.textContent = online ? waktuLokal(d.lastSeen) : "tidak ada laporan";
    el.rssi.textContent = d && typeof d.rssi === "number" ? d.rssi + " dBm" : "\u2013";
    el.ip.textContent = (d && d.ip) || "\u2013";

    if (perintahTertunda && !!d && d.status === perintahTertunda.hidup) {
      perintahTertunda = null;
    }

    renderKontrol();
    renderSisa();

    if (d && Array.isArray(d.jadwal) && d.jadwal.length) {
      tampilkanJadwal(d.jadwal.map(function (s) {
        return {
          nama: s.nama,
          judul: s.nama === "siang" ? "Waktu 1 - Siang" : "Waktu 2 - Malam",
          mulai: s.mulai,
          sampai: s.sampai,
          durasiMenit: s.durasiMenit,
          intervalMenit: s.intervalMenit
        };
      }));
    }
  }

  function renderSisa() {
    var d = perangkat;
    if (!d || !d.status) {
      el.sisa.textContent = "\u2013";
      return;
    }
    if (typeof d.sisaDetik === "number") {
      var nama = d.namaWaktu === "siang" ? "Waktu 1 (siang)" : "Waktu 2 (malam)";
      el.sisa.textContent = formatDurasi(d.sisaDetik) + " (" + nama + ")";
      return;
    }
    el.sisa.textContent = (d.sumber === "manual") ? "tanpa batas waktu" : "tidak dijadwalkan";
  }

  function kurangiSisa() {
    if (!perangkat || !perangkat.status || typeof perangkat.sisaDetik !== "number") return;
    if (perangkat.sisaDetik > 0) {
      perangkat.sisaDetik -= 1;
      renderSisa();
    }
  }

  function cekPerintahTertunda() {
    if (!perintahTertunda) return;
    if (Date.now() - perintahTertunda.sejak < TIMEOUT_PERINTAH_MS) return;
    perintahTertunda = null;
    toast("Perangkat belum merespons. Periksa status online.", "err");
    renderKontrol();
  }

  /* ---------------------------------------------------------
     Aksi (hanya mode & tombol pompa)
     --------------------------------------------------------- */
  function pasangEvent() {
    Array.prototype.forEach.call(el.modeBtns, function (btn) {
      btn.addEventListener("click", function () {
        if (!bolehKontrol) return;
        var baru = btn.dataset.mode;
        if (baru === mode) return;
        simpan({ mode: baru }, "Mode diubah ke " + (baru === "auto" ? "otomatis" : "manual"));
      });
    });

    el.relayBtn.addEventListener("click", function () {
      if (!bolehKontrol || mode !== "manual") return;
      var nyata = !!(perangkat && perangkat.status);
      var hidup = !(perintahTertunda ? perintahTertunda.hidup : nyata);
      perintahTertunda = { hidup: hidup, sejak: Date.now() };
      renderKontrol();
      simpan({ manual: hidup, mode: "manual" },
        hidup ? "Perintah: nyalakan pompa" : "Perintah: matikan pompa");
    });
  }

  /* ---------------------------------------------------------
     Login Google + daftar user yang diizinkan
     --------------------------------------------------------- */
  function pasangAuth() {
    auth = firebase.auth();

    el.loginBtn.addEventListener("click", function () {
      var provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      auth.signInWithPopup(provider).catch(function (err) {
        if (err && err.code !== "auth/popup-closed-by-user") {
          toast("Login gagal: " + err.message, "err");
        }
      });
    });

    el.logoutBtn.addEventListener("click", function () {
      auth.signOut();
    });

    auth.onAuthStateChanged(function (user) {

      if (!user) {
        bolehKontrol = false;
        tampilkanPengguna(null);
        renderKontrol();
        return;
      }

      // satu-satunya sumber kebenaran: /izin/<UID> di database
      firebase.database().ref("izin/" + user.uid).once("value")
        .then(function (snap) {
          bolehKontrol = snap.val() === true;
          tampilkanPengguna(user);
          renderKontrol();
          if (bolehKontrol) {
            toast("Selamat datang, " + (user.displayName || "user"), "ok");
          } else {
            toast("Akun ini belum terdaftar. UID: " + user.uid, "err");
          }
        })
        .catch(function (err) {
          bolehKontrol = false;
          tampilkanPengguna(user);
          renderKontrol();
          toast("Cek izin gagal: " + err.message, "err");
        });
    });
  }

  function tampilkanPengguna(user) {
    el.loginBtn.hidden = !!user;
    el.userBox.hidden = !user;
    if (!user) return;
    el.userName.textContent = user.displayName || user.email || "Pengguna";
    el.userPhoto.src = user.photoURL || "";
    el.userPhoto.hidden = !user.photoURL;
  }

  function simpan(data, pesan) {
    refKonfigurasi.update(data).then(function () {
      toast(pesan, "ok");
    }).catch(function (err) {
      toast("Gagal menyimpan: " + err.message, "err");
    });
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
     Bantuan
     --------------------------------------------------------- */
  function waktuLokal(epochDetik) {
    return new Date(epochDetik * 1000).toLocaleString("id-ID");
  }

  function formatDurasi(detik) {
    if (detik <= 0) return "0 detik";
    return Math.floor(detik / 60) + " menit " + (detik % 60) + " detik";
  }

  function toast(pesan, tipe) {
    clearTimeout(toastTimer);
    el.toast.textContent = pesan;
    el.toast.className = "toast show " + tipe;
    toastTimer = setTimeout(function () {
      el.toast.className = "toast";
    }, 3000);
  }

  function fatal(pesan) {
    el.deviceMeta.textContent = pesan;
    el.badge.classList.add("offline");
    el.badgeText.textContent = "Konfigurasi belum lengkap";
    el.autoCard.hidden = false;
    el.manualCard.hidden = true;
    toast(pesan, "err");
  }

  function cacheElemen() {
    el.jadwalList = document.getElementById("jadwalList");
    el.autoCard = document.getElementById("autoCard");
    el.manualCard = document.getElementById("manualCard");
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
    el.toast = document.getElementById("toast");
    el.modeBtns = document.querySelectorAll(".mode-btn");
    el.loginBtn = document.getElementById("loginBtn");
    el.logoutBtn = document.getElementById("logoutBtn");
    el.userBox = document.getElementById("userBox");
    el.userName = document.getElementById("userName");
    el.userPhoto = document.getElementById("userPhoto");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();