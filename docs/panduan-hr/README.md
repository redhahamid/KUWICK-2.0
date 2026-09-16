# Panduan HR Kuwick

`Panduan-HR-Kuwick.pdf` — panduan lengkap menguji dan menggunakan HR dan payroll
Kuwick, dalam Bahasa Melayu, ditulis untuk doktor dan bukan untuk pengaturcara.
40 muka surat, 46 screenshot sebenar (komputer 1440×950 dan telefon 390×844).

Susunannya mengikut urutan sebenar yang sebuah klinik baru akan lalui:

0. Sebelum awak mula — akaun ujian
1. Sediakan klinik — nombor majikan, kadar berkanun, payroll items, rule set,
   polisi kehadiran dan cuti, cuti umum
2. Tambah pekerja — gaji, bank, tab Statutory, rule set mana
3. Roster
4. Kehadiran — punch, timesheet, Fix, luluskan OT
5. Cuti — mohon dari portal, luluskan, kesan pada payroll, baki dan carry forward
6. Tuntutan — hantar dengan resit, luluskan
7. Payroll — cipta run, Save draft, betulkan yang disekat, Review, Approve
8. Bayar — sediakan payment batch, rekod pemindahan
9. Payslip PDF dan portal staf
10. Bila staf berhenti — cuti tidak habis
    Penutup: keputusan dasar yang klinik sudah buat

Setiap kotak merah bertulis **"Di sini sistem akan menghalang awak"** disemak
terhadap kod, bukan diandaikan.

## Membina semula

Screenshot diambil daripada dunia ujian `Klinik Contoh (UAT)` yang berjalan
secara tempatan (api pada `:3000`, web pada `:5173`), selepas `seed-hr-uat.ts`.

```bash
# 1. Screenshot (perlukan pelayan dev yang berjalan)
cd docs/panduan-hr/capture
CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node capture-panduan.mjs
CHROME_PATH=... node capture-panduan2.mjs
CHROME_PATH=... node capture-panduan3.mjs

# 2. HTML
cd docs/panduan-hr && python3 build.py

# 3. PDF
/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
  --headless --disable-gpu --no-sandbox --virtual-time-budget=25000 \
  --no-pdf-header-footer --print-to-pdf=Panduan-HR-Kuwick.pdf panduan.html

# 4. Semak (tiada imej rosak, ketinggian muka surat)
cd capture && CHROME_PATH=... node verify-panduan.mjs
```

Teks panduan hidup dalam `build.py`. Sunting di situ, bukan dalam `panduan.html`,
yang dijana.

Tiada PII sebenar di mana-mana: semua nama rekaan, semua akaun `.invalid`.
