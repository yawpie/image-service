# Triase dependency image-service

Snapshot residual: 20 Oktober 2026 WITA. Graph canonical mempertahankan Sharp 0.35.5, Multer 2.4.0, Morgan 1.12.1, Express 4.22.3 dan Prisma 5. UUID diperbarui dari 9.0.1 ke **11.1.1 exact**, versi patch yang tetap mendukung CommonJS. `@types/uuid` dihapus karena paket UUID menyediakan tipe sendiri; tidak ada migrasi ESM.

## Kompatibilitas UUID dan bukti regresi

[Advisory UUID](https://github.com/advisories/GHSA-w5hq-g745-h8pq) membahas bounds pada API v3/v5/v6 dengan buffer. Caller aplikasi memakai `v4()` tanpa buffer untuk nama file serta `validate()` pada provisioning. [Rilis resmi 11.1.1](https://github.com/uuidjs/uuid/releases/tag/v11.1.1) membawa patch. Perubahan library tetap memerlukan pembatasan kontrak: validate baru juga menerima versi UUID yang sebelumnya ditolak.

Corpus HTTP berisi **17 kasus** (v1–v8, NIL/MAX, uppercase dan input malformed) lulus pada 9.0.1. Setelah upgrade polos, **empat kasus RED** menerima HTTP 201 padahal harus 400: v6, v7, v8 dan MAX. Guard `validate` lalu `version <= 5` menghasilkan GREEN, mempertahankan v1–v5 serta NIL dan menolak input baru sebelum lookup admin/mutasi key. Pengecekan active-admin tetap berlaku untuk setiap ID yang lolos syntax. Pengujian nama file membuktikan format UUIDv4 acak/WebP tetap sama.

Suite akhir lulus: **197 tes aplikasi + 9 kontrol gate = 206 tes**, build, serta **3 tes PostgreSQL nyata** (active admin, rollback gagal tulis dan rotasi bersamaan). PostgreSQL memakai database sintetis milik task dan env eksplisit; cwd source-only menghindari pemuatan `.env` pribadi. Tes native/symlink Windows yang ditolak sandbox lulus setelah dijalankan pada lingkungan native; kontrol produk tidak dilonggarkan.

## Snapshot npm historis dan risiko tersisa

Audit npm sebelum paket residual mencatat empat paket rentan pada full (tiga high dan satu moderate), serta satu moderate tanpa dev. Itu menghitung paket/propagasi dan **bukan audit npm terkini**. Snapshot tetap dipertahankan. UUID 11.1.1 menambal advisory UUID yang diketahui; tidak adanya advisory pada feed lain bukan alasan penutupan.

High `braces` [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) melalui chokidar/ts-node-dev **tetap terbuka di dev**. Script dev masih memakainya; runner produksi menjalankan Node hasil build dan memangkas dev dependency. Tidak ada patch kompatibel dalam rantai watcher lama, dan tidak ada penggantian watcher untuk mengejar nol. CI/dev tetap memiliki risiko availability bila pola/input tooling tidak tepercaya.

## Pemindaian Trivy aktual dan policy

Scanner **Trivy 0.76.0** dipatok digest `sha256:2416d1f74045b57274df1a340eee6b510cacd73c66a6ccb8da092b117eb7d222`. Unduhan DB publik ke cache task baru tidak memasang source: `UpdatedAt` 19 Oktober 2026 19:08:34 UTC, `DownloadedAt` 23:30:49 UTC, `NextUpdate` 20 Oktober 2026 19:08:34 UTC. Baseline/kandidat menggunakan DB yang sama. Scan memasang hanya manifest/lock read-only dengan jaringan `none`, telemetry nonaktif, konfigurasi/ignore kosong dan tanpa filter severity; full memakai `--include-dev-deps`.

| Scope | Baseline pada DB yang sama | Graph residual |
| --- | --- | --- |
| full | 242 paket unik / 2 pasangan paket-advisory | **241 paket unik / 1 HIGH** |
| production | 164 paket unik / 1 pasangan paket-advisory | **164 paket unik / 0 temuan feed Trivy** |

Temuan full adalah **CVE-2026-93687 / braces 3.0.3**, tanpa fix di feed saat scan. [Policy](dependency-audit-policy.json) hanya mencatat fingerprint/inventaris/hash aktual; tidak menyembunyikan seluruh severity atau dev. Gate menolak source/lock/inventaris berubah, advisory baru, scan gagal, JSON malformed, DB/report kedaluwarsa dan expiry policy. Pemilik tindak lanjut **maintainer repository**, review paling lambat **2 November 2026 UTC** dan sebelum rilis; penerimaan risiko masih terbuka.

[Ringkasan mesin](dependency-scan-verification-2026-10-20.json) memisahkan **raw input CRLF** dari **Git/canonical LF**, menyimpan baseline dengan DB sama dan `previousObservation` utuh. Kontrol scanner scope sebelumnya (lodash produksi + minimist dev: full 2 paket/7 finding, produksi 1 paket/5 finding) tetap historis. Sembilan kontrol gate RED/GREEN dan pemeriksaan CLI tetap dijalankan; tanggal report tidak direlabel setelah jeda proses.

Review otomatis sebelumnya menolak audit npm baru karena ekspor graph repository privat tanpa izin eksplisit. Ia tidak dicoba ulang melalui host/CI lain. Instalasi memakai `--no-audit --no-fund`; Trivy mengunduh data publik lalu menganalisis lokal tanpa mengunggah source/graph. Cakupan/freshness feed npm dan Trivy berbeda; advisory historis yang belum dibuktikan patch atau hilang jalurnya tetap terbuka. Nol pada production Trivy bukan persetujuan risiko atau bukti seluruh aplikasi aman.

## Runner dan batas rilis

Runner kandidat baru dibangun dari snapshot tracked + perubahan source/lock canonical, dengan Dockerfile/.dockerignore tetap sama. Lihat [verifikasi runner residual](container-residual-verification-2026-10-20.json) dan [triase runner residual](container-residual-triage.md). Archive/report container sebelumnya tetap historis dengan graph UUID 9; tidak diganti namanya menjadi kandidat baru. Bukti raw/hash/source baru dicatat terpisah.

CI GitHub atas graph baru wajib lulus setelah review/push; CI hijau sebelumnya memakai graph sebelumnya. **Staging ditunda atas arahan pengguna dan menjadi BLOCKER rilis.** Domain/provider image sebenarnya, proxy, izin volume UID1000, inventaris file lama, pemulihan backup dan penerimaan risiko OS/tooling belum dibuktikan/disetujui. Tidak ada deploy atau perubahan berkas upload pengguna.

Referensi scanner resmi: [cakupan npm/dev](https://trivy.dev/docs/v0.76/guide/coverage/language/nodejs/), [filesystem scanner](https://trivy.dev/docs/v0.76/guide/references/configuration/cli/trivy_filesystem/).
