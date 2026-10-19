# Triase dependency image-service

Snapshot 20 Oktober 2026 WITA. Graph canonical memakai Sharp 0.35.5, Multer 2.4.0, Morgan 1.12.1, Express 4.22.3 dan Prisma 5. Audit lengkap mencatat empat paket rentan (tiga high dan satu moderate); audit tanpa dev mencatat satu moderate. Angka tersebut menghitung paket/propagasi, bukan empat jalur eksploitasi aplikasi yang terbukti.

- High `braces` [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) merambat melalui `chokidar` dan `ts-node-dev`, yang hanya dipakai `npm run dev`. Runner produksi menjalankan `node dist/index.js` dan memangkas dev dependencies. Ini mengurangi keterjangkauan runtime, tetapi build/CI tetap harus memperlakukan pola/input tooling sebagai tidak tepercaya. Tidak ada patch kompatibel untuk induk lama; penggantian watcher ditunda sebagai pekerjaan terpisah.
- Moderate `uuid` [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) terkait penulisan buffered API. Kode aplikasi memakai `v4()` tanpa buffer dan `validate()`, sehingga jalur buffered tidak dipanggil. Upgrade major di luar patch minimal ini; triase ulang wajib bila cara penggunaan berubah.

## Gate dependensi offline CI

Gate aktif memakai Trivy 0.76.0 yang dipatok digest, bukan permintaan audit npm. Database advisory publik diunduh pada tahap tanpa mount source; setelah itu dua scope dipindai dengan `--network none`, input manifest/lock read-only, `--offline-scan --scanners vuln --disable-telemetry`, serta konfigurasi/ignore kosong. Scanner bekerja dari `/tmp`, di luar source. `--include-dev-deps` dipakai hanya pada scope penuh; default npm lockfile Trivy mengecualikan dev. Instalasi CI memakai `npm ci --no-audit --no-fund`, sehingga audit otomatis npm juga tidak mengekspor graph.

Review otomatis menolak percobaan audit npm baru karena daftar dependensi repository privat akan dikirim ke registry tanpa izin ekspor eksplisit. Perintah tersebut tidak dijalankan dan tidak dicoba ulang melalui host/CI lain. Jalur Trivy ini mengunduh informasi publik lalu menganalisis source secara lokal; tidak mengunggah source atau graph ke layanan scanner.

[Policy](dependency-audit-policy.json) mengikat hash isi lock canonical setelah normalisasi CRLF ke LF, hash/jumlah inventaris paket lengkap untuk setiap scope, serta identitas advisory/paket/versi/severity/fix yang diamati. Tidak ada pengecualian seluruh severity atau dev dependency. Scanner gagal, JSON malformed, target npm kosong/salah, inventaris tidak lengkap, perubahan graph/temuan yang belum ditriase, DB lebih dari 24 jam atau melewati `NextUpdate`, report lama/mendahului unduhan DB, dan policy kedaluwarsa menggagalkan gate. Tanggal review UTC 19 Oktober 2026 (20 Oktober WITA), kedaluwarsa 2 November 2026; pemilik tindak lanjut maintainer repository. Pembaruan graph memerlukan scan serta triase baru, bukan mengganti hash tanpa review.

Sembilan tes gate memiliki RED lalu GREEN, termasuk kontrol report/DB gagal dan portabilitas CRLF Windows. Ketiganya dijalankan lagi pada Node 24.22.0 Linux tanpa jaringan dan lulus bersama report canonical aktual. Fixture scanner nyata memuat `lodash` produksi dan `minimist` dev: full 2 paket/7 finding, produksi 1 paket/5 finding; advisory minimist hanya terdapat pada scope penuh. [Ringkasan mesin](dependency-scan-verification-2026-10-20.json) merekam hash report dan lock raw/canonical. DB lokal bertanggal 19 Oktober 2026 07:19:54 UTC; validasi download-only exit 0 memakai cache task yang masih segar, bukan klaim unduh paksa ulang.

Angka npm historis di atas menghitung paket/propagasi, sedangkan Trivy menghitung pasangan paket/advisory pada feed yang berbeda. Perbedaan cakupan atau freshness feed tidak membuktikan perbaikan versi. Seluruh advisory npm yang sudah diketahui tetap terbuka bila tidak muncul pada DB Trivy saat ini; kelulusan gate teknis maupun nol pada salah satu feed bukan persetujuan rilis atau penerimaan risiko pengguna. Snapshot npm terdahulu dipertahankan sebagai bukti asal, bukan prosedur audit aktif. Maintainer wajib meninjau semua risiko yang masih terbuka sebelum rilis dan saat entrypoint/input/versi berubah.

Referensi resmi: [cakupan npm dan dev dependency](https://trivy.dev/docs/v0.76/guide/coverage/language/nodejs/), [flag filesystem scanner](https://trivy.dev/docs/v0.76/guide/references/configuration/cli/trivy_filesystem/). CI remote tetap menunggu PR; pengujian lokal tidak menyatakan GitHub Actions sudah berjalan.

## Temuan feed Trivy pada lock canonical

| Scope | Paket unik yang diperiksa | Pasangan paket/advisory |
| --- | --- | --- |
| full | 242 | 2 |
| production | 164 | 1 |

Semua temuan berikut tetap tercatat dalam policy. Disposisinya usulan penundaan berbatas waktu hingga review maintainer paling lambat 2 November 2026, bukan persetujuan produksi. Kolom fix hanya merekam feed; adanya versi fix belum membuktikan kompatibilitas pembaruan pada graph ini.

| Advisory / paket | Severity; scope | Fix yang dilaporkan | Paparan dan tindak lanjut |
| --- | --- | --- | --- |
| CVE-2026-93687 / braces 3.0.3 | HIGH; full saja | Belum tercantum | Rantai watcher hanya scope dev, dipangkas dari runner; risiko CI/dev tetap terbuka sebagaimana uraian di atas. |
| CVE-2026-41907 / uuid 9.0.1 | MEDIUM; full + produksi | 11.1.1, 12.0.1, 13.0.1 | Paket produksi. Aplikasi memanggil v4 tanpa buffer dan validate; buffered API yang dibahas advisory tidak dipanggil oleh caller aplikasi saat ini. |
