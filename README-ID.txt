PDF READER PRO 2.0 — PANDUAN
1. Ekstrak ZIP di HP.
2. Buat repository GitHub baru dan upload SELURUH ISI folder pdf-reader-pro ke root.
3. Settings > Pages > Deploy from a branch > main > /(root) > Save.
4. Buka URL GitHub Pages di Chrome Android > Install app/Tambahkan ke layar utama.

Fitur tambahan: pencarian teks PDF, thumbnail halaman, daftar isi interaktif bila outline tersedia, catatan lokal, tanda tangan gambar, ekspor PDF dengan catatan/tanda tangan, mode sepia/malam/kecerahan, cetak, backup/restore, estimasi storage. PDF.js text layer mendukung seleksi dan copy teks jika struktur PDF mengizinkan. Password PDF didukung oleh viewer PDF.js (akan meminta kata sandi).

Penyimpanan: file PDF, bookmark, riwayat, anotasi di IndexedDB lokal; tema di LocalStorage. Database yang sama dipertahankan dan schema ditingkatkan ke versi 2. Service Worker hanya menghapus cache aplikasi lama, bukan data pengguna. Jangan gunakan Clear site data. Backup rutin.

Batasan: PDF.js dan PDF-lib diambil dari CDN; koneksi diperlukan untuk memuat library pertama kali. Untuk offline penuh, vendor library harus disimpan di repository dan dimasukkan cache. Highlight/underline presisi, anotasi posisi bebas, pencarian PDF sangat besar, dan thumbnail ratusan halaman masih memerlukan pengujian/penyempurnaan. Browser tetap dapat menghapus data situs; backup sangat disarankan.
Untuk update, ubah APP_VERSION di sw.js lalu upload perubahan. Jangan ubah DB_NAME.
