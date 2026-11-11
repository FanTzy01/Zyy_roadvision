# ZYY-ROAD VISION v3.1 — Patching Human + Vehicle Detection

Aplikasi statis browser untuk Android/Chrome (GitHub Pages), dengan video diproses lokal. Mempertahankan fitur v3.0: kamera depan/belakang, unggah klip uji, rekam overlay, foto, marka jalan eksperimental, Depth Map opsional, CSV, log objek unik, profil Zyy, QR/manual ID, dan kalibrasi perkiraan tinggi.

## Apa yang diperbaiki

1. **Tiga jalur analisis manusia** yang berjalan independen: COCO-SSD (`person`/tubuh), MediaPipe Face Detector (hanya wajah), MediaPipe Pose Landmarker (postur sebagian). Hasilnya digabung: wajah di dalam kotak tubuh tidak membuat catatan manusia kedua.
2. **Kendaraan beragam:** COCO-SSD untuk mobil, motor, truk, bus, sepeda, kereta, pesawat dan perahu (kelas yang didukung dataset COCO); ada **fallback MediaPipe EfficientDet Lite0** jika COCO-SSD gagal dimuat. Kelas-kelas itu tidak menjamin semua kendaraan dapat dikenali di segala kondisi.
3. **Sensitivitas awal 35%** (dapat diubah 20–90%). Lebih sensitif berarti potensi deteksi palsu juga meningkat.
4. **Tracking dan log unik**: objek diberi ID ketika muncul dan tidak ditambah berulang kali pada frame berikutnya selama asosiasi tracking tetap berhasil. Jika masuk lagi setelah tertutup/keluar lama, perangkat bisa memberi ID baru. Ada fitur penggabungan catatan manual.
5. **AI Diagnostics**: tampilkan status Object AI, Face AI, Pose AI, jumlah analisis, pesan galat yang bertahan, dan tombol **Muat Ulang AI**.
6. **Tinggi badan**: memerlukan kalibrasi dan deteksi tubuh utuh; tidak dihitung dari wajah saja karena tidak bisa diperkirakan secara andal.

## Struktur GitHub

```
Zyy_roadvision/
├── index.html
├── style.css
├── app.js
└── assets/
    ├── zyy-profile.jpg
    └── zyy-badge.png
```

Upload semua file dan folder tersebut ke **akar repository** `FanTzy01/Zyy_roadvision` pada branch `main`, lalu Commit changes. Pastikan GitHub Pages di Settings → Pages → Deploy from branch → `main` → `/(root)`. Buka `https://fantzy01.github.io/Zyy_roadvision/` dan reload paksa atau tab samaran (cache lama dapat membuat script v3.0 masih berjalan). GitHub Pages membutuhkan HTTPS untuk izin kamera. Di Chrome Android klik **Mulai Kamera** atau pilih **Uji Video** untuk menguji dari rekaman.

## Diagnosis jika tidak mendeteksi

- Periksa **SYSTEM STATUS** dan baris `Object AI`, `Face AI`, `Pose AI`. Minimal satu harus `Aktif`. `Kamera aktif` saja **tidak berarti AI sudah siap**.
- Tunggu unduhan model pertama kali, gunakan koneksi internet yang stabil. Model memakai beberapa CDN dan `storage.googleapis.com`, yang dapat gagal bila diblokir jaringan/ekstensi/ISP.
- Jika muncul `Gagal library`, `Gagal WebAssembly`, atau `Gagal model`: tekan **Muat Ulang AI**. Coba Chrome terbaru. Matikan VPN/ad-blocker yang menghalangi CDN. Lihat pesan tepat dalam panel merah (`AI ERROR`).
- Coba tampilkan wajah dari depan dalam cahaya cukup pada jarak yang jelas, lalu uji kendaraan. Saat model Object AI aktif, objek yang didukung dan memenuhi skor akan muncul dengan kotak.
- Jika HP melambat, nonaktifkan Depth Map dan tutup aplikasi lain. Pose/Face berjalan pada CPU/WebAssembly dan performanya beragam.
- Jika tombol berfungsi tetapi angka tetap `00`, kirim screenshot **SYSTEM STATUS** (berisi status ketiga model dan pesan error) bersama tipe HP/browser agar masalah bisa ditelusuri.

## Identitas Zyy

Foto `assets/zyy-profile.jpg` adalah **profil contoh yang ditampilkan**, bukan data pelatihan identifikasi wajah. **Wajah manusia bisa terdeteksi otomatis**, tetapi nama tidak dapat disimpulkan dari foto; orang yang belum diverifikasi akan tertulis **Tidak dikenali**. Untuk menampilkan `Zyy — Zyy System Development`, pilih ID orang di dropdown lalu `Tandai pilihan sebagai Zyy` atau tampilkan badge QR terdaftar saat kamera merekamnya. QR dapat disalin dan bukan keamanan autentikasi.

Jika repo publik, gambar di `assets` akan terlihat publik. Hapus/ganti dengan avatar jika tak ingin mempublikasikan foto.

## Pengujian dan batasan

- `node --check app.js`: lulus.
- Browser Chromium dengan **deteksi sintetis (mock bounding boxes)**: 1 wajah + 1 mobil -> dua objek unik; pengulangan 8 kali -> dua objek; tambahan postur/tubuh yang tumpang tindih -> tetap dua objek; tanpa error JavaScript.
- **Belum** dilakukan uji asli jaringan CDN, model sebenarnya, kamera HP fisik, atau perangkat sasaran. Sistem tidak menjamin menemukan semua manusia/kendaraan. Orang yang hanya terlihat sebagian (contoh satu lengan di balik tembok) mungkin tidak dikenali.
- Perkiraan jarak/tinggi/Depth Map tidak terkalibrasi dan bukan pengukuran faktual maupun fitur keselamatan lalu lintas. Jangan operasikan HP saat mengemudi. Gunakan perekaman sesuai privasi dan persetujuan.

Rujukan teknis: [COCO-SSD](https://github.com/tensorflow/tfjs-models/tree/master/coco-ssd) · [MediaPipe Face Detector](https://developers.google.com/edge/mediapipe/solutions/vision/face_detector/web_js) · [Pose Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker) · [MediaPipe Object Detector](https://developers.google.com/edge/mediapipe/solutions/vision/object_detector).
