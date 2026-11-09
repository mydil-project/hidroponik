// HydroFlow — Firebase Auth (Google) + RTDB REST
// Kontrak data firmware: src/main.cpp + include/firebase_config.h
// Hanya email terdaftar di AKUN_EDIT (dan sama di Rules RTDB) yang boleh mengubah.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDbmHxS5OP3bTeG68Nn_jTmgU78-ndQdmc",
  authDomain: "test-50309.firebaseapp.com",
  databaseURL: "https://test-50309-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "test-50309",
  storageBucket: "test-50309.firebasestorage.app",
  messagingSenderId: "1059005265039",
  appId: "1:1059005265039:web:80ef906623d1f2ef256cfa",
};

// email yang boleh mengubah — harus sama dengan daftar di Rules RTDB (rules-rtdb.json)
// tambah akun: tulis di sini DAN di rules-rtdb.json (yaitu Rules Firebase Console)
const AKUN_EDIT = [
  "aidilfebrian01@gmail.com",
  "nelvimayasari13@gmail.com",
];

const DB_URL = firebaseConfig.databaseURL;
const DEVICE_PATH = "perangkat/pompa-1";
const KONFIG_PATH = "konfigurasi";
const POLL_MS = 3000;
const OFFLINE_MS = 60000;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

let idToken = null;
let emailSaat = null;
let namaSaat = null;
let fotoSaat = null;

function bisaEdit() {
  if (!idToken || !emailSaat) return false;
  const email = emailSaat.toLowerCase();
  return AKUN_EDIT.some((x) => x.toLowerCase() === email);
}

function url(path) {
  let u = DB_URL + "/" + path + ".json";
  if (idToken) u += "?auth=" + idToken;
  return u;
}

const $ = (id) => document.getElementById(id);

async function ambil(path) {
  const res = await fetch(url(path));
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

async function tulisKonfigurasi(parsial) {
  if (!bisaEdit()) throw new Error("login akun terdaftar diperlukan");
  let lama = {};
  try {
    lama = (await ambil(KONFIG_PATH)) || {};
    if (typeof lama !== "object" || Array.isArray(lama)) lama = {};
  } catch (e) {}
  idToken = await auth.currentUser.getIdToken(true); // token segar tiap tulis
  const res = await fetch(url(KONFIG_PATH), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...lama, ...parsial }),
  });
  if (!res.ok) throw new Error("Gagal menulis konfigurasi (HTTP " + res.status + ")");
}

function isiNilai(id, nilai) {
  const el = $(id);
  if (document.activeElement === el) return; // jangan menimpa input yang sedang diedit
  el.value = nilai;
}

function pasangJadwal(jadwal, nama, idMulai, idSampai, idOn, idMati, kunci) {
  if (kunci) return; // menunggu perangkat menerbitkan jadwal yang disimpan
  const j = (jadwal || []).find((x) => x.nama === nama);
  if (!j) return;
  isiNilai(idMulai, j.mulai);
  isiNilai(idSampai, j.sampai);
  isiNilai(idOn, j.durasiMenit);
  isiNilai(idMati, Math.max(0, (j.intervalMenit || j.durasiMenit) - j.durasiMenit));
}

function render(db) {
  const now = Date.now() / 1000;
  const dbOk = db && typeof db === "object" && !Array.isArray(db);
  const fresh = dbOk
    ? db.lastSeen > 0
      ? now - db.lastSeen < OFFLINE_MS
      : db.konek === true // fallback: NTP belum sinkron, percaya flag konek
    : false;
  const online = fresh && db.konek !== false;

  if (simpanTunda) {
    if (Date.now() - simpanTunda.mulai > 30000) simpanTunda = null;
    else if (dbOk && jadwalTeks(db.jadwal) === jadwalTeks(simpanTunda.jadwal)) simpanTunda = null;
  }
  const kunciJadwal = !!simpanTunda;

  $("wifiPill").classList.toggle("disconnected", !online);
  $("wifiTeks").textContent = online ? "Online" : "Offline";

  $("connStatus").classList.toggle("disconnected", !online);
  $("connTeks").textContent = online ? "Online" : "Offline";
  $("connDeskripsi").textContent = online
    ? db.lastSeen > 0
      ? "Perangkat berhasil terhubung ke jaringan Wi-Fi."
      : "Perangkat terhubung ke Wi-Fi, namun sinkronisasi waktu (NTP) belum berjalan."
    : "Perangkat tidak merespons. Periksa daya atau WiFi ESP32.";

  $("netNama").textContent = online ? db.ssid || "—" : "—";
  $("netIp").textContent = online ? db.ip || "—" : "—";
  $("netPerangkat").textContent = online ? "ESP32 · RSSI " + db.rssi + " dBm" : "ESP32";

  const teksJadwal = dbOk ? jadwalTeks(db.jadwal) : teksJadwalLama;
  const jadwalBerubah = teksJadwal !== teksJadwalLama;
  teksJadwalLama = teksJadwal;
  const janganBuku = kunciJadwal || !jadwalBerubah;

  pasangJadwal(db && db.jadwal, "siang", "jSiangMulai", "jSiangSampai", "jSiangOn", "jSiangOff", janganBuku);
  pasangJadwal(db && db.jadwal, "malam", "jMalamMulai", "jMalamSampai", "jMalamOn", "jMalamOff", janganBuku);

  if (dbOk && jadwalBerubah && !kunciJadwal) isiLandasan(db.jadwal);
  segarkanTombolSimpan();

  const menyala = online && db.status === true;
  $("badgeStatus").className = "status-badge " + (menyala ? "on" : "off");
  $("badgeStatus").textContent = online ? (menyala ? "MENYALA" : "MATI") : "—";

  $("stSiklus").textContent = online ? (db.mode === "manual" ? "Manual" : "Otomatis") : "—";
  $("stStatus").textContent = online ? (menyala ? "ON" : "OFF") : "—";
  $("pompaDeskripsi").textContent = online
    ? menyala
      ? "Pompa sedang aktif mengalirkan air."
      : "Pompa tidak menyala."
    : "Menunggu data perangkat...";

  const jamManual = online && db.mode === "manual";
  $("btnNyalakan").className = "btn-secondary" + (jamManual ? " btn-aktif" : "");
  $("btnNyalakan").textContent = jamManual && menyala ? "Matikan (Manual)" : "Nyalakan (Manual)";
  $("btnOtomatis").className = "btn-secondary" + (online && !jamManual ? " btn-aktif" : "");
}

async function perbarui() {
  try {
    render(await ambil(DEVICE_PATH));
  } catch (e) {
    render(null);
  }
}

let sedangTulis = false;

// Setelah Simpan: kunci isian hingga perangkat menerbitkan jadwal yang sama
// (perangkat butuh 3-6 dtk untuk terbaca dan menerbitkan ulang), atau 30 dtk.
let simpanTunda = null;

// catatan jadwal render sebelumnya: input hanya ditimpa saat jadwal DB berubah
let teksJadwalLama = null;

function jadwalTeks(jadwal) {
  return (jadwal || [])
    .slice()
    .sort((a, b) => (a.nama > b.nama ? 1 : -1))
    .map((x) => [x.nama, x.mulai, x.sampai || "", x.durasiMenit, x.intervalMenit].join("|"))
    .join(";");
}

const ID_ISIAN = [
  "jSiangMulai", "jSiangSampai", "jSiangOn", "jSiangOff",
  "jMalamMulai", "jMalamSampai", "jMalamOn", "jMalamOff",
];

// baseline = isian yang sudah tersimpan (dari DB atau hasil Simpan terakhir)
let landasan = null;

function isianSekarang() {
  const o = {};
  ID_ISIAN.forEach((id) => (o[id] = String($(id).value ?? "")));
  return o;
}

function isiLandasan(jadwal) {
  const temukan = (nama) => (jadwal || []).find((x) => x.nama === nama);
  const siang = temukan("siang");
  const malam = temukan("malam");
  const on = (j) => (j ? String(j.durasiMenit) : "");
  const mati = (j) => (j ? String(Math.max(0, (j.intervalMenit || j.durasiMenit) - j.durasiMenit)) : "");
  landasan = {
    jSiangMulai: siang ? String(siang.mulai || "") : "",
    jSiangSampai: siang ? String(siang.sampai || "") : "",
    jSiangOn: on(siang),
    jSiangOff: mati(siang),
    jMalamMulai: malam ? String(malam.mulai || "") : "",
    jMalamSampai: malam ? String(malam.sampai || "") : "",
    jMalamOn: on(malam),
    jMalamOff: mati(malam),
  };
}

function jadwalDiedit() {
  if (landasan === null) return false;
  const isian = isianSekarang();
  return ID_ISIAN.some((id) => landasan[id] !== isian[id]);
}

// tombol Simpan hanya tampil bila ada perbedaan isian vs baseline
function segarkanTombolSimpan() {
  if (sedangTulis) return;
  $("btnSimpan").style.display = jadwalDiedit() ? "" : "none";
}

// popup notifikasi di tengah layar
let popupTunda = null;

function tampilkanPopup(teks, tipe = "sukses", durasiMs = 2600) {
  const layar = $("popupNotif");
  const kartu = $("popupKartu");
  $("popupTeks").textContent = teks;
  kartu.className = "popup-kartu " + (tipe === "peringatan" ? "popup-pering" : "popup-sukses");
  kartu.style.animation = "none";
  void kartu.offsetWidth;
  kartu.style.animation = "";
  layar.classList.add("tampil");
  clearTimeout(popupTunda);
  popupTunda = setTimeout(() => layar.classList.remove("tampil"), durasiMs);
}

$("popupNotif").addEventListener("click", (e) => {
  if (e.target === $("popupNotif")) $("popupNotif").classList.remove("tampil");
});

// ---------- Akses: fitur selalu tampil, percobaan ubah ditolak dengan pesan ----------
function pesanAkses() {
  tampilkanPopup(
    idToken ? "Akun tidak terdaftar — hanya melihat." : "Login dengan akun Google terdaftar untuk mengubah.",
    "peringatan",
    3200
  );
}

function perbaruiAkses() {
  segarkanTombolSimpan();

  const masuk = !idToken;
  $("akunMasuk").style.display = masuk ? "" : "none";
  $("akunAvatar").style.display = masuk ? "none" : "";
  if (!masuk) {
    const foto = $("akunFoto");
    const inisial = $("akunInisial");
    foto.style.display = fotoSaat ? "" : "none";
    inisial.style.display = fotoSaat ? "none" : "";
    if (fotoSaat) {
      foto.src = fotoSaat;
    } else {
      inisial.textContent = (namaSaat || "A").trim().charAt(0).toUpperCase() || "A";
    }
  }
}

function bukaPopupLogin() {
  const masuk = !idToken;
  $("divLogin").style.display = masuk ? "" : "none";
  $("divKeluar").style.display = masuk ? "none" : "";
  if (masuk) {
    $("popupLoginJudul").textContent = "Masuk";
  } else {
    $("popupLoginJudul").textContent = "Profil";
    const foto = $("keluarFoto");
    const inisial = $("keluarInisial");
    foto.style.display = fotoSaat ? "" : "none";
    inisial.style.display = fotoSaat ? "none" : "";
    if (fotoSaat) {
      foto.src = fotoSaat;
    } else {
      inisial.textContent = (namaSaat || "A").trim().charAt(0).toUpperCase() || "A";
    }
    $("keluarNama").textContent = namaSaat || "Akun";
    $("keluarCatatan").textContent = bisaEdit() ? "" : "Akun tidak terdaftar - mode lihat-saja.";
  }
  $("popupLogin").classList.add("tampil");
}

function tutupPopupLogin() {
  $("popupLogin").classList.remove("tampil");
}

$("akunMasuk").addEventListener("click", bukaPopupLogin);
$("akunAvatar").addEventListener("click", bukaPopupLogin);
$("btnBatalLogin").addEventListener("click", tutupPopupLogin);
$("btnTutupLogin").addEventListener("click", tutupPopupLogin);

$("popupLogin").addEventListener("click", (e) => {
  if (e.target === $("popupLogin")) tutupPopupLogin();
});

$("btnGoogle").addEventListener("click", async () => {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
    tutupPopupLogin();
    tampilkanPopup("Login berhasil.");
  } catch (err) {
    // popup diblokir browser -> coba lagi lewat redirect halaman penuh
    if (err.code === "auth/popup-blocked") {
      try {
        await signInWithRedirect(auth, provider);
        return; // halaman dipindah, lanjut via getRedirectResult
      } catch (e) {
        err = e;
      }
    }
    let pesan = "Login Google gagal: " + (err.code || err.message);
    if (err.code === "auth/popup-closed-by-user" || err.code === "auth/cancelled-popup-request") return;
    if (err.code === "auth/account-exists-with-different-credential") {
      pesan = "Email ini masih terdaftar sebagai akun email/password. Hapus akun itu di Firebase Console -> Authentication, lalu login Google lagi.";
    }
    if (err.code === "auth/unauthorized-domain") pesan = "Domain halaman belum diizinkan di Firebase Console.";
    if (err.code === "auth/operation-not-supported-in-this-environment") pesan = "Login Google perlu halaman lewat localhost/HTTPS, bukan file://.";
    tampilkanPopup(pesan, "peringatan", 4200);
  }
});

$("btnKeluar").addEventListener("click", async () => {
  try {
    await signOut(auth);
    tutupPopupLogin();
    tampilkanPopup("Akun keluar (mode lihat-saja).");
  } catch (e) {
    tampilkanPopup("Gagal keluar: " + e.message, "peringatan", 3200);
  }
});

// hasil login Google lewat redirect (fallback popup diblokir)
getRedirectResult(auth).catch(() => {}); // gagal senyap; kegagalan penting muncul saat klik tombol

onAuthStateChanged(auth, async (user) => {
  idToken = null;
  emailSaat = null;
  namaSaat = null;
  fotoSaat = null;
  if (user) {
    emailSaat = user.email;
    namaSaat = user.displayName || "Akun";
    fotoSaat = user.photoURL || null;
    idToken = await user.getIdToken();
    if (!bisaEdit()) {
      tampilkanPopup("Akun tidak terdaftar — hanya melihat.", "peringatan", 3500);
    }
  }
  perbaruiAkses();
  await perbarui();
});

// ---------- tombol jadwal ----------
// percobaan ubah oleh pengguna lihat-saja: pesan + isian dikembalikan
const nilaiSaatFokus = new Map();
ID_ISIAN.forEach((id) => {
  $(id).addEventListener("focus", () => nilaiSaatFokus.set(id, $(id).value));
  $(id).addEventListener("input", segarkanTombolSimpan);
  $(id).addEventListener("change", () => {
    if (!bisaEdit()) {
      $(id).value = nilaiSaatFokus.has(id) ? nilaiSaatFokus.get(id) : $(id).value;
      pesanAkses();
    }
    segarkanTombolSimpan();
  });
});

$("btnSimpan").addEventListener("click", async () => {
  if (sedangTulis) return;
  if (!bisaEdit()) {
    pesanAkses();
    return;
  }
  sedangTulis = true;
  try {
    const baca = (id) => parseInt($(id).value, 10);
    const jamBener = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v || "");
    const jSiangMulai = $("jSiangMulai").value;
    const jSiangSampai = $("jSiangSampai").value;
    const jMalamMulai = $("jMalamMulai").value;
    const jMalamSampai = $("jMalamSampai").value;
    const siangOn = baca("jSiangOn");
    const siangOff = baca("jSiangOff");
    const malamOn = baca("jMalamOn");
    const malamOff = baca("jMalamOff");
    const valid = (n) => Number.isInteger(n) && n >= 1 && n <= 720;
    if (!jamBener(jSiangMulai) || !jamBener(jSiangSampai) ||
        !jamBener(jMalamMulai) || !jamBener(jMalamSampai)) {
      tampilkanPopup("Rentang jam tidak valid (format HH:MM).", "peringatan", 3200);
      return;
    }
    if (!valid(siangOn) || !valid(siangOff) || !valid(malamOn) || !valid(malamOff)) {
      tampilkanPopup("Tiap isian harus berupa menit antara 1–720.", "peringatan", 3200);
      return;
    }
    // rentang siang & malam tidak boleh tumpang tindih (jam melingkar, boleh lewat tengah malam)
    const menitJam = (v) => {
      const [h, m] = v.split(":");
      return parseInt(h, 10) * 60 + parseInt(m, 10);
    };
    const jabat = (mulai, selesai) => (selesai - mulai + 1440) % 1440;
    const siangMenit = menitJam(jSiangMulai), siangSelesaiMenit = menitJam(jSiangSampai);
    const malamMenit = menitJam(jMalamMulai), malamSelesaiMenit = menitJam(jMalamSampai);
    const jabatSiang = jabat(siangMenit, siangSelesaiMenit);
    const jabatMalam = jabat(malamMenit, malamSelesaiMenit);
    const diDalam = (titik, mulai, jabatLen) => (titik - mulai + 1440) % 1440 < jabatLen;
    const bentrok = jabatSiang > 0 && jabatMalam > 0 &&
      (diDalam(malamMenit, siangMenit, jabatSiang) || diDalam(siangMenit, malamMenit, jabatMalam));
    if (bentrok) {
      tampilkanPopup("Rentang siang & malam tumpang tindih. Atur ulang jam-nya dulu.", "peringatan", 4000);
      return;
    }
    const jadwalTerpilih = [
      {
        nama: "siang",
        mulai: jSiangMulai,
        sampai: jSiangSampai,
        durasiMenit: siangOn,
        intervalMenit: siangOn + siangOff,
      },
      {
        nama: "malam",
        mulai: jMalamMulai,
        sampai: jMalamSampai,
        durasiMenit: malamOn,
        intervalMenit: malamOn + malamOff,
      },
    ];
    await tulisKonfigurasi({ jadwal: jadwalTerpilih });
    simpanTunda = { mulai: Date.now(), jadwal: jadwalTerpilih };
    landasan = isianSekarang(); // isian saat ini menjadi baseline tersimpan
    $("btnSimpan").style.display = "none";
    tampilkanPopup("Pengaturan tersimpan.");
    await perbarui();
  } catch (e) {
    tampilkanPopup("Pengaturan gagal disimpan: " + e.message, "peringatan", 4000);
  } finally {
    sedangTulis = false;
  }
});

$("btnNyalakan").addEventListener("click", async () => {
  if (sedangTulis) return;
  if (!bisaEdit()) {
    pesanAkses();
    return;
  }
  if (jadwalDiedit()) tampilkanPopup("Jadwal diubah tapi belum disimpan.", "peringatan", 3200);
  sedangTulis = true;
  try {
    const db = await ambil(DEVICE_PATH);
    const nyala = db && db.mode === "manual" && db.status === true;
    await tulisKonfigurasi({ mode: "manual", manual: !nyala });
    tampilkanPopup(nyala ? "Mode Manual: pompa dimatikan." : "Mode Manual: pompa dinyalakan.");
    await perbarui();
  } catch (e) {
    tampilkanPopup("Perintah gagal dikirim: " + e.message, "peringatan", 4000);
  } finally {
    sedangTulis = false;
  }
});

$("btnOtomatis").addEventListener("click", async () => {
  if (sedangTulis) return;
  if (!bisaEdit()) {
    pesanAkses();
    return;
  }
  if (jadwalDiedit()) tampilkanPopup("Jadwal diubah tapi belum disimpan.", "peringatan", 3200);
  sedangTulis = true;
  try {
    await tulisKonfigurasi({ mode: "auto" });
    tampilkanPopup("Mode Otomatis aktif — jadwal berjalan kembali.");
    await perbarui();
  } catch (e) {
    tampilkanPopup("Perintah gagal dikirim: " + e.message, "peringatan", 4000);
  } finally {
    sedangTulis = false;
  }
});

perbaruiAkses();
setInterval(perbarui, POLL_MS);
