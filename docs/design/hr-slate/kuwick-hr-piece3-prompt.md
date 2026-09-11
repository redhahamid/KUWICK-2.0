# PROMPT: Piece 3 — Design kit "Slate" dan skrin HR & Payroll Kuwick 2.0

## 0. Rujukan yang dilampirkan (baca dahulu)

Folder `docs/design/hr-slate/` dalam repo mengandungi:
- `kit.css` — token warna, font, komponen (chip, butang, kad, jadual, grid, drawer). **Ini sumber kebenaran untuk visual.**
- 14 fail HTML mockup + PNG: `settings`, `settings-statutory`, `employees`, `employee-record`, `payroll`, `employee-payroll`, `payslip`, `attendance`, `leave`, `claims`, `reports`, `portal-home`, `portal-leave`, `portal-claims`.
- `README.md` — peraturan warna dan sel.

Buka setiap HTML dalam browser dan bandingkan dengan PNG sebelum menulis kod. Bila spesifikasi di bawah dan mockup bercanggah, **mockup menang** untuk susun atur dan visual; **prompt ini menang** untuk logik dan data.

## 1. Peraturan kerja (kekal dari Piece 1–2)

1. Jangan ubah skema Prisma **kecuali** yang dinyatakan dalam §6 (polisi OT/PH). Tiada feature lain di luar prompt ini.
2. Bekerja ikut sub-Piece 3a → 3g. Selesai satu, hantar deliverable (§8), **berhenti dan tunggu OK.**
3. Tag laporan [D] DIPERHATIKAN / [A] ANDAIAN.
4. Data demo sahaja dalam seed, screenshot dan ujian.
5. Gunakan semula backend sedia ada: `GET /payroll/runs/:id/journey`, `payroll-report.service.ts`, `pay-component-catalogue.ts`, `statutory/registry.ts`, `/me/*`.
6. Kalau mockup menunjukkan data yang API belum ada (contoh: "Decided · by" pada leave, tarikh perbelanjaan pada claim), semak dahulu adakah medan itu wujud dalam Prisma. Kalau wujud tapi tidak didedahkan → tambah pada DTO. Kalau tidak wujud → laporkan, jangan cipta senyap.

## 2. Piece 3a — Kit dan shell

- Tukar `kit.css` kepada token design system Kuwick (CSS variables / theme file yang sedia ada). Font: Inter (400/500/600) untuk teks, Inter Tight (600/700) untuk tajuk dan angka besar. `font-feature-settings: "tnum"` pada semua angka.
- Shell HR sahaja: header slate `#16302B`, sidebar `#1E3E37` 232px, ikon pada setiap item rail, kiraan gold pada Payroll / Leave / Claims bila ada item menunggu, Settings di bawah. **Modul lain (Operation, Finance, Stock, Panel) tidak disentuh.**
- Komponen kongsi baru dalam `apps/web/src/admin/hr/ui/`: `StatCard`, `StatusChip` (done / attn / block / muted / info), `Panel`, `PanelHead`, `Steps`, `Toolbar`, `SegControl`, `Drawer`, `IconButton`. Gantikan komponen lama HR yang setara; jangan tinggalkan dua versi.
- Peraturan warna (tegas): teal = tindakan; gold = perlu orang; merah = block payroll; hijau = selesai; kelabu = auto/dari rekod. Tiada warna untuk hiasan.
- Copy: sentence case, tiada all-caps eyebrow, tiada anak panah dalam teks pautan, tiada istilah dalaman (snapshot, journey, materialisation).

Deliverable 3a: shell + komponen, satu skrin contoh (Settings landing) dalam kit baru, screenshot.

## 3. Piece 3b — Settings

Ikut `settings.html` dan `settings-statutory.html`.
- Landing: "Before the first live payroll" 5 baris + 1 Optional, cincin progres `4/5`, setiap baris ada Open. Enam kad "Everything you can change" dengan ikon, chip status, tarikh terakhir diubah.
- Kad **Statutory rates** (baru, gantikan bahagian "Check the statutory rates"): jadual EPF / SOCSO & EIS / PCB / HRD seperti mockup, **read-only** dari `statutory/registry.ts`, dengan tarikh kuat kuasa dan butang "Mark as checked" (simpan tarikh + nama pengguna).
- Payroll items: suis per-baris EPF · SOCSO · EIS · PCB · HRD · Prorate · OT base · Unpaid-leave base · Recurring · Reimbursement, boleh edit tanpa drawer (ini kerja yang ditangguh dari Piece 2).
- Payroll policies: lihat §6.

## 4. Piece 3c — Employees

Ikut `employees.html` dan `employee-record.html`.
- Senarai: ikon hijau/merah untuk EPF / SOCSO / EIS / Bank, chip Record (Complete / Bank missing / …), butang Edit + menu ⋯ (View · Edit · Mark as resigned). **Tiada Delete.**
- Rekod: 4 tab — Profile · Employment & salary · Statutory · Bank. Gabungkan 6 tab sedia ada; jangan buang data.
- Employment & salary: jadual gaji bertarikh (Upcoming / Current / lama) dengan sebab dan siapa ubah; **Recurring items** (allowance, potongan berulang) dengan tarikh mula/tamat dan flag EPF/SOCSO/PCB. Model: guna `EmployeeSalary` untuk gaji; untuk recurring items guna `EmployeeRecurringItem` (model wujud, 0 penggunaan — hidupkan, jangan cipta baru).
- Statutory tab: pilihan EPF 9%/11%, kategori SOCSO, status pemastautin, TP1/TP3.

## 5. Piece 3d — Payroll

Ikut `payroll.html`, `employee-payroll.html`, `payslip.html`.
- **Grid boleh edit.** Lajur kelabu (dari rekod / auto): Basic, Claims, Gross, EPF, SOCSO, EIS, PCB, Net. Lajur putih (boleh edit): Other income, OT jam, Unpaid hari, Other deduction. Nilai default putih datang dari Attendance / Leave / Claims / Recurring items.
- Butang Edit hujung baris → sel putih jadi input → Save (kira semula baris, status Ready / Blocked / Check) atau Cancel. Simpan seorang-seorang; "Save draft" simpan semua baris yang sedang diedit.
- Statutory **tidak boleh ditaip dalam grid**. Override EPF / PCB hanya di skrin butiran pekerja dengan sebab wajib, dilog dengan nama pengguna.
- Langkah: Prepare → Review → Approve → Pay. "Continue to review" mati selagi ada Blocked.
- Butiran pekerja (`employee-payroll.html`): Earnings kiri / Deductions kanan, tag sumber pada baris (Incentives, Locum, Attendance, Claims, Leave) yang boleh klik ke tempat asal, formula ringkas sebelah deduction, banding bulan lepas, panel "What fed this month", YTD, "Adjust this month" (one-off item, override PCB, nota payslip). Navigasi ‹ › antara pekerja.
- Payslip PDF (`payslip.html`, `payroll-payslip-pdf.ts`): logo + nama + alamat + no. SSM + no. majikan EPF/SOCSO/LHDN; butiran pekerja; Earnings/Deductions **tanpa** peratus atau butiran (hanya unpaid leave tunjuk bilangan hari); caruman majikan **di atas** net pay; net pay angka + perkataan; **Prepared by / Approved by** (nama, jawatan, tarikh, tandatangan dari profil). Tiada YTD.

## 6. Piece 3d (sambungan) — Polisi OT, PH dan hari rehat  ⚠️ perubahan skema dibenarkan di sini sahaja

Settings › Payroll policies mesti sokong **dua cara**, dipilih ikut kumpulan pekerja (`WorkforceCategory` sedia ada, atau per pekerja override):

**A. Statutori (Akta Kerja 1955):** gaji sehari = bulanan ÷ 26; sejam = sehari ÷ 8; hari biasa 1.5×, hari rehat 2.0×, cuti umum 3.0×.

**B. Kadar klinik:** salah satu — RM X sejam OT · RM Y per shift PH / hari rehat · RM Z per sesi. Nilai ditetapkan dalam Settings, bukan ditaip dalam grid.

Peraturan:
- Attendance kira jam dan tanda hari (biasa / rest day / PH dari Public holidays). Payroll darab ikut polisi pekerja dan masukkan sebagai baris "Overtime" atau "Public holiday pay" dalam grid — pengguna tidak kira sendiri.
- OT hanya masuk payroll selepas **diluluskan** dalam Attendance.
- Untuk pekerja gaji ≤ RM4,000: kadar klinik **tidak boleh** lebih rendah dari statutori — tunjuk warning gold dalam Settings dan block dalam payroll.
- Lanjutkan `PayrollPolicy` / `overtime-pricing.ts` untuk mode B. Migrasi minimum, laporkan skema yang diubah.

## 7. Piece 3e — Attendance, Leave, Claims · Piece 3f — Reports · Piece 3g — Portal

**Attendance** (`attendance.html`): tab Timesheet (harian) · Roster · Corrections · Monthly summary. Timesheet: shift vs clock in/out; lambat / balik awal merah dengan minit; on time hijau; jam total; OT jam teal dengan status Pending/Approved dan butang lulus; baris peraturan yang berkuat kuasa di bawah jadual.

**Leave** (`leave.html`): lajur Applied · Decided · by; butang Review → Drawer: butiran, balance selepas, siapa lagi cuti hari sama, timeline, nota (wajib bila reject), Approve / Reject.

**Claims** (`claims.html`): lajur Submitted · Expense date · Receipts · Amount; Drawer: kiraan (mileage km × kadar), resit lampiran (`StaffClaimAttachment`), "Approve different amount", nota wajib bila reject atau ubah amaun. Claims diluluskan masuk grid payroll bulan berkenaan sebagai Reimbursement (bukan taxable).

**Reports** (`reports.html`): 3 kumpulan — Payroll reports · Government reports (EPF Borang A, SOCSO & EIS 8A, PCB CP39, HRD, EA, Borang E) · Payslips (cari, Email all, Download all). Kekalkan deep-link `?report=…&run=…`.

**Portal /me** (`portal-*.html`): tab Home · Payslips · Leave · Claims · Attendance. Home: payslip terkini + PDF, baki cuti, clock in. Apply leave: balance selepas, warning clash, lampiran MC. Submit claim: resit **wajib**, kiraan mileage automatik. Payslip PDF muncul di portal sebaik run status Paid.

**Clock in / out (portal, fasa 1 — tiada device):**
- Butang Clock in / Clock out di portal Home dan tab Attendance.
- Semasa clock: ambil lokasi GPS dan selfie kamera depan. Simpan selfie sebagai bukti (bukan pengecaman wajah). Kalau lokasi di luar radius klinik (tetapan dalam Attendance & leave policies, default 150 m) → rekod tetap disimpan, ditanda "Outside clinic", manager nampak dalam Timesheet.
- `AttendanceRecord` mesti ada medan `source` (portal / qr / device) dan `proofUrl` + `lat/lng` — tambah jika tiada, supaya QR (fasa 2) dan device import (fasa 3) masuk tanpa ubah struktur.
- Timesheet admin: thumbnail selfie boleh klik, chip "Outside clinic" gold.
- Minta consent sekali (skrin ringkas) sebelum selfie pertama; simpan tarikh consent pada profil pekerja.

## 8. Kesediaan untuk ujian sebenar (wajib sebelum 3g dilaporkan siap)

Pemilik akan menjalankan aliran penuh dan membandingkan dengan payroll sebenar klinik. Sediakan:
1. **Seed UAT** `seed-hr-uat.ts`: 1 syarikat demo lengkap (semua nombor majikan diisi), 2 cawangan, 10 pekerja demo dengan gaji, statutory, bank, recurring items; roster bulan semasa; public holidays Malaysia tahun semasa; polisi OT mode A untuk staf dan mode B (kadar klinik) untuk doktor.
2. **Akaun ujian**: 1 owner, 1 clinic manager, 3 pekerja portal (doktor, nurse, staf ≤ RM4,000). Kata laluan dalam README ujian.
3. **Senarai semak aliran** dalam `docs/HR_UAT_CHECKLIST.md`, setiap langkah dengan URL: pekerja clock in (selfie) → apply leave → submit claim + resit → manager approve leave & claim → lulus OT → Payroll Prepare (edit satu baris, save) → Review → Approve → Pay → payslip PDF muncul di portal pekerja → Government reports dijana.
4. **Ketepatan visual**: setiap skrin mesti sepadan mockup pada 1440px — susun atur, label, warna, ikon, urutan lajur. Perbezaan hanya dibenarkan jika dilaporkan dengan sebab teknikal [D]. Screenshot bersebelahan (§9.2) adalah bukti penerimaan.
5. **Ketepatan kiraan**: ujian unit untuk EPF/SOCSO/EIS/PCB dengan 3 kes gaji (RM2,900 · RM5,600 · RM9,500), OT mode A dan B, unpaid leave 1 hari, dan claims non-taxable — keputusan dicetak dalam laporan supaya pemilik boleh banding dengan payslip sebenar.

## 9. Deliverable setiap sub-Piece

1. Senarai fail diubah / ditambah / dipadam, dan sebarang migrasi.
2. Screenshot 1440px setiap skrin disentuh **bersebelahan** PNG mockup yang sepadan (kiri mockup, kanan hasil). Ini bukti penerimaan — tanpa ini sub-Piece tidak dianggap siap.
3. Empat gate: `npm run test:api`, jest e2e, `npx vitest run`, `npx playwright test` — semua hijau, atau senarai kegagalan sedia ada yang disahkan bukan regresi.
4. Laporan [D]/[A]: di mana hasil menyimpang dari mockup dan kenapa; medan data yang mockup minta tapi API tiada.

Mula dengan **3a**. Senaraikan perubahan dahulu, tunggu "OK", baru tulis kod.
