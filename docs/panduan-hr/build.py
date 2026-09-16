# -*- coding: utf-8 -*-
"""Bina panduan HR Kuwick sebagai satu fail HTML sedia untuk dicetak ke PDF."""
import html, os

SHOTS = 'shots'
def has(n, s): return os.path.exists(f'{SHOTS}/{n}-{s}.png')

def figure(name, caption):
    """Komputer selebar muka surat, telefon di bawahnya di sebelah kapsyen."""
    desk = ph = ''
    if has(name, 'desktop'):
        desk = (f'<div class="shot desk"><img src="{SHOTS}/{name}-desktop.png" alt="">'
                f'<div class="cap">Komputer</div></div>')
    if has(name, 'phone'):
        ph = (f'<div class="shot ph"><img src="{SHOTS}/{name}-phone.png" alt="">'
              f'<div class="cap">Telefon</div></div>')
    if not desk and not ph:
        return ''
    return (f'<figure class="pair">{desk}'
            f'<div class="foot">{ph}<figcaption>{html.escape(caption)}</figcaption></div></figure>')

def step(n, title, body):
    return f'<div class="step"><div class="stepno">{n}</div><div class="stepbody"><h4>{html.escape(title)}</h4>{body}</div></div>'

def block(text):
    return f'<div class="block"><strong>Di sini sistem akan menghalang awak</strong><p>{text}</p></div>'

def note(text):
    return f'<div class="note">{text}</div>'

SECTIONS = []

# ---------------------------------------------------------------- 1
SECTIONS.append(('1', 'Sediakan klinik', '''
<p>Ini dibuat <strong>sekali sahaja</strong>, sebelum ada pekerja. Kuwick tidak akan
benarkan awak jalankan payroll sebelum bahagian ini lengkap, dan itu memang disengajakan —
payroll yang berjalan atas tetapan kosong akan memberi angka yang nampak betul tetapi salah.</p>
''' + figure('01-settings', 'Settings HR. Enam kad, setiap satu satu bahagian tetapan.') + step(1, 'Nombor majikan', '''
<p>Buka <strong>Settings › Company</strong>. Isikan nombor pendaftaran syarikat, nombor
KWSP, nombor PERKESO dan nombor cukai majikan.</p>
<p><em>Apa yang sepatutnya berlaku:</em> setiap nombor disimpan pada syarikat itu, bukan pada
klinik. Kalau awak ada dua syarikat, setiap satu ada nombornya sendiri.</p>
''') + figure('02-company', 'Settings › Company — nombor majikan disimpan di sini.') + step(2, 'Semak kadar berkanun', '''
<p>Buka <strong>Settings › Statutory rates</strong>. Skrin ini <strong>memaparkan</strong>
jadual KWSP, PERKESO, EIS dan PCB yang Kuwick guna. Awak tidak menaipnya — awak
menyemaknya terhadap dokumen rasmi, kemudian tekan <strong>Mark as checked</strong>.</p>
<p><em>Kenapa:</em> Kuwick tidak mahu awak mempercayai angkanya tanpa seorang manusia
melihatnya. Sehingga ditanda, setiap payslip berkata ia PROVISIONAL.</p>
''') + figure('03-statutory-rates', 'Jadual berkanun. Awak semak, awak tanda — bukan taip.') + step(3, 'Payroll items', '''
<p>Buka <strong>Settings › Payroll items</strong> dan tekan <strong>Seed the catalogue</strong>.
Ini mencipta komponen standard Malaysia: Basic, Allowance, Overtime, Bonus, Locum fee,
BOD fee, potongan, dan lain-lain.</p>
<p>Setiap komponen ada empat suis: <strong>EPF · SOCSO · EIS · PCB</strong>. Itu yang
menentukan apa yang dikira ke dalam setiap caruman.</p>
''' + note('Kalau butang bertulis <strong>"Add 1 standard item"</strong> atau seumpamanya, itu bermakna Kuwick sudah menambah komponen baharu sejak awak seed dahulu. Tekan sahaja — ia hanya menambah yang tiada.')) + figure('04-payroll-items', 'Payroll items. Empat suis setiap komponen.') + block('Menukar mana-mana suis memerlukan <strong>sebab bertulis dan tarikh berkuat kuasa</strong>. Kuwick tidak akan menyimpannya sebagai suntingan biasa — ia menjadi <em>versi baharu</em>, supaya bulan yang sudah diluluskan kekal dengan layanan yang digunakan ketika itu. Sebab: satu perubahan senyap boleh mengira semula setiap bulan yang belum diluluskan.') + step(4, 'Payroll policies (rule set)', '''
<p>Buka <strong>Settings › Payroll policies</strong>. Rule set menentukan bagaimana kerja
lebih masa dihargai untuk satu kumpulan pekerja.</p>
<p>Dalam laci <strong>Edit</strong>:</p>
<ul>
<li><strong>Overtime divisor</strong> — biasanya 26. Seksyen 60I(1A) menetapkannya. Angka
lebih tinggi menjadikan sehari kurang bernilai, dan Kuwick akan menolak untuk mengira.</li>
<li><strong>Normal hours</strong> — jam biasa sehari.</li>
<li><strong>Pengganda</strong> — 1.5× biasa, 2× hari rehat, 3× cuti umum.</li>
<li><strong>Bagaimana baki tahun dianggarkan untuk cukai bulanan</strong> — tetapan baharu.
Lihat nota di bawah.</li>
</ul>
''') + figure('05-payroll-policies', 'Senarai rule set. Tekan <strong>Edit</strong> pada baris yang berkenaan.') + figure('05b-pcb-projection', 'Laci rule set. Di bawah: pilihan anggaran cukai bulanan.') + note('''<strong>Anggaran cukai bulanan.</strong> Kaedah PCB memandang ke hadapan: potongan
bulan ini bergantung pada berapa yang awak jangka pekerja itu terima untuk <em>baki tahun</em>.
LHDN menyerahkan anggaran itu kepada majikan. Tiga pilihan, dan <strong>tiada satu pun mengubah
jumlah cukai yang pekerja hutang untuk tahun itu</strong> — ia diselesaikan pada taksiran.
Yang berubah hanyalah berapa banyak ditahan setiap bulan.''') + step(5, 'Attendance & leave policies', '''
<p>Buka <strong>Settings › Attendance &amp; leave policies</strong>.</p>
<ul>
<li><strong>Late after</strong> / <strong>Short after</strong> — berapa minit sebelum lewat dikira.</li>
<li><strong>Overtime minimum</strong> dan <strong>rounds down to</strong> — masa lebih di bawah
minimum bukan OT langsung; selebihnya dibundarkan <em>ke bawah</em>.</li>
<li><strong>Longest believable shift</strong> — syif lebih panjang daripada ini ditanda, bukan dipercayai.</li>
</ul>
<p>Di bawah panel itu: <strong>cuti tahunan yang tidak habis apabila pekerja berhenti</strong>.</p>
''') + figure('06-attendance-leave', 'Peraturan kehadiran. Waktu rehat ditolak melalui punch, bukan potongan tetap.') + figure('06b-leave-payout', 'Pilihan bayar / tidak bayar cuti tidak habis — seksyen 60E(3).') + block('Kalau awak pilih <strong>"Do not pay it out"</strong>, Kuwick akan <em>menyimpannya</em> tetapi tidak senyap. Ia menunjukkan amaran yang menyebut seksyen 60E(3), menyatakan ia kewajipan berkanun yang terpakai untuk peletakan jawatan juga, dan menuntut <strong>tanda kotak dan sebab bertulis</strong>. Nama awak dan tarikh direkod, dan polisi itu ditanda kekal pada skrin.') + step(6, 'Cuti umum', '''
<p>Buka <strong>Settings › Public holidays</strong> dan masukkan senarai tahun ini.</p>
<p><em>Kenapa penting:</em> kehadiran dan cuti kedua-duanya membaca senarai ini. Tanpa ia,
syif pada cuti umum akan dihargai seperti hari biasa.</p>
''') + figure('07-public-holidays', 'Senarai cuti umum. Kehadiran dan cuti membacanya.')))

# ---------------------------------------------------------------- 2
SECTIONS.append(('2', 'Tambah pekerja', '''
<p>Setiap pekerja perlukan empat perkara sebelum payroll boleh mengira mereka: gaji,
butiran bank, kedudukan berkanun, dan rule set mana mereka ikut.</p>
''' + figure('08-employees', 'Senarai pekerja. Titik menunjukkan apa yang masih tiada.') + step(1, 'Butiran asas dan gaji', '''
<p><strong>Add employee</strong>, kemudian nama, nombor pekerja, jawatan, jenis pekerjaan, tarikh mula,
tarikh lahir.</p>
<p>Kemudian tab <strong>Employment &amp; salary</strong>, dan di situ <strong>gaji bulanan</strong> dengan
tarikh berkuat kuasa dan sebab.</p>
<p><em>Apa yang sepatutnya berlaku:</em> gaji disimpan sebagai rekod bertarikh. Kenaikan gaji
kemudian tidak memadam gaji lama — bulan lepas kekal betul.</p>
'''), '', '', ''))
SECTIONS[-1] = ('2', 'Tambah pekerja', SECTIONS[-1][2] + step(2, 'Tab Statutory', '''
<p>Ini yang menentukan potongan. Tekan <strong>Record a change</strong>.</p>
<ul>
<li><strong>EPF Third Schedule part</strong> — warganegara, PR, atau bukan warganegara.</li>
<li><strong>EPF employee share</strong> — <strong>11% (lalai)</strong> atau <strong>9%</strong> kalau
pekerja memilih kadar yang dikurangkan. Ini pilihan pekerja, bukan klinik.</li>
<li><strong>LINDUNG 24 JAM (SKBBK)</strong> — <strong>Enrolled ialah lalai</strong>. Setiap
pekerja mencarum kecuali mereka opt out melalui borang PERKESO sendiri. Pilih
<strong>Opted out</strong> hanya kalau borang itu benar-benar sudah diisi.</li>
<li><strong>MTD category</strong> — Kategori 1 (bujang), 2 (berkahwin, pasangan tidak bekerja),
atau 3 (berkahwin, pasangan bekerja), dan bilangan anak layak.</li>
<li><strong>Rest day</strong> — hari rehat yang majikan tetapkan. Bukan hari klinik tutup.</li>
</ul>
''') + figure('09-employee-statutory', 'Tab Statutory. LINDUNG 24 JAM menunjukkan <em>Enrolled</em> — itu lalai baharu.') + block('Tanpa <strong>tarikh lahir</strong>, Kuwick tidak akan mengira EPF, SOCSO atau EIS langsung. Sebab: pada umur 60 skim bertukar — EPF pekerja jadi sifar, SOCSO ke Kategori Kedua, EIS berhenti. Menganggap "di bawah 60" akan kurang mencarum untuk seluruh pekerja dan tiada siapa akan nampak.') + block('Tanpa <strong>rest day</strong>, hari yang bekerja pada hari rehat tidak boleh dihargai. Kuwick akan menyekat run itu.') + note('<strong>EPF contribution basis.</strong> Di bawah tab yang sama. Ini menetapkan atas gaji <em>mana</em> EPF dicarum — contohnya gaji pokok sahaja. Kuwick akan menunjukkan amaran (bukan halangan) kalau pilihan itu lebih rendah daripada gaji yang ia nilai sebagai layak EPF.'))

# ---------------------------------------------------------------- 3
SECTIONS.append(('3', 'Roster — tetapkan syif', '''
<p>Buka <strong>HR › Attendance › Roster</strong>. Tetapkan syif untuk setiap pekerja
untuk minggu atau bulan.</p>
<p><em>Kenapa ini dahulu:</em> kehadiran dinilai terhadap syif. Tanpa syif, Kuwick tidak
tahu apa itu "lewat" atau apa itu "masa lebih".</p>
''' + figure('10-roster', 'Roster. Syif menentukan apa yang dikira lewat dan apa yang dikira OT.')))

# ---------------------------------------------------------------- 4
SECTIONS.append(('4', 'Kehadiran — punch, timesheet, betulkan, luluskan OT', '''
''' + step(1, 'Pekerja punch dari telefon', '''
<p>Pekerja buka <strong>/my</strong> di telefon dan tekan <strong>Clock in</strong>.</p>
<p>Kali pertama, skrin meminta kebenaran untuk foto. Selepas <strong>I agree</strong>, setiap
punch mengambil selfie dan lokasi.</p>
<p><em>Apa yang sepatutnya berlaku:</em> mesej <em>Clocked in</em>; butang bertukar
<strong>Clock out</strong>. Kalau telefon lebih 150 m dari titik klinik, chip emas
<em>Outside clinic · N m away</em> — punch <strong>tetap direkod</strong>, tidak ditolak.</p>
''') + figure('27-portal-attendance', 'Kehadiran dalam portal pekerja.') + step(2, 'Timesheet dan laci Fix', '''
<p>Buka <strong>HR › Attendance</strong>. Timesheet menunjukkan setiap hari, masa masuk dan
keluar, thumbnail selfie, dan chip kalau di luar radius.</p>
<p>Kalau ada punch yang salah — terlupa clock out, punch berganda — tekan
<strong>Fix</strong> pada baris itu. Rekod asal <strong>kekal</strong>; pembetulan ditambah
di atasnya dengan nama awak dan sebab.</p>
''') + step(3, 'Luluskan OT', '''
<p>Pada baris yang ada masa lebih, tekan <strong>Pending · approve</strong>.</p>
''') + figure('11-attendance', 'Timesheet. OT menunggu kelulusan sebelum ia masuk payroll.') + block('<strong>Masa lebih tidak akan dibayar sehingga diluluskan.</strong> Tiada tetapan untuk mematikan ini. Membayar masa lebih yang tiada sesiapa bersetuju bukan sesuatu yang klinik patut boleh hidupkan secara tidak sengaja. Orang yang meluluskan mesti bukan orang yang menuntut — dan di sini <strong>tiada pengecualian pemilik</strong>. Berbeza dengan kelulusan payroll, pemilik akaun pun tidak boleh meluluskan masa lebih dirinya sendiri.')))

# ---------------------------------------------------------------- 5
SECTIONS.append(('5', 'Cuti — mohon, luluskan, kesan pada payroll', '''
''' + step(1, 'Pekerja mohon dari portal', '''
<p><strong>/my/leave</strong>, pilih jenis, tarikh dari dan hingga, kemudian <strong>Submit request</strong>.</p>
<p><em>Sebelum hantar</em>, jalur pratonton menunjukkan: <em>3 days · Balance after: 11 of 14</em>,
dan nama rakan sekerja yang cuti hari sama dalam warna emas.</p>
''') + figure('25-portal-leave', 'Permohonan cuti dari portal, dengan baki selepas dan siapa lagi cuti.') + block('Untuk <strong>cuti sakit</strong>, butang Submit kekal kelabu sehingga MC dilampirkan — kalau polisi cuti klinik awak menetapkan lampiran wajib. Butang itu juga kelabu kalau tarikh yang dipilih <strong>bertindih dengan cuti pekerja itu sendiri</strong> yang sudah ada, atau kalau tarikh tamat jatuh sebelum tarikh mula.') + step(2, 'Manager luluskan', '''
<p><strong>HR › Leave</strong>, kemudian <strong>Review</strong> pada permohonan itu.</p>
<p>Laci keputusan menunjukkan: jenis, tarikh, <em>Balance after</em>, siapa lagi cuti, lampiran
MC, dan kesan pada payroll. Tekan <strong>Approve</strong> atau <strong>Reject</strong>.</p>
''') + figure('13-leave-admin', 'Skrin cuti. Tab Requests, Calendar dan Balances.') + block('<strong>Reject memerlukan nota.</strong> Butang menolak sehingga nota diisi — pekerja akan membacanya.') + note('''<strong>Baki dan carry forward.</strong> Tab <strong>Balances</strong> menunjukkan kelayakan,
dibawa masuk, diambil dan baki untuk setiap pekerja. Had carry forward ditetapkan pada polisi
cuti. <strong>Tiada rollover automatik hujung tahun</strong> — hari dibawa masuk melalui pelarasan
baki yang ditaip seseorang, dan had itu mengikat taipan itu.''')))

# ---------------------------------------------------------------- 6
SECTIONS.append(('6', 'Tuntutan — hantar dengan resit, luluskan', '''
''' + step(1, 'Pekerja hantar', '''
<p><strong>/my/claims</strong>, isikan jenis dan butiran, <strong>lampirkan foto resit</strong>, kemudian
<strong>Submit claim</strong>.</p>
<p>Untuk mileage: pilih dari dan ke, masukkan jarak. Amaun dikira sendiri —
<em>RM 25.20 · 42 × RM 0.60</em> — daripada kadar dalam Settings.</p>
''') + figure('26-portal-claims', 'Tuntutan dari portal. Amaun dikira daripada jarak × kadar.') + block('Butang Submit kekal kelabu sehingga <strong>resit dilampirkan</strong>, kalau polisi tuntutan menetapkannya.') + step(2, 'Manager luluskan', '''
<p><strong>HR › Claims</strong>, kemudian <strong>Review</strong>. Resit dipaparkan dalam laci, bukan
nama fail sahaja. Kadar yang dibekukan pada tuntutan itu ditunjukkan.</p>
<p>Tekan <strong>Approve RM 25.20</strong>, atau tukar amaun.</p>
''') + figure('15-claims-admin', 'Skrin tuntutan. Resit dipaparkan dalam laci semakan.') + block('Kalau awak <strong>tukar amaun</strong>, butang menolak sehingga nota diisi. Amaun yang berbeza daripada yang dituntut mesti ada sebabnya. Dan awak <strong>tidak boleh meluluskan lebih daripada yang dituntut</strong> — hanya sama atau kurang.')))

# ---------------------------------------------------------------- 7
SECTIONS.append(('7', 'Payroll — cipta, kira, betulkan, luluskan', '''
<p>Satu run satu bulan. Empat langkah: <strong>Prepare · Review · Approve · Pay</strong>.</p>
''' + figure('17-payroll-month', 'Bulan payroll sebelum dimulakan. Kuwick sudah tahu siapa yang akan menghalang.') + step(1, 'Mulakan bulan', '''
<p><strong>HR › Payroll</strong>, pilih bulan, kemudian <strong>Start [bulan] payroll</strong>.</p>
<p>Kuwick mengira setiap payslip daripada kehadiran, cuti, tuntutan, item berulang dan
insentif yang sudah diluluskan.</p>
''') + step(2, 'Prepare — betulkan baris', '''
<p>Grid menunjukkan satu baris setiap pekerja. <strong>Sel kelabu</strong> datang daripada rekod
atau dikira untuk awak; <strong>sel putih</strong> boleh awak ubah.</p>
<p>Tekan <strong>Edit</strong> pada satu baris, isi apa yang perlu, kemudian
<strong>Save draft</strong>.</p>
<p><em>Apa yang sepatutnya berlaku:</em> baris itu <strong>dikira semula serta-merta</strong> —
EPF, SOCSO, EIS dan PCB berubah mengikut. Kaki jadual menamakan siapa yang masih disekat.</p>
''' + note('<strong>Save draft ialah butang yang mengira.</strong> Ia bukan sekadar menyimpan — ia menjalankan semula enjin untuk baris itu.')) + block('''Kuwick akan <strong>menyekat</strong> bulan itu untuk sebab seperti ini, dan setiap satu
menamakan orangnya:
<ul>
<li><strong>Monthly tax (PCB) information</strong> — kedudukan cukai belum direkod</li>
<li><strong>EPF, SOCSO and EIS</strong> — kedudukan berkanun belum direkod</li>
<li><strong>Salary</strong> — tiada gaji berkuat kuasa untuk bulan itu</li>
<li><strong>Pay history for the year</strong> — tiada baki tahun-ke-tarikh untuk klinik yang
bermula pertengahan tahun</li>
</ul>
Tekan <strong>Complete setup</strong> di sebelah nama itu. <strong>Continue to review</strong>
kekal mati sehingga tiada lagi yang disekat.''') + step(3, 'Review', '''
<p>Semak blockers dan warnings. Warning boleh ditanda <strong>Checked</strong> dengan sebab —
itu rekod bahawa manusia melihatnya, bukan cara untuk menyembunyikannya.</p>
''') + step(4, 'Approve', '''
<p>Baca kenyataan, tekan <strong>Approve</strong>. Run dikunci.</p>
''') + block('<strong>Payroll mesti diluluskan oleh orang lain daripada orang yang menjalankannya.</strong> Itu lalai Kuwick. Tetapi ada satu pengecualian yang sengaja dibiarkan hidup: <strong>pemilik akaun dibenarkan meluluskan run sendiri</strong>, kerana dalam klinik seorang doktor memang tiada orang lain. Setiap kelulusan yang menggunakan pengecualian itu <em>ditanda</em> — ia tidak senyap. Kalau awak mahu lebih ketat, tukar peraturan pada skrin Payroll policies: satu kelulusan oleh sesiapa, satu kelulusan oleh orang lain, atau dua kelulusan oleh dua orang berlainan.')))

# ---------------------------------------------------------------- 8
SECTIONS.append(('8', 'Bayar', '''
''' + step(1, 'Sediakan senarai bayaran', '''
<p>Langkah <strong>Pay</strong>, kemudian <strong>Prepare payment listing</strong>, dan muat turun CSV
untuk bank.</p>
''') + step(2, 'Rekod pemindahan', '''
<p>Selepas bank selesai, tekan <strong>Record paid</strong> dengan tarikh dan rujukan bank.</p>
<p><em>Apa yang sepatutnya berlaku:</em> status bertukar <strong>Paid</strong>. Tuntutan yang
dibayar bersama gaji juga bertukar <em>Paid</em>.</p>
''') + block('<strong>Payslip PDF tidak muncul untuk pekerja sehingga run ditanda Paid.</strong> Sebab: payslip ialah rekod apa yang <em>dibayar</em>, bukan apa yang dicadangkan.') + figure('21-payroll-history', 'Sejarah payroll. Bulan yang sudah dibayar kekal di sini.')))

# ---------------------------------------------------------------- 9
SECTIONS.append(('9', 'Payslip dan portal staf', '''
<p>Selepas bulan ditanda Paid, pekerja melihatnya sendiri.</p>
''' + figure('23-portal-home', 'Portal pekerja. Kad payslip terkini, cuti, tuntutan.') + figure('24-portal-payslips', 'Senarai payslip. PDF boleh dimuat turun.') + step(1, 'Pekerja muat turun', '''
<p><strong>/my/payslips</strong>, kemudian <strong>Download PDF</strong>.</p>
<p>Angka pada PDF sama dengan yang awak lihat di
<strong>HR › Payroll › [bulan] › [pekerja]</strong>.</p>
''') + step(2, 'Laporan kerajaan', '''
<p><strong>HR › Reports</strong> menjana borang: EPF Borang A, SOCSO &amp; EIS 8A, PCB CP39,
HRD, EA, Borang E.</p>
''') + figure('22-reports', 'Perpustakaan laporan. Borang kerajaan dan laporan payroll.')))

# ---------------------------------------------------------------- 10
SECTIONS.append(('10', 'Bila staf berhenti', '''
<p>Masukkan <strong>tarikh akhir</strong> pada rekod pekerja (tab Employment &amp; salary).</p>
<p>Pada bulan tarikh akhir itu, dua perkara berlaku sendiri:</p>
<ol>
<li><strong>Bulan akhir diprorata</strong> kepada hari yang benar-benar bekerja, termasuk hari
terakhir. Seksyen 18A: gaji bulanan dibahagi hari sebenar dalam bulan itu.</li>
<li><strong>Cuti tahunan yang tidak habis dinamakan</strong> dengan jumlahnya.</li>
</ol>
''' + note('''<strong>Seksyen 60E(3) terpakai untuk peletakan jawatan juga.</strong> Akta berkata
"mana-mana pihak" menamatkan kontrak — jadi staf yang berhenti sendiri pun berhak. Kuwick
mengira hari yang tinggal, memprorata tahun akhir mengikut bulan lengkap, dan menilai pada
kadar biasa (gaji bulanan ÷ 26).''') + '''
<p><strong>Apa yang awak perlu buat:</strong></p>
<ul>
<li>Kalau polisi cuti awak <strong>membayar</strong> — Kuwick menyebut jumlahnya dan awak
masukkannya sebagai payroll input <em>Untaken annual leave paid out</em>. Ia tidak
ditambah sendiri, kerana payslip akhir ialah satu-satunya yang pekerja tidak akan dapat
peluang kedua untuk pertikaikan.</li>
<li>Kalau polisi awak <strong>tidak membayar</strong> — Kuwick memberi amaran dengan jumlah
yang tidak dibayar dan nama polisinya. Tiada apa perlu dibuat untuk menyelesaikan bulan itu.</li>
<li>Kalau pekerja itu <strong>tiada polisi cuti</strong> — bulan itu <strong>disekat</strong>,
kerana tanpa polisi Kuwick tidak tahu sama ada klinik ini membayarnya atau tidak.</li>
</ul>
'''))

DECISIONS = '''
<table class="dec">
<thead><tr><th>Keputusan</th><th>Apa yang awak pilih</th><th>Kenapa</th></tr></thead>
<tbody>
<tr><td><strong>EPF atas gaji apa</strong></td><td>Gaji pokok sahaja</td>
<td>Dasar klinik. Kuwick menyimpannya sebagai pilihan bertarikh dan memberi amaran (bukan halangan)
bahawa ia di bawah gaji yang dinilai layak EPF — supaya pilihan itu kelihatan, bukan tersembunyi.</td></tr>
<tr><td><strong>Cuti tahunan tidak habis</strong></td><td>Dibayar apabila pekerja berhenti</td>
<td>Seksyen 60E(3), dan ia terpakai untuk peletakan jawatan juga kerana Akta berkata "mana-mana pihak".
Lalai produk ialah BAYAR. Klinik boleh memilih tidak bayar, tetapi mesti mengesahkan dengan sebab bertulis.</td></tr>
<tr><td><strong>Anggaran PCB Sep–Dis</strong></td><td>Pendapatan biasa bulan semasa (lalai)</td>
<td>Bacaan paling harfiah spesifikasi LHDN, yang menyebut Y2 sebagai "anggaran seperti Y1". Dua pilihan
lain ada kalau klinik mahu menahan kurang setiap bulan. Tiada satu pun mengubah jumlah cukai setahun.</td></tr>
<tr><td><strong>Pengganda OT</strong></td><td>Akta: 1.5× biasa · 2× hari rehat · 3× cuti umum</td>
<td>Ini lantai, bukan siling. Klinik boleh menetapkan lebih tinggi. Kalau menetapkan lebih rendah,
Kuwick akan menyimpannya tetapi menuntut pengesahan bertulis dan menandanya kekal pada skrin.</td></tr>
<tr><td><strong>SKBBK (Lindung 24 Jam)</strong></td><td>Auto-daftar; opt out per pekerja</td>
<td>Skim PERKESO mendaftar semua orang secara automatik; keluar memerlukan borang. Lalai Kuwick dahulu
terbalik dan kurang memotong daripada sesiapa yang tiada rekod.</td></tr>
<tr><td><strong>Komisen dan elaun dalam gaji SOCSO/EIS</strong></td><td>Termasuk</td>
<td>Takrif gaji PERKESO merangkuminya. Payroll lama klinik meninggalkannya keluar dan kurang mencarum.</td></tr>
<tr><td><strong>Waktu rehat</strong></td><td>Ditolak melalui punch</td>
<td>Staf clock out untuk rehat dan clock in balik, jadi ia sudah di luar jam bekerja. Potongan rata
akan mengira dua kali, jadi tiada medan untuknya.</td></tr>
<tr><td><strong>Kelulusan OT</strong></td><td>Sentiasa diperlukan</td>
<td>Tiada suis. Membayar masa lebih yang tiada sesiapa bersetuju bukan sesuatu yang patut boleh
dihidupkan secara tidak sengaja.</td></tr>
<tr><td><strong>Locum luar</strong></td><td>Dibayar melalui PV, bukan payroll</td>
<td>Kontraktor, bukan pekerja. Kuwick mengecualikan mereka daripada payroll dan tiada payslip.</td></tr>
</tbody></table>
'''

body = []
for num, title, content in SECTIONS:
    body.append(f'<section class="flow"><h2><span class="fnum">{num}</span>{html.escape(title)}</h2>{content}</section>')

HTML = f'''<!doctype html>
<html lang="ms"><head><meta charset="utf-8">
<title>Panduan HR Kuwick</title>
<style>
@page {{ size: A4; margin: 14mm 12mm 16mm; }}
* {{ box-sizing: border-box; }}
body {{ font-family: "DejaVu Sans", Arial, sans-serif; color: #17202a; font-size: 10.5pt; line-height: 1.55; margin: 0; }}
h1 {{ font-size: 26pt; margin: 0 0 6pt; letter-spacing: -0.5pt; }}
h2 {{ font-size: 16pt; margin: 0 0 10pt; padding-bottom: 6pt; border-bottom: 2px solid #0f5132; display: flex; align-items: center; gap: 10pt; }}
h4 {{ font-size: 11pt; margin: 0 0 4pt; }}
p {{ margin: 0 0 7pt; }}
ul, ol {{ margin: 0 0 7pt; padding-left: 16pt; }}
li {{ margin-bottom: 3pt; }}
.fnum {{ background: #0f5132; color: #fff; width: 26pt; height: 26pt; border-radius: 50%; display: inline-flex;
  align-items: center; justify-content: center; font-size: 13pt; flex: none; }}
.cover {{ page-break-after: always; padding-top: 55mm; }}
.cover .sub {{ font-size: 13pt; color: #52606d; margin-bottom: 26pt; }}
.cover .meta {{ font-size: 9.5pt; color: #52606d; border-top: 1px solid #d3d9de; padding-top: 10pt; }}
.flow {{ page-break-before: always; }}
.step {{ display: flex; gap: 9pt; margin: 0 0 10pt; page-break-inside: avoid; }}
.stepno {{ background: #e7f0ec; color: #0f5132; width: 19pt; height: 19pt; border-radius: 50%; display: flex;
  align-items: center; justify-content: center; font-weight: 700; font-size: 9.5pt; flex: none; margin-top: 1pt; }}
.stepbody {{ flex: 1; }}
.block {{ border-left: 3px solid #b42318; background: #fef3f2; padding: 7pt 10pt; margin: 0 0 10pt;
  page-break-inside: avoid; font-size: 10pt; }}
.block strong:first-child {{ color: #b42318; display: block; margin-bottom: 3pt; }}
.block p {{ margin: 0; }}
.note {{ border-left: 3px solid #b5730a; background: #fffaeb; padding: 7pt 10pt; margin: 0 0 10pt;
  page-break-inside: avoid; font-size: 10pt; }}
figure.pair {{ margin: 0 0 13pt; }}
.shot {{ page-break-inside: avoid; }}
.shot img {{ width: 100%; border: 1px solid #d3d9de; border-radius: 3pt; display: block; }}
.shot.desk {{ width: 100%; }}
.foot {{ display: flex; gap: 11pt; align-items: flex-start; margin-top: 7pt; page-break-inside: avoid; }}
.shot.ph {{ flex: 0 0 23%; }}
.cap {{ font-size: 7.5pt; color: #7b8794; text-align: center; margin-top: 2pt; }}
figcaption {{ font-size: 8.5pt; color: #52606d; margin: 0; font-style: italic; flex: 1 1 auto; }}
table.dec {{ width: 100%; border-collapse: collapse; font-size: 9pt; }}
table.dec th, table.dec td {{ border: 1px solid #d3d9de; padding: 5pt 6pt; text-align: left; vertical-align: top; }}
table.dec th {{ background: #e7f0ec; }}
table.dec td:first-child {{ width: 20%; }}
table.dec td:nth-child(2) {{ width: 26%; }}
.legend {{ font-size: 9.5pt; }}
.legend .block, .legend .note {{ margin-bottom: 6pt; }}
</style></head>
<body>

<div class="cover">
  <h1>Panduan HR Kuwick</h1>
  <div class="sub">Menguji dan menggunakan HR dan payroll, hujung ke hujung —<br>dengan skrin sebenar pada komputer dan telefon</div>
  <p>Panduan ini mengikut urutan sebenar yang sebuah klinik baru akan lalui: sediakan klinik,
  tambah pekerja, roster, kehadiran, cuti, tuntutan, payroll, bayar, payslip, dan apa yang
  berlaku bila seseorang berhenti.</p>
  <p>Setiap langkah memberitahu <strong>butang mana ditekan</strong>, <strong>apa yang
  sepatutnya berlaku</strong>, dan — dalam kotak merah — <strong>di mana sistem akan
  menghalang awak dan kenapa</strong>.</p>
  <div class="legend">
    <div class="block"><strong>Kotak merah</strong><p>Sistem akan menghalang. Ini bukan pepijat — ia halangan yang disengajakan, dan sebabnya diberikan.</p></div>
    <div class="note"><strong>Kotak kuning</strong> — perkara yang senang tersalah faham, atau keputusan dasar yang awak sudah buat.</div>
  </div>
  <div class="meta">
    Semua skrin dalam panduan ini ialah gambar sebenar daripada Kuwick, bukan lukisan.<br>
    Data yang kelihatan ialah dunia ujian <em>Klinik Contoh (UAT)</em> — nama rekaan, angka rekaan.<br>
    Disediakan 16 September 2026.
  </div>
</div>

<section class="flow">
  <h2><span class="fnum">0</span>Sebelum awak mula</h2>
  <p>Panduan ini memandu awak melalui <strong>dunia ujian</strong> yang sudah disediakan &mdash;
  Klinik Contoh (UAT). Semua nama, gaji dan nombor di dalamnya rekaan. Tiada pekerja sebenar,
  tiada nombor KWSP atau PERKESO sebenar, tiada resit sebenar. Awak boleh menekan apa sahaja.</p>
  <p>Buka web Kuwick, kemudian log masuk. <strong>Kata laluan semua akaun ujian ini ialah
  <code>AdminUat!2026</code>.</strong></p>
  <table class="dec">
    <thead><tr><th>Peranan</th><th>Log masuk</th><th>Siapa, dan bila awak gunakannya</th></tr></thead>
    <tbody>
      <tr><td><strong>Pemilik</strong></td><td>owner@admin-uat.kuwick.invalid</td>
        <td>Dr Aisyah Rahman. Settings, jalankan dan luluskan payroll. Guna akaun ini untuk
        bahagian 1, 2, 7 dan 8.</td></tr>
      <tr><td><strong>Clinic manager</strong></td><td>manager@admin-uat.kuwick.invalid</td>
        <td>Rohana Yusof. Luluskan cuti, tuntutan dan masa lebih. Guna akaun ini untuk bahagian
        4, 5 dan 6 &mdash; kerana orang yang meluluskan mesti bukan orang yang menuntut.</td></tr>
      <tr><td><strong>Doktor (portal)</strong></td><td>resident@admin-uat.kuwick.invalid</td>
        <td>Dr Meera Kaur, RM9,500. Guna akaun ini untuk melihat sisi pekerja: mohon cuti, hantar
        tuntutan, punch, muat turun payslip.</td></tr>
      <tr><td><strong>Jururawat (portal)</strong></td><td>nurse@admin-uat.kuwick.invalid</td>
        <td>Puteri Balqis, RM3,400.</td></tr>
      <tr><td><strong>Staf &le; RM4,000 (portal)</strong></td><td>stock@admin-uat.kuwick.invalid</td>
        <td>Hafiz Osman, RM2,900. Dia berada dalam Jadual Pertama Akta Kerja &mdash; berguna untuk
        menguji kadar masa lebih berkanun.</td></tr>
    </tbody>
  </table>
  <div class="note"><strong>Dua akaun, dua tetingkap.</strong> Cara paling cepat menguji ialah
  buka Kuwick dalam dua tetingkap pelayar: satu log masuk sebagai pemilik atau manager, satu
  lagi dalam tetingkap peribadi sebagai pekerja portal. Begitu awak boleh menghantar permohonan
  dan meluluskannya tanpa log keluar setiap kali.</div>
</section>

{''.join(body)}

<section class="flow">
  <h2><span class="fnum">✓</span>Keputusan dasar yang awak sudah buat</h2>
  <p>Ini supaya awak ingat apa yang awak pilih dan kenapa — dan supaya sesiapa yang membuka
  Settings kemudian tidak menukarnya tanpa tahu sebabnya.</p>
  {DECISIONS}
</section>

</body></html>'''

open('panduan.html', 'w').write(HTML)
print(f'panduan.html {len(HTML)} bytes')
