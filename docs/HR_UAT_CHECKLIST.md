# Senarai semak UAT HR & payroll (Piece 3g)

Aliran penuh yang pemilik jalankan dan bandingkan dengan payroll sebenar
klinik. Setiap langkah ada URL, siapa yang buat, dan apa yang patut kelihatan.
Semua data dalam dunia ujian ini sintetik — nama rekaan, akaun `.invalid`,
angka rekaan. `[D]` = diperhatikan dalam kod/DB, `[A]` = andaian.

## 0. Persediaan

1. Jalankan API dan web (`npm run dev:api`, `npm run dev:web`). API mesti
   berjalan pada pangkalan data yang sama sebelum seed dijalankan, kerana seed
   memandu enjin payroll melalui API itu sendiri.
2. Dari `apps/api`:

   ```
   KUWICK_ADMIN_UAT_SEED=yes \
   ADMIN_UAT_RESET_URL=postgresql://<owner>:<pass>@host:5432/<db> \
   npx tsx prisma/seed-hr-uat.ts
   ```

   Seed ini membina semula tenant `Klinik Contoh (UAT)` (satu syarikat dengan
   semua nombor majikan, dua cawangan, 11 pekerja + 1 kontraktor, gaji,
   statutori, bank, item berulang, roster bulan semasa, cuti umum tahun ini,
   polisi OT mod A untuk staf dan mod B untuk doktor), kemudian menjalankan
   Jun, Julai dan Ogos melalui enjin — kira, lulus, sedia bayaran, rekod
   bayar pada 28 hb — supaya portal ada tiga bulan berbayar dengan PDF.
3. Web: `http://localhost:5173`. Kata laluan semua akaun: `AdminUat!2026`.

| Peranan | Log masuk | Siapa | Untuk apa |
|---|---|---|---|
| Owner | `owner@admin-uat.kuwick.invalid` | Dr Aisyah Rahman | Jalankan dan luluskan payroll, Settings |
| Clinic manager | `manager@admin-uat.kuwick.invalid` | Rohana Yusof | Luluskan cuti, tuntutan dan OT |
| Doktor (portal) | `resident@admin-uat.kuwick.invalid` | Dr Meera Kaur | RM9,500 · rule set Doctors (mod B, RM500 satu syif PH) |
| Jururawat (portal) | `nurse@admin-uat.kuwick.invalid` | Puteri Balqis | RM3,400 · rule set statutori |
| Staf ≤ RM4,000 (portal) | `stock@admin-uat.kuwick.invalid` | Hafiz Osman | RM2,900 · dalam Jadual Pertama |

**Placeholder yang perlu diganti sebelum dibandingkan dengan klinik sebenar**

| Apa | Di mana | Nilai sekarang |
|---|---|---|
| Kadar doktor untuk syif cuti umum (mod B) | `/admin/hr/settings/payroll` → rule set *Doctors* | RM500 satu syif; jam OT, syif hari rehat dan sesi kosong (jatuh ke formula Akta) |
| Kadar mileage tuntutan | Pemalar dalam kod portal (`MILEAGE_RATE_RM` dalam `apps/web/src/me/MyClaimsPage.tsx`) | RM0.60 sekilometer `[A]` — tiada medan skema untuk kadar ini; lihat soalan di §4 |
| Tarikh cuti umum kalendar lunar | `/admin/hr/settings/public-holidays` | Tarikh kebiasaan, ditanda *(placeholder date)*; sahkan dengan warta |

## 1. Aliran

Tanda ☐ apabila keputusan sepadan.

| # | Siapa | URL | Buat | Yang patut kelihatan |
|---|---|---|---|---|
| ☐ 1 | Doktor | `/my` | Tekan **Clock in** | Butang bertukar *Clock out*; *On duty since HH:MM*. Tab Attendance menunjukkan hari ini dengan masa masuk. `[D]` Selfie dan GPS belum ada — memerlukan medan `source`, `proofUrl`, `lat/lng` pada AttendanceRecord (skema, menunggu OK) |
| ☐ 2 | Doktor | `/my/leave` | Type *Annual leave*, From 21 Sep, To 23 Sep, **Submit request** | Jalur pratonton sebelum hantar: *3 days · Balance after: 11 of 14*; jika rakan sekerja cuti hari sama, nama mereka dalam warna emas. Selepas hantar: *Waiting* dalam *My requests*; tab Leave bertanda 1 |
| ☐ 3 | Doktor | `/my/claims` | Type *Mileage*, From *Contoh Central*, To *Contoh Bandar (return)*, Distance 42, Purpose, **lampirkan foto resit** (wajib), **Submit claim** | Amount dikira sendiri *RM 25.20 · 42 × RM 0.60*; butang Submit kelabu sehingga resit dilampirkan; selepas hantar: *Waiting* dalam *My claims* |
| ☐ 4 | Manager | `/admin/hr/leave` | Buka permintaan Dr Meera → **Approve** | Portal doktor: *Approved*; *Recent* di Home menunjukkan *Leave 21 to 23 Sep approved* |
| ☐ 5 | Manager | `/admin/hr/claims` | Buka tuntutan mileage → **Approve**, laluan *Payroll* | Portal doktor: kad *Claims* bertambah, *pays with Sep payroll* |
| ☐ 6 | Manager | `/admin/hr/attendance` | Timesheet: luluskan jam lebih (OT) yang *Pending* | Baris OT bertukar *Approved*; portal pekerja: *approved as overtime* |
| ☐ 7 | Owner | `/admin/hr/payroll?period=2026-09` | **Start this month** → Prepare: klik **Edit** pada satu baris, isi *Other income*, **Save draft** | Baris dikira semula; EPF/SOCSO/EIS/PCB berubah mengikut; footer menamakan siapa *Blocked*; **Continue to review** aktif bila tiada yang disekat |
| ☐ 8 | Owner | (sama, langkah *Review*) | Semak blockers dan warnings, jumlah bulan | Tiada blocker; warnings boleh ditanda *Checked* dengan sebab |
| ☐ 9 | Owner | (sama, langkah *Approve*) | Baca kenyataan, **Approve** | Chip *Approved*; run dikunci |
| ☐ 10 | Owner | (sama, langkah *Pay*) | **Prepare payment listing** → muat turun CSV → **Record paid** (tarikh, rujukan bank) | Status *Paid*; tuntutan yang dibayar dengan gaji bertukar *Paid* |
| ☐ 11 | Doktor | `/my` dan `/my/payslips` | Kad *Latest payslip* → **Download PDF** | PDF September muncul hanya selepas *Paid* `[D]`; angka sama dengan `/admin/hr/payroll/<run>/employees/<staff>` |
| ☐ 12 | Owner | `/admin/hr/reports` | Jana laporan kerajaan: EPF Borang A, SOCSO & EIS 8A, PCB CP39, HRD, EA, Borang E | Setiap laporan dibuka untuk run September; deep-link `?report=…&run=…` kekal |

Bulan yang sudah berbayar (Jun, Julai, Ogos) boleh dilihat di
`/admin/hr/payroll/history` dan dalam portal setiap pekerja.

## 2. Kiraan untuk dibandingkan dengan payslip sebenar

Dicetak oleh `apps/api/src/workforce/payroll-worked-cases.spec.ts` untuk Ogos
2026 (31 hari, satu cuti umum, 8 jam normal). Lajur EPF/SOCSO/EIS: pekerja /
majikan.

| Gaji | Kes | Kasar | EPF | SOCSO | EIS | PCB | Bersih |
|---|---|---|---|---|---|---|---|
| 2,900 | gaji asas sahaja | 2,900.00 | 319.00 / 377.00 | 14.25 / 49.85 | 5.70 / 5.70 | 0.00 | 2,561.05 |
| 2,900 | OT mod A: 6.5 j pada 1.5× (RM14.87/j) + satu cuti umum | 3,268.06 | 319.00 / 377.00 | 16.25 / 56.85 | 6.50 / 6.50 | 0.00 | 2,926.31 |
| 2,900 | OT mod B: RM20/j dan RM250 satu syif PH | +394.98 — 2 hari di bawah Akta → disekat, dibayar pada kadar Akta | | | | | |
| 2,900 | cuti tanpa gaji 1 hari (RM93.55 = 2,900 ÷ 31) | 2,806.45 | 311.00 / 367.00 | 14.25 / 49.85 | 5.70 / 5.70 | 0.00 | 2,475.50 |
| 2,900 | + tuntutan mileage RM42.00 (tidak dicukai) | 2,942.00 | 319.00 / 377.00 | 14.25 / 49.85 | 5.70 / 5.70 | 0.00 | 2,603.05 |
| 5,600 | gaji asas sahaja | 5,600.00 | 616.00 / 672.00 | 27.75 / 97.15 | 11.10 / 11.10 | 0.00 | 4,945.15 |
| 5,600 | OT mod A: 6.5 j pada 1.5× (RM28.72/j) + satu cuti umum | 6,310.78 | 616.00 / 672.00 | 29.75 / 104.15 | 11.90 / 11.90 | 0.00 | 5,653.13 |
| 5,600 | OT mod B: doktor, RM500 satu syif PH | +500.00, kontraktual | | | | | |
| 5,600 | cuti tanpa gaji 1 hari (RM180.65) | 5,419.35 | 605.00 / 660.00 | 27.25 / 95.35 | 10.90 / 10.90 | 0.00 | 4,776.20 |
| 5,600 | + tuntutan mileage RM42.00 | 5,642.00 | 616.00 / 672.00 | 27.75 / 97.15 | 11.10 / 11.10 | 0.00 | 4,987.15 |
| 9,500 | gaji asas sahaja | 9,500.00 | 1,045.00 / 1,140.00 | 29.75 / 104.15 | 11.90 / 11.90 | 37.00 | 8,376.35 |
| 9,500 | OT mod A: 6.5 j pada 1.5× (RM48.72/j) + satu cuti umum | 10,705.78 | 1,045.00 / 1,140.00 | 29.75 / 104.15 | 11.90 / 11.90 | 186.35 | 9,432.78 |
| 9,500 | OT mod B: doktor, RM500 satu syif PH | +500.00, kontraktual | | | | | |
| 9,500 | cuti tanpa gaji 1 hari (RM306.45 = 9,500 ÷ 31) | 9,193.55 | 1,012.00 / 1,104.00 | 29.75 / 104.15 | 11.90 / 11.90 | 27.80 | 8,112.10 |
| 9,500 | + tuntutan mileage RM42.00 | 9,542.00 | 1,045.00 / 1,140.00 | 29.75 / 104.15 | 11.90 / 11.90 | 37.00 | 8,418.35 |

Nota: cuti tanpa gaji dikira mengikut s.18A (gaji bulanan ÷ hari dalam bulan);
PCB dikira mengikut formula MTD dengan angka tahun-ke-tarikh, jadi bulan
berturut-turut dengan gaji sama boleh beri PCB berbeza `[D]`.

## 3. Apa yang seed sediakan untuk portal Dr Meera Kaur

Tiga bulan berbayar (Jun, Julai, Ogos — PDF tersedia), satu hari cuti sakit
diluluskan, tiga hari cuti tahunan menunggu, satu hari tanpa gaji bulan lepas,
tuntutan pergigian RM180 diluluskan untuk payroll bulan ini, makan RM30
dibayar dengan payroll bulan lepas, manfaat perubatan RM1,000 (RM380 digunakan).

## 4. Belum tersedia — menunggu jawapan

| Perkara | Sebab | Cadangan |
|---|---|---|
| Selfie + GPS semasa clock in, radius klinik, tarikh consent | `[D]` Tiada `source`, `proofUrl`, `lat/lng` pada AttendanceRecord; tiada lat/lng klinik atau radius pada polisi; tiada tarikh consent pada profil | Satu migrasi 3g merangkumi kesemuanya — soalan (a) dalam laporan 3d |
| Lampiran MC pada permohonan cuti | `[D]` Tiada model lampiran pada LeaveRequest | Sama — migrasi 3g |
| Kadar mileage boleh ubah | `[D]` Tiada medan kadar pada polisi tuntutan | Sama — migrasi 3g, atau kekal pemalar |
| Tukar akaun bank sendiri dari portal | `[D]` Tiada endpoint; sengaja — akaun bank ditukar melalui HR | Kekal melalui HR |
