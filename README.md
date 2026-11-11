# ZYY-ROAD VISION v2.0 — Advanced Road Intelligence

Website statis yang dapat di-host di **GitHub Pages** tanpa server backend. Menggunakan kamera HP atau video lokal untuk mencoba deteksi kendaraan, ID tracking, pendeteksian marka jalan, jarak perkiraan, dan Depth Map relatif. Video ber-overlay dapat diunduh ke perangkat.

## Isi ZIP untuk GitHub

- `index.html` — tata letak website.
- `style.css` — dashboard dark navy, neon cyan, responsif untuk HP.
- `app.js` — kamera, deteksi kendaraan, tracking, analisis marka, jarak, depth, dan rekaman.
- `README.md` — petunjuk penggunaan dan batasan.

Semua file **harus berada di direktori root** repository GitHub. Ketiga file yang dipakai website adalah **index.html**, **style.css**, dan **app.js**. Ini adalah JavaScript browser, *bukan* Google Apps Script.

## Upgrade repository yang sudah ada

1. Ekstrak `ZYY-ROAD-VISION-v2.0.zip` pada laptop.
2. Masuk ke repository GitHub `FanTzy01/Zyy_roadvision` > tab **Code**.
3. Pilih **Add file** > **Upload files**. Unggah `index.html`, `style.css`, dan `app.js` dari folder hasil ekstrak (jangan unggah ZIP saja). Berkas bernama sama dalam root harus diganti dengan versi baru; jika GitHub web menolak duplikat, edit/hapus berkas lama di repository sebelum mengunggah versi baru.
4. Klik **Commit changes** pada branch `main`.
5. Buka **Settings** > **Pages** > **Build and deployment**: `Deploy from a branch`, branch `main`, folder `/(root)`, kemudian **Save**.
6. Setelah deployment selesai, buka `https://fantzy01.github.io/Zyy_roadvision/` dengan Chrome/Edge/Safari yang cukup baru. Gunakan **hard reload** jika laman lama masih muncul.
7. Pilih **Mulai Kamera** dan beri izin kamera. Untuk video yang sudah direkam, pilih **Uji Video**, lalu pilih file dari perangkat.
8. Klik **Mulai Rekam** dan **Hentikan Rekaman**. Bila unduhan otomatis tidak muncul, klik **Simpan Rekaman Terakhir**.

### Persyaratan

- Akses kamera memerlukan HTTPS atau localhost; meminta izin kamera langsung ke browser.
- Dibutuhkan internet untuk memuat TensorFlow.js, COCO-SSD, dan model AI pada penggunaan pertama.
- **Depth AI opsional**: klik **Aktifkan Depth AI** untuk memuat Transformers.js / Depth Anything V2 Small (model `onnx-community/depth-anything-v2-small`, bobot q8 sekitar 27 MB, di luar runtime dan file lainnya). Proses ini menuntut internet dan memori lebih banyak.
- Jika HP melambat atau model Depth gagal: matikan Depth AI; fitur lainnya tetap tersedia.
- Tidak ada backend upload data video. Gambar diproses di browser; pustaka/model tetap diunduh dari CDN/Hugging Face. Rekaman disimpan sementara di memori tab dan perlu diunduh **sebelum menutup tab**.

## Fitur (apa yang benar-benar dilakukan)

1. **Vehicle detection**: TensorFlow.js COCO-SSD (lite_mobilenet_v2) mengembalikan bounding box mobil, motor, bus, truk, sepeda, dan probabilitas.
2. **Vehicle tracking**: ID sementara dipasangkan antardeteksi memakai intersection-over-union dan jarak titik tengah; riwayat pusat digambar sebagai jejak. ID bisa salah, berpindah, atau berganti setelah objek hilang/tertutup. Total ID selama sesi *bukan* penghitung pasti kendaraan melintas atau kecepatan.
3. **Road-marking analysis**: mendeteksi *kandidat garis marka lurus* dengan gradien/tepi piksel serta pemeriksaan dukungan geometrik di bagian bawah gambar. Status marka dapat tidak ditemukan bila jalan tanpa garis, tikungan, cuaca buruk, pencahayaan lemah, kamera miring, atau marka tertutup. Bukan segmentasi lajur berbasis AI maupun lane-keeping.
4. **Distance estimate**: menggunakan lebar bounding box kendaraan, asumsi dimensi kendaraan, dan nilai HFOV yang disetel manual pada pengaturan. Rumus pinhole sederhana ini **tidak terkalibrasi**, sangat mudah salah untuk kendaraan tampak dari samping, sudut kamera, zoom, jenis kendaraan, atau bbox yang kurang akurat. Angka `~X m*` **bukan pengukuran jarak**.
5. **Relative Depth Map**: optional Depth Anything V2 model tunggal/monokular, menghasilkan gradasi warna untuk jarak relatif dalam satu frame. **Tidak ada jarak dalam meter**, akurasi geometrik 3D, ataupun sensor LiDAR; ini bukan replika peta 3D real-time seperti video inspirasi. Inferensi dilakukan secara periodik (sekitar tiap 4.8 detik setelah suatu prediksi selesai), bukan tiap frame.
6. **Video recording**: Canvas yang sudah digambar kotak, ID, jejak, kandidat marka, jam, dan inset Depth (jika aktif) direkam dengan MediaRecorder. Format MP4 atau WebM dipilih sesuai browser. Foto PNG juga bisa disimpan. Rekaman tanpa audio, maksimal 5 menit/klip.
7. **Uji Video**: pilih video lokal untuk mencoba tanpa perlu berjalan di jalan dengan kamera HP; file video tidak diunggah ke server.

## Catatan pengujian

- Kode JavaScript telah melewati pemeriksaan sintaks menggunakan Node.js.
- Antarmuka desktop/HP, kamera tiruan, deteksi tiruan, tracking ID, marka pada gambar simulasi, output Depth **simulasi**, format rekaman dengan MediaRecorder, dan pemutaran file video lokal diuji di Chromium berbasis Playwright.
- Rekaman tes diekspor sebagai MP4 dan validasi ffprobe berhasil.
- **Model AI COCO-SSD asli dan Depth Anything V2 asli belum diuji pada kamera HP fisik di lingkungan ini.** Keberhasilan nyata bergantung pada browser, daya komputasi, izin kamera, internet, dan file model dari pihak ketiga. Pemakaian dengan HP sungguhan perlu diuji.

## Batasan keselamatan & privasi

**Bukan sistem ADAS, antitabrakan, pengukur jarak tepercaya, atau peringatan keselamatan.** Tidak mendeteksi semua kendaraan di sekitar (hanya yang tampak di kamera). Jangan memegang/mengoperasikan HP saat mengemudi. Letakkan kamera secara aman dan patuhi aturan privasi pihak yang terekam. Hindari mengandalkan hasil untuk navigasi, manuver, atau pengereman.

## Arsitektur dan sumber

- TensorFlow.js 4.22.0, COCO-SSD 2.2.3: https://github.com/tensorflow/tfjs-models/tree/master/coco-ssd
- Transformers.js 4.3.2: https://github.com/huggingface/transformers.js
- Depth Anything V2 Small (ONNX): https://huggingface.co/onnx-community/depth-anything-v2-small
- Tidak perlu API key, token GitHub, server, maupun akun Hugging Face untuk membuka website publik.
