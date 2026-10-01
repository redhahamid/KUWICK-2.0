# HR progress log

Log berjalan untuk modul HR & payroll: apa yang setiap batch ubah, cara
mengujinya di staging, dan keputusan yang masih terbuka. Terbaharu di atas.
Setiap kenyataan: `[D]` diperhatikan dalam kod atau DB, `[A]` andaian.

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
