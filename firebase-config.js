/* ==========================================================
   Konfigurasi Firebase Web SDK
   Diisi dari Firebase Console > Project settings > General
   ========================================================== */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyDbmHxS5OP3bTeG68Nn_jTmgU78-ndQdmc",
  authDomain: "test-50309.firebaseapp.com",
  databaseURL: "https://test-50309-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "test-50309",
  storageBucket: "test-50309.firebasestorage.app",
  messagingSenderId: "1059005265039",
  appId: "1:1059005265039:web:80ef906623d1f2ef256cfa",
  measurementId: "G-901QDRCR11"
};

/* Nama perangkat di Firebase (/perangkat/<id>) */
window.DEVICE_ID = "pompa-1";

/* ==========================================================
   Daftar user yang boleh mengubah mode pompa TIDAK ada di file ini.
   Disimpan di database: /izin/<UID> = true
   (Firebase Console > Realtime Database > klik ikon tambah di /izin)

   Cara mendaftarkan user:
   1. User login di web, UID-nya muncul di notifikasi "belum terdaftar".
   2. Buka Realtime Database > /izin > klik ikon "+" > nama node = UID > nilai true.
   ========================================================== */