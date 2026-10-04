# HR progress log

Log berjalan untuk modul HR & payroll: apa yang setiap batch ubah, cara
mengujinya di staging, dan keputusan yang masih terbuka. Terbaharu di atas.
Setiap kenyataan: `[D]` diperhatikan dalam kod atau DB, `[A]` andaian.

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
