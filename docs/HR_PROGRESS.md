# HR progress log

Log berjalan untuk modul HR & payroll: apa yang setiap batch ubah, cara
mengujinya di staging, dan keputusan yang masih terbuka. Terbaharu di atas.
Setiap kenyataan: `[D]` diperhatikan dalam kod atau DB, `[A]` andaian.

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
