# ZYY-ROAD VISION v3.0 — People, Vehicle & Unique Object Log

Proyek website statis untuk GitHub Pages. Menjalankan deteksi `person`, `car`, `motorcycle`, `bus`, `truck`, dan `bicycle` di browser dengan TensorFlow.js + COCO-SSD. Fitur v2.0 (kamera HP, video lokal, deteksi marka berbasis tepi, estimasi jarak kendaraan, Depth Map relatif, dan ekspor rekaman dengan overlay) tetap tersedia.

## Berkas yang perlu diunggah

```text
Zyy_roadvision/
├── index.html
├── style.css
├── app.js
└── assets/
    ├── zyy-profile.jpg
    └── zyy-badge.png
```

Upload **semua file dan folder**, menjaga struktur persis seperti di atas. `README.md` opsional. `app.js` adalah JavaScript browser, **bukan** Google Apps Script. File foto pengguna di folder `assets` akan dapat diakses publik jika repository/GitHub Pages bersifat publik. Jika tidak ingin foto tersebut terbuka, jangan unggah berkas itu dan ganti dengan avatar nonpersonal melalui `src` pada `index.html`.

### Upgrade dari v2.0 di GitHub

1. Ekstrak ZIP di komputer.
2. Buka `https://github.com/FanTzy01/Zyy_roadvision`, pilih `Code`, branch `main`, lalu `Add file → Upload files`.
3. Unggah `index.html`, `style.css`, `app.js` yang baru sehingga menggantikan versi sebelumnya, **dan** folder `assets/` beserta kedua gambarnya. Jika browser tidak mendukung menyeret folder, unggah melalui GitHub Desktop/git CLI atau buat direktori `assets` di repository lalu letakkan kedua gambar di sana.
4. `Commit changes` ke `main`. Pada `Settings → Pages` gunakan `Deploy from a branch` / `main` / `/(root)`.
5. Setelah deploy, buka `https://fantzy01.github.io/Zyy_roadvision/` dan lakukan hard refresh atau tab samaran jika masih versi lama.
6. Gunakan HTTPS. Izinkan kamera HP; untuk file rekaman, klik `Uji Video`.

## Fitur v3.0

1. **Deteksi manusia otomatis:** COCO-SSD mengenali kategori `person`, menggambar kotak dan probabilitas. **Tanpa fitur pengenalan wajah otomatis** atau pencarian identitas orang dari foto.
2. **Profil dikenal Zyy:** foto pengguna ditampilkan pada kartu profil, dengan nama `Zyy` dan status `Zyy System Development`.
3. **Identitas diketahui melalui QR atau manual:** untuk menandai track sebagai Zyy, tampilkan QR dalam kartu `Lihat QR identitas Zyy` di area tubuh yang terlihat kamera, atau pilih ID person dari dropdown lalu tekan `Tandai pilihan sebagai Zyy`. QR hanya badge sukarela dan dapat disalin, **bukan verifikasi identitas yang aman**. Jika browser tidak mendukung native BarcodeDetector, kode berusaha memakai `jsQR` dari CDN. Jika QR tidak terbaca, gunakan penandaan manual. Orang yang belum ditandai mendapat label `TIDAK DIKENALI` (artinya identitas belum ditetapkan, bukan kepastian orang asing).
4. **Pencatatan kemunculan dan total unik:** track baru yang terdeteksi langsung masuk daftar otomatis dengan tanggal/waktu, jenis, ID, dan status. Track yang sama pada frame berulang tidak menambah hitungan. ID dilacak berdasarkan overlap dan posisi kotak. ID dapat terputus karena objek tertutup, perubahan gerak tajam, keluar lama, atau kamera berpindah. Untuk kemunculan yang terhitung dua kali, gunakan `Gabungkan catatan duplikat` pada dua ID **dengan jenis sama**. Badge Zyy yang terpasang pada track baru menggabungkannya dengan catatan Zyy terdahulu.
5. **Penyimpanan lokal & CSV:** catatan disimpan di `localStorage` browser ini (maksimal 500 log terbaru), dan bisa diunduh CSV melalui tombol `Ekspor CSV`. `Reset Daftar` menghapus daftar dan memulai kembali. LocalStorage dapat hilang ketika browser dibersihkan, mode samaran, atau situs berganti alamat. Jika log penting, ekspor CSV secara berkala.
6. **Estimasi tinggi badan:** *dinonaktifkan secara default.* Agar muncul angka, pilih person dengan seluruh tubuh masuk gambar, masukkan **tinggi acuan yang memang diketahui** dalam cm, lalu klik `Kalibrasi ID terpilih`. Sistem hanya memperkirakan tinggi pada orang dengan **posisi kaki pada kedalaman gambar hampir sama** dan seluruh tubuh terlihat. Jika kondisi ini tidak terpenuhi, sistem menampilkan `belum terukur`. Tinggi acuan tidak tersimpan setelah video/kamera ditutup. Estimasi tidak cocok untuk pengukuran antropometri resmi.
7. **Perekaman dengan overlay:** kotak manusia/kendaraan, identitas yang ditandai, marka, jam, dan Depth Map bila diaktifkan ikut dalam rekaman lokal. Max 5 menit dan tanpa suara. Foto snapshot masih didukung.

## Batasan utama

- **Tidak ada pengenalan wajah otomatis berbasis foto.** Foto profil **tidak** dicocokkan ke wajah kamera. Identitas melalui QR/manual membutuhkan persetujuan dan tidak boleh dianggap autentikasi untuk akses keamanan.
- **Tidak ada deduplikasi sempurna untuk objek yang keluar lalu masuk lagi.** Tanpa identitas permanen, dua kendaraan serupa atau orang yang sama setelah keluar lama tidak selalu bisa dibedakan. Track yang sama di frame berurutan dihitung satu; gabungkan catatan manual ketika perlu.
- **Tinggi badan bukan pengukuran pasti.** Perbandingan bbox sederhana hanya layak untuk orang pada kedalaman serupa dengan acuan, seluruh badan terlihat; distorsi perspektif, jarak, alas kaki, dan pose sangat memengaruhi hasil.
- **Estimasi jarak kendaraan v2.0 dan Depth Map** tetap relatif/tidak terkalibrasi. Jangan digunakan untuk mengemudi, pengereman, pengamanan jalan, atau mengukur jarak aman.
- Gunakan kamera dan perekaman hanya dengan memperhatikan persetujuan/privasi pihak terkait. Jangan mengoperasikan HP sambil mengemudi.
- Pustaka COCO-SSD, TensorFlow.js, dan opsional Depth Anything V2 memerlukan koneksi internet untuk diunduh pertama kali. Performanya bergantung pada perangkat.
- QR scanner native (`BarcodeDetector`) tidak didukung di semua browser; tersedia fallback `jsQR` yang juga memerlukan koneksi internet untuk diunduh.

## Hasil pengujian proyek

- `node --check app.js` lulus.
- Pengujian Chromium menggunakan bounding box **simulasi**: `person + car` menjadi 2 catatan, frame ulang tidak menambah total; penandaan Zyy, kalibrasi berdasarkan acuan, penggabungan duplikat, ekspor CSV, dan pemulihan log lokal lulus.
- Uji visual desktop dan HP memakai video **simulasi**; bukan kamera HP asli atau validasi model AI dengan footage sesungguhnya.
- Model COCO-SSD asli, Depth Anything asli, QR scanner fisik, dan performa HP fisik belum diuji end-to-end pada lingkungan ini. Untuk penggunaan lapangan, uji dan verifikasi dahulu pada perangkat yang digunakan.

**Lisensi/pustaka rujukan:** [COCO-SSD](https://github.com/tensorflow/tfjs-models/tree/master/coco-ssd), [TensorFlow.js](https://www.tensorflow.org/js), [Transformers.js](https://huggingface.co/docs/transformers.js), [MDN BarcodeDetector](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector).
