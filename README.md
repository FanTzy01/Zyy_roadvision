# ZYY-ROAD VISION v1.0

Web app untuk mendeteksi kendaraan di kamera HP dan merekam video dengan overlay deteksi AI. Seluruh inferensi dan pemrosesan rekaman dilakukan **di browser** pengguna, tanpa backend unggah video.

## Fitur
- Kamera belakang dan depan (jika tersedia).
- Deteksi mobil, sepeda motor, bus, truk, dan sepeda dengan bounding box serta tingkat keyakinan.
- Statistik kendaraan yang **terlihat pada frame terkini** (bukan jumlah unik kendaraan yang lewat).
- Perekaman video dengan bounding box dan jam, maksimal 5 menit per klip.
- Unduh video dengan format WebM atau MP4, mengikuti dukungan browser.
- Ambil foto beranotasi sebagai PNG.
- Garis pandu jalan berupa **ilustrasi**, bukan hasil deteksi lajur.
- Tanpa server penyimpanan; hasil rekaman diproses di perangkat dan diunduh secara lokal.

## Cara menjalankan di HP
1. Upload **semua tiga berkas** (`index.html`, `style.css`, `app.js`) ke hosting HTTPS, misalnya GitHub Pages, Netlify, atau Cloudflare Pages. File harus berada dalam folder publik yang sama.
2. Buka alamat HTTPS tersebut di browser HP, disarankan Chrome Android yang terbaru.
3. Klik **Aktifkan Kamera** dan izinkan akses kamera.
4. Koneksi internet diperlukan untuk mengunduh TensorFlow.js, COCO-SSD, serta model AI pada pemakaian awal / ketika tidak ada cache.
5. Tunggu status **Engine AI: Aktif** sebelum menilai hasil deteksi.
6. Klik **Mulai Rekam**, kemudian **Hentikan Rekaman**. Sistem akan meminta browser mengunduh video; jika tidak langsung tersimpan, tekan **Simpan Rekaman Terakhir**.
7. Periksa folder **Download / Unduhan** atau aplikasi **Files**, sesuai perilaku browser. Pada iPhone mungkin diperlukan langkah **Save to Files**.

## Menjalankan di laptop (uji lokal)

Buka terminal di folder file ini dan jalankan:

```bash
python -m http.server 8000
```

Buka `http://localhost:8000`. **HTTP non-local di HP tidak akan mendapatkan izin kamera**; gunakan hosting HTTPS.

## Mesin AI
- TensorFlow.js v4.22.0 (CDN)
- COCO-SSD v2.2.3 / lite_mobilenet_v2 (CDN + model online)
- API Browser: `getUserMedia`, `canvas.captureStream`, `MediaRecorder`, dan `download` link.

## Batasan penting
- Hanya kendaraan yang masuk bidang pandang kamera yang dapat terdeteksi; tidak mendeteksi 360° di sekitar HP.
- Tidak menghitung jarak meter, kecepatan, risiko tabrakan, atau depth map 3D. Pendeteksian bisa salah, terutama malam hari, hujan, kendaraan kecil/jauh, atau HP yang lambat.
- Garis pandu berupa ilustrasi visual, **tidak menyesuaikan lengkung/jalur jalan**.
- Rekaman tidak mengandung audio.
- Format dan perilaku penyimpanan bergantung browser/perangkat; unduhan mungkin memerlukan tindakan manual.
- Jangan dipakai sebagai pengganti perhatian pengemudi ataupun sebagai sistem ADAS keselamatan berkendara. Pasang HP secara aman dan jangan menyentuhnya saat berkendara.
- Rekaman disimpan sementara di RAM tab sampai ditutup. **Pastikan berkas berhasil diunduh** sebelum menutup tab atau memulai aktivitas lain.
- Jika tidak ada internet saat library/model belum ada di cache, fitur deteksi tidak dapat berjalan.

## Rencana pengembangan
Versi berikutnya dapat menambahkan segmentasi jalur yang nyata, tracking ID kendaraan, pencatatan ke IndexedDB, pemrosesan lebih cepat, dan model kedalaman dengan kalibrasi. Fitur tersebut **belum** tersedia pada v1.0.
