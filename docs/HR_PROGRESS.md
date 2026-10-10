# HR progress log

Log berjalan untuk modul HR & payroll: apa yang setiap batch ubah, cara
mengujinya di staging, dan keputusan yang masih terbuka. Terbaharu di atas.
Setiap kenyataan: `[D]` diperhatikan dalam kod atau DB, `[A]` andaian.

---

## Batch 37 — 10 Oktober 2026 — Import item bulan dari CSV (skrin)

**Cawangan:** `claude/malaysia-payroll-final-validation-h1h6xi`. **Tiada
migrasi.**

### Apa yang berubah

- `[D]` Langkah Prepare, bulan draf sahaja: butang **Import items (CSV)** dan
  **Download template** (lajur: Employee No. · Item code · Amount (RM) ·
  Earned in (YYYY-MM, optional) · PCB type (normal / additional) · Note
  (optional); contoh baris demo sahaja).
- `[D]` Selepas memilih fail: setiap baris disemak dan ditunjuk (baris yang
  perlu dibaiki di atas, dengan sebabnya); "N rows need fixing. Nothing has
  been saved."; butang **Add N lines** hanya aktif apabila semua lulus.
  Jika bulan itu sudah ada import, notis "Replaces the N lines imported
  earlier". Senarai kod yang dibenarkan di bawah *Item codes you can use*.
- `[D]` Selepas *Add N lines*: bulan dikira semula. Baris yang diimport
  menunjukkan asal "Imported" dalam laci item setiap orang.
- `[D]` **Ujian**: web baharu `itemsImport` (5).

### Uji di staging

1. Payroll → Januari 2026 (draf) → *Download template*.
2. Isi beberapa baris (Employee No. sebenar klinik, kod daripada senarai),
   tambah satu baris dengan Employee No. yang salah → *Import items (CSV)*:
   baris itu ditanda *Fix*, tiada apa disimpan.
3. Betulkan dan pilih semula → *Add N lines* → grid dikira semula; buka
   item seseorang: asal "Imported".
4. Import fail kedua untuk bulan yang sama: notis "Replaces …"; selepas
   simpan, hanya baris fail kedua yang tinggal.

---

## Batch 36 — 10 Oktober 2026 — Import item bulan dari CSV (API)

**Cawangan:** `claude/malaysia-payroll-final-validation-h1h6xi`. **Migrasi**
`20261010170000_payroll_input_quantity`: satu lajur `quantity`
(DECIMAL(6,2), boleh kosong) pada `payroll_input_entries`, untuk hari cuti
tanpa gaji yang diimport. `[D]` Dijalankan di staging dengan *Migrate only*
run #19 (38062059498) dari cawangan ini sebelum master digerakkan: "Applying
migration `20261010170000_payroll_input_quantity`", kemudian "Database
schema is up to date!".

### Keputusan anda (10 Oktober 2026)

- `[D]` "Import this month's items (CSV)" pada langkah Prepare, untuk
  memindahkan Jan–Sep 2026 daripada payroll lama: satu muat naik sebulan,
  semak setiap baris dahulu, tiada apa disimpan sehingga semua lulus, muat
  naik semula MENGGANTIKAN import sebelumnya, setiap import dilog, bulan
  draf sahaja; OVERTIME boleh dalam RM dan ditanda "Imported";
  UNPAID_LEAVE_DAYS dalam hari.

### Apa yang berubah

- `[D]` `GET /workforce/payroll/items-import/codes`: kod yang dibenarkan.
  `POST /workforce/payroll/runs/:id/items-import`: tanpa `commit`, semak
  sahaja; dengan `commit`, simpan semua hanya jika setiap baris lulus.
- `[D]` Semakan setiap baris: Employee No. tidak dikenali, orang tidak dalam
  run bulan itu (peraturan Batch 35), kontraktor, kod tidak dikenali, BASIC
  / PCB / UNPAID_LEAVE (guna UNPAID_LEAVE_DAYS), amaun tidak sah, bulan
  *earned in* tidak sah atau selepas bulan run, item untuk orang terpilih
  sahaja, baris berganda bagi orang dan item yang sama, baris yang ditaip
  di grid bulan ini, dan baris daripada kehadiran / cuti / tuntutan / item
  berulang (akan dibayar dua kali).
- `[D]` Baris yang diimport ialah baris tangan dengan `source = IMPORT`:
  satu bagi setiap orang dan item; slip gaji, label *earned in*, tarikh
  bayar dan statutori sama seperti baris tangan; boleh disunting di grid;
  asal ditunjuk "Imported". Item bayaran tertunggak tanpa *earned in*
  dianggap diperoleh bulan sebelumnya, seperti baris tangan.
- `[D]` Muat naik semula: semua baris import terdahulu bulan itu (bagi orang
  dalam run) dibuang, dan baris yang dibawa dari bulan lepas bagi orang dan
  item yang sama digantikan. Satu baris `audit_logs`
  (`payrollInput.imported`) bagi setiap import: siapa, bila, fail, bilangan
  baris, bilangan diganti.
- `[D]` UNPAID_LEAVE_DAYS disimpan sebagai baris Unpaid leave dengan bilangan
  hari; run menilainya pada kadar harian set peraturan setiap kali bulan
  dikira ("Unpaid leave · 2 days at RM100.00").
- `[D]` **Ujian**: e2e baharu `payroll-items-import` (6).

### Percanggahan, dilaporkan

- `[D]` Jenis PCB (normal / additional) ditentukan oleh tetapan item dalam
  Payroll items, bukan oleh baris; pengiraan membaca tetapan item. Lajur
  yang bercanggah akan diabaikan secara senyap, jadi: sel kosong = tetapan
  item; sel yang bercanggah ditolak dengan arahan untuk menukar item.
- `[D]` Beberapa kod dalam senarai anda tiada dalam katalog standard Kuwick
  (MARKERTING_INCENTIVE, INCENTIVE_PROCEDURE, OTHER_CLAIM,
  REFUND_MEDICAL_CHECKUP, HUTANG_MEDICAL_CLAIM, MEDICAL_CHECKUP); katalog
  standard menggunakan MARKETING, PROCEDURE_INCENTIVE_BOD /
  PROCEDURE_INCENTIVE_RESIDENT, MEDICAL_CHECKUP_REFUND,
  MEDICAL_CLAIM_RECOVERY, MEDICAL_CHECKUP_DEDUCTION. Import menerima kod yang
  ada dalam Payroll items klinik itu sendiri; templat menyenaraikannya.

### Andaian, dilaporkan

- `[A]` Jika bulan yang diimport kemudian mendapat lebih masa daripada
  kehadiran untuk orang yang sama, kedua-duanya dibayar; untuk bulan lepas
  yang tiada rekod kehadiran, ini tidak berlaku.

---

## Batch 35 — 10 Oktober 2026 — Payroll bulan lepas: semua yang bekerja dalam bulan itu

**Cawangan:** `claude/malaysia-payroll-final-validation-h1h6xi`. **Tiada
migrasi.** Formula gaji tidak berubah: pengiraan sebahagian bulan (hari
kalendar) yang sedia ada kini sampai kepada mereka yang patut.

### Keputusan anda (10 Oktober 2026)

- `[D]` "A month's run must include everyone employed at any point in THAT
  month: start date on or before the month's last day, AND no end date or
  end date on or after the month's first day. Part-month people are
  prorated." Pekerja yang bermula selepas bulan itu tidak muncul langsung.
  Amaran bulan tanpa payroll guna peraturan yang sama. Tarikh berhenti
  ditunjuk di kepala rekod dan senarai staf.

### Punca

- `[D]` Setiap senarai payroll (run, grid Prepare, readiness, cap perubahan,
  carry-forward) memilih status HARI INI (ACTIVE/PROBATION/NOTICE), dan
  pengiraan melangkau sesiapa yang log masuknya dimatikan. Jadi Januari 2026
  hanya menyenaraikan staf aktif hari ini, dan staf yang bermula Ogos
  muncul sebagai "Blocked: Salary setup is incomplete".

### Apa yang berubah

- `[D]` Satu peraturan, `employed-in-month.ts`, dipakai oleh run, grid
  Prepare, readiness, cap perubahan dan carry-forward: tarikh mula ≤ hari
  terakhir bulan, dan tiada tarikh akhir atau tarikh akhir ≥ hari pertama.
  Pekerja yang telah berhenti (RESIGNED/TERMINATED) termasuk sehingga tarikh
  akhirnya; log masuk yang dimatikan tidak lagi menyingkirkan mereka.
- `[D]` Bulan tanpa payroll dikira dari tarikh mula hingga tarikh akhir
  setiap orang.
- `[D]` Kepala rekod pekerja dan lajur *Type* dalam senarai: "Resigned ·
  7 Jan 2026".
- `[D]` **Ujian**: e2e baharu `payroll-employed-in-month` (2: Januari
  membayar yang kekal, yang berhenti 7 Jan (7/31 = RM700 daripada RM3,100)
  dan yang berhenti 25 Ogos; tidak termasuk yang berhenti Dis 2025, yang
  bermula 17 Ogos dan yang berhenti tanpa tarikh; readiness sama). Gagal pada
  kod lama, lulus pada kod baharu. Unit `payroll-readiness` +1, web
  `leftLabel` (2).

### Andaian, dilaporkan

- `[A]` Pekerja RESIGNED/TERMINATED tanpa tarikh akhir tidak dimasukkan ke
  mana-mana bulan, kerana bila mereka berhenti tidak direkod. Isikan tarikh
  akhir dan mereka akan muncul dalam bulan yang betul.
- `[A]` SUSPENDED kekal tidak termasuk, seperti dahulu.
- `[A]` Amaran bulan tanpa payroll mengira orang dalam bulan yang sedang
  disediakan; bagi setiap orang, hanya bulan mereka bekerja dikira.

### Uji di staging

1. Payroll → Januari 2026 → *Discard draft*, kemudian mulakan semula.
2. Semak: no. 43 (berhenti 7 Jan) dan no. 20 (berhenti 10 Jan) ada, dengan
   gaji sebahagian bulan; no. 46 (berhenti 25 Ogos) ada untuk sebulan penuh;
   no. 63 (mula 17 Ogos 2026) tiada.
3. Buka rekod no. 43: kepala menunjukkan "Resigned · 7 Jan 2026"; senarai
   staf (*Resigned*) juga.

---

## Batch 34 — 10 Oktober 2026 — Payroll items: satu baris, suis dalam panel

**Cawangan:** `claude/malaysia-payroll-final-validation-h1h6xi`. **Tiada
migrasi.** Tiada perubahan pengiraan, peraturan statutori atau data.

### Keputusan anda (10 Oktober 2026)

- `[D]` B4: "Payroll items table is too dense: show item name, adds/deducts,
  a one-line summary ('EPF · SOCSO · EIS · PCB · paid 15th, a month in
  arrears') and In use. All switches move into an edit panel opened by
  clicking the row."

### Apa yang berubah

- `[D]` Jadual: *Item*, *Adds or deducts*, *What it counts towards* (satu
  baris, contoh "EPF · SOCSO · EIS · PCB · paid 15th, a month in arrears";
  potongan: "Reduces …" atau "Taken from net pay") dan *In use* (cip).
- `[D]` Klik baris membuka panel item: 8 suis rawatan (masih minta bulan
  berkuat kuasa dan sebab, di bawah suis itu sendiri), *Paid on*, *Own
  column* / *Carry forward*, *Applies to*, *In use*, *History*, dan *Change
  the month* untuk versi yang belum bermula. Cara simpan sama seperti dahulu.
- `[D]` Nota panjang di bawah jadual kini di belakang *Details*.
- `[D]` **Ujian**: web `payrollItems` dikemas kini (buka panel dahulu) +2
  baharu (31 lulus). Skrip UAT `own-columns.uat.ts` membuka panel dahulu.

### Uji di staging

1. *Settings → Payroll items*: setiap baris satu ayat; tiada suis dalam
   jadual.
2. Klik *Overtime*: panel dibuka; matikan EPF: kotak "From which month / Why"
   muncul di bawahnya; *Cancel* tidak menyimpan apa-apa.

---

## Batch 33 — 10 Oktober 2026 — Settings: langkah setup, kemudian empat kad

**Cawangan:** `claude/malaysia-payroll-final-validation-h1h6xi`. **Tiada
migrasi.** Tiada perubahan pengiraan, peraturan statutori atau data.

### Keputusan anda (10 Oktober 2026)

- `[D]` B1–B3: Settings semasa setup belum lengkap = hanya langkah setup
  (SetupWizard.html); selepas lengkap = "Setup complete ✓ — Review setup" +
  empat kad + *Advanced* berlipat (SettingsHome.html); Employees keluar dari
  Settings; setiap tetapan di satu tempat sahaja.

### Apa yang berubah

- `[D]` Setup belum lengkap: kiri lima langkah dengan status (Company &
  statutory numbers, Pay rules, Payroll items, Employees, Check statutory
  rates; "Optional later: bank payment file"); kanan satu langkah terbuka.
  Langkah syarikat ada borang (nama, no. pendaftaran, EPF, SOCSO, LHDN, zakat,
  asas levi HRD) dengan *Save for later* dan *Save & next* / *Save & finish
  setup*. Langkah lain menunjukkan fakta dan butang ke halaman masing-masing;
  langkah kadar statutori ada *I've checked them*.
- `[D]` Setup lengkap: satu baris "Setup complete", kad *Company &
  statutory*, *Pay rules*, *Payroll items*, *Attendance & leave* (tiga fakta
  setiap satu), *Advanced* (Statutory rates, Opening balances, Bank payment
  file) berlipat. *Review setup* membuka semula langkah.
- `[D]` *Payroll policies* kini bernama **Pay rules** (halaman yang sama);
  *Attendance & leave policies* kini **Attendance & leave** dan memaut ke
  *Public holidays*. Langkah *Employees* membuka halaman Employees.
- `[D]` Pembetulan ditemui semasa membina langkah syarikat: menyimpan di
  halaman *Company & statutory* dahulu mengosongkan no. HRD, alamat baris 2
  dan poskod (borang tidak menghantarnya, API mengosongkan medan yang tiada).
  Kini dihantar semula seperti sedia ada.
- `[D]` **Ujian**: web baharu `hrSettingsPage` (6), `hrRoutes` dikemas kini
  (empat kad), e2e `hr-navigation` "Settings is the setup steps until setup is
  done".

### Andaian, dilaporkan

- `[A]` Kelas HRD Corp tidak dipilih dalam wizard (mockup menunjukkan tiga
  butang): ia direkod dengan tarikh berkuat kuasa dan sebab di halaman
  *Company & statutory*, jadi wizard menunjukkan kelas semasa dan pautan.
- `[A]` *Pay rules* sentiasa "selesai" kerana peraturan lalai Kuwick terpakai
  sehingga klinik menetapkan sendiri (sama seperti senarai semak lama).

### Uji di staging

1. Klinik yang belum menyemak kadar statutori: *HR → Settings* hanya
   menunjukkan "Set up payroll" dan lima langkah.
2. Isi nombor SOCSO/LHDN demo, *Save & next*: langkah bertukar hijau.
3. Langkah *Check statutory rates* → *I've checked them*: Settings bertukar
   ke "Setup complete" dengan empat kad; *Show* membuka *Advanced*.

---

## Batch 32 — 10 Oktober 2026 — Rupa premium untuk semua skrin HR

**Cawangan:** `claude/malaysia-payroll-final-validation-h1h6xi`. **Tiada
migrasi.** Gaya sahaja: tiada perubahan pengiraan, peraturan statutori atau
data.

### Keputusan anda (10 Oktober 2026)

- `[D]` B5: lebar maksimum 1440px di tengah; teks 15px; tajuk 32–34px; amaun
  utama 28–30px tabular; latar #ECEEF5; kad putih radius 22px dengan bayang
  lembut; jubin ikon 38px radius 12px; indigo #4B4FC4; butang 44px radius
  12px; cip pil dengan titik; penerangan panjang di belakang *Details*.

### Apa yang berubah

- `[D]` Token HR sahaja (`.kw-hrSlate`), jadi klinikal dan portal tidak
  berubah: latar, indigo, warna cip, bayang, radius kad 22px dan kawalan
  12px; tajuk 34px/800; amaun kad statistik 30px tabular; butang 44px (kecil
  36px); cip 13px dengan titik 7px; jubin ikon 38px; antd dalam HR guna indigo
  yang sama, 15px dan radius 12.
- `[D]` Tangkapan skrin desktop dan telefon (390px) untuk Payroll,
  Employees, Settings, Payroll items: tiada skrol mendatar.

### Uji di staging

1. Buka *HR → Payroll* pada desktop lebar: kandungan berhenti pada 1440px di
   tengah, latar lavender, kad bulat.

---

## Batch 31 — 10 Oktober 2026 — Amaran bulan awal tahun tanpa payroll

**Cawangan:** `claude/malaysia-payroll-final-validation-h1h6xi`. Komit: komit
yang menambah bahagian ini. **Tiada migrasi.**

### Keputusan anda (10 Oktober 2026)

- `[D]` A2: "Warn before working out a month when earlier months of the year
  have no payroll run for staff who were employed then (e.g. 'Jun–Sep have no
  payroll run — PCB may be understated'). Do not block."

### Apa yang berubah

- `[D]` Langkah Prepare, sebelum bulan dikira: notis "Jun–Sep have no payroll
  run — PCB may be understated" dengan bilangan orang, dan senarai nama serta
  bulan setiap orang di bawah *Details*. Butang kira tidak disekat.
- `[D]` Bulan dikira hanya ketika orang itu bekerja di sini (dari tarikh
  mula), dan "ada rekod" bermaksud bulan yang diluluskan atau baki pembukaan
  yang diimport. Tarikh mula tiada: tidak ditanya (seperti dahulu).
- `[D]` Rekod pekerja (*Pay history for the year*) kini menamakan bulan yang
  sama, bukan hanya "tiada langsung".
- `[D]` **Ujian**: unit `payroll-readiness` +4; web baharu
  `payrollStartGate` (2).

### Andaian, dilaporkan

- `[A]` Bulan yang ada run tetapi belum diluluskan dikira "tiada payroll",
  kerana PCB hanya membaca bulan yang diluluskan.

### Uji di staging

1. Pekerja demo bermula Januari, hanya Jan–Mei diluluskan. Buka run Oktober:
   notis "Jun–Sep have no payroll run — PCB may be understated"; butang kira
   masih boleh ditekan.

---

## Batch 30 — 10 Oktober 2026 — "Paid on": hari bulan ini atau bulan berikutnya

**Cawangan:** `claude/malaysia-payroll-final-validation-h1h6xi`. Komit: komit
yang menambah bahagian ini. **Migrasi**
`20261010150000_pay_component_pay_date_month`: satu lajur
`pay_date_month_offset` (SMALLINT, lalai 0) pada `pay_components`. `[D]`
Dijalankan di staging dengan *Migrate only* run #18 (38046073291) dari
cawangan ini SEBELUM master digerakkan: "Applying migration
`20261010150000_pay_component_pay_date_month`", kemudian "Database schema is
up to date!".

### Keputusan anda (10 Oktober 2026)

- `[D]` A1: "'Paid on' in Payroll items: add 'of this month / of the
  following month' (e.g. salary paid on the 1st of the following month, or
  the 25th of this month). The per-run override on the Pay step stays."

### Apa yang berubah

- `[D]` *Settings → Payroll items*, lajur *Paid on*: pilihan **Of this month /
  Of the following month** di sebelah hari. Label: "1st of the following
  month". Gaji pokok boleh dibayar pada bulan berikutnya (berbeza daripada "a
  month in arrears", yang tetap tidak dibenarkan untuk gaji pokok).
- `[D]` Tarikh bayar, tarikh gaji (yang melepaskan payslip), senarai bank,
  payslip dan portal pekerja mengikut bulan itu. Statutori kekal pada bulan
  run. Pilihan tarikh setiap run pada langkah Pay kekal.
- `[D]` **Ujian**: e2e baharu `payroll-pay-date-following-month` (3: gaji
  Ogos dibayar 1 September dengan potongan diambil daripadanya; payslip
  dilepaskan dengan pemindahan gaji); unit `pay-dates` +3; web
  `payrollItems` +1.

### Uji di staging

1. *Settings → Payroll items* → *Basic pay* → *Paid on*: pilih *Of the
   following month* dan *1st*. Lajur berkata "1st of the following month".
2. Run bulan ini → langkah Pay: tarikh gaji ialah 1hb bulan depan.

---

## Batch 29 — 10 Oktober 2026 — OT tertunggak dinilai seperti bulan ia dikerjakan; tarikh bayar yang sudah lepas

**Cawangan:** `claude/malaysia-payroll-final-validation-h1h6xi`, dibina atas
`a0e1766`. Komit: komit yang menambah bahagian ini (hash dalam laporan).
**Tiada migrasi.**

### Keputusan anda (10 Oktober 2026)

- `[D]` A3: "Overtime paid in arrears: use the rest day and rule set of the
  month the overtime was worked, not the paying month."
- `[D]` A4: "Pay date in the past: reword to 'Already paid on 1 Oct? Record
  the transfer with that date.' It must not block."

### Apa yang berubah

- `[D]` **Hari rehat bulan kerja** (`payroll.service.ts`,
  `statutory-classification.ts` `classificationOn`): setiap hari OT bulan
  lepas dinilai sebagai hari rehat atau tidak mengikut rekod statutori pekerja
  yang berkuat kuasa **pada hari itu**.
- `[D]` **Rule set bulan kerja** (`ruleSetOfWorkedMonth`): rule set tiada
  tarikh, jadi yang terpakai pada bulan itu diambil daripada slip bulan itu
  yang sudah diluluskan (terkunci): hari dan jam kadar biasa (ORP), nama rule
  set, mod (Akta atau kadar klinik) dan kadar klinik. Pendarab diambil daripada
  rule set yang sama namanya.
- `[D]` Jika bulan kerja belum diluluskan dalam Kuwick, rule set yang berkuat
  kuasa sekarang digunakan, dengan hari rehat bulan kerja.
- `[D]` **Tarikh bayar yang sudah lepas** pada langkah Pay kini berkata
  "Already paid on 1 Oct? Record the transfer with that date." Ia petunjuk
  sahaja; tarikh masih boleh diubah dan tiada apa disekat.
- `[D]` **Ujian**: e2e baharu `payroll-arrears-worked-month` (2: Sabtu
  September dibayar sebagai OT hari biasa dan Ahad sebagai hari rehat,
  kedua-duanya pada formula Akta seperti September, walaupun Oktober bertukar
  kepada hari rehat Sabtu dan kadar klinik; bulan yang belum diluluskan
  dinilai dengan rule set semasa); unit `classificationOn` +1; web
  `paymentPanel` dikemas kini.

### Andaian, dilaporkan

- `[A]` Pendarab OT tidak dibekukan dalam slip, jadi pendarab bulan kerja
  diambil daripada rule set yang sama namanya seperti sekarang.

### Uji di staging

1. Pekerja demo dengan OT tertunggak: tukar hari rehat dalam rekod statutori
   mulai bulan ini. Run bulan ini menilai OT bulan lepas mengikut hari rehat
   lama.
2. Langkah Pay pada run yang ada tarikh sudah lepas: baris berkata "Already
   paid on …? Record the transfer with that date." dan tarikh masih boleh
   diubah.

---

## Bahagian 6 — 10 Oktober 2026 — Data ujian KLINIK HIJRAA BANGI dipadam di staging

**Arahan anda:** "wipe now" (10 Oktober 2026). Skrip sekali guna
`apps/api/scripts/wipe-hijraa-bangi-test-data.mjs`, dijalankan melalui
workflow manual "Wipe Hijraa Bangi test data (one-off, manual)". Komit:
`cf2bb5b`, `1d207f9`, `a0e1766`.

### Apa yang berlaku

- `[D]` Larian kering pertama (run 38042374305) **berhenti**: cawangan itu
  ada **4** rekod pekerja, bukan 3. Yang keempat: doktor residen, status
  RESIGNED, no pekerja 1036, ada log masuk, nama bukan salah satu daripada
  tiga yang dinamakan. Tiada apa diubah.
- `[D]` Skrip diubah supaya hanya tiga yang dinamakan (DR RESIDEN + BOD,
  CLINICAL STAFF, STAFF ADMIN) dipadam; orang lain disimpan dan dilaporkan.
- `[D]` Larian kering kedua (run 38042629064) **berhenti**: satu run
  September 2026 untuk **seluruh tenant** (CALCULATED, 15 slip, semuanya
  orang cawangan lain, tiada seorang pun daripada tiga itu) dikira sebagai
  run cawangan. Skrip diubah: run seluruh tenant yang tidak membayar
  seorang pun daripada tiga itu disimpan.
- `[D]` Larian kering ketiga (run 38042960371): selamat, 160 baris. Dengan
  no 1036 sekali (run 38042962105): selamat, 165 baris. Tiada apa diubah.
- `[D]` **Dipadam** (run 38043215966, satu transaksi): 3 pekerja, 3 log
  masuk mereka, 6 run 2026 cawangan (Jan–Mei dan Okt, semuanya APPROVED),
  6 rekod lulus, 18 slip, 23 amaran, 3 senarai bayaran dengan 7 baris,
  1 rekod filing, 6 kelulusan, 43 input, 18 baris YTD, 3 gaji, 5
  klasifikasi statutori, 3 asas caruman, 3 pengakuan amaran, 2 item
  berulang, 1 tuntutan (dengan 1 lampiran, 1 peristiwa), 1 fail pekerja.
  Jumlah 160 baris.
- `[D]` **Selepas**: baris rancangan yang tinggal 0; tiga pekerja itu 0;
  run 2026 cawangan 0; kunci kelulusan hidup 2 daripada 2; satu baris
  `audit_logs` (`admin.branchTestDataWiped`). Pekerja dalam cawangan: **1**,
  iaitu no 1036 (disimpan, tidak dinamakan).
- `[D]` Kunci kelulusan tidak dilemahkan: run yang diluluskan dibatalkan
  dahulu (peralihan yang dibenarkan kunci itu sendiri); kunci rekod lulus
  dimatikan hanya di dalam transaksi skrip dan dihidupkan semula sebelum
  komit. Tiada kod, migrasi atau trigger diubah.
- `[D]` Disimpan: cawangan, majikan dan nombor pendaftaran, polisi, item
  payroll, kalendar, jadual statutori, semua data klinikal/pesakit/stok/
  kewangan, 3 cawangan lain, tenant lain, dan run September 2026 seluruh
  tenant. `audit_logs` lama tidak disentuh.

### Larian kedua: no pekerja 1036

- `[D]` Arahan anda (10 Oktober 2026): "Yes, remove employee no. 1036 too,
  same way (staging, logged, nothing else touched)."
- `[D]` Skrip yang sama, satu perubahan: nama yang tiada lagi diterima
  hanya apabila baris `audit_logs` skrip ini sendiri untuk cawangan itu
  menunjukkan larian awal telah memadamnya; jika tiada sesiapa untuk dipadam
  ia berhenti. Diuji dahulu secara tempatan (4 ujian lulus, termasuk larian
  kedua).
- `[D]` Dry run (run 38050312034): selamat, 5 baris, tiada apa di luar
  skop. Apply (run 38050433789): 1 gaji, 1 klasifikasi statutori, 1 profil
  pekerja, 1 staf, 1 log masuk pengguna. **Jumlah 5 baris.** Tiada run
  payroll disentuh (run September 2026 seluruh tenant disimpan).
- `[D]` **Selepas**: pekerja dalam cawangan **0**; run 2026 cawangan 0;
  kunci 2 daripada 2 hidup; baris `audit_logs` kedua merekod tambahan
  pemilik. Jumlah kedua-dua larian: 165 baris.

---

## Batch 28 — 10 Oktober 2026 — Pemilik memilih tarikh bayar bagi setiap run, pada langkah Pay

**Cawangan:** `claude/malaysia-payroll-final-validation-h1h6xi`, dibina atas
Batch 27 (`14afc50`). Komit: komit yang menambah bahagian ini (hash dalam
laporan). **Migrasi** `20261010140000_payroll_run_pay_dates`: satu lajur
`pay_dates` (JSONB, boleh kosong) pada `payroll_runs`. Dijalankan di staging
dengan *Migrate only* run #17 dari cawangan pada `3d41f10` SEBELUM master
digerakkan: satu migrasi tertunggak, digunakan, 154 migrasi terkini.

### Keputusan anda (10 Oktober 2026)

- `[D]` "Pay date: the owner chooses it per run. The component's 'Paid on'
  (e.g. 15th, 1st) is only the default date within that run's month, and can
  be changed on the Pay step for each run before the listing is prepared."

### Apa yang berubah

- `[D]` **"Pay dates for this run"** pada langkah Pay (*Paying this month*):
  satu baris bagi setiap tarikh dalam rekod lulus, dengan item yang dibayar
  pada tarikh itu, jumlahnya, tarikh dalam *Payroll items*, dan pemilih
  tarikh *Pay on*. Tarikh yang diubah berkata "Changed for this run" dengan
  pautan "Back to <tarikh asal>". Tarikh yang sudah lepas diberi amaran.
- `[D]` **Untuk run ini sahaja** (`payroll-payment.service.ts`
  `choosePayDate`, `PATCH /workforce/payroll/runs/:id/payment/dates`):
  *Payroll items* kekal dengan hari mereka. Tiada amaun berubah: statutori,
  payslip dan rekod lulus kekal seperti diluluskan; hanya tarikh pemindahan
  berubah. Disimpan pada run (`pay_dates`), diaudit
  (`payrollPayment.payDateChosen`).
- `[D]` **Dua tarikh pada satu hari ialah satu pemindahan**, dan dipisahkan
  semula dengan memilih tarikh asal.
- `[D]` **Dikunci apabila senarai disediakan**: selepas *Prepare the payment
  listings*, tarikh itu kekal. Run yang PAID tidak boleh diubah. Hanya run
  APPROVED, oleh orang yang boleh menyediakan senarai (`hr.payroll.export.bank`).
- `[D]` **Yang mengikut tarikh pilihan**: senarai bank bagi setiap tarikh,
  tarikh gaji (yang melepaskan payslip kepada pekerja), tarikh tuntutan
  dibayar, payslip (*Paid on* setiap item dan bahagian pembayaran), dan
  portal pekerja.
- `[D]` **Ujian**: e2e baharu `payroll-run-pay-dates` (6); unit
  `pay-dates` +3 dan `payroll-payment-schedule` +2; web `paymentPanel` +2.

### Andaian, dilaporkan

- `[A]` Tarikh pilihan mesti dalam bulan run atau bulan berikutnya (contoh run
  Ogos: 1 Ogos hingga 30 September). Ini menangkap tahun yang tersalah taip.
- `[A]` Pilihan tarikh kekal pada run jika run dibuka semula dan diluluskan
  semula; tarikh yang tiada lagi dalam rekod baharu diabaikan.
- `[A]` Semua tarikh dikunci serentak kerana *Prepare* menyediakan senarai
  bagi setiap tarikh sekali gus.

### Uji di staging (ikut urutan)

1. Run demo yang APPROVED tetapi senarai belum disediakan → *Paying this
   month*: bahagian "Pay dates for this run" dengan tarikh 1hb, 15hb, 30hb.
2. Tukar tarikh 1hb kepada 28hb → baris berkata "Changed for this run";
   notis atas menunjukkan 28hb. Buka payslip pekerja demo: *Paid on* yuran
   pengarah ialah 28hb.
3. Klik "Back to 1 …" → kembali ke tarikh asal.
4. *Prepare the payment listings* → tarikh kini "listing prepared" dan tiada
   pemilih.
5. *Settings → Payroll items*: hari bayar item tidak berubah.

---

## Batch 27 — 10 Oktober 2026 — Item tertunggak sebulan masuk run bulan berikutnya; tarikh bayar dalam bulan run

**Cawangan:** `claude/malaysia-payroll-final-validation-h1h6xi`, dibina atas
Batch 26 (`7d3d9ba`). Komit: komit yang menambah bahagian ini (hash dalam
laporan). **Tiada migrasi**: lajur `pay_month_offset` yang sedia ada kini
bermaksud "sebulan tertunggak" (1) dan bukan lagi "dibayar bulan depan".

### Keputusan anda (10 Oktober 2026)

- `[D]` "September's overtime, locum and director's fee go INTO THE OCTOBER
  RUN — counted in October's statutory, labelled 'earned September' (same as
  the existing earned-in labels). Do not shift them a second month."
- `[D]` "The component's 'Paid on' (e.g. 15th, 1st) is only the default date
  within that run's month, and can be changed on the Pay step for each run
  before the listing is prepared." Bahagian kedua (tukar pada langkah Pay)
  ialah Batch 28.

### Apa yang berubah

- `[D]` **Setiap tarikh bayar kini dalam bulan run itu sendiri**
  (`pay-dates.ts`): run Oktober membayar yuran pengarah pada 1 Okt, OT dan
  tuntutan pada 15 Okt, gaji pada 30 Okt. Tiada lagi "bulan depan".
- `[D]` **"A month in arrears"** di *Settings → Payroll items*, lajur *Paid
  on*: suis di sebelah hari. Label lajur: "15th · a month in arrears". Gaji
  pokok tidak boleh tertunggak (ditolak). Ditulis pada setiap versi item,
  seperti hari bayar.
- `[D]` **Overtime tertunggak** (`payroll.service.ts`
  `unpaidDaysOfLastMonth`, `overtime-pricing.ts` `combinePricing`): run
  Oktober membayar OT, gaji hari rehat dan cuti umum bulan September, dikira
  dalam statutori Oktober, berlabel "Overtime (September 2026)" seperti label
  earned-in sedia ada, dan **dinilai dengan gaji September** (bukan gaji
  Oktober jika ada kenaikan). OT Oktober menunggu run November.
- `[D]` **Tidak dibayar dua kali, tidak hilang**: hari yang sudah dibawa oleh
  run bulan lain tidak dibayar semula, jadi menghidupkan tertunggak selamat.
  Tanpa tertunggak, run masih mengambil hari bulan lepas yang belum dibayar
  oleh mana-mana run — contohnya OT yang diluluskan selepas bulan lepas
  diluluskan, atau bulan tertunggak dimatikan — tetapi hanya jika bulan lepas
  dijalankan dalam Kuwick untuk pekerja itu.
- `[D]` **Item yang dikunci dengan tangan** (Locum fee, Director's fee) yang
  tertunggak: baris tanpa bulan dianggap bulan lepas ("earned September"). Di
  laci input, *Earned in* diisi bulan lepas apabila item tertunggak dipilih;
  boleh diubah atau dikosongkan.
- `[D]` Rekod lulus format 5 merekod hari bayar dan "tertunggak" secara
  berasingan. Rekod format 4 kekal seperti diluluskan.
- `[D]` **Ujian**: e2e baharu `payroll-arrears` (5: OT bulan sendiri tanpa
  tertunggak; hidupkan tertunggak tanpa bayar dua kali; OT Oktober dalam run
  November pada kadar gaji Oktober RM3,000 walaupun gaji November RM3,600;
  matikan tertunggak tanpa kehilangan OT November; item tangan tertunggak
  dianggap bulan lepas); `payroll-pay-dates` dan `pay-component-pay-date`
  dikemas kini; unit `pay-dates` ditulis semula; web `payrollItems` +1 dan
  `payrollInputsDrawer` +1.

### Andaian, dilaporkan

- `[A]` OT tertunggak menggunakan hari rehat dan rule set pekerja pada bulan
  run (bukan bulan kerja) — hanya gaji yang diambil daripada bulan kerja.
- `[A]` Tanpa tertunggak, run mengambil OT bulan lepas yang belum dibayar.
  Ini perubahan kecil: sebelum ini OT yang diluluskan lewat tidak pernah
  dibayar secara automatik.
- `[A]` Tarikh bayar 1hb untuk run yang diluluskan pada hujung bulan sudah
  lepas; pemilik akan mengubahnya pada langkah Pay (Batch 28).

### Uji di staging (ikut urutan)

1. *Settings → Payroll items*: Overtime, Locum fee → **15th** dengan **A
   month in arrears**; Director's fee → **1st** dengan **A month in
   arrears**; Housecall, Claim reimbursement, Panel claim → **15th**.
2. Pekerja demo dengan OT diluluskan pada bulan lepas: run bulan ini
   menunjukkan baris "Overtime (<bulan lepas>)".
3. Laci input pada run bulan ini: pilih *Director's fee*; *Earned in* terisi
   bulan lepas.
4. *Paying this month*: tarikh 1hb, 15hb dan 30hb semuanya dalam bulan run.

---

## Batch 26 — 10 Oktober 2026 — Asas levi HRD kembali kepada takrif Akta PSMB secara lalai

**Cawangan:** `claude/malaysia-payroll-final-validation-h1h6xi`, dibina atas
Batch 25 (`7e649b8`). Komit: `7d3d9ba`; migrasi dijalankan di staging
dengan *Migrate only* run #16 sebelum master dimajukan, status selepas
"Database schema is up to date!". **Migrasi:
`20261010130000_hrd_levy_base_default_psmb`** — lajur
`hrd_levy_base` pada `legal_employers` digugurkan dan ditambah semula dengan
lalai `BASIC_PLUS_FIXED_ALLOWANCES`, dalam satu transaksi. Dijalankan di
staging dengan *Migrate only* dari cawangan ini **sebelum** master dimajukan.

### Keputusan anda (10 Oktober 2026)

- `[D]` "HRD levy base: revert the default to follow the PSMB Act (basic +
  allowances marked HRD). Keep 'Basic salary only' as an option."

### Apa yang berubah

- `[D]` Lalai asas levi HRD kini **Basic + allowances marked HRD (PSMB
  Act)**: gaji pokok tolak cuti tanpa gaji, campur setiap elaun yang suis
  HRD-nya hidup di *Payroll items*. *Basic salary only* kekal sebagai pilihan.
- `[D]` **Setiap majikan sedia ada** berpindah ke lalai baharu. Tiada majikan
  yang memilih *Basic salary only*; itu hanya lalai lajur selama kira-kira
  sejam di staging.
- `[D]` Kenapa gugur dan tambah semula, bukan `UPDATE`: setiap jadual ialah
  FORCE ROW LEVEL SECURITY, dan `UPDATE` oleh peranan migrasi tanpa konteks
  tenant boleh tidak mengena sebarang baris secara senyap. DDL tidak ditapis
  oleh row security, dan transaksi bermakna tiada permintaan melihat jadual
  tanpa lajur itu. Diuji pada pangkalan data tempatan: 2 majikan
  `BASIC_ONLY` menjadi `BASIC_PLUS_FIXED_ALLOWANCES`.
- `[D]` Penerangan lajur **HRD** di *Payroll items* dan baris majikan
  ("levy on basic + allowances marked HRD") dikemas kini.
- `[D]` **Ujian**: e2e `payroll-hrd-base-and-zakat` kini bermula pada RM85.00
  (RM8,000 + elaun RM500) dan RM80.00 selepas memilih *Basic salary only*;
  web `legalEmployersPage` bermula pada takrif Akta.

### Uji di staging

1. *Settings → Company & statutory → Edit*: **HRD levy base** = *Basic +
   allowances marked HRD (PSMB Act)*.
2. Bulan payroll bagi majikan berdaftar dengan pekerja demo yang ada elaun
   bertanda HRD: levi = 1% daripada gaji pokok campur elaun itu.

---

## Batch 25 — 10 Oktober 2026 — Zakat melalui payroll, dan asas levi HRD (Bahagian 4)

**Cawangan:** `claude/malaysia-payroll-final-validation-h1h6xi`, dibina atas
Batch 24 (`b555678`). Komit: `7e649b8`; migrasi dijalankan di staging
dengan *Migrate only* run #15 sebelum master dimajukan, status selepas
"Database schema is up to date!". **Migrasi:
`20261010120000_legal_employer_hrd_base_and_zakat`** —
satu jenis enum baharu `HrdLevyBase` dan dua lajur pada `legal_employers`
(`hrd_levy_base` lalai `BASIC_ONLY`, `zakat_through_payroll` lalai `false`);
tiada pernyataan data, tiada jadual baharu. Dijalankan di staging dengan
*Migrate only* dari cawangan ini **sebelum** master dimajukan.

### Perubahan angka, dilaporkan

- `[D]` **Levi HRD sebelum ini** dikira atas gaji pokok tolak cuti tanpa gaji
  **campur** setiap elaun yang suis HRD-nya hidup di *Payroll items* (item
  *Allowance* standard hidup secara lalai). Itu takrif "wages" Akta PSMB.
  Arahan anda menjadikan **Basic salary only** sebagai lalai, jadi bagi majikan
  sedia ada yang membayar elaun bertanda HRD, levi dari pengiraan seterusnya
  akan **lebih rendah**. Bulan yang sudah diluluskan tidak berubah.
  `[A]` Semak dengan HRD Corp; jika pendaftaran anda mengira elaun tetap
  sebagai gaji, pilih *Basic + fixed allowances*.
- `[D]` **Zakat**: Kuwick sudah lama memotong item *Zakat* dan menolaknya
  daripada PCB. Kini ia hanya berlaku apabila tetapan dihidupkan (lalai
  mati). Pekerja yang ada item Zakat ketika tetapan mati: bulan itu
  **disekat** (`ZAKAT_THROUGH_PAYROLL_OFF`), bukan dipotong atau diabaikan
  secara senyap. `[A]` Jika mana-mana klinik di production sudah memotong
  zakat melalui item Zakat, hidupkan tetapan itu sebelum run seterusnya.

### Apa yang berubah

- `[D]` *Settings → Company & statutory → Edit*: **HRD levy base** (*Basic
  salary only*, lalai, atau *Basic + fixed allowances*) dan suis **Deduct
  zakat through payroll** (lalai mati), dengan penerangan di bawah setiap
  satu. Baris majikan berdaftar menunjukkan "levy on basic salary only".
- `[D]` **Levi atas gaji pokok sahaja** (`basicOnlyHrdCents`): gaji pokok
  tolak cuti tanpa gaji; tiada elaun, apa pun suis itemnya. Lajur **HRD** di
  *Payroll items* kini ada penerangan bahawa suis itu hanya dikira jika asas
  levi majikan ialah *Basic + fixed allowances*.
- `[D]` **Zakat hidup**: jumlah bulanan setiap pekerja ialah item berulang
  *Zakat* pada rekod mereka (*Employment & salary → Recurring items*), dipotong
  daripada gaji bersih dan ditolak daripada PCB bulan itu, ringgit untuk
  ringgit selagi ada PCB. **Zakat mati**: item Zakat tidak boleh ditambah
  (mesej menyuruh hidupkan tetapan dahulu). Zakat yang dibayar sendiri
  melalui TP1 tidak berubah.
- `[D]` **Ujian**: API unit +1 (`basicOnlyHrdCents`), e2e +5
  (`payroll-hrd-base-and-zakat`: RM80.00 atas RM8,000, RM85.00 dengan elaun
  RM500, item Zakat ditolak ketika mati, PCB turun RM100 dan gaji bersih kekal
  ketika hidup, bulan disekat bila dimatikan semula), web +1
  (`legalEmployersPage`). Ujian *synthetic month* kini menghidupkan zakat
  bagi majikannya kerana pelakonnya membayar zakat melalui payroll.

### Uji di staging (ikut urutan)

1. *Settings → Company & statutory → Edit* majikan: **HRD levy base** =
   *Basic salary only*, **Deduct zakat through payroll** mati.
2. Bulan payroll bagi majikan berdaftar s.14 dengan pekerja demo yang ada
   item *Allowance*: levi = 1% gaji pokok. Tukar kepada *Basic + fixed
   allowances*, kira semula: levi termasuk elaun.
3. Cuba tambah item berulang *Zakat* pada pekerja demo: ditolak dengan mesej.
4. Hidupkan zakat, tambah *Zakat* RM100 sebulan, kira semula: baris Zakat
   pada payslip, PCB turun RM100, gaji bersih sama.
5. Matikan zakat, kira semula: sekatan **Zakat on record, not deducted**.

---

## Batch 24 — 10 Oktober 2026 — Bulan separa: hari kalendar atau hari bekerja (Bahagian 3)

**Cawangan:** `claude/malaysia-payroll-final-validation-h1h6xi`, dibina atas
Batch 23 (`0a2a92f`). Komit: `b555678`. **Migrasi:
`20261010110000_payroll_policy_part_month_basis`** — satu lajur
`part_month_basis` pada `payroll_policies` (lalai `CALENDAR_DAYS`) dan satu
semakan (hanya `CALENDAR_DAYS` atau `WORKING_DAYS`); tiada pernyataan data,
tiada jadual baharu. Dijalankan di staging dengan *Migrate only* run #14 dari
cawangan ini **sebelum** master dimajukan; status selepas: "Database schema
is up to date!".

### Percanggahan dengan kod, dilaporkan

- `[D]` Kod sebelum ini **sengaja membuang** pilihan pembahagi bulan separa,
  dengan sebab bertulis dalam `schema.prisma` (PayrollPolicy) dan
  `upsert-payroll-policy.dto.ts`: s.18A Akta Kerja menetapkan bulan yang tidak
  lengkap dikira dengan **hari kalendar** (gaji × hari bekerja ÷ hari dalam
  bulan), jadi pilihan lain "is a choice the law does not give". Permintaan
  anda menambahnya semula. Saya ikut permintaan anda, dengan tiga pengaman:
  lalai kekal hari kalendar (s.18A); pilihan *Working days* dicatat dalam
  audit; dan setiap bulan yang hari bekerja membayar **kurang** daripada angka
  s.18A, review menamakan pekerja itu dan beza wangnya.
- `[A]` Cadangan saya: kekalkan *Calendar days* melainkan kontrak pekerja
  memang menyebut hari bekerja.

### Apa yang berubah

- `[D]` **Settings → Payroll policies → rule set → Part-month proration**:
  *Calendar days (Employment Act s.18A)* (lalai) atau *Working days*.
  Penerangan di bawahnya menunjukkan contoh anda: RM1,800 × 11/31 =
  RM638.71. *Unpaid leave keeps its own divisor: the days in the month.*
  Senarai rule set menunjukkan "part months by working days" bila dipilih.
- `[D]` **Hari bekerja** (`proration.ts` `workingWeek`, `partMonthPay`):
  gaji × hari bekerja semasa bekerja ÷ hari bekerja dalam bulan, dikira
  daripada minggu kerja pekerja itu sendiri (5, 5.5 atau 6 hari pada rekod
  pekerja) dan hari rehatnya. Tiada angka tetap.
  `[A]` Pada minggu 5 hari, hari sebelum hari rehat juga cuti; pada minggu
  5.5 hari, hari itu dikira separuh. Cuti umum dikira sebagai hari bekerja
  biasa.
- `[D]` Pekerja tanpa minggu kerja tetap pada rekod (tiada 5/5.5/6, atau hari
  rehat berubah-ubah) dibayar dengan hari kalendar, dan baris *Part of the
  month only* menyebut sebabnya.
- `[D]` Amaran baharu **Part month below the Act’s calendar days**
  (`PART_MONTH_BELOW_STATUTORY`, WARNING, tidak menyekat): contohnya pekerja
  yang berhenti pada hari Ahad 4 Oktober dibayar RM200.00 dengan hari
  bekerja, sedangkan s.18A memberi RM232.26 — kurang RM32.26.
- `[D]` **Cuti tanpa gaji tidak berubah**: masih gaji ÷ hari dalam bulan.
- `[D]` Ayat lama di halaman yang berkata bulan separa "not the clinic’s to
  choose" telah dibetulkan.
- `[D]` **Ujian**: API unit +6 (`proration`), e2e +3
  (`payroll-part-month-basis`: 638.71 kalendar, 666.67 hari bekerja, 200.00
  dengan amaran, pekerja tanpa minggu kerja, FIXED_DAYS ditolak), web +1
  (`payrollPartMonth`).

### Uji di staging (ikut urutan)

1. *Settings → Payroll policies* → *Edit* rule set lalai: medan
   **Part-month proration** = *Calendar days (Employment Act s.18A)*.
2. Pekerja demo yang mula kerja pada 21 haribulan dengan gaji RM1,800: bulan
   itu membayar RM638.71 (11/31).
3. Tukar kepada **Working days**, simpan, kira semula bulan itu: pekerja
   minggu 6 hari dengan Ahad sebagai hari rehat dibayar RM666.67 (10/27).
4. Pekerja yang berhenti pada hari rehat: review menunjukkan **Part month
   below the Act’s calendar days** dengan beza wangnya.

---

## Batch 23 — 10 Oktober 2026 — Satu bulan payroll, tiga tarikh bayar (Bahagian 1)

**Cawangan:** `claude/malaysia-payroll-final-validation-h1h6xi`, dibina atas
Batch 22 (`5348779`). Komit: `0a2a92f`. **Migrasi:
`20261010100000_payment_batch_pay_date`** — satu lajur boleh-null `pay_date`
pada `payroll_payment_batches`; tiada pernyataan data, tiada jadual baharu.
Dijalankan di staging dengan *Migrate only* run #13 dari cawangan ini
**sebelum** master dimajukan; status selepas: "Database schema is up to
date!". **Tiada logik pengiraan statutori diubah**:
EPF, SOCSO, EIS, PCB dan levi HRD masih dikira atas seluruh bulan, dan payslip
masih satu bagi setiap bulan; hanya bayaran yang dipecah.

### Apa yang berubah

- `[D]` **Rekod lulus membekukan tarikh bayar** (`pay-dates.ts`
  `splitByPayDate`, snapshot format 4): tarikh setiap item, tarikh pada
  setiap baris pendapatan, dan berapa setiap orang dibayar pada setiap tarikh.
  Setiap pendapatan pergi ke tarikh itemnya. Semua yang ditolak bulan itu
  (statutori, cuti tanpa gaji, potongan selepas statutori) diambil daripada
  **bayaran gaji dahulu** (tarikh item *Basic*); jika tidak cukup, bakinya
  daripada tarikh lain mengikut urutan. Jumlah semua tarikh mesti sama dengan
  gaji bersih hingga ke sen; pengesahan rekod menyemaknya
  (`SNAPSHOT_PAYMENTS_VS_NET`).
- `[D]` ***Paying this month*** (`PaymentPanel.tsx`): notis "This month is
  paid on 3 dates: 30 Oct 2026 RM… · 1 Nov 2026 RM… · 15 Nov 2026 RM…", satu
  senarai bayaran dan satu butang **Record the transfer** bagi setiap tarikh,
  dan tarikh gaji ditanda "· the salary". CSV dimuat turun bagi satu tarikh
  (`…-paid-2026-11-15-batchN.csv`, baris pertama menyebut tarikhnya). Pada
  telefon, tag status kini berbalut dan tidak terpotong.
- `[D]` **Status run**: kekal APPROVED sehingga pemindahan terakhir direkod,
  kemudian PAID. **Payslip sampai ke portal pekerja apabila pemindahan gaji
  direkod** (`payslip-release.ts`), bukan menunggu tarikh 15hb. Tuntutan
  pekerja ditanda dibayar pada tarikh item tuntutan.
- `[D]` **Payslip** (cetak, PDF, portal): setiap pendapatan dengan tarikh
  bayarnya, dan bahagian **When it is paid**: setiap tarikh, jumlahnya, dan
  "paid" (tarikh sebenar) atau "due". Bulan yang dibayar pada satu tarikh
  kelihatan seperti dahulu.
- `[D]` **Buka semula**: bulan yang sudah ada mana-mana pemindahan direkod
  ditolak (409, "A transfer for this month was recorded on …"). Bulan yang
  dibuka semula sebelum itu: senarai bayarannya ditarik balik (SUPERSEDED,
  disimpan), supaya tiada senarai dengan angka lama atau tarikh lama yang
  boleh dibayar. Senarai bagi tarikh yang tidak lagi dibayar juga ditarik
  balik semasa *Prepare*.
- `[D]` **Laporan *Payment status*** menunjukkan satu blok bagi setiap tarikh.
  **Suapan Finance** (`/workforce/payroll/finance/liabilities`) menganggap
  bulan itu dibayar hanya apabila semua pemindahan direkod ("1 of the 3
  transfers … are recorded … Treat the rest of the net pay liability as
  outstanding"), dengan senarai `transfers` bagi setiap tarikh.
- `[D]` Rekod yang diluluskan sebelum batch ini: satu senarai dan satu
  pemindahan, tepat seperti dahulu.
- `[D]` **Ujian**: API unit +9 (`pay-dates` +5, `payroll-payment-schedule`
  +3, `payroll-snapshot` +1), e2e +5 (`payroll-pay-dates`: pecahan, satu
  senarai bagi setiap tarikh, muat turun, buka semula, rekod dan laporan),
  web +2 (`paymentPanel`).
- `[D]` **Semakan pelayar** (klinik UAT sintetik, Oktober 2026, pekerja demo
  sahaja): 30 Okt RM43,684.87 untuk 8 orang, 1 Nov RM1,000.00 untuk 1 orang,
  15 Nov RM835.00 untuk 2 orang. Payslip cetak Dr Meera Kaur (demo): gaji
  bersih 10,647.60 = 8,897.60 + 1,000.00 + 750.00. Portal telefon Puteri
  Balqis (demo): "15 Nov 2026 · due RM 85.00". Tiada skrol mendatar pada
  telefon.

### Uji di staging (ikut urutan)

1. *Settings → Payroll items*, lajur **Paid on**: Overtime, Locum fee,
   Housecall, Claim reimbursement dan Panel claim → **15th, next month**;
   Director's fee → **1st, next month** (jika belum dibuat selepas Batch 22).
2. *Payroll* → bulan baharu → *Work out* → *Approve*.
3. Langkah *Complete* → *Paying this month*: notis tiga tarikh. Tekan
   **Prepare the payment listings**; tiga blok muncul, 30hb bertanda "the
   salary".
4. Muat turun CSV bagi 15hb; semak nama fail dan jumlahnya.
5. **Record the transfer** pada blok 30hb. Log masuk sebagai pekerja: payslip
   bulan itu kini kelihatan, dengan **When it is paid**.
6. Cuba **Reopen** bulan itu: ditolak, kerana wang sudah keluar.
7. Rekod blok 1hb dan 15hb: run menjadi **PAID**. *Reports → Payment
   status* menunjukkan tiga blok.

### Keputusan terbuka

- `[A]` **Tarikh gaji ialah tarikh item *Basic***, dan semua potongan bulan
  itu diambil daripada bayaran gaji dahulu. Jika klinik mahu potongan
  tertentu (contohnya *Hutang medical claim*) diambil daripada bayaran 15hb,
  beritahu: itu peraturan berasingan bagi setiap potongan.
- `[A]` Tafsiran "1 month in arrears" daripada Batch 22 kekal: dibayar pada
  bulan selepas bulan payroll, dikira daripada rekod bulan itu sendiri.
- `[A]` *Date the money left* dalam dialog rakaman bermula pada tarikh bayar
  jika tarikh itu sudah lepas, atau hari ini jika belum.

---

## Batch 22 — 10 Oktober 2026 — Settings: tarikh bayar bagi setiap item, dan item klinik yang belum ada (Bahagian 2, dan asas Bahagian 1)

**Cawangan:** `claude/malaysia-payroll-final-validation-h1h6xi`, dibina atas
Batch 21 (`bc85fe7`). Komit: `5348779`. **Migrasi:
`20261010090000_pay_component_pay_dates`** — dua lajur
dengan nilai lalai pada `pay_components` (`pay_day` 30, `pay_month_offset` 0)
dan dua semakan julat; tiada pernyataan data, tiada jadual baharu. Dijalankan
di staging dengan *Migrate only* run #12 dari cawangan ini **sebelum** master
dimajukan; status selepas: "Database schema is up to date!". **Tiada logik
pengiraan statutori diubah.**

### Apa yang berubah

- `[D]` **Tarikh bayar bagi setiap item** (`pay-dates.ts`,
  `pay-component.service.ts`, `PayDateCell.tsx`): lajur baharu **Paid on**
  pada *Settings → Payroll items*. Satu tekan untuk "30th", "1st, next month"
  atau "15th, next month", atau mana-mana hari 1–31 "of the payroll month" /
  "of the next month". Hari yang tiada dalam bulan dibayar pada hari
  terakhirnya (30hb pada Februari → 28/29 Feb). Pembayaran, bukan rawatan
  statutori: disimpan terus tanpa tarikh berkuat kuasa atau sebab, ditulis
  pada **setiap versi** item itu (`PATCH /workforce/pay-components/:code/pay-date`),
  dan diaudit (`payComponent.payDateSet`). Perubahan rawatan yang membuat
  versi baharu membawa tarikh bayar bersama. Potongan tiada tarikh sendiri:
  "From the salary payment" (pelayan menolak dengan 400).
- `[D]` Semua item sedia ada bermula pada **30hb bulan payroll** — satu
  tarikh untuk seluruh bulan, jadi setiap run, senarai bayaran dan angka
  kekal seperti sebelum ini sehingga klinik menukar tarikh. Pemisahan bayaran
  mengikut tarikh ialah Batch 23.
- `[D]` **Item standard baharu** (`pay-component-catalogue.ts`), mengikut
  jadual anda sebagai kedudukan permulaan (DRAFT, belum disahkan, seperti
  semua baris lain): Night incentive, Marketing, Incentive procedure (BOD),
  Incentive procedure (resident), Housecall — EPF/SOCSO/EIS/PCB ya, HRD
  tidak; Panel claim, Refund medical checkup — tuntutan, tiada caruman dan
  tidak bercukai; Hutang medical claim / overpaid, Medical checkup — potongan
  selepas statutori (NET_ONLY). Ditambah melalui butang *Add N standard
  items* yang sedia ada.
- `[D]` Item standard tidak ditawarkan lagi jika klinik sudah membuatnya
  dengan tangan di bawah kod lain tetapi **nama yang sama** (contohnya
  "Housecall" sebagai `HOUSE_CALL`), supaya tiada pendua.
- `[D]` **Ujian**: API unit +3 (`pay-dates`), e2e +5
  (`pay-component-pay-date`), web +2 (`payrollItems`).

### Uji di staging (ikut urutan)

1. *Settings → Payroll items*: lajur **Paid on** menunjukkan "30th" untuk
   semua item; potongan menunjukkan "From the salary payment".
2. Tekan "30th" pada *Overtime* → **15th, next month**. Lakukan sama untuk
   Locum fee, Housecall, Claim reimbursement (*Other claim*) dan Panel claim;
   *Director's fee* → **1st, next month**.
3. Jika butang *Add N standard items* muncul, tekan untuk menambah item
   klinik yang belum ada; semak suisnya.

### Keputusan terbuka

- `[A]` Tafsiran "1 month in arrears": **dibayar pada bulan selepas bulan
  payroll** (Overtime/Locum pada 15hb bulan berikutnya, BOD pada 1hb bulan
  berikutnya). Angka bulan itu masih dikira daripada rekod bulan itu sendiri
  (contohnya OT Oktober daripada kehadiran Oktober). Jika maksud anda ialah
  run Oktober perlu mengira OT **September**, itu mengubah bulan rekod yang
  dibaca oleh pengiraan; beritahu dan ia boleh ditambah sebagai tetapan item.
- `[A]` Item standard sedia ada tidak diubah suisnya oleh batch ini. Mengikut
  jadual anda, yang berbeza daripada lalai Kuwick ialah: Bonus (SOCSO/EIS
  tidak), Locum fee (EPF/SOCSO/EIS ya), Incentive (bukan *additional
  remuneration*). Tukar di *Payroll items* dengan sebab dan bulan berkuat
  kuasa jika belum.
- `[A]` Housecall dan Panel claim bermula pada 30hb seperti item lain; jadual
  anda meletakkannya pada 15hb, jadi tetapkan di lajur *Paid on* (langkah 2).

---

## Batch 21 — 10 Oktober 2026 — CI: ujian pelayar hijau semula (Bahagian 5)

**Cawangan:** `claude/malaysia-payroll-final-validation-h1h6xi`, dibina atas
Batch 20 (`c22584c`). Komit: komit yang menambah bahagian ini (hash dalam
laporan). **Migrasi: tiada. Tiada kod aplikasi diubah** — `ci.yml` sahaja.

### Punca

- `[D]` Kerja *golden path (E2E)* dalam CI merah pada setiap push ke master
  sejak sekurang-kurangnya 17 September (run 397 hingga 436). Pada run 436:
  1 gagal, 1 *flaky*, 2 dilangkau, 102 lulus.
- `[D]` Yang gagal: `e2e/admin-hr.spec.ts:160` "the seeded month reads as
  what it is…", yang menunggu cip **Paid** pada bulan yang di-seed. Bulan
  berbayar itu hanya dibuat oleh `prisma/seed-hr-uat.ts`, yang memandu API
  yang sedang berjalan (cipta, kira, lulus, sediakan bayaran, rekod dibayar).
  Gate tempatan menjalankannya; CI tidak pernah menjalankannya.

### Apa yang berubah

- `[D]` `ci.yml`: langkah baharu **Seed the HR world through the API**
  selepas API dan web hidup dan kedua-dua ujian asap, sebelum Playwright,
  dengan `KUWICK_HR_UAT_SKIP_BASE=yes` (klinik admin sudah di-seed oleh
  langkah sebelumnya) dan kata laluan E2E CI.
- `[D]` Disahkan secara tempatan dengan urutan CI yang sama (seed asas →
  `seed-admin-uat.ts` → bina → API dan web → seed HR melalui API →
  Playwright): **104 lulus, 2 dilangkau, 0 gagal**. Seed HR membayar Julai,
  Ogos dan September 2026.

### Keputusan terbuka

- `[D]` `e2e/appointment-module.spec.ts:519` (pautan token membatalkan
  temujanji) *flaky* dalam CI: gagal sekali, lulus pada ulangan, lulus
  setiap kali secara tempatan. Ia tidak memerahkan kerja (Playwright
  menganggap *flaky* sebagai lulus). Artifak CI (tangkapan skrin, jejak)
  tidak dapat dimuat turun dari bekas ini kerana polisi rangkaian, jadi
  puncanya belum diketahui.

---

## Batch 20 — 6 Oktober 2026 — Review: satu kad bagi setiap jenis, tiga bahagian, satu kiraan

**Cawangan:** `claude/malaysia-payroll-final-validation-h1h6xi`, dibina atas
Batch 19 (`fd3a887`). Komit: komit yang menambah bahagian ini (hash dalam
laporan). **Migrasi: tiada. Tiada logik pengiraan statutori diubah** — hanya
cara amaran disimpan selepas diakui, dikira dan dipaparkan. Penemuan UAT,
bahagian C, item 13–17.

### Apa yang berubah

- `[D]` **C13 — satu kad bagi setiap jenis** (`PayrollExceptionCentre.tsx`):
  baris dikumpul mengikut jenis dalam setiap bahagian, contohnya satu kad
  *EPF on the employer-selected basis · 3 staff: A, B, C*. Amaran polisi
  (kini hanya `EPF_BASIS_DISCREPANCY`, ditanda `acknowledgedFor: 'YEAR'`
  dalam katalog) mendapat satu butang **Acknowledge for 2026** (tahun bulan
  run). Butang memanggil laluan baharu
  `PATCH /workforce/payroll/runs/:id/exceptions/acknowledge` `{ code, reason }`:
  setiap baris terbuka jenis itu diakui satu persatu dalam satu transaksi —
  audit yang sama dan rekod tahunan yang sama seperti mengakui seorang demi
  seorang. Tiada baris terbuka → 404; sebab kurang 5 aksara → 400. Butiran
  setiap orang di bawah **Details** (tertutup).
- `[D]` **C14 — tiga bahagian**: *Needs action* (blocker dan amaran yang
  belum diakui), *For information* (baris INFO, dan baris yang dibawa dari
  bulan lepas sebagai satu kad — notis berasingan di atas Review dibuang) dan
  *Done* (yang telah diakui, tertutup dengan *Show/Hide*).
- `[D]` **C15 — rupa yang sama sebelum dan selepas kira semula**
  (`payroll.service.ts`): pengiraan menulis semula baris amaran setiap kali;
  kini amaran yang kembali SAMA (kod, orang dan ayat yang sama) mengekalkan
  siapa mengakuinya, sebab dan tarikh. Amaran EPF yang diakui untuk tahun itu
  kini ditulis sebagai baris `EPF_BASIS_DISCREPANCY` yang sama, sudah diakui
  (orang, sebab dan tarikh dari rekod tahunan), bukan baris INFO
  `EPF_BASIS_ACKNOWLEDGED` yang lain rupa. Kod lama kekal dalam katalog untuk
  baris yang ditulis sebelum ini (dipaparkan dalam *Done*). Satu ayat untuk
  semua: *Acknowledged for 2026 by … on 6 Oct 2026: "sebab"*.
- `[D]` **C16 — satu kiraan**: pengepala "N need action", kaki "N need
  action. B of them block approval." atau "Nothing needs action.", dan ayat
  gate pelayan (dipaparkan pada langkah *Approve*) "N need action. None of
  them blocks approval." — semuanya mengira baris yang sama: blocker yang
  masih berdiri + amaran yang belum diakui (`approvalGate().needAction`
  baharu). Kiraan "to check" pada grid, senarai semak *Attendance and leave
  are settled* dan `worthALook` tidak lagi mengira amaran yang sudah diakui.
- `[D]` **C17 — teks pendek**: setiap 35 kod dalam katalog mendapat tajuk
  pendek (`title`, contohnya "Missing clock-in or clock-out", "Monthly tax
  (PCB) missing"); sebab, akibat dan "What to do" di bawah **Details**.
- `[D]` **Susunan nama dalam kad**: dalam setiap jenis, orang disusun
  mengikut susunan pekerja yang satu (`employee-order.ts`). Semasa ujian
  skrin, "3 staff: A, B, C" bertukar susunan selepas kira semula kerana
  pangkalan data memulangkan baris yang sama jenis dalam sebarang susunan.
- `[D]` **Ujian**: API unit +2 (tajuk katalog dan polisi tahunan; kiraan
  `needAction`) dan satu dikemas kini (ayat gate); e2e: amaran EPF kekal
  diakui selepas kira semula dan pada bulan berikutnya, butang polisi
  (`{ acknowledged: 1 }`, 404 bila tiada, 400 bila sebab pendek), amaran HRD
  kekal diakui selepas kira semula, nama dalam setiap jenis mengikut susunan
  pekerja (gagal tanpa susunan baharu, lulus dengannya); web +7
  (`payrollExceptionCentre.test.tsx`).
- `[D]` **Dokumen**: `KUWICK_MANAGEMENT_A_TO_Z_USER_UAT_GUIDE.md` (ayat gate,
  PAY-03, PAY-04) dan `HR_UAT_CHECKLIST.md` (7c, 7i, 8) mengikut skrin baharu.
- `[D]` **Semakan skrin tempatan** (klinik UAT sintetik, Oktober, Contoh
  Central, tiga pekerja demo pada EPF gaji pokok sahaja): satu kad EPF untuk
  3 staff; selepas **Acknowledge for 2026** pengepala dan kaki turun bersama
  dari 7 kepada 4 *need action*; kad dalam *Done* membaca ayat yang sama
  selepas kira semula; lebar telefon tanpa skrol sisi.

### Uji di staging (ikut urutan)

1. Bulan dengan dua atau lebih pekerja pada asas EPF pilihan majikan →
   *Review*: satu kad *EPF on the employer-selected basis · N staff*, satu
   butang **Acknowledge for 2026**; **Details** menunjukkan setiap orang.
2. Tekan butang, beri satu sebab → kad berpindah ke *Done* (tekan *Show*):
   "Acknowledged for 2026 by … on …". Pengepala dan kaki menyebut nombor
   *need action* yang sama.
3. Kembali ke grid, ubah satu angka (bulan dikira semula) → *Review*: kad
   yang diakui masih dalam *Done* dengan ayat yang sama.
4. Bulan dengan baris dibawa dari bulan lepas → kadnya dalam *For
   information*, bukan notis berasingan.
5. Langkah *Approve*: ayat atas butang menyebut nombor yang sama dengan
   *Review*.

### Keputusan terbuka

- `[A]` Amaran yang ayatnya berubah selepas kira semula (contohnya jam OT
  belum diluluskan bertambah) ditanya semula — sengaja: pengakuan dibuat
  untuk apa yang ia katakan pada hari itu.
- `[A]` Hanya asas EPF dianggap polisi tahunan dengan satu butang. Amaran
  lain untuk beberapa orang (contohnya *Missing clock-in or clock-out*) satu
  kad, tetapi diakui seorang demi seorang dalam *Details*, kerana setiap satu
  fakta bulan itu. Cadangan: tambah jenis lain sebagai polisi hanya bila
  anda memintanya.
- `[A]` Run yang sudah diluluskan dibekukan dengan baris lamanya: nota EPF
  yang ditulis sebelum batch ini kekal dengan ayat lama, di bawah *Done*.
- `[D]` Kiraan pada stepper ("2 blocked, 1 to check") mengira orang, Review
  mengira perkara; label berbeza untuk unit berbeza.

---

## Batch 19 — 6 Oktober 2026 — fail dan rekod: CSV dibuka betul dalam Excel, mesej rujukan, "tiada akaun bank", lajur Position dan Employee No.

**Cawangan:** `claude/malaysia-payroll-final-validation-h1h6xi`, dibina atas
Batch 18 (`8e9a24a`). Komit: komit yang menambah bahagian ini (hash dalam
laporan). **Migrasi: tiada. Tiada logik pengiraan statutori diubah.**
Penemuan UAT, bahagian D, item 18–21.

### Apa yang berubah

- `[D]` **D18 — CSV untuk Excel** (`apps/api/src/workforce/csv.ts`):
  senarai sumbangan statutori (KWSP/PERKESO/EIS/LINDUNG/PCB/HRD) dan senarai
  arahan bayaran kini UTF-8 **dengan BOM** — "—" tidak lagi menjadi "â€”" —
  dan nombor IC, nombor ahli KWSP/PERKESO, nombor cukai dan nombor akaun bank
  ditulis sebagai `="…"` supaya Excel menyimpannya sebagai teks (tiada
  9.63E+12, tiada sifar hadapan hilang). Nota pembuka fail kini satu sel, jadi
  tidak lagi pecah merentas lajur. Sebelum ini setiap fail mempunyai salinan
  fungsi `escape` sendiri; kini satu.
- `[D]` **D19 — rujukan kosong**: kedua-dua laluan rekod pemfailan (pelayan
  dan dua borang web) kini berkata **"Please enter the portal reference."**
  untuk kotak kosong, dan "That portal reference looks too short. Please
  check it against the portal." untuk 1–2 aksara.
- `[D]` **D20 — tiada akaun bank**: senarai pekerja menunjukkan **"Complete —
  no bank account"** (amber) bila semua perkara yang menyekat payroll lengkap
  tetapi akaun bank tiada; pengepala rekod pekerja: "Record complete — no bank
  account". Kad *Records incomplete* tidak mengiranya sebagai tidak lengkap
  tetapi menyebut "N without a bank account".
- `[D]` **D21 — Position dan Employee No.**: dua lajur baharu dalam grid *Add
  several* dan templat CSV, terus selepas *Full name*. *Position* menawarkan
  senarai jawatan klinik semasa menaip; nama yang sepadan dengan jawatan aktif
  dipautkan kepada jawatan itu oleh pelayan, perkataan lain disimpan seperti
  ditaip. *Employee No.* disemak unik (dalam kelompok dan dengan pekerja
  sedia ada) seperti sebelumnya. Contoh lajur baharu kosong, supaya templat
  lama masih dikenali.
- `[D]` **Ujian**: API unit +3 (`csv`), e2e dilanjutkan (BOM dan `="…"` dalam
  kedua-dua muat turun; mesej rujukan kosong dan pendek; intake +1: Employee
  No. dan Position, termasuk pautan kepada jawatan sedia ada), web dikemas kini
  dan +2 (lajur baharu, templat lama).

### Uji di staging (ikut urutan)

1. Bulan diluluskan → *Statutory outputs* → *Listing* KWSP → buka dalam
   Excel: "—" dipaparkan betul, nombor IC dan nombor ahli penuh (bukan
   9.63E+12). Senarai bank: nombor akaun penuh.
2. *Statutory filing* → *Mark as submitted* → kosongkan rujukan → *Record*:
   "Please enter the portal reference."
3. *Employees*: pekerja tanpa akaun bank tetapi lain-lain lengkap →
   "Complete — no bank account"; buka rekod → "Record complete — no bank
   account".
4. *Add several* → muat turun templat: lajur *Employee No.* dan *Position*
   selepas *Full name*; isi dan muat naik → kedua-duanya masuk ke rekod.

### Keputusan terbuka

- `[A]` Senarai bank (bukan fail statutori) turut menerima BOM dan nombor
  akaun sebagai teks — nombor akaun 12 digit mengalami masalah Excel yang
  sama.
- `[A]` Templat import pekerja (fail web) sudah mempunyai BOM; IC dalam
  templat bertanda sengkang jadi Excel menyimpannya sebagai teks. IC tanpa
  sengkang yang ditaip dalam Excel masih boleh ditukar Excel — cadangan:
  tulis IC dengan sengkang, atau format lajur sebagai Text sebelum menaip.

---

## Batch 18 — 6 Oktober 2026 — rekod berubah kini MENYEKAT kelulusan; keputusan anda direkod

**Cawangan:** `claude/malaysia-payroll-final-validation-h1h6xi`, dibina atas
Batch 17 (`fec0e73`). Komit: komit yang menambah bahagian ini (hash dalam
laporan). **Migrasi: tiada. Tiada logik pengiraan statutori diubah.**

### Keputusan anda (6 Oktober 2026)

1. `[D]` **Hari OFF roster untuk staf "Rotating"**: tidak sekarang — dikaji
   semula bersama pilot Kehadiran. Payroll kekal mengira seperti "Varies
   week to week".
2. `[D]` **Perubahan bertarikh ke belakang vs bulan diluluskan**: peraturan
   semasa dikekalkan (ditolak jika mana-mana bulan ≥ tarikh itu sudah
   diluluskan untuk pekerja itu).
3. `[D]` **Sepanduk rekod berubah**: kini MENYEKAT kelulusan sehingga bulan
   dikerjakan semula — batch ini.
4. `[D]` **Susunan senarai bank dengan baris dikecualikan**: diterima
   (mengikut nama, ditanda).

### Apa yang berubah

- `[D]` **Pelayan menolak kelulusan** (`PayrollService.refuseChangedRecords`,
  dipanggil dalam `approve` sejurus selepas semakan jadual statutori dan
  sebelum sebarang rekod kelulusan ditulis): cap jari input dikira semula
  dan dibanding seperti sepanduk; jika berbeza → 409 "Records changed since
  this month was worked out (Nama: jenis rekod). Work it out again, then
  approve." Terpakai pada pelulus pertama dan kedua. Run yang dikerjakan
  sebelum cap jari wujud tidak ditolak atas sebab ini.
- `[D]` **Gerbang di ruang kerja** (`journey.review.gate`): `canApprove`
  palsu dengan `recordsChanged: true` dan sebabnya sendiri; butang *Proceed
  to approval* dan *Approve* dimatikan, dan teks yang dahulu mengira
  "0 things must be sorted" kini menyebut sebab rekod berubah dan "Locked
  until the month is worked out again". Langkah Review tidak bertanda.
- `[D]` **Sepanduk** menambah baris "Approval is blocked until it is worked
  out again."
- `[D]` **Ujian**: e2e `pcb-additional` dilanjutkan (gerbang palsu dengan
  sebab; `approve` → 409 dengan nama dan jenis; tiada baris kelulusan;
  selepas dikerjakan semula `recordsChanged: false`), web +1 pengawal sumber
  dan sepanduk diperluas.

### Uji di staging (ikut urutan)

1. Draf bulan yang sudah dikerjakan → ubah Additional PCB seorang pekerja →
   *Payroll*: sepanduk dengan "Approval is blocked until it is worked out
   again."; langkah *Approve*: butang dimatikan, "Locked until the month is
   worked out again".
2. *Work it out again* → sepanduk hilang, butang *Approve* aktif semula.

### Keputusan terbuka

- `[A]` Senarai run bulanan (cawangan) masih membaca gerbang pengecualian
  sahaja; sekatan rekod berubah dikuatkuasa di ruang kerja run dan di
  pelayan. Mengira cap jari untuk setiap run dalam senarai bulan akan
  memperlahankan halaman itu.

---

## Batch 17 — 5 Oktober 2026 — "Records changed since this draft was worked out — work it out again"

**Cawangan:** `claude/malaysia-payroll-final-validation-h1h6xi`, dibina atas
Batch 16 (`f925fb2`). Komit: komit yang menambah bahagian ini (hash dalam
laporan). **Migrasi: `20261005140000_payroll_run_input_stamps`** — satu
lajur `input_stamps jsonb` (boleh null) pada `payroll_runs`, tiada
pernyataan data. **Tiada logik pengiraan statutori diubah.** Penemuan UAT 5
Okt, item B5.

### Apa yang berubah

- `[D]` **Cap jari input** (`payroll-input-stamps.ts`): di hujung setiap
  pengiraan — selepas tuntutan dipaut dan item terbitan ditulis — setiap
  pekerja dalam skop run diberi cap jari bagi setiap jenis rekod yang dibaca
  pengiraan: rekod pekerja (medan yang dibaca payslip/pengiraan sahaja; nombor
  telefon tidak), gaji, kedudukan statutori, asas KWSP, TP1/TP3, kehadiran
  bulan itu, cuti diluluskan, insentif, item bulan itu, tuntutan, item
  berulang, YTD bulan sebelumnya. Cap jari ialah hash **kandungan**, bukan
  masa — simpan tanpa ubah tidak menggerakkannya; tambah/padam
  menggerakkannya.
- `[D]` **Ruang kerja** (`journey`): untuk draf yang sudah dikerjakan
  (`CALCULATED`), cap jari dikira semula dan dibanding; perbezaan dinamakan
  — siapa, dan jenis rekod — serta pekerja yang masuk atau keluar skop.
- `[D]` **Sepanduk** di atas ruang kerja Payroll: "Records changed since this
  draft was worked out — work it out again." dengan senarai (8 pertama + "and
  N more") dan butang **Work it out again** (bagi pemegang
  `hr.payroll.run`). Hilang selepas dikerjakan semula. Tidak dipaparkan untuk
  bulan diluluskan/dibayar (perubahan kepada bulan itu melalui pelarasan).
- `[D]` Run yang dikerjakan sebelum lajur wujud tiada cap jari → tiada
  sepanduk sehingga dikerjakan semula (tidak meneka).
- `[D]` Cap jari membaca **bulan itu sahaja**: versi gaji/kedudukan/asas
  KWSP dibaca hanya jika berkuat kuasa pada mana-mana hari bulan itu, dan
  untuk nilainya (bukan id, sebab, nota); tarikh di luar bulan dibaca
  sebagai "sebelum/selepas bulan". Jadi merekod gaji tahun depan, atau
  menukar nombor telefon, tidak menimbulkan sepanduk.
- `[D]` **Ujian**: API unit +7 (`diffInputStamps`, `storedInputStamps`, dan
  tiga ujian tetingkap bulan: versi ditutup selepas bulan / sebab ditukar →
  tiada perubahan; gaji bulan itu berubah atau versi baharu bermula di
  tengah bulan → "salary"; telefon → tiada, bank → "employee record"), e2e
  +1 (kerjakan bulan → tiada; ubah Additional PCB → "statutory standing";
  kerjakan semula → hilang), web +3 (sepanduk, 8 nama + "and N more", tiada
  butang tanpa kebenaran).
- `[D]` **Disemak dalam pelayar** (klinik UAT sintetik, draf Oktober Contoh
  Central): selepas dikerjakan → tiada sepanduk; Additional PCB Puteri
  Balqis ditukar → sepanduk "Puteri Balqis: statutory standing"; *Work it
  out again* → hilang; 390px tiada limpahan.

### Uji di staging (ikut urutan)

1. *Payroll* → bulan draf yang sudah dikerjakan → tiada sepanduk kuning.
2. Buka seorang pekerja dalam draf itu → *Statutory* → *Record a change* →
   ubah Additional PCB → simpan. Kembali ke *Payroll*: sepanduk "Records
   changed since this draft was worked out — work it out again." dengan
   "<nama>: statutory standing".
3. Tekan **Work it out again** → sepanduk hilang dan PCB pekerja itu
   termasuk amaun baharu.

### Keputusan terbuka / yang saya pilih bagi pihak anda

- `[A]` Sepanduk ialah amaran, bukan sekatan: kelulusan tidak dihalang oleh
  sepanduk ini (sekatan sedia ada kekal). Cadangan: jika mahu, tambah
  pengadang di `approve` yang menolak draf yang ketinggalan — perlu keputusan
  anda kerana ia mengubah aliran kelulusan.
- `[A]` Tetapan seluruh run (komponen gaji, polisi payroll, cuti umum, jadual
  statutori) tidak termasuk dalam cap jari: item meminta "employee records";
  jadual statutori sudah ada semakan sendiri semasa kelulusan.

---

## Batch 16 — 5 Oktober 2026 — payroll: baris PCB, YTD, earned-in, hari bekerja, memuat, susunan, amaun dalam perkataan

**Cawangan:** `claude/malaysia-payroll-final-validation-h1h6xi`, dibina atas
Batch 15 (`70d4367`). Komit: komit yang menambah bahagian ini (hash dalam
laporan). **Migrasi: tiada. Tiada logik pengiraan statutori diubah** —
angka PCB, KWSP, PERKESO, EIS sama; yang berubah ialah cara ia dibentangkan
dan disusun. Penemuan UAT 5 Okt, bahagian B, item 6–12.

### Apa yang berubah

- `[D]` **B6 — "How this was worked out" (PCB)**: dua baris baharu, *MTD
  worked out for this month* dan *Additional PCB each month (statutory
  standing)* (dengan nota CP38), serta *PCB deducted this month* =
  jumlahnya. Nota lama dikekalkan. Terpakai pada bulan yang dikerjakan
  selepas kemas kini (kerjakan semula draf untuk melihatnya).
- `[D]` **B7 — Year to date**: label kini bulan yang **benar-benar dijumlah**
  ("Jan – Apr 2026"), bukan bulan draf; jurang dinamakan ("March not on
  record"), dan bulan draf disebut "May is added when it is approved".
  Pepijat ditemui: web menghantar `?taxYear=` tetapi API membaca `?year=`,
  jadi kad sentiasa tahun semasa — dibetulkan, dan API menerima
  `throughMonth` supaya kad bulan lama tidak mengira bulan kemudian.
- `[D]` **B8 — Earned-in** pada halaman payroll pekerja: "Director's fee
  (April 2026)", format sama dengan PDF dan payslip.
- `[D]` **B9 — "Days worked 0"**: tanpa kehadiran direkod, baris menjadi
  *Pay basis: Monthly salary* (halaman pekerja dan cetakan payslip
  diluluskan); dengan kehadiran, bilangan hari kekal.
- `[D]` **B10 — memuat**: halaman Payroll tidak lagi berkelip "Not started"
  dan sepanduk "not production-ready" semasa membaca bulan; ia menulis
  "Loading September 2026…". Sepanduk di ruang kerja juga menunggu data.
- `[D]` **B11 — satu susunan**: grid, sebelum/seterusnya pekerja, senarai
  payslip, senarai bank (skrin dan CSV), laporan status bayaran dan laporan
  YTD kini disusun dengan satu pembanding (`employee-order.ts`): nama A–Z
  tanpa beza huruf besar/kecil, nombor dibaca sebagai nombor, kemudian id.
  Baris dikecualikan dalam senarai bank kini berada di tempat namanya
  (ditanda, tidak dipindah ke hujung).
- `[D]` **B12 — amaun dalam perkataan** (PDF payslip): "Ringgit Malaysia
  Thirteen Thousand Eight Hundred Six and Thirty-One Sen Only".
- `[D]` **Ujian**: API unit +4 (perkataan: contoh UAT tepat dan
  "Minus"; susunan 3), dua ujian e2e dilanjutkan (baris PCB dalam
  `pcb-additional`; `throughMonth` dan 400 dalam `workforce-payroll`), web +8
  (`payrollLabels` 7, keadaan memuat 1).
- `[D]` **Disemak dalam pelayar** pada klinik UAT sintetik (Puteri Balqis,
  draf Oktober, Additional PCB RM100 CP38, Director's fee RM500 earned
  September): "Director's fee (September 2026)", *Pay basis: Monthly
  salary*, *Year to date: Jul – Sep 2026* + "October is added when it is
  approved", baris *MTD worked out for this month RM0.00* / *Additional PCB
  RM100.00 · CP38 ref 2026/1234* / *PCB deducted RM100.00*; susunan payslip
  September = susunan senarai bank; halaman Payroll menunjukkan "Loading
  October 2026…" dahulu, tidak "Not started".

### Uji di staging (ikut urutan)

1. *Payroll* → tukar bulan: tiada kelipan "Not started"; "Loading …" sebentar,
   kemudian ruang kerja atau "has not been started" yang betul.
2. Draf bulan Mei → buka pekerja dengan Additional PCB → *How this was
   worked out* → PCB: baris *MTD worked out for this month* dan *Additional
   PCB each month*; jumlahnya = PCB pada payslip. (Kerjakan semula draf dulu.)
3. Halaman yang sama: kad *Year to date* bertulis "Jan – Apr 2026" dan "May
   is added when it is approved"; item bulan lain bertulis "(April 2026)";
   tanpa kehadiran, *Pay basis: Monthly salary*.
4. Bulan diluluskan: senarai *Payslips* dan *Bank listing* (skrin dan CSV)
   dalam susunan nama yang sama dengan grid.
5. Muat turun PDF payslip: baris perkataan "Ringgit Malaysia … Sen Only".

### Keputusan terbuka / yang saya pilih bagi pihak anda

- `[A]` Susunan bank: nama sahaja, baris dikecualikan di tempat namanya —
  "susunan yang sama di mana-mana" dibaca secara literal. Satu baris untuk
  kembali kepada "dikecualikan di hujung" jika itu lebih baik untuk yang
  membayar.
- `[A]` Fail statutori (KWSP/PERKESO/LHDN) tidak disentuh: susunannya
  ikut format agensi.
- `[A]` *Pay basis: Monthly salary* hanya apabila tiada kehadiran direkod;
  payroll hanya membayar gaji bulanan (yang lain dikecualikan dengan
  `SALARY_BASIS_UNSUPPORTED`).

---

## Batch 15 — 5 Oktober 2026 — hari rehat "Rotating — follows the roster"

**Cawangan:** `claude/malaysia-payroll-final-validation-h1h6xi`, dibina atas
Batch 14 (`7e1ba48`). Komit: komit yang menambah bahagian ini (hash dalam
laporan). **Migrasi: `20261005130000_statutory_classification_rest_day_roster`**
— satu lajur `rest_day_follows_roster boolean NOT NULL DEFAULT false`
(metadata sahaja, tiada baris disentuh). Dicuba pada `kuwick_test` (kosong)
dan DB tempatan berbenih: bersih. **Tiada logik pengiraan statutori diubah.**
Penemuan UAT 5 Okt, item A4.

### Apa yang berubah

- `[D]` Pilihan hari rehat baharu **"Rotating — follows the roster"** pada
  kelima-lima tempat hari rehat ditanya: *Record a change*/*Correct*
  (kedudukan statutori), laci *Edit employment*, *Add employee*, *Bulk add*
  (CSV: `roster`, `rotating`, `followstheroster`, `ikutroster`), dan
  paparan rekod pekerja/kedudukan. Satu modul `restDay.ts` memegang senarai
  pilihan, label dan badan permintaan supaya lima skrin tidak bercanggah.
- `[D]` Disimpan sebagai `restDayFollowsRoster = true` **bersama**
  `restDayVaries = true` dan tiada hari minggu; memilih hari minggu atau
  "Varies week to week" mengosongkannya (pelayan menormalkan dalam
  `applyToBase`). Masuk `CLASSIFICATION_FIELDS`, jadi ia muncul dalam
  "What changed" dan menyekat bulan jika berubah di tengah bulan, seperti
  medan lain.
- `[D]` **Payroll tidak berubah**: ia mengira tepat seperti "Varies week to
  week" (tiada hari minggu ialah hari rehat; hari bekerja dikira hari biasa;
  notis INFO `REST_DAY_VARIES` setiap bulan; bayaran hari rehat dikunci
  dengan tangan). Ayat notis dan semakan kesediaan kini menyebut "rotates
  with the roster … Kuwick does not read the roster's off days".
- `[D]` Teks bantuan di bawah pilihan menyatakan perkara itu terus terang.
- `[D]` **Ujian**: API unit +2 (notis, kesediaan), e2e +1 (roster disimpan
  sebagai varies tanpa hari; hari Selasa menamatkannya), web +7 (`restDay`
  4, borang kedudukan, laci, intake CSV). Disemak dalam pelayar pada pekerja
  demo sintetik "Demo Roster (Synthetic)".

### Uji di staging (ikut urutan)

1. *Employees* → pekerja → *Statutory* → *Correct* (atau *Record a change*)
   → *Rest day*: pilihan terakhir **Rotating — follows the roster**; pilih →
   "You are changing: Rest day (Sunday becomes Rotating — follows the
   roster)" dan teks bantuan tentang roster.
2. Simpan → panel *Statutory standing* menunjukkan *Rest day: Rotating —
   follows the roster*; lajur *What changed* versi itu menyebut hari rehat.
3. Kerjakan payroll bulan itu untuk pekerja yang bekerja → notis INFO
   "Their rest day rotates with the roster…"; angka gaji sama seperti
   "Varies week to week".

### Keputusan terbuka / yang saya pilih bagi pihak anda

- `[A]` **Payroll tidak membaca hari OFF roster.** Arahan "jangan ubah logik
  pengiraan statutori kecuali dinyatakan" — item A4 hanya meminta pilihan.
  `[D]` Model roster (`ProviderShift`, jenis `OFF`) wujud tetapi payroll
  tidak pernah membacanya, dan kehadiran membaca masa baris OFF sebagai syif
  (`attendance-record.service.ts` tidak menapis `shiftType`). Cadangan
  susulan, perlu keputusan anda: ajar `classifyDay` menganggap tarikh OFF
  dalam roster sebagai `REST_DAY` bagi pekerja "Rotating", selepas
  pembetulan penapis OFF dalam kehadiran.

---

## Batch 14 — 5 Oktober 2026 — kedudukan statutori: pra-isi ikut tarikh, ringkasan perubahan, versi kemudian, pengesahan padam

**Cawangan:** `claude/malaysia-payroll-final-validation-h1h6xi`, dibina atas
Batch 13 (`7276e71`). Komit: komit yang menambah bahagian ini (hash dalam
laporan). **Migrasi: `20261005120000_statutory_classification_changed_fields`**
— satu lajur `changed_fields jsonb` (boleh null) pada
`employee_statutory_classifications`, **tiada pernyataan data**. Dicuba pada
DB ujian kosong (`kuwick_test`, melalui global-setup) dan DB tempatan
berbenih (12 versi sedia ada): kedua-duanya bersih, 0 baris disentuh.
**Tiada logik pengiraan statutori diubah.** Penemuan UAT 5 Okt, bahagian A,
item 1–3.

### Apa yang berubah

- `[D]` **A1 — pra-isi ikut tarikh** (`StatutoryStandingManager.tsx`):
  *Record a change* dahulu mengisi borang daripada versi **terkini** dan
  menghantar kesemuanya terhadap tarikh yang lebih awal — itulah sebabnya
  LINDUNG 24 JAM dan hari rehat ikut berubah apabila hanya Additional PCB
  diubah. Kini borang diisi daripada **versi yang berkuat kuasa pada tarikh
  yang dipilih** (atau versi pertama, jika tarikh mendahuluinya), dan
  mengikut tarikh apabila tarikh diubah. Teks bantuan di bawah tarikh
  menyatakannya.
- `[D]` **A1 — "You are changing: …"** sebelum simpan: senarai medan yang
  berbeza daripada versi asas, dalam perkataan borang ("Additional PCB each
  month (None becomes RM50.00)"), dengan versi perbandingannya dinamakan.
  Jika tiada yang berbeza, notis "Nothing differs…" dan butang *Record*
  dimatikan (pelayan pun menolaknya dengan 400).
- `[D]` **A2 — versi kemudian**: apabila tarikh mendahului versi lain dan ada
  perubahan, borang bertanya *Apply this change to later versions too?*
  (Yes/No, wajib dijawab). `applyToLater` baharu pada DTO; pelayan menyalin
  **medan yang berubah sahaja** ke setiap versi kemudian **yang masih
  memegang nilai lama**; versi yang mengubah medan itu sendiri kekal. Soalan
  yang sama pada *Correct* untuk versi yang mempunyai versi kemudian. Tidak
  ditanya untuk tarikh sebelum versi pertama (tiada nilai lama untuk
  dibawa). Mesej kejayaan menyebut berapa versi kemudian yang berubah.
- `[D]` **A2 — "What changed" kekal asal**: dahulu dikira semula pada setiap
  bacaan terhadap baris sebelumnya, jadi versi Jun yang diselitkan membuat
  September "berubah" medan yang tidak disentuh. Kini senarai medan
  **disimpan semasa versi ditulis** (`changed_fields`) dan tidak dikira
  semula; pembetulan (`correct`) mengira semula untuk baris itu sahaja.
  Baris lama (null) **dibekukan** — teks langsung ditulis sekali — sebelum
  operasi pertama yang menyusun semula rantai pekerja itu (tarikh ke
  belakang, padam, pembetulan), di bawah tenant yang memilikinya.
- `[D]` **A3 — pengesahan padam**: dialog sedia ada (komit `a3e78e9`) kini
  menunjukkan julat *In force*, sebab, perakam, dan **apa yang kembali**:
  versi sebelumnya berlanjutan dan setiap medan yang berbeza disenaraikan
  ("Additional PCB each month: RM50.00 becomes None"); versi pertama: amaran
  bulan-bulan itu tiada kedudukan dan payroll akan menyekatnya.
- `[D]` Lajur *What changed* untuk versi tanpa perubahan yang bukan yang
  pertama kini "Same as the version before" (dahulu "First recorded
  standing", mengelirukan). API `history` menambah `first`.
- `[D]` **Pembetulan sampingan**: baris borang dua lajur dalam modal tidak
  runtuh pada ≤767px (pra-wujud; pada 390px medan kanan terkeluar dari
  tepi) — kini satu lajur; notis dalam borang sejajar dengan medan.
- `[D]` **Ujian**: API e2e `statutory-standing-backdate` +5 (teks September
  kekal selepas Jun diselitkan; baris lama dibekukan; salin ke versi
  kemudian dua kes — masih nilai lama vs sengaja diubah; pembetulan Jan
  dibawa ke Sep; tidak diminta → tidak disentuh), unit +2
  (`storedChangedFields`), web +10 (pra-isi ikut tarikh, ringkasan, soalan
  wajib dan nilainya, soalan pada *Correct*, tiada soalan sebelum versi
  pertama atau tanpa versi kemudian, Record dimatikan, label lajur, dua
  dialog padam).
- `[D]` **Disemak dalam pelayar** pada pekerja demo sintetik ("Demo Backdate
  (Synthetic)", Jan dan Sep, baris dinolkan seperti staging): tarikh 1 Jun
  → Additional PCB kosong (Jan), ringkasan betul, Yes → Sep mendapat RM50
  dan teksnya kekal "LINDUNG 24 JAM participation"; padam Jun → dialog
  betul, Jan berlanjutan ke 31 Ogos; 390px tiada limpahan.

### Uji di staging (ikut urutan)

1. *Employees* → pekerja dengan ≥2 versi kedudukan → *Record a change* →
   tarikh **1 Jun 2026**: medan menunjukkan versi yang berkuat kuasa pada
   tarikh itu (bukan terkini). Taip Additional PCB `50` → notis "You are
   changing: Additional PCB each month (None becomes RM50.00)".
2. Soalan *Apply this change to later versions too?* muncul. Tekan *Record*
   tanpa menjawab → ralat. Pilih **Yes** → versi kemudian yang masih
   memegang nilai lama turut RM50; lajur *What changed* versi kemudian
   **tidak berubah**.
3. *Delete* pada versi Jun → dialog menunjukkan "In force 1 Jun 2026 to 31
   Aug 2026" dan "Additional PCB each month: RM50.00 becomes None"; sahkan →
   versi sebelumnya berlanjutan ke 31 Ogos.
4. *Record a change* tanpa mengubah apa-apa → "Nothing differs…" dan
   *Record* dimatikan.

### Keputusan terbuka / yang saya pilih bagi pihak anda

- `[A]` Soalan versi kemudian **wajib dijawab**, tiada lalai — "Ask" dalam
  penemuan dibaca sebagai soalan yang mesti dijawab, bukan kotak semak.
- `[A]` Salinan ke versi kemudian hanya untuk medan yang versi itu masih
  memegang nilai lama; perubahan sengaja pada versi kemudian dikekalkan.
- `[A]` Teks baris lama dibekukan pada operasi pertama, bukan backfill
  migrasi: jadual ini `FORCE ROW LEVEL SECURITY`, dan pada pemilik bukan
  superuser (staging) backfill tanpa tenant akan menyentuh 0 baris secara
  senyap.
- `[D]` Pengadang bulan diluluskan **tidak diubah**: perubahan bertarikh ke
  belakang masih ditolak jika mana-mana bulan ≥ tarikh itu sudah
  diluluskan untuk pekerja itu (walaupun bulan itu ditadbir versi kemudian
  yang tidak disentuh). Pengadang inilah yang menghalang *Yes* daripada
  mengubah versi yang bulan diluluskan dikira daripadanya. Cadangan:
  longgarkan kepada bulan dalam julat versi yang dibelah, dengan *Yes*
  menolak versi kemudian yang dibaca bulan diluluskan — perlu keputusan
  anda.

---

## Batch 13 — 5 Oktober 2026 — jadual statutori dibuka dalam pemapar besar, bukan laci sempit

**Cawangan:** `claude/malaysia-payroll-final-validation-h1h6xi`, dibina atas
Batch 12 (`ea54f24`). Komit: komit yang menambah bahagian ini (hash dalam
laporan). **Migrasi: tiada. Visual sahaja.**

### Apa yang berubah

- `[D]` **Pemapar jadual** (`admin/hr/ui/TableModal.tsx`, gaya
  `.hr-modal*` dalam `slate.css`): Jadual Ketiga KWSP, jadual PERKESO, jadual
  EIS dan Jadual 1 PCB (dengan parameternya) dibuka dalam tetingkap tengah
  ~90% lebar dan tinggi tetingkap pelayar, halaman di belakang dimalapkan;
  **Esc**, butang tutup atau klik pada kawasan malap menutupnya. Pada
  telefon (≤767px) ia helaian skrin penuh.
- `[D]` **Pengepala lajur melekat** di atas dan **lajur jalur gaji melekat**
  di kiri semasa badan tetingkap diskrol; badan tetingkap ialah satu-satunya
  penskrol (`.hr-table` di dalamnya `overflow: visible`). Pada desktop semua
  lajur kelihatan tanpa skrol sisi (jadual PERKESO 6 lajur muat dalam
  ~1,300px); pada telefon lajur gaji kekal di tempatnya ketika angka diskrol.
- `[D]` **Diukur dalam pelayar** (Chromium, akaun pemilik UAT sintetik):
  pada 1440×900 pemapar 1296×810 (90%/90%), jadual PERKESO 1256px dalam
  badan 1296px (skrol sisi 0), kepala kekal pada y badan selepas skrol
  900px; Esc dan klik di luar menutup `dialog`. Pada 390×844 helaian
  390×844, badan menskrol sisi (PCB +270px, PERKESO +508px) dengan kepala
  dan lajur pertama kekal; `3250` → PERKESO RM3,200.00 – RM3,300.00, KWSP
  RM3,240.01 – RM3,260.00; `45000` → PCB RM35,001.00 – RM50,000.00.
- `[D]` **Kotak "taip gaji"** berpindah ke kepala pemapar untuk keempat-empat
  jadual (PCB: pendapatan bercukai P). Ia **menyerlahkan** jalur yang
  dipadankan (`hr-row--hit`, latar indigo lembut dan jalur kiri) dan
  **menskrol** ke jalur itu (`scrollIntoView`, di tengah) — jadual penuh
  kekal, bukan lagi ditapis kepada 7 baris. Notis "RM… falls in the band …"
  dikekalkan untuk KWSP.
- `[D]` `StatutoryTablesView.tsx` kini memegang keempat-empat jadual
  (`EpfScheduleTable`, `SocsoBandsTable`, `EisBandsTable`,
  `PcbParametersView`) dengan pembantu `amountCents`/`bandIndex` yang sama;
  `StatutoryRatesPage` hanya memilih yang mana. Laci kit (`Drawer`) kekal
  untuk skrin lain (cuti, tuntutan).
- `[D]` **Ujian**: `statutoryRatesEditions.test.tsx` — jalur yang dipadankan
  membawa kelas `hr-row--hit` dan jadual kekal penuh; pemapar bernama
  `dialog` dan ditutup dengan Escape; ujian PERKESO/PCB sedia ada tidak
  berubah.

### Uji di staging (ikut urutan)

1. *Settings → Statutory rates* → **View SOCSO table**: tetingkap besar di
   tengah, keenam-enam lajur kelihatan tanpa skrol sisi; skrol ke bawah —
   baris pengepala kekal di atas. Esc menutup; klik kawasan malap menutup.
2. **View Third Schedule, band by band** → taip `3250` dalam kotak di kepala:
   jalur RM3,240.01 – RM3,260.00 diserlahkan dan diskrol ke pandangan, dengan
   notis angka majikan/pekerja; tukar ke *Part C* — kotak yang sama berfungsi.
3. Pada telefon (390px): **View Table 1 and the parameters** — helaian skrin
   penuh; skrol jadual ke sisi — lajur *P — chargeable income* kekal di kiri;
   taip `45000` — baris RM35,000.01 – RM50,000.00 diserlahkan.

### Keputusan terbuka / yang saya pilih bagi pihak anda

- `[A]` Pemapar dilukis dalam pokok React (bukan portal) dengan
  `position: fixed; z-index: 1000` — menutup bar atas juga, seperti pemapar
  imej; tiada unsur bertransformasi di atasnya dalam shell HR.
- `[A]` Kotak carian pada PCB mencari jalur **P** (pendapatan bercukai),
  dilabel sedemikian dan **menyimpan nilainya sendiri**; pada KWSP/PERKESO/EIS
  ia gaji bulanan seperti dahulu, dan gaji yang ditaip kekal semasa anda
  berada di halaman ini supaya satu gaji boleh dibandingkan merentas ketiga-tiga
  jadual (buka PERKESO selepas KWSP: jalur yang sama terus bercahaya).
- `[D]` Pada skrin ≤991px, `index.css` menjadikan pembalut jadual antd
  penskrol mendatar; dalam pemapar ini ia ditimpa supaya **badan pemapar**
  ialah satu-satunya penskrol (menegak dan mendatar) — diukur: tanpa timpaan,
  kepala jadual PERKESO hilang ke atas pada 390px selepas skrol 900px.
- `[D]` **Pembetulan benih ujian, komit berasingan** (`prisma/seed-e2e.ts`):
  carian benih E2E (`staff`, `diagnosis_catalog`, `service_catalog`, `items`)
  tidak menamakan tenant; ia berjalan sebagai pemilik DB yang RLS tidak
  tapis, jadi selepas klinik admin UAT wujud ia memilih *Paracetamol 500mg*
  klinik itu dan menulis baris `stock_levels` tenant staging untuk item
  tenant lain — baris yang `seed-admin-uat` tidak boleh padam (23503 pada
  `items`), jadi gate 4 gagal pada semaian semula. CI terlepas hanya kerana
  urutannya (admin UAT disemai terakhir). Setiap carian kini berskop
  `tenantId`. Tiada kesan pada kod produk atau staging.

---

## Batch 12 — 4 Oktober 2026 — gaya kanvas klinikal: bar atas putih, kad bulat, jubin ikon, indigo

**Cawangan:** `claude/malaysia-payroll-final-validation-h1h6xi`, dibina atas
Batch 11 (`11c276a`). Komit: komit yang menambah bahagian ini (hash dalam
laporan). **Migrasi: tiada. Tiada perubahan tingkah laku** — CSS, token dan
elemen hiasan (jubin ikon, `aria-hidden`) sahaja.

### Apa yang berubah

- `[D]` **Reka bentuk kanvas yang dilampirkan belum wujud dalam repo.** Yang
  ada ialah spek kanvas lama (`docs/design/kuwick2-canvas-final.pdf`, navy
  "Compact Pro", dilaksanakan sebagai token `.kw-canvas2` dalam
  `canvas.css`). Jadi palet baharu diletakkan **sekali** dalam
  `apps/web/src/design-system/tokens.ts` (`canvas`, `tileGradients`) dan
  dalam `index.css` sebagai `--kw-c-*`; `canvas.css` (klinikal) dan
  `slate.css` (HR dan portal) membaca token itu, bukan menyalin hex.
- `[D]` **Bar atas** (`AppLayout`): putih, wordmark KUWICK sebagai teks,
  menu utama sebagai pil dengan keadaan aktif indigo lembut, pil klinik
  bercahaya, avatar indigo; tinggi 60px. Item navigasi tidak berubah.
- `[D]` **Kanvas klinikal**: latar kelabu-lavender, kad putih bucu 18px
  dengan bayang lembut, jubin ikon berkecerunan pada setiap kepala kad
  (Visits, Clinical Notes, Diagnosis, Orders, Medications, Documents,
  Invoice, Appointments, Vitals), butang utama indigo, cip status lembut.
  Kad lawatan semasa kini indigo lembut, bukan navy.
- `[D]` **HR & payroll**: sidebar putih dengan garis halus, bahagian aktif
  sebagai pil indigo lembut; header HR putih dengan tab modul; panel, kad
  stat dan butang pada bucu kanvas; cip = pil; `PanelHead` memakai jubin
  bahagian secara lalai (`SectionTileContext` daripada `HrShell`) atau
  jubin sendiri melalui prop `icon`/`tone`; tajuk kedua dalam satu panel
  (`rule`) tiada jubin. Pada telefon, rail menjadi baris pil di bawah header.
- `[D]` **My Kuwick**: bar atas putih, tab sebagai pil indigo lembut, kad
  dengan jubin (halaman utama: Payslips ungu, Quick actions indigo, Recent
  kelabu; halaman lain mengikut tab).
- `[D]` **Ujian**: `slateIsolation.test.tsx` menjaga kontrak baharu
  (`slate.css` membaca `var(--kw-c-indigo)`/`var(--kw-c-bg)`, tiada hex
  kanvas ditaip di dalamnya); 324 ujian unit HR/portal/kanvas lulus.
- `[D]` **Bajet kanvas 1920×1080** (`canvas-viewport.spec.ts`) diukur
  selepas gaya baharu: rail kanan 873/873 (tiada skrol), dok janji temu
  bawah 878 < 1080, halaman tidak skrol; tiada limpahan mendatar pada 1440
  mahupun 390 untuk kesemua sembilan skrin yang ditangkap.

### Uji di staging (ikut urutan)

1. Log masuk; bar atas putih dengan wordmark **KUWICK**; item menu semasa
   (cth. *Queue*) ialah pil indigo lembut; nama klinik dalam pil putih.
2. Buka satu lawatan dalam susun atur *Canvas*: latar lavender, kad putih
   bulat, jubin ikon pada Visits/Clinical Notes/Medications/Invoice, butang
   *Dispense*/*Start* indigo, cip *In Consult* hijau.
3. *Administration → HR*: sidebar putih, bahagian aktif pil indigo; header
   putih dengan tab Operation/Stock/Panel/HR/Finance; panel Payroll berjubin
   ungu, Leave berjubin teal.
4. *My Kuwick* (akaun nurse): tab Home/Payslips/… sebagai pil; kad Payslips
   jubin ungu, Quick actions indigo, Recent kelabu; butang *Clock in* indigo.
5. Kecilkan ke 390px: tiada skrol mendatar pada kanvas, HR dan portal; rail
   HR menjadi baris pil di bawah header.

### Keputusan terbuka / yang saya pilih bagi pihak anda

- `[A]` Warna utama antd seluruh produk (`colors.primary`, navy) **tidak
  diubah**: Stock/Panel/Finance/Operation/Queue kekal seperti yang disemak,
  dan indigo diskop kepada kanvas klinikal, HR dan portal. Satu baris dalam
  `theme.ts` jika seluruh produk patut indigo.
- `[A]` Wordmark sebagai teks, bukan imej logo, mengikut reka bentuk; PNG
  logo kekal untuk halaman log masuk.
- `[A]` Garis rambut 3px di bawah header HR (Batch 7) dibuang — reka bentuk
  putih tidak mempunyainya.
- `[A]` Latar halaman global `--kw-page-bg` beralih daripada #f4f7fa ke
  #f3f4f9 (kelabu-lavender) supaya satu warna latar untuk seluruh produk;
  perbezaannya hampir tidak kelihatan pada modul lain.
- `[A]` **Jubin pada kad rail kanan kanvas disembunyikan di bawah 1440px.**
  Pada 1366 rail itu 463px lebar dan kad Invoice diukur kepada bajet 160px
  (`canvas-viewport.spec.ts`); jubin 24px menolak cip status kedua ke baris
  baharu (kad 167px). Dari 1440 ke atas jubin dipaparkan; kad lajur tengah
  (Diagnosis) mengekalkan jubinnya pada semua lebar. Pilihan lain ialah
  melonggarkan bajet, dan peraturan spek itu ialah kad yang dipendekkan,
  bukan ujian.
- `[A]` **Bajet ujian `addEmployeeForm.test.tsx` dinaikkan** (20 s setiap
  ujian, 4 s untuk `findBy`/`waitFor`) untuk fail itu sahaja. Mesin ujian
  hari ini ~1.5× lebih perlahan (gate 1: 48 s berbanding 30 s semalam) dan
  dua aliran borang empat peringkat itu melepasi had lalai 5 s **juga pada
  pokok sebelum perubahan ini** (`git stash` → 5.07 s / 5.09 s), jadi ia
  bukan kesan gaya baharu. Tiada ujian dilangkau.

---

## Batch 11 — 3 Oktober 2026 — pembetulan S berkuat kuasa dari 1 Januari 2026

**Cawangan:** `claude/malaysia-payroll-final-validation-h1h6xi`, dibina atas
Batch 10 (`6079be5`). Komit: komit yang menambah bahagian ini (hash dalam
laporan). **Migrasi: tiada.**

### Apa yang berubah

- `[D]` **Tarikh kuat kuasa:** edisi `PCB_MTD_2026_S_CORRECTED` kini berkuat
  kuasa **1 Januari 2026** (`registry.ts`, pemalar `JAN_2026`; `OCT_2026`
  dibuang). Ia pembetulan kod, bukan perubahan undang-undang, jadi setiap
  bulan yang belum diluluskan menggunakan S = RM4,000.
- `[D]` **Edisi kod pertama `PCB_MTD_2026`** dikeluarkan daripada senarai
  aktif dan disimpan dalam `SUPERSEDED_SCHEDULES` (id, hash `d2c8fca6b990daf8`
  dan dokumen yang sama; tempoh kosong, tidak pernah dipilih oleh
  `scheduleFor`). Snapshot bulan Jan–Sep 2026 yang diluluskan menamakan id
  dan hash ini, jadi ia kekal dapat dikesan. `builtInPcbParamsFor` dibuang;
  enjin membaca `BUILT_IN_PCB_PARAMS` untuk setiap tempoh.
- `[D]` **Pagar kelulusan baharu** (`payroll.service.ts` →
  `refuseStaleStatutoryStamp`): *Approve* ditolak (400) apabila cap statutori
  yang disimpan semasa pengiraan tidak lagi sepadan dengan jadual yang
  berkuat kuasa untuk tempoh itu (id atau hash edisi berbeza), dengan mesej
  "… changed since this run was calculated (PCB: PCB_MTD_2026 is now
  PCB_MTD_2026_S_CORRECTED). Recalculate …". Tanpa ini, run September yang
  sudah dikira sebelum pembetulan boleh diluluskan dengan S = RM9,000. Run
  tanpa cap (dikira sebelum cap wujud) tidak disentuh; skim yang tiada dalam
  cap lama tidak dihakimi.
- `[D]` **Ujian:** `editions.spec.ts` (empat tarikh 2026 → edisi
  dibetulkan; kod pertama tidak pernah dipilih), `registry.spec.ts` (edisi
  digantikan disimpan mengikut id dan hash, id tidak diguna semula),
  `workforce-payroll.e2e-spec.ts` (run dengan cap lapuk ditolak, dikira
  semula, diluluskan).
- Skrin: tiada kod web berubah. Pemilih bulan pada *Statutory rates*
  menunjukkan RM4,000.00 untuk mana-mana bulan 2026; konsol platform
  menyenaraikan satu edisi PCB terbina dalam (2026-01-01). Tanda "sudah
  disemak" klinik pada *Statutory rates* menjadi tidak semasa (hash registry
  berubah) — semak semula dan tanda sekali lagi.
- `[D]` **Seed UAT (`apps/api/prisma/seed-admin-uat.ts`):** rekod kehadiran
  *dibetulkan* untuk staf kaunter pada hari −22 berlanggar dengan rekod lebih
  masa 12 hb bulan gaji apabila seed dijalankan pada 3–6 hb (waktu Malaysia):
  kunci unik (tenant, staf, tarikh) → seed mati dengan P2002. Kini rekod itu
  berundur sehari apabila bertembung. Ditemui kerana gate 4 batch ini menyemai
  semula dunia UAT pada 4 Oktober waktu Malaysia. Tiada ujian memaut hari itu.

### Uji di staging (ikut urutan)

1. *Settings → Statutory rates*, pilih **Jan 2026** dan kemudian **Sep 2026**,
   buka **View Table 1 and the parameters**: kedua-duanya *Spouse relief
   (category 2)* **RM4,000.00**, garis edisi *… spouse deduction S = RM4,000
   …*, *in force from 1 January 2026*.
2. Konsol platform → *Statutory Tables*: satu baris terbina dalam untuk PCB
   (2026-01-01, edisi S dibetulkan).
3. Payslip Jan–Sep yang diluluskan: angka PCB tidak berubah; **How this was
   worked out** masih menamakan edisi D1 yang lama.
4. Jika ada run yang **sudah dikira tetapi belum diluluskan** (dikira sebelum
   pembetulan): *Approve* ditolak dengan mesej "changed since this run was
   calculated … Recalculate"; tekan *Recalculate*, kemudian *Approve* lulus.
5. Pekerja kategori 2 pada mana-mana bulan yang belum diluluskan: *Reliefs*
   RM13,000.00 (contoh pin RM5,000, KWSP 11%, bulan pertama → PCB RM90.00).

### Keputusan terbuka / yang saya pilih bagi pihak anda

- `[A]` **Pagar cap lapuk** ditambah tanpa diminta, kerana tanpanya "setiap
  bulan belum diluluskan guna S = RM4,000" tidak benar untuk run yang sudah
  dikira. Ia menolak kelulusan hanya apabila id atau hash edisi berubah;
  jalan keluar sentiasa *Recalculate*.
- `[A]` Edisi kod pertama disimpan (bukan dipadam) supaya hash pada snapshot
  Jan–Sep 2026 masih ada padanannya dalam kod; status
  *OFFICIAL_SOURCE_VERIFIED* edisi dibetulkan kekal seperti Batch 10.
- `[A]` Pembaikan seed di atas ialah infrastruktur ujian, bukan produk —
  dimasukkan dalam batch ini kerana tanpanya gate 4 tidak boleh dijalankan
  pada 3–6 hb mana-mana bulan.

---

## Batch 10 — 3 Oktober 2026 — pelepasan pasangan PCB (S) dibetulkan sebagai edisi baharu

**Cawangan:** `claude/malaysia-payroll-final-validation-h1h6xi`, dibina atas
Batch 9 (`052355c`). Komit: komit yang menambah bahagian ini (hash dalam
laporan). **Migrasi: tiada** — edisi terbina dalam ialah kod.

### Apa yang berubah

- `[D]` **S = RM4,000** (`DEDUCTION_SPOUSE_CENTS`) dalam
  `apps/api/src/statutory/pcb-2026.ts`; angka lama RM9,000 kekal di bawah
  nama sendiri (`DEDUCTION_SPOUSE_CENTS_AS_FIRST_CODED`,
  `PCB_PARAMS_2026_AS_FIRST_CODED`) supaya bulan yang dihargakan dengannya
  boleh dihasilkan semula.
- `[D]` **Registry:** edisi `PCB_MTD_2026` (D1) tamat pada 1 Oktober 2026;
  edisi terbina dalam baharu `PCB_MTD_2026_S_CORRECTED` berkuat kuasa
  1 Oktober 2026 dengan hash kandungannya sendiri (termasuk S), status
  *OFFICIAL_SOURCE_VERIFIED* (Jadual 1 dan D masih menghasilkan semula
  Exhibit 5; S dari senarai parameter spesifikasi — Exhibit 5 ialah kategori
  3 dan tidak pernah menguji S).
- `[D]` **Penyelesai edisi** (`editions.ts` → `builtInPcbParamsFor(on)`)
  mengikut jadual registry: hari terakhir bulan sebelum Oktober 2026 →
  parameter kod pertama; dari Oktober 2026 → parameter yang dibetulkan. Run
  gaji sudah memutuskan edisi pada hari terakhir bulan, jadi tiada perubahan
  lain dalam enjin.
- `[D]` **Bulan yang diluluskan tidak berubah:** snapshot beku, dan bulan
  sebelum Oktober 2026 yang dikira semula masih menggunakan edisi D1 lama.
- `[D]` **Ujian:** `pcb-2026.spec.ts` — contoh kategori 2 dipinkan terhadap
  formula dengan parameter spesifikasi ditulis terang (bulan pertama,
  RM5,000, KWSP 11%: K2 RM313.63, P RM43,000.07, cukai tahun RM1,080.00, MTD
  RM90.00; kod pertama RM65.00); `editions.spec.ts` — 30 Sep 2026 → edisi
  lama, 1 Okt 2026 → edisi baharu, hanya S yang berbeza; `registry.spec.ts`
  — status setiap edisi PCB.
- Skrin: *Settings → Statutory rates* dan konsol platform *Statutory Tables*
  menunjukkan kedua-dua edisi PCB mengikut bulan — tiada kod web berubah.

### Uji di staging (ikut urutan)

1. *Settings → Statutory rates*, pilih **Sep 2026**, buka **View Table 1
   and the parameters**: *Spouse relief (category 2)* **RM9,000.00**; garis
   edisi PCB ialah D1 yang lama.
2. Pilih **Oct 2026**, buka laci yang sama: **RM4,000.00**; garis edisi
   *… spouse deduction S = RM4,000 …*, *in force from 1 October 2026*.
3. Konsol platform → *Statutory Tables*: dua baris terbina dalam untuk PCB
   (2026-01-01 dan 2026-10-01).
4. Payslip September yang diluluskan: angka PCB tidak berubah.
5. Jika ada pekerja **kategori 2** (berkahwin, pasangan tidak bekerja):
   kira Oktober — **How this was worked out** menunjukkan *Reliefs
   (individual, spouse, …)* RM13,000.00 dan PCB lebih tinggi daripada
   September pada gaji yang sama (formula menampung kekurangan Jan–Sep
   melalui X). Contoh pin: RM5,000, KWSP 11%, bulan pertama → RM90.00.

### Keputusan terbuka / yang saya pilih bagi pihak anda

- `[A]` **Tarikh berkuat kuasa 1 Oktober 2026** *(dibatalkan oleh Batch 11:
  kini 1 Januari 2026)* = "bulan seterusnya yang
  belum diluluskan" (hari ini 3 Oktober). Bulan sebelum Oktober yang masih
  belum diluluskan (jika ada) tetap menggunakan S lama — kalau anda mahu
  pembetulan itu juga, tarikh dalam `registry.ts` (`OCT_2026`) ialah satu
  pemalar.
- `[A]` Status edisi baharu *OFFICIAL_SOURCE_VERIFIED* (bukan *TEST_VECTOR*)
  kerana tiada contoh rasmi yang menguji S; memenuhi bar kelulusan.

---

## Batch 9 — 1 Oktober 2026 — laporan hala tuju (dokumen sahaja)

**Cawangan:** `claude/malaysia-payroll-final-validation-h1h6xi`, dibina atas
Batch 8 (`7d82564`). **Tiada kod, tiada migrasi.**

- `docs/HR_DIRECTION_AUDIT.md` `[D]`: audit modul HR berbanding Talenox,
  PayrollPanda, SQL Payroll dan Kakitangan pada paksi *Setup* dan kitaran
  bulanan *Prepare, Adjust, Review, Pay*, kemudian hujung tahun; setiap
  kenyataan ditanda `[D]` (kod Kuwick) atau `[A]` (bahan awam vendor,
  dibaca 1 Oktober 2026 — sumber disenaraikan). Jurang utama: fail muat naik
  portal, fail bank, Borang EA / Borang E / C.P.8D, import .xlsx, aplikasi
  mudah alih asli. Pelan Borang EA enam langkah (katalog kotak EA beredisi
  milik platform, pemetaan item, pengagregat tahunan dari snapshot yang
  diluluskan sahaja, PDF EA, Borang E + C.P.8D sebagai senarai dahulu, ujian
  dengan dunia demo) — dengan satu titik berhenti untuk anda: senarai kotak
  EA ialah tafsiran statutori.

### Uji

1. Buka `docs/HR_DIRECTION_AUDIT.md` dan semak bahagian 3 (di mana Kuwick di
   hadapan / di belakang) dan bahagian 5 (pelan EA) — beritahu saya jika
   susunan keutamaan dalam bahagian 6 tidak seperti yang anda mahu.

---

## Batch 8 — 1 Oktober 2026 — pembantu pemfailan statutori (versi kecil)

**Cawangan:** `claude/malaysia-payroll-final-validation-h1h6xi`, dibina atas
master Batch 7 (`85d57b4`). Komit: komit yang menambah bahagian ini (hash
dalam laporan akhir). **Migrasi: tiada** — rekod "submitted" menggunakan
jadual `payroll_statutory_submissions` yang sedia ada (satu baris setiap
skim), jadi laporan dan kontrak kewangan yang membacanya tidak berubah.

### Apa yang berubah

- **`GET /workforce/payroll/runs/:id/filing`** `[D]`: bulan yang diluluskan
  (snapshot disahkan) disusun semula **mengikut agensi** — KWSP (EPF),
  PERKESO (SOCSO + EIS + LINDUNG 24 JAM), LHDN (PCB), HRD Corp (levi; tidak
  berkenaan jika majikan tidak berdaftar). Setiap agensi: baris pekerja
  mengikut **nama** dengan IC, no. keahlian, bahagian setiap skim dan jumlah;
  **joiners** (tarikh mula dalam bulan itu, atau tiada dalam run bulan lepas
  yang diluluskan untuk majikan + cawangan yang sama) dan **leavers** (tarikh
  akhir dalam bulan itu, atau ada dalam run bulan lepas tetapi tiada bulan
  ini); jumlah pekerja / majikan / untuk dibayar (null jika ada baris tidak
  dikira — sama peraturan dengan senarai sedia ada); keadaan pemfailan
  (`NOT_RECORDED` / `PARTIAL` / `RECORDED` / `NOT_APPLICABLE`). Kebenaran
  sama dengan senarai: `hr.payroll.export.statutory`; audit
  `payrollStatutory.filingViewed`.
- **`POST .../filing/:agency/record-submission`** `[D]`: satu tarikh + satu
  rujukan ditulis pada **setiap skim** agensi itu (PERKESO = 3 baris),
  dalam satu transaksi; ditolak (409) jika mana-mana skim agensi itu sudah
  direkod, atau agensi tidak berkenaan. Audit
  `payrollStatutory.filingRecorded`.
- **Halaman `/admin/hr/payroll/:id/filing`** (Slate) `[D]`: tab agensi; kad
  jumlah (pekerja dalam senarai, bahagian pekerja, bahagian majikan, jumlah
  untuk dibayar + nama portal); panel *This month at the portal* (*Add before
  keying* / *Remove after filing* dengan sebab); jadual mengikut urutan
  portal; **Mark as submitted** membuka laci tarikh + rujukan + nota.
  Pautan dari tahap *Pay* run dan dari *Reports → Government reports*.
- **Tiada penjanaan fail** — seperti yang diminta; senarai CSV sedia ada
  setiap skim kekal.
- Ujian: `statutory-filing.e2e-spec.ts` (Feb + Mac untuk 4 pekerja demo:
  mula dalam bulan, akhir dalam bulan, berhenti bulan lepas; PERKESO 3 baris
  sekali sahaja; HRD tidak berkenaan; 403 tanpa kebenaran),
  `statutoryFiling.test.tsx` (4 ujian halaman).

### Uji di staging (ikut urutan)

1. **Payroll → bulan yang diluluskan → tahap Pay → Statutory filing helper.**
   Tab **KWSP**: senarai mengikut nama, IC dan no. KWSP di sebelah, jumlah
   *Total to pay* sama dengan jumlah EPF pada senarai lama.
2. Tab **PERKESO**: tiga lajur skim setiap pekerja (SOCSO, EIS, SKBBK) dan
   satu jumlah; panel *This month at the portal* menamakan sesiapa yang baru
   mula atau berhenti bulan itu (demo: tiada → "Nobody joined/left").
3. Tekan **Mark as submitted** pada KWSP, isi tarikh + rujukan → cip
   *Submitted [tarikh]* dan rujukan tertera; butang hilang. Buka semula
   halaman — kekal.
4. Tab **HRD**: jika syarikat tidak berdaftar dengan HRD Corp → *Nothing to
   file*.
5. *Reports → Government reports* → butang **Filing helper, per agency**
   membuka halaman yang sama untuk bulan yang dipilih.

### Keputusan terbuka / yang saya pilih bagi pihak anda

- `[A]` **"Urutan mesra portal"** saya tafsirkan sebagai lajur *nama, IC,
  no. keahlian, amaun* dan baris **A–Z mengikut nama**. Kalau portal tertentu
  mahu mengikut no. keahlian, itu satu baris `sort`.
- `[A]` Nama portal (i-Akaun (Majikan), ASSIST Portal, e-PCB Plus, e-TRiS)
  ialah label sahaja; tiada pautan ke portal.
- `[A]` **Satu rekod setiap agensi** ditulis sebagai satu baris setiap skim
  (bukan model baharu) supaya tiada migrasi dan laporan sedia ada terus
  membaca per skim; "PARTIAL" muncul hanya jika seseorang merekod skim demi
  skim melalui panel lama.
- `[A]` Joiners/leavers dibandingkan dengan run **REGULAR** bulan lepas
  untuk majikan dan cawangan yang sama; run "All branches" dibandingkan
  dengan run "All branches".

---

## Batch 7 — 1 Oktober 2026 — polish visual: biru Kuwick, fon dan ikon aplikasi utama

**Cawangan:** `claude/malaysia-payroll-final-validation-h1h6xi`, dibina atas
master Batch 6 (`a651408`). Komit: komit yang menambah bahagian ini (hash
dalam laporan akhir). **Migrasi: tiada.** Visual sahaja — tiada tingkah laku
berubah, tiada angka berubah.

### Apa yang berubah

- **Satu tempat untuk token jenama** `[D]`: `apps/web/src/design-system/
  tokens.ts` kini memegang `brandNavy #101632` (biru tua logo — warna bar
  atas sedia ada), `brandNavyRaised`, `brandBlue #2557e8` (biru diraja logo
  — garis aktif tab bar atas sedia ada), `brandBlueHover/Soft`, `onNavy/
  onNavyDim` dan `fontFamily`; `index.css` membawa bentuk CSS-nya
  (`--kw-brand-*`, `--kw-font`). Bar atas aplikasi utama kini membaca token
  itu dan bukan hex yang ditaip (output sama).
- **Modul HR membaca token itu** `[D]`: palet `.kw-hrSlate` (`--hr-slate`,
  `--hr-slate2`, `--hr-slate-txt`, `--hr-slate-dim`) menunjuk ke
  `--kw-brand-navy/raised/on-navy`; warna tindakan `--hr-teal` dinamakan
  semula `--hr-action` = `--kw-brand-blue` (39 tapak guna + 10 lembut +
  3 gaya sebaris). Hijau gelap tiada lagi di mana-mana dalam HR; gold
  (perlu orang), merah (sekat) dan hijau (selesai) kekal sebagai warna
  status HR sahaja.
- **Bar kecerunan biru di bawah header** `[A]`: saya tidak menjumpai bar
  kecerunan dalam kod aplikasi utama (hanya warna bar `#101632` dan garis
  aktif `#2557e8`); saya menambah satu garis 3px (navy → biru diraja →
  biru lembut) di atas shell HR, di bawah header. Kalau bar yang anda
  maksudkan ialah elemen lain, beritahu saya di mana dan saya guna semula.
- **Fon sama dengan aplikasi utama** `[D]`: HR dan portal pekerja kini
  menggunakan stack fon tema antd (`-apple-system, Segoe UI, Roboto…`);
  Inter / Inter Tight dibuang dari `slate.css` dan pautan Google Fonts
  dibuang dari `index.html` (hanya HR yang memintanya).
- **Ikon sama dengan aplikasi utama** `[D]`: 21 ikon HR (`ui/icons.tsx`)
  kini ikon `@ant-design/icons` dengan nama komponen yang sama; peraturan
  CSS `stroke/fill` untuk glyph lama ditindih untuk `.anticon`.
- **Portal pekerja** `[D]`: `colorPrimary`/`colorLink` dari `#0F8F7A` ke
  `colors.brandBlue`; fon tema yang sama.
- **390px** `[D]`: halaman payslip pekerja tidak lagi melimpah ke kanan
  (`.hr-two > * { min-width: 0 }`, `.hr-slip` satu lajur ≤640px); jadual
  kadar SOCSO membalut lajur "Applies" dan tidak lagi dipotong pada desktop.
- Guard `slateIsolation.test.tsx`: warna HR-sahaja = gold/merah/hijau;
  ujian baharu memastikan `slate.css` membaca `--kw-brand-*` dan `--kw-font`
  dan tidak menaip semula hex jenama atau Inter `[D]`.
- Tangkapan skrin 390px dan desktop (sebelum/selepas) dalam laporan akhir.

### Uji di staging (ikut urutan)

1. Buka **HR** — sidebar dan header biru tua (sama dengan bar atas aplikasi
   utama), item aktif dan butang biru diraja, garis nipis biru di bawah
   header; tiada hijau gelap di mana-mana.
2. Tab **Operation / Stock / HR / Finance** pada bar atas — garis bawah tab
   aktif biru diraja, warna sama dalam dan luar HR.
3. **Fon dan ikon**: HR kelihatan sama "jenis huruf" dengan Finance; ikon
   sidebar (Employees, Payroll, Attendance…) ialah ikon yang sama set dengan
   modul lain.
4. Telefon (390px): **Payroll → bulan → mana-mana pekerja** — payslip tidak
   dipotong di kanan; **Settings → Statutory rates** — kad SOCSO tidak
   dipotong.
5. **My Kuwick** (portal pekerja) — butang dan pautan biru, bukan teal.

### Keputusan terbuka / yang saya pilih bagi pihak anda

- `[A]` Bar kecerunan: ditambah seperti di atas kerana tiada dalam kod.
- `[A]` `--hr-teal` → `--hr-action` (nama sahaja; nilai = biru jenama).
- `[A]` Warna status HR (gold/merah/hijau) dikekalkan — ia makna, bukan
  jenama.
- `[A]` Pautan Google Fonts dibuang; kalau ada skrin lain yang mahu Inter,
  pulangkan satu baris dalam `index.html`.

---

## Batch 6 — 1 Oktober 2026 — jadual statutori beredisi dan kiraan payslip (a, b)

**Cawangan:** `claude/malaysia-payroll-final-validation-h1h6xi`, dibina atas
master Batch 5 (`28ea34b`). Komit: komit yang menambah bahagian ini (hash
dalam laporan akhir). **Migrasi: satu** — diterapkan dengan *Migrate only
(manual)* sebelum merge.

| Migrasi | Apa | Risiko kepada bulan lepas |
|---|---|---|
| `20261001130000_statutory_table_versions` | jadual platform `statutory_table_versions` (tiada tenant, tiada RLS, grant `kuwick_app`), FK ke `platform_admins` | Tiada: tiada baris = jadual terbina dalam seperti sebelum ini; run diluluskan beku `[D]` |

### Apa yang berubah

- **3a — Jadual statutori beredisi.** Enjin (`contributions.ts`, `lindung-24-jam
  .ts`, `pcb-2026.ts`) kini menerima jadual sebagai parameter dengan jadual
  terbina dalam sebagai lalai — tanpa apa-apa diserahkan, angka sama seperti
  sebelum ini (ujian vektor rasmi tidak berubah) `[D]`. Modul baharu
  `statutory/editions.ts`: `editionsFor(tarikh, versi)` memilih edisi yang
  berkuat kuasa pada hari terakhir tempoh — terbina dalam atau edisi platform
  yang lebih kemudian; kandungan edisi disemak band demi band (bentuk,
  susunan menaik, sambungan tanpa jurang, siling) `[D]`. Run gaji memuatkan
  versi platform sekali setiap run dan menyerahkannya melalui
  `StatutoryContext.editions`; **cap** run (`stampFor`) menamakan edisi
  platform (`platform:<id>`, dokumen, hash) apabila ia yang menghargakan
  bulan `[D]`.
- **Hanya pemilik Kuwick menambah edisi:** `POST/GET/DELETE /platform/
  statutory-tables` dengan `PlatformAuthGuard`; token klinik ditolak (401);
  edisi mesti berkuat kuasa **selepas** edisi terbina dalam; edisi yang sudah
  berkuat kuasa tidak boleh ditarik balik (bulan mungkin sudah diharga
  dengannya); halaman konsol platform **Statutory Tables** (senarai edisi
  terbina dalam + platform setiap skim, borang *Add an edition* dengan JSON,
  masalah dinamakan baris demi baris, *Withdraw*) `[D]`.
- **Klinik membaca sahaja:** `GET /workforce/payroll/statutory-rates?period=
  YYYY-MM` mengembalikan edisi mengikut bulan, jadual penuh (EPF 4 bahagian
  band demi band, SOCSO, EIS, LINDUNG, PCB Jadual 1 + parameter, HRD) dan
  senarai versi platform; halaman *Statutory rates* mendapat pemilih bulan,
  baris edisi pada setiap panel, laci *View Third Schedule, band by band*
  (bahagian + carian gaji), laci *View Table 1 and the parameters*, panel
  *Editions on file* `[D]`.
- **3b — "How this was worked out" setiap baris statutori payslip.** Enjin
  melampirkan `working` pada setiap sumbangan (gaji yang dibaca, bahagian/
  kategori, baris jadual yang dipadankan, siling, edisi) dan baris PCB (P, M,
  R, B, n, K2, pelepasan, cukai tahun, MTD tahun) — dibekukan ke dalam
  snapshot payslip (`workings`) dan dipaparkan oleh butang **How this was
  worked out** pada halaman gaji pekerja `[D]`. Baris payslip lama (sebelum
  medan wujud) tidak mempunyainya.
- Ujian: `editions.spec.ts` (terbina dalam = pemalar mengikut rujukan;
  edisi platform terpakai dari tarikhnya dan bukan sebulan sebelumnya;
  LINDUNG mengikut edisi SOCSO; edisi rosak diabaikan; penolakan jurang/
  bahagian hilang), `statutory-table-versions.e2e-spec.ts` (guard, tambah,
  tolak, senarai, resolusi bulan klinik, tarik balik), `payslipWorkings
  .test.tsx`, `statutoryRatesEditions.test.tsx` `[D]`.

### Uji di staging (ikut urutan)

1. **Settings → Statutory rates**: pilih **Jun 2026**; setiap panel menyebut
   *Built-in edition … in force from …*. **View Third Schedule, band by
   band** → Part A → taip 3250 → tujuh baris sekitar band itu.
2. **View Table 1 and the parameters** → Jadual 1 PCB dan parameter
   (pelepasan individu RM9,000, had KWSP RM4,000, bukan pemastautin 30%).
3. **Konsol platform → Statutory Tables → Add an edition**: EIS, 2099,
   berkuat kuasa 2099-01-01, JSON contoh dalam senarai semak (1i). Cuba JSON
   berjurang → ditolak dengan sebab. Tersenarai dengan *Withdraw*.
4. Kembali ke klinik, *Statutory rates* → pilih **Feb 2099** → panel SOCSO &
   EIS menyebut *Platform edition 2099*; pilih **Jun 2026** → *Built-in*.
   **Withdraw** edisi itu di konsol platform.
5. **Payroll → baris pekerja → How this was worked out**: baris EPF/SOCSO/
   EIS/PCB dengan gaji, baris jadual dan edisi.

### Keputusan terbuka / yang saya pilih bagi pihak anda

- `[A]` **Edisi platform dianggap *OFFICIAL_SOURCE_VERIFIED*** untuk cap run
  (memenuhi bar kelulusan): pemilik Kuwick merekod dokumen sumber; tiada
  vektor ujian rasmi dijalankan terhadapnya. Kalau anda mahu bar yang lebih
  tinggi (contoh: edisi platform perlu "disahkan" dahulu sebelum run boleh
  diluluskan), itu kerja lanjutan.
- `[A]` **Edisi platform mesti berkuat kuasa selepas edisi terbina dalam**
  — Kuwick tidak membenarkan angka yang ditaip menggantikan angka yang
  disahkan untuk bulan yang sama atau sebelumnya.
- `[A]` **Kandungan ialah JSON** dalam bentuk yang enjin baca (ditunjukkan
  pada borang); tiada penyunting band demi band — jadual KWSP ada ~1,000
  baris sebahagian dan lebih selamat ditampal dari fail yang disediakan.
- `[A]` PDF payslip **tidak** memuatkan kiraan (hanya halaman web); pekerja
  melihat angka, klinik melihat kiraan.
- `[A]` HRD: kadar beredisi; kelas pendaftaran majikan kekal pada majikan.
- `[D]` **Untuk disemak (tidak diubah):** pemalar enjin
  `DEDUCTION_SPOUSE_CENTS` dalam `apps/api/src/statutory/pcb-2026.ts` ialah
  **RM9,000** ("Exhibit 5"), kini dipaparkan dalam laci PCB sebagai *Spouse
  relief (category 2)*. `[A]` Spesifikasi MTD HASiL yang saya ingat menyebut
  S = RM4,000 untuk pasangan tanpa pendapatan. Saya **tidak** mengubahnya
  kerana ia akan mengubah PCB bulan sedia ada bagi pekerja kategori 2 —
  sila semak terhadap dokumen D1 dan beritahu saya; pembetulan ialah satu
  pemalar + satu edisi baharu, bukan kerja besar.
- `[D]` **Dibaiki sambil lalu:** halaman payslip yang dibuka terus dari
  penanda buku (sebelum baris pekerja tiba) ranap pada nama kosong
  (`initialsOf('')`); kini avatar kosong. Ujian `ui/who.test.ts`.
- `[D]` **Ditangguh ke batch polish:** pada 390px, halaman payslip pekerja
  (`PayrollEmployeePage`) melimpah ke kanan (panel 421px dalam skrin 390px)
  — sedia ada sebelum batch ini; dibaiki dalam Batch 7 (visual sahaja).

---

## Batch 5 — 1 Oktober 2026 — statutori dan payslip (c, d, e)

**Cawangan:** `claude/malaysia-payroll-final-validation-h1h6xi`, dibina atas
master Batch 4 (`61ef48b`). Komit: komit yang menambah bahagian ini (hash
dalam laporan akhir). **Migrasi: satu** — diterapkan dengan *Migrate only
(manual)* sebelum merge.

| Migrasi | Apa | Risiko kepada bulan lepas |
|---|---|---|
| `20261001120000_pcb_additional_and_warning_acknowledgements` | 2 lajur pada `employee_statutory_classifications` (`additional_pcb_cents` lalai 0, `additional_pcb_note`); jadual `payroll_warning_acknowledgements` (RLS + grant `kuwick_app`) | Tiada: lalai 0 = tingkah laku lama; run diluluskan beku `[D]` |

### Apa yang berubah

- **3c — PCB tambahan setiap bulan**, pada kedudukan statutori bertarikh
  (`additionalPcbCents`, `additionalPcbNote`): ditambah **di atas MTD yang
  dikira**, dibawa dalam baris PCB (YTD bulan berikutnya mengiranya sebagai
  cukai dibayar), nota payslip menyebutnya; **tidak** ditambah pada angka
  PCB yang ditaip tangan. Borang *Statutory standing* ada dua medan baharu;
  sejarah versi menunjukkannya `[D]`.
- **3d — Baris tunggakan menamakan bulan ia diperoleh** pada label payslip
  dan register: *Locum fee (December 2025)*; baris bulan ini tanpa akhiran
  `[D]`.
- **3e — Amaran asas EPF diakui sekali setiap keputusan polisi.** Butang
  *Acknowledge* yang sedia ada pada Review kini juga merekod pengakuan
  (`payroll_warning_acknowledgements`, kunci: pilihan asas bertarikh + tahun).
  Bulan yang sama dikira semula dan bulan-bulan berikutnya menunjukkan satu
  baris INFO `EPF_BASIS_ACKNOWLEDGED` (*acknowledged for the year by … on …:
  “…”*), tidak boleh di-*override*; pilihan asas baharu (baris bertarikh
  baharu) atau tahun baharu menanyakannya semula. Dialog *Acknowledge*
  menyatakan liputan ini `[D]`. Audit: `payrollWarning.acknowledged` `[D]`.
- Ujian: `pcb-additional.e2e-spec.ts`, `epf-basis-acknowledgement
  .e2e-spec.ts`, label tunggakan dalam `payroll-input-lines.e2e-spec.ts`,
  fixture `statutory-classification.spec.ts` `[D]`.

### Uji di staging (ikut urutan)

1. **Rekod pekerja → Statutory → Record a statutory standing**: *Additional
   PCB each month* 100, nota *CP38 ref 2026/0001*, tarikh 1 bulan ujian.
   Kira semula bulan: PCB orang itu naik tepat RM100.00; payslip (dan laci
   *Statutory*) menyebut *Includes RM100.00 additional PCB each month*.
2. Orang yang PCB-nya **ditaip tangan** (tiada profil cukai): angka yang
   ditaip kekal — tiada +100.
3. **Prepare → Other income → Add a line** dengan *Earned in* bulan lepas:
   register dan payslip menunjukkan *Nama item (Bulan Tahun)*.
4. **Review**: pada pekerja dengan asas EPF pilihan majikan di bawah
   penilaian, **Acknowledge** dengan sebab. Kira semula: amaran bertukar
   satu baris INFO; mulakan bulan berikutnya: INFO sahaja, tiada amaran.
5. Rekod pilihan asas EPF **baharu** (tarikh bulan berikutnya) → amaran
   ditanya semula untuk bulan itu.

### Keputusan terbuka / yang saya pilih bagi pihak anda

- `[A]` **PCB tambahan dibawa dalam baris PCB** (bukan baris berasingan) dan
  dikira dalam *X* (MTD dibayar) bulan berikutnya — rawatan yang sama untuk
  arahan CP38 dan permintaan pekerja. Laporan CP39 Kuwick **tiada lajur CP38
  berasingan** (sebelum ini pun tiada); kalau LHDN memerlukan lajur CP38
  dalam fail CP39 anda, itu kerja lanjutan — nota pada kedudukan merekod
  rujukan CP38 untuk sementara.
- `[A]` **Pengakuan terikat pada tahun kalendar** (tahun tempoh gaji) dan pada
  baris pilihan asas bertarikh; pengakuan tidak dipindahkan ke pilihan yang
  disemak semula walaupun isinya sama — pilihan baharu, soalan baharu.
- `[A]` Kod amaran lain (bukan asas EPF) kekal diakui **setiap run** seperti
  sebelum ini; hanya `EPF_BASIS_DISCREPANCY` yang disebut dalam arahan.

---

## Batch 4 — 1 Oktober 2026 — tambah beberapa pekerja sekali gus

**Cawangan:** `claude/malaysia-payroll-final-validation-h1h6xi`, dibina atas
master Batch 3 (`7a0a0d5`). Komit: komit yang menambah bahagian ini (hash dalam laporan akhir). **Migrasi: tiada** —
tiada jadual atau lajur baharu `[D]`.

### Apa yang berubah

- **Satu pintu masuk untuk pekerja baharu.** `POST /workforce/employees/intake`
  menerima 1–200 baris. `commit: false` menyemak sahaja; `commit: true`
  menulis **hanya jika setiap baris bersih**. Setiap baris disemak dengan DTO
  yang sama seperti empat endpoint rekod (`CreateEmployeeDto`,
  `RecordSalaryDto`, `RecordStatutoryClassificationDto`) ditambah apa yang
  endpoint tunggal tidak nampak: IC tidak sah, tarikh lahir bercanggah
  dengan IC, IC/nombor pekerja/e-mel login berganda dalam batch atau sudah
  ada pada rekod, syarikat diarkib, jawatan di-*retire*, cawangan di luar
  skop akaun. Masalah dinamakan pada `index` baris dan `field` sel `[D]`.
- **Penulisan melalui laluan sedia ada**, seorang demi seorang: rekod
  (`employees.create`), syarikat (`assignEmployee`), gaji bertarikh
  (`salaries.record`), kedudukan statutori bertarikh (`standings.record`) —
  jadi penolakan dan baris audit setiap pintu kekal; satu baris audit
  `employee.intake` untuk kumpulan itu `[D]`.
- **Kesediaan gaji** (`readiness.blocking` / `advisory`) dikira pada
  pelayan untuk setiap baris dalam susunan run gaji menolaknya — senarai
  yang dahulu disimpan tangan pada peringkat *Review* borang `[D]`.
- **Grid** `/admin/hr/employees/bulk` (butang **Add several** di
  *Employees*): lajur nama, *Account role*, cawangan, syarikat, tarikh
  mula, dokumen, nombor IC/pasport, tarikh lahir, jantina, gaji bulanan, EPF
  membership, tax residence, kategori PCB, hari rehat, LINDUNG. IC mengisi
  tarikh lahir dan jantina (masih boleh ditaip ganti). **Check rows** dan
  **Add N employees**; masalah di bawah selnya; lajur *Payroll* menyebut
  *Ready for payroll* atau senarai yang run masih akan halang `[D]`.
- **Templat CSV** (tajuk lajur yang sama + satu baris contoh yang diabaikan
  semasa dibaca) dan **Upload CSV** — cawangan dan syarikat dengan nama;
  perkataan biasa diterima (*Sunday*/*Ahad*, *Category 1*/*1*, *RM 2,500*,
  *IC*/*Passport*, *Nurse* → front desk / clinical staff); sel yang tidak
  dapat dibaca ditanda, lajur asing disebut, bukan dibuang senyap `[D]`.
- **Borang Add employee** menghantar satu baris ke endpoint yang sama
  (bukan lagi empat panggilan dari pelayar); penolakan diletak di bawah
  kotaknya pada peringkat yang ada kotak itu `[D]`.
- Keizinan: `hr.employee.manage` untuk masuk; sel gaji ditolak tanpa
  `hr.payroll.view`; login ditolak tanpa `users.manage`; cawangan mengikut
  skop akaun — sama seperti endpoint tunggal `[D]`.
- Ujian: `nric.spec.ts` (pembacaan IC pelayan = pelayar), `employee-intake
  .e2e-spec.ts` (4 ujian: semak tanpa tulis, batch ditolak keseluruhan,
  batch bersih ditulis melalui empat pintu + audit, skop pengurus dan kerani
  HR), `employeeIntake.test.ts`, `bulkEmployees.test.tsx`, borang tunggal
  dikemas kini; laluan `/admin/hr/employees/bulk` dalam jalan Playwright
  *Admin shell* `[D]`.

### Uji di staging (ikut urutan)

1. **Employees → Add several → Template (CSV).** Buka dalam Excel; baris
   contoh ada. Ganti dengan dua pekerja demo: cawangan dan syarikat ditulis
   dengan nama, IC `900101-14-5566` dan `850505-10-5571`, gaji 2500 dan
   2800, *Malaysian citizen*, *Resident*, *Category 1*, *Sunday*. Simpan
   sebagai CSV.
2. **Upload CSV** → dua baris muncul (baris contoh templat tidak); tarikh
   lahir dan jantina terisi dari IC. **Check rows** → kedua-dua *Ready for
   payroll*.
3. Tukar IC baris kedua kepada IC baris pertama → **Check rows** → *The same
   IC is on another row of this batch* di bawah sel itu; **Add 2 employees**
   enggan menulis (*Nothing was written*).
4. Betulkan IC → **Add 2 employees** → mesej *2 employees added*; di
   *Employees* kedua-duanya ada; rekod menunjukkan syarikat, gaji dan
   kedudukan statutori bertarikh dari tarikh mula.
5. **Add employee** (borang tunggal) masih berfungsi; cuba IC yang sama
   dengan pekerja sedia ada → ralat *An employee with this IC is already on
   record* di bawah kotak IC pada peringkat *Personal*.

### Keputusan terbuka / yang saya pilih bagi pihak anda

- `[A]` Grid membawa **Account role** dan **Start date** walaupun bukan
  dalam senarai "lajur yang gaji halang": API menolak rekod tanpa role, dan
  gaji serta kedudukan statutori tidak boleh ditarikhkan tanpa tarikh mula.
- `[A]` Baris yang **berhenti separuh jalan** semasa menulis (contoh: rekod
  dibuat, gaji ditolak oleh pelayan atas sebab yang semakan tidak jangka)
  dilaporkan (`failedAt`, `error`) dan tidak di-*rollback* — sama seperti
  borang tunggal sebelum ini; orang itu wujud dan rekodnya menyebut apa yang
  kurang. Pilihan yang lebih selamat berbanding memadam separuh rekod.
- `[A]` Had **200 baris** satu batch; **Excel `.xlsx` tidak dibaca** — templat
  ialah CSV (Excel membukanya); simpan semula sebagai *CSV UTF-8*.
- `[A]` Alamat dan hubungan kecemasan tidak di grid (ikut arahan); senarai
  kesediaan pada *Review* borang tunggal kekal dikira di pelayar dengan
  perkataan yang sama seperti pelayan (pelayan menyemak semula semasa simpan).

---

## Batch 3 — 1 Oktober 2026

**Cawangan:** `claude/malaysia-payroll-final-validation-h1h6xi`, dibina atas
master `41d7af3` (Batch 2). Komit utama: `0b44ed8` (27), `46e698a` (21),
`1b530b9` (LINDUNG), `26800d8` (5, 6, 7, 9b, 9e, 31, 32), dan komit yang
menambah bahagian ini (30, dokumen). Master dimajukan selepas migrasi
diterapkan — hash tip ada dalam laporan akhir.

**Migrasi (tiga, diterapkan dengan *Migrate only (manual)* sebelum merge):**

| Migrasi | Apa | Risiko kepada bulan lepas |
|---|---|---|
| `20261001090000_pay_component_audience` | enum + 2 lajur pada `pay_components` (lalai *everyone*) | Tiada: setiap item kekal untuk semua `[D]` |
| `20261001100000_festive_public_holidays` | `kind` pada `public_holidays` (lalai *ordinary*), 2 lajur nullable pada `payroll_policies` | Tiada: tiada hari ditanda, tiada angka ditetapkan `[D]` |
| `20261001110000_employee_record_set` | jadual `job_titles` (RLS + grant `kuwick_app`), 6 lajur nullable pada `employee_profiles`, `rest_day_varies` (lalai false) pada `employee_statutory_classifications` | Tiada `[D]` |

Tiada angka EPF, SOCSO, EIS, SKBBK atau PCB yang diluluskan berubah: run yang
diluluskan beku, dan setiap lajur baharu lalai kepada tingkah laku lama `[D]`.

### Apa yang berubah

- **27 — Item gaji menamakan untuk siapa ia.** *Applies to* pada *Payroll
  items*: *Everyone* atau senarai nama. Lajur sendiri, laci, baris yang
  ditaip dan *carry forward* membaca satu senarai yang sama. Baris orang lain
  yang sudah ditaip kekal dibayar dalam *Other income* `[D]`.
- **21 — Cuti umum boleh ditanda *Festive*.** Jenis pada kalendar (boleh
  ditukar kemudian, diaudit); *Festive holiday* multiplier dan *Per festive
  holiday shift* pada rule set, kosong = ikut cuti umum biasa. Hari itu
  sendiri kekal dua hari gaji Akta — tidak boleh ditetapkan (pilihan yang
  lebih selamat; soalan terbuka dalam `HR_HOLIDAY_TYPE_MARKER.md` dicatat
  di bawah, tidak diputuskan untuk anda) `[D]`.
- **LINDUNG — kosong bermaksud *Enrolled*** dan tidak lagi menyekat bulan;
  pengecualian `LINDUNG_PARTICIPATION_UNRECORDED` dibuang; fail-safe untuk
  gaji tanpa band kekal `[D]`.
- **5 — Jawatan klinik sendiri.** *Job* → *Account role*; *Job title* dari
  senarai klinik, tambah di tempat, urus dari butang *Job titles* di
  *Employees*. Senarai bermula dari jawatan yang sudah ditaip `[D]`.
- **6 — Days a week** (5, 5½, 6) direkod dan dipaparkan; pembahagi 26 kekal
  milik rule set (s.60I) `[D]`.
- **7 — Rest day *Varies week to week***: readiness terima, run tidak
  menyekat, baris INFO `REST_DAY_VARIES` menyebut bayaran hari rehat ditaip
  tangan `[D]`.
- **9b — Passport number** di samping IC untuk bukan warganegara; tulis
  sahaja, tidak dipaparkan semula `[D]`.
- **9e — Alamat dipecah**: jalan, poskod, bandar, negeri `[D]`.
- **30 — Company & statutory**: satu cawangan dipilih → syarikat tanpa
  pekerja aktif dilipat di bawah *Show other employers (no staff here) · N* `[D]`.
- **31 — IC mengisi tarikh lahir dan jantina** (Add employee, Complete
  profile); masih boleh ditaip ganti `[D]`.
- **32 — Placeholder** yang kelihatan seperti data sebenar berawalan *e.g.*
  (borang pekerja, PhoneField, borang klinik platform) `[D]`.
- **Dua pembetulan sebelah ujian, dijumpai semasa gate:** (i) `seed-admin-uat.ts`
  — senarai *reset* jadual tenant kini merangkumi `job_titles` (selepas
  `employee_profiles` yang menunjuk kepadanya); tanpa ini, seed UAT enggan
  berjalan kali kedua (semakan liputannya sendiri) — ini juga akan menimpa
  *HR UAT seed* di staging kalau dijalankan `[D]`; (ii) `me-self-service
  .e2e-spec.ts` — tetingkap kehadiran dilukis sekitar hari ini, bukan
  September yang ditaip (merah pada 1 Oktober tanpa apa-apa yang salah)
  `[D]`. Tiga kegagalan Playwright pada 1 Oktober (bulan yang di-seed,
  *Reversed* pada *Payments*, baris *Profitability*) berpunca dari data seed
  yang tinggal di September; selepas seed semula tempatan, kelima-lima spec
  (termasuk dua yang sebelum ini disangka kegagalan sedia ada) lulus `[D]`.

### Uji di staging (ikut urutan)

1. **Employees → Add employee.** Taip IC `900101-14-5567`: *Date of birth* jadi
   1 Jan 1990, *Gender* *Male*. Pilih *Account role*, kemudian *Job title*
   (tekan *Add a job title* kalau senarai kosong), *Days a week* 5½, alamat
   penuh. Pada *Pay & Statutory* pilih *Rest day* *Varies week to week*.
   *Review* tidak sebut *No rest day*. Simpan; rekod menunjukkan semuanya.
2. **Employees → Job titles.** Tukar nama satu jawatan → rekod pekerja ikut
   berubah. *Retire* satu → hilang dari borang, kekal pada pemegang.
3. **Settings → Payroll items.** *Applies to* pada *Director's fee* →
   *Selected employees only*, pilih seorang. Buka bulan: petak hanya pada
   orang itu, orang lain **—**. Laci *Other income* orang lain tidak
   menawarkan item itu.
4. **Settings → Public holidays.** *Mark festive* pada satu cuti bulan ujian;
   *Settings → Payroll policies* → rule set lalai → *Festive holiday* 4.
   Kira semula bulan yang ada hari itu dikerjakan: payslip ada *Festive
   holiday pay*; cuti umum biasa kekal 3×.
5. **Settings → Company & statutory.** Pilih satu cawangan: syarikat tanpa
   pekerja aktif di situ dilipat; tekan *Show other employers*.
   Juga: pekerja dengan LINDUNG kosong tidak lagi menyekat bulan (SKBBK
   dipotong seperti *Enrolled*).

### Keputusan terbuka / yang saya pilih bagi pihak anda

- **Hari festive — jam atau hari?** `[A]` Saya tafsirkan "Raya berbeza"
  sebagai angka klinik untuk **jam melebihi jam biasa** (dan shift dalam mod
  kadar klinik). Angka **hari** (dua hari gaji) kekal Akta, tidak boleh
  ditetapkan. Kalau anda mahu "tiga hari gaji untuk Raya", itu kerja
  seterusnya.
- **Rest day varies** `[A]` — run tidak mengharga hari rehat secara automatik
  untuk orang itu (tiada hari minggu yang boleh dipadankan); baris INFO
  setiap bulan. Alternatif: baca roster untuk menentukan hari rehat — belum
  dibina.
- **Days a week tidak mengubah kiraan** `[D]`: pembahagi ORP 26 ditetapkan
  s.60I(1A); hari kelima/keenam tidak bekerja diharga sebagai hari biasa
  (Akta tiada konsep "off day").
- **Audience mengikut kategori** (Doktor/Klinikal/…) tidak dibina; senarai
  nama sahaja. Pekerja baharu perlu ditambah ke senarai item secara manual.
- **Job titles tanpa kad Settings** — diurus dari butang *Job titles* di
  *Employees* supaya kad Settings kekal enam (ujian dan navigasi sedia ada).
- Dari Batch 2, masih terbuka: siapa memegang `order.fulfil` dan
  `procurement.manage`; kategori *Clinic manager*; run tenant-wide lama.
