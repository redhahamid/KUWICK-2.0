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
| Kadar mileage tuntutan dan peraturan resit | `/admin/hr/settings/attendance-leave` → panel *Claims* | RM0.60 sekilometer, resit wajib `[A]` — ubah di sini; kadar dibekukan pada setiap tuntutan semasa dihantar |
| Titik dan radius klinik untuk clock in (geofence) | `/admin/hr/settings/attendance-leave` → *Rules for: Contoh Central* → *Clinic latitude / longitude* | 3.139, 101.6869 (titik placeholder di Kuala Lumpur), 150 m `[A]` — tekan **Use where this device is now** sambil berada di klinik |
| Tarikh cuti umum kalendar lunar | `/admin/hr/settings/public-holidays` | Tarikh kebiasaan, ditanda *(placeholder date)*; sahkan dengan warta |

## 1. Aliran

Tanda ☐ apabila keputusan sepadan.

| # | Siapa | URL | Buat | Yang patut kelihatan |
|---|---|---|---|---|
| ☐ 1 | Doktor (telefon, di klinik) | `/my` | Tekan **Clock in** → skrin *A photo with each punch* → **I agree** → benarkan lokasi dan kamera → **Take photo and clock in** | Mesej *Clocked in.*; butang bertukar *Clock out*; *On duty since HH:MM*. Tab Attendance: hari ini dengan masa masuk dan **thumbnail selfie** di sebelahnya. Jika telefon lebih 150 m dari titik klinik: chip emas *Outside clinic · N m away* (punch tetap direkod, tidak ditolak). Tanpa kamera atau lokasi: punch direkod dan mesej menyebut apa yang tiada. **Skip the photo** / **Not now** merekod punch tanpa foto. Consent ditanya sekali sahaja. `[D]` Hafiz Osman sudah *clock in* (lewat 24 min) hari ini oleh seed asas — uji sebagai Dr Meera atau Puteri, atau *Clock out* dahulu sebagai Hafiz |
| ☐ 1b | Doktor | `/my/attendance` | Tekan **Clock out** dari jauh (atau **Skip the photo**) | Masa keluar direkod; jika di luar radius, chip *Outside clinic* dengan jarak terjauh hari itu |
| ☐ 1c | Owner | `/admin/hr/employees/new` | Tambah pekerja demo: pada *Pay & Statutory* pilih **Employed by**, **Rest day** *Sunday*, biarkan **LINDUNG** *Enrolled*, EPF membership *Malaysian citizen*; tarikh mula 1 Jan 2026 | *Review* tidak lagi menyenaraikan *No employing company* atau *No rest day*; selepas *Add employee*, rekod pekerja menunjukkan syarikat, hari rehat dan LINDUNG bertarikh 1 Jan 2026; gaji Januari tidak menghalangnya atas ketiga-tiga fakta itu `[D]` |
| ☐ 1d | Owner | `/admin/hr/employees/new` | Taip IC `900101-14-5567` pada *Personal*; pilih **Job title** (atau *Add a job title*), **Days a week** *5½ days*; isi *Street address*, *Postcode*, *City*, *State*; pada *Pay & Statutory* pilih **Rest day** *Varies week to week* | *Date of birth* terisi 1 Jan 1990 dan *Gender* *Male* (boleh ditukar); *Review* tidak menyenaraikan *No rest day*; rekod menunjukkan jawatan, *5.5-day week · rest day varies week to week*, alamat lengkap; selepas run dikira, baris INFO *rest day varies* pada orang itu, bulan tidak disekat `[D]` |
| ☐ 1e | Owner | `/admin/hr/employees` → **Job titles** | Tukar nama satu jawatan; *Retire* satu lagi | Rekod pekerja yang memegang jawatan itu menunjukkan nama baharu; jawatan yang di-*retire* tidak ditawarkan pada borang tetapi kekal pada pemegangnya `[D]` |
| ☐ 1f | Owner | `/admin/hr/employees` → **Add several** | **Template (CSV)**, isi dua baris demo dalam Excel (cawangan dan syarikat dengan nama, IC `900101-14-5566` dan `850505-10-5571`, gaji 2500 dan 2800, *Malaysian citizen*, *Sunday*), **Upload CSV**, kemudian **Check rows**; tukar IC baris kedua kepada IC baris pertama dan **Check rows** lagi; betulkan, **Add 2 employees** | Baris contoh templat tidak dibaca sebagai orang; tarikh lahir dan jantina terisi dari IC; *Ready for payroll* pada kedua-dua baris; IC berganda ditanda di bawah selnya (*The same IC is on another row of this batch*) dan tiada seorang pun ditambah; selepas dibetulkan, dua pekerja muncul di *Employees* dengan syarikat, gaji dan kedudukan statutori bertarikh dari tarikh mula `[D]` |
| ☐ 2 | Doktor | `/my/leave` | Type *Annual leave*, From 21 Sep, To 23 Sep, **Submit request** | Jalur pratonton sebelum hantar: *3 days · Balance after: 11 of 14*; jika rakan sekerja cuti hari sama, nama mereka dalam warna emas. Selepas hantar: *Waiting* dalam *My requests*; tab Leave bertanda 1 |
| ☐ 2b | Doktor | `/my/leave` | Type *Medical leave*, satu hari, **tanpa** lampiran, cuba Submit; kemudian lampirkan foto/PDF MC, **Submit request** | Zon *Drop MC or photo here — required*; butang Submit kelabu sehingga MC dipilih `[D]` polisi cuti menetapkan MC wajib untuk cuti sakit. Selepas hantar: baris *Medical* dengan thumbnail/nama fail MC |
| ☐ 3 | Doktor | `/my/claims` | Type *Mileage*, From *Contoh Central*, To *Contoh Bandar (return)*, Distance 42, Purpose, **lampirkan foto resit** (wajib), **Submit claim** | Amount dikira sendiri *RM 25.20 · 42 × RM 0.60* (kadar dari Settings › Claims); butang Submit kelabu sehingga resit dilampirkan; selepas hantar: *Waiting* dalam *My claims*, baris menunjukkan *42 km × RM 0.60* dan thumbnail resit. Pelayan mengira semula amaun dari jarak × kadar `[D]` |
| ☐ 4 | Manager | `/admin/hr/leave` | **Review** pada permintaan Dr Meera → baca baki selepas, siapa lagi cuti, lampiran MC → **Approve** | Laci keputusan menunjukkan: jenis, tarikh, *Balance after*, *Also away*, MC (jika ada), dan kesan pada payroll. Portal doktor: *Approved*; *Recent* di Home menunjukkan *Leave 21 to 23 Sep approved* |
| ☐ 4b | Manager | `/admin/hr/leave` | **Review** permintaan lain → **Reject** tanpa nota | Butang menolak sehingga nota diisi (pekerja akan baca nota itu) |
| ☐ 5 | Manager | `/admin/hr/claims` | **Review** tuntutan mileage → lihat resit dan *42 km × RM 0.60* → *Paid from: With their salary* → **Approve RM 25.20** | Resit dipaparkan dalam laci (bukan nama fail sahaja); kadar yang dibekukan pada tuntutan ditunjukkan. Portal doktor: kad *Claims* bertambah, *pays with Sep payroll* |
| ☐ 5b | Manager | `/admin/hr/claims` | **Review** → tukar amaun kepada RM 20.00 tanpa nota | Butang menolak sehingga nota diisi — amaun berbeza mesti ada sebabnya |
| ☐ 5c | Manager | `/admin/hr/claims` | **+ Record claim**: pilih pekerja cawangan sendiri, *Meals* RM 30, tujuan, lampirkan foto resit, **Record it**; ulang dengan *Mileage* 10 km | Tuntutan muncul *Waiting* dengan resit; laci *Review* menyatakan *entered on their behalf*; mileage 10 km diharga km × kadar klinik (RM 6.00 pada kadar lalai); tanpa resit ditolak apabila polisi mewajibkan resit; pekerja cawangan lain tidak ditawarkan `[D]` |
| ☐ 6 | Manager | `/admin/hr/attendance` | Timesheet hari ini: lihat thumbnail selfie dan chip *Outside clinic* (jika ada), tekan **Pending · approve** pada baris OT | Baris OT bertukar *Approved*; kaki jadual menyebut peraturan yang berkuat kuasa; portal pekerja: *approved as overtime* |
| ☐ 6b | Manager | `/admin/hr/attendance` | Tab **Corrections**: luluskan atau tolak permintaan pembetulan pekerja | Rekod asal kekal; pekerja melihat keputusan. Tab **Monthly summary**: OT *approved* dan *pending* dalam dua lajur berasingan |
| ☐ 7 | Owner | `/admin/hr/payroll?period=2026-09` | **Start this month** → Prepare: klik petak *Other income* pada satu baris, **Add a line**, pilih item dan jumlah, simpan | Bulan dikira semula sendiri; jumlah petak sama dengan subtotal senarai; EPF/SOCSO/EIS/PCB berubah mengikut; footer menamakan siapa *Blocked*; **Continue to review** aktif bila tiada yang disekat |
| ☐ 7b | Owner | `/admin/hr/settings/payroll-items` → Prepare | Hidupkan **Own column** dan **Carry forward** pada *Director's fee* (tiada tarikh atau sebab diminta) → kembali ke Prepare: **Show all columns**, taip 2000 dalam petak *Director's fee* seorang pekerja, **Save changes** | Lajur *Director's fee* muncul antara *Basic* dan *Other income*; toast *1 change saved and the month worked out again*; petak *Other income* tidak termasuk 2,000; kaki lajur = jumlah pelayan; lajur nama kekal apabila skrol ke sisi; laci item menunjukkan baris di bawah *In their own columns*. Suis ditolak pada item terbitan (OT, tuntutan, PCB) dan pada potongan `[D]` |
| ☐ 7c | Owner | `/admin/hr/payroll?period=2026-10` | **Start this month** | Toast *1 line carried from September 2026 for 1 person*; petak *Director's fee* bertanda *Carried*; *Review* menyenaraikan baris yang dibawa dan belum diubah (INFO, tidak menyekat); ubah atau kosongkan petak → tanda hilang. Baris *earned in* bulan sebelumnya dibawa dengan bulan dianjak satu; bayaran lewat sekali sahaja tidak dibawa; buang dan mulakan semula bulan tidak menyalin lagi `[D]` |
| ☐ 7g | Owner | `/admin/hr/settings/payroll-items` → Prepare | **Applies to** pada *Director's fee* → *Selected employees only*, tanda seorang doktor, **Save** | Baris menunjukkan *1 employee*; pada grid, petak *Director's fee* hanya pada baris doktor itu, orang lain **—** dengan penjelasan; laci *Other income* orang lain tidak menawarkan *Director's fee*; cuba taip untuk orang lain melalui API/laci → ditolak dengan nama; bulan baharu membawa (*Carried*) hanya untuk doktor itu `[D]` |
| ☐ 7d | Owner | `/admin/hr/payroll?period=2026-10` → Prepare | Baca lajur **OT RM** dan **Unpaid RM** di sebelah *OT h* dan *Unpaid d*; guna pemilih bulan di atas grid untuk kembali ke September; pada baris *Blocked*, klik **Fix**; buka *Review* | Wang OT dan potongan cuti tanpa gaji sepadan dengan slip gaji orang itu; pemilih bulan membuka bulan yang dipilih; *Fix* membuka tab yang betul pada rekod pekerja dan menyerlahkan panel yang berkenaan; *Review* menamakan bulan sebelumnya yang dibandingkan, atau *First month on record* `[D]` |
| ☐ 7e | Owner | `/admin/hr/payroll?period=2026-09` dengan pemilih cawangan *All branches* | Baca panel *September 2026 by branch* | Setiap cawangan satu baris dengan status, pekerja dan gaji bersih; **Open** membuka run cawangan itu; **Start** memilih cawangan itu; tiada satu run dipaparkan sebagai bulan kumpulan `[D]` |
| ☐ 7f | Owner | Run yang *Approved* bagi majikan berdaftar s.14 | Letak tetikus di atas **—** pada *HRD levy*; baca ayat di bawah grid | Sengkang menerangkan sebabnya; ayat menamakan syarikat, tarikh kelas HRD berkuat kuasa berbanding bulan, dan langkah seterusnya (rekod dari tarikh sebenar / Reopen dan kira semula / selesai di luar Kuwick untuk bulan *Paid*) `[D]` |
| ☐ 8 | Owner | (sama, langkah *Review*) | Semak blockers dan warnings, jumlah bulan | Tiada blocker; warnings boleh ditanda *Checked* dengan sebab |
| ☐ 9 | Owner | (sama, langkah *Approve*) | Baca kenyataan, **Approve** | Chip *Approved*; run dikunci |
| ☐ 10 | Owner | (sama, langkah *Pay*) | **Prepare payment listing** → muat turun CSV → **Record paid** (tarikh, rujukan bank) | Status *Paid*; tuntutan yang dibayar dengan gaji bertukar *Paid* |
| ☐ 11 | Doktor | `/my` dan `/my/payslips` | Kad *Latest payslip* → **Download PDF** | PDF September muncul hanya selepas *Paid* `[D]`; angka sama dengan `/admin/hr/payroll/<run>/employees/<staff>` |
| ☐ 12 | Owner | `/admin/hr/reports` | Jana laporan kerajaan: EPF Borang A, SOCSO & EIS 8A, PCB CP39, HRD, EA, Borang E | Setiap laporan dibuka untuk run September; deep-link `?report=…&run=…` kekal |
| ☐ 13 | Owner | `/admin/hr/settings/attendance-leave` | *Rules for: Contoh Central* → **Use where this device is now** (atau taip lat/long) → **Save attendance rules**; panel *Claims*: tukar kadar → **Save claim rules** | Geofence disimpan untuk cawangan itu sahaja (lat dan long kedua-duanya, atau kosong kedua-duanya); portal mengira mileage dengan kadar baharu untuk tuntutan seterusnya; tuntutan lama kekal pada kadar lama |
| ☐ 13b | Owner | `/admin/hr/settings/company` | Pilih satu cawangan pada pemilih cawangan; tandakan seorang pekerja cawangan itu *Resigned*, kembali | Lajur bertukar kepada **Active at <cawangan>** dan mengira cawangan itu sahaja; orang yang berhenti tidak dikira lagi; tanpa cawangan, lajur **Active employees** mengira seluruh kumpulan `[D]` |
| ☐ 13c | Manager | `/admin/hr/settings/public-holidays` | Cuba tambah atau buang cuti umum | Butang tidak dipaparkan kepada pengurus; Owner boleh menambah (tarikh sama dua kali ditolak dengan mesej, bukan ralat) dan membuang; log audit mencatat kedua-duanya `[D]` |
| ☐ 13d | Owner | `/admin/hr/settings/payroll` | Tambah rule set *Percubaan* (Statutory, tiada kumpulan), kemudian **Delete** padanya; cuba **Delete** pada *Doctors* | *Percubaan* hilang dengan sebab pilihan; *Doctors* tiada butang Delete (ia menetapkan harga seseorang) dan pelayan menolak dengan sebab jika dipaksa `[D]` |
| ☐ 13e | Owner | `/admin/hr/settings/public-holidays` → `/admin/hr/settings/payroll` | Tanda satu cuti umum bulan ujian **Mark festive**; pada rule set lalai tetapkan **Festive holiday** 4; kira semula bulan dengan hari itu dikerjakan | Baris *Festive* pada kalendar (audit *publicHoliday.updated*); payslip ada baris *Festive holiday pay* = 2 hari gaji + jam lebih × kadar jam × 4; cuti umum biasa kekal 3×; kosongkan angka → ikut angka *Public holiday* `[D]` |
| ☐ 13f | Owner | `/admin/hr/settings/company` | Pilih satu cawangan pada pemilih cawangan | Syarikat tanpa pekerja aktif di situ dilipat di bawah *Show other employers (no staff here) · N*; tekan untuk membuka (baris pudar); *All branches* menyenaraikan semua `[D]` |

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

## 4. Jawapan pemilik, dan apa yang kini ada

| Perkara | Keadaan |
|---|---|
| Selfie + GPS semasa clock in, radius klinik, tarikh consent | **Ada** — migrasi 3g `20260912160000_attendance_proof_leave_attachments_mileage`. Foto disimpan sebagai fail pekerja (dibaca hanya dengan token sendiri atau `hr.view`), lokasi dinilai di pelayan; di luar radius ditanda, tidak ditolak `[A]` |
| Lampiran MC pada permohonan cuti | **Ada** — `leave_request_attachments`; wajib bila polisi cuti menetapkannya |
| Kadar mileage boleh ubah | **Ada** — `/admin/hr/settings/attendance-leave` › *Claims* |
| Tukar akaun bank sendiri dari portal | **Kekal melalui HR** — keputusan pemilik |
| Clock in melalui QR atau peranti | Belum — enum `source` ada nilai QR dan DEVICE, tiada yang menulisnya lagi (fasa 1: portal sahaja) |
| Jejak audit | Muat naik fail, consent dan simpanan polisi tuntutan direkod (`staffFile.uploaded`, `selfieConsent.given`, `claimPolicy.saved`); jejak audit tidak boleh dipadam `[D]` |
