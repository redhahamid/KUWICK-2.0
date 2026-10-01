# Panduan pengguna HR & Payroll Kuwick

Untuk pemilik klinik. Anda tidak perlu tahu apa-apa tentang HR atau komputer
untuk guna panduan ini. Setiap nama butang dan setiap tajuk medan ditulis
**persis seperti yang terpapar pada skrin** — skrin Kuwick berbahasa Inggeris,
jadi perkataan Inggeris dalam panduan ini ialah perkataan yang anda akan cari.

Ada dua pintu masuk:

| Siapa | Ke mana | Apa yang mereka nampak |
|---|---|---|
| Anda dan penyelia | **Administration ▸ HR** | Semua pekerja, kehadiran, cuti, tuntutan, gaji, laporan |
| Setiap pekerja | **My Kuwick** | Diri mereka sendiri sahaja: slip gaji, cuti, tuntutan, jam masuk |

Di sebelah kiri HR ada enam menu: **Employees · Payroll · Attendance · Leave ·
Claims · Reports**. **Settings** diletak berasingan di bawah sekali, sebab ia
diset sekali sahaja dan jarang dibuka.

---

## 1. Kitaran sebulan, dalam 10 baris

1. **Pekerja tekan Clock in** di My Kuwick bila sampai klinik — dengan selfie
   dan lokasi telefon kalau mereka benarkan. Tekan **Clock out** bila balik.
2. **Kuwick kira sendiri** lewat berapa minit, balik awal berapa minit, jumlah
   jam, dan berapa jam lebih masa — mengikut peraturan yang anda set.
3. **Penyelia buka Attendance setiap pagi**, tengok siapa lewat dan siapa
   tak clock out semalam, dan tekan **Fix** untuk betulkan yang patut.
4. **Lebih masa tidak dibayar sehingga diluluskan.** Penyelia tekan
   **Pending · approve** pada lajur **OT status** hari itu.
5. **Pekerja mohon cuti dari My Kuwick.** Penyelia buka **Leave**, tekan baris
   itu, dan tekan **Approve** atau **Reject** di dalam laci yang terbuka.
6. **Pekerja hantar tuntutan dengan resit** dari My Kuwick. Penyelia buka
   **Claims**, tengok resit, dan luluskan — sepenuhnya atau jumlah lain.
7. **Hujung bulan, buka Payroll** dan tekan **Start [bulan] payroll**. Kuwick
   tarik masuk gaji, lebih masa yang diluluskan, cuti tanpa gaji, tuntutan,
   elaun bulanan dan insentif.
8. **Tahap Review** memberitahu apa yang menghalang. Apa-apa bertanda
   **Blocked** mesti dibetulkan dahulu; **Needs attention** hanya perlu
   dipandang.
9. **Tahap Approve** mengunci bulan itu. Selepas ini angka tidak boleh berubah
   lagi tanpa membuka semula run.
10. **Tahap Pay**: muat turun senarai bank, bayar di portal bank anda sendiri,
    rekod ia sudah dibayar — dan slip gaji terus muncul di My Kuwick pekerja.

---

## 2. Settings — skrin demi skrin

Buka **Administration ▸ HR ▸ Settings**. Halaman pertama menunjukkan kiraan
seperti *3 to go* di sebelah **Before the first live payroll**: itu senarai
perkara yang Kuwick halang gaji sebenar sehingga selesai.

### 2.1 Company & statutory

**Apa gunanya.** Syarikat yang *menggaji*, yang *menghantar borang*, dan yang
*membayar*. Cawangan bukan majikan — cawangan tempat kerja berlaku, ia tidak
menghantar apa-apa borang. Tanpa satu baris di sini, tiada apa boleh difailkan
dan tiada gaji boleh dibayar.

Tekan **+ New employer**, atau **Edit** pada baris sedia ada.

| Medan | Maksudnya dalam bahasa harian | Contoh | Kalau salah / kosong |
|---|---|---|---|
| **Registered name** | Nama syarikat seperti dalam sijil SSM, bukan nama papan tanda klinik | `Klinik Sihat Sdn Bhd` | Nama salah akan keluar atas slip gaji dan atas semua borang |
| **Company registration number** | Nombor pendaftaran SSM | `202301012345 (1234567-A)` | Tidak menghalang gaji, tapi borang jadi tidak lengkap |
| **EPF employer number** | Nombor majikan KWSP anda | `E1234567890` | Lajur **Could it file?** akan tunjuk **1 missing**; senarai EPF tidak boleh dihantar |
| **SOCSO employer code** | Kod majikan PERKESO | `B1234567890` | Sama — senarai PERKESO tidak boleh dihantar |
| **LHDN employer number (E)** | Nombor majikan LHDN (nombor E) | `E 1234567890` | CP39 / e-PCB tidak boleh dihantar |
| **Address**, **City**, **State** | Alamat berdaftar syarikat | `12 Jalan Melur` · `Shah Alam` · `Selangor` | Keluar atas slip gaji |
| **Bank**, **Bank account number**, **Account name** | Akaun bank syarikat yang membayar gaji | `Maybank` · `512345678901` | Senarai pembayaran bank tidak lengkap |

Lajur **Could it file?** ialah pemeriksaan ringkas: **Complete** bermakna semua
nombor majikan ada. Kalau tidak, ia tulis berapa yang hilang dan yang mana.

Lajur **Active employees** mengira orang yang masih bekerja dengan syarikat itu
sahaja — yang sudah berhenti atau ditamatkan tidak dikira. Pilih cawangan pada
pemilih cawangan di atas dan lajur itu bertukar kepada **Active at <cawangan>**,
mengira cawangan itu sahaja.

**Mendaftarkan syarikat di sini tidak mengikat sesiapa kepadanya.** Setiap
pekerja perlu diberitahu syarikat mana yang menggajinya, seorang demi seorang:
buka rekod pekerja · tab **Employment & salary** · **Edit** · medan **Employed
by**. Tanpa itu, payroll akan menolak orang itu dengan *No employing company
is recorded*, dan penolakan itu tidak boleh dilepasi. Kuwick menghalangnya
sebab KWSP, PERKESO dan cukai semuanya difailkan atas nama syarikat, bukan
atas nama cawangan.

Menukar syarikat pekerja akan **ditolak** kalau orang itu sudah ada pada run
gaji yang diluluskan — caruman mereka sudah dilaporkan atas nama syarikat lama,
dan menukarnya sekarang akan membuat borang dan rekod bercanggah. Rekodkan
perubahan itu bermula dari bulan yang belum diluluskan.

**Butang HRD class.** Hanya untuk klinik yang berdaftar dengan HRD Corp.
Pilih **In force from** (bulan ia mula berkuat kuasa), kemudian **Registration
class**: *Registered — s.14 mandatory (1%)*, *Registered — s.15 optional
(0.5%)*, atau *Not registered*. **Kadar tidak pernah ditaip** — 1% dan 0.5%
itu angka Akta PSMB sendiri. Kalau anda tidak berdaftar dan biar ia *Not
recorded*, levi pada slip gaji jadi amaran, bukan angka.

> **Klinik kecil biasa:** satu baris sahaja di sini. Anda perlukan lebih dari
> satu hanya kalau ada dua Sdn Bhd berasingan yang masing-masing menggaji
> orang.

Lajur **HRD Corp** menunjukkan kelas yang direkodkan **dan tarikh ia berkuat
kuasa** (*Registered — s.14 mandatory (1%) · from 1 Sep 2026*). Kelas itu
hanya menyentuh bulan gaji dari tarikh itu: bulan yang sudah *Approved* atau
*Paid* sebelum tarikh itu kekal seperti ia diluluskan, dan grid gaji bulan itu
menunjukkan **—** pada *HRD levy* dengan sebabnya (lihat 3.5). Syarikat tanpa
kelas HRD disenaraikan *missing* di bawah **Could it file?**.

**Satu cawangan dipilih** pada pemilih cawangan: syarikat yang **tiada
pekerja aktif** di cawangan itu dilipat di bawah satu baris *Show other
employers (no staff here) · N* — tekan untuk membukanya (barisnya dipudarkan).
Di bawah *All branches* semua syarikat disenaraikan seperti biasa.

### 2.2 Payroll items

**Apa gunanya.** Senarai perkara yang klinik boleh bayar atau potong — gaji
pokok, elaun, lebih masa, potongan — dan **apa setiap satu dikira untuk**.

Kalau senarai kosong, tekan **Seed the catalogue** sekali. Kuwick akan isikan
set standard Malaysia, semua tanda belum disemak.

Setiap baris ada lapan suis:

| Suis | Soalan yang ia jawab | Jawapan biasa |
|---|---|---|
| **EPF** | Adakah item ini dikira untuk caruman KWSP? | Gaji pokok **ya**; elaun perjalanan **tidak** |
| **SOCSO** | Dikira untuk caruman PERKESO? | Gaji pokok **ya** |
| **EIS** | Dikira untuk SIP? | Gaji pokok **ya** |
| **PCB** | Dikira untuk cukai bulanan? | Gaji pokok dan bonus **ya** |
| **HRD** | Dikira untuk levi HRD Corp? | Ikut nasihat HRD Corp anda |
| **Prorate** | Kalau pekerja masuk atau berhenti pertengahan bulan, item ini dibahagi ikut hari? | Gaji pokok **ya**; bonus satu kali **tidak** |
| **OT base** | Item ini masuk dalam kiraan kadar sejam lebih masa? | Elaun tetap selalunya **ya**, elaun tidak tetap **tidak** |
| **Unpaid-leave base** | Item ini masuk dalam kiraan potongan cuti tanpa gaji? | Ikut yang sama seperti OT base |

**Bila anda gerakkan mana-mana suis, Kuwick tanya dua soalan sebelum simpan:**
**From which month** (bulan ia mula berkuat kuasa) dan **Why**. Ini bukan
kerenah — bulan yang sudah dikira kekal dengan layanan lama, jadi mengubah
suis hari ini tidak menulis semula gaji Ogos.

**Dua suis susun atur** di hujung baris tidak minta tarikh atau sebab, kerana
ia tidak mengubah layanan berkanun — hanya cara item itu duduk pada grid gaji:

| Suis | Apa jadi | Contoh |
|---|---|---|
| **Own column** | Item itu dapat lajur sendiri pada grid gaji, antara *Basic* dan *Other income*, dan ditaip terus dalam petak | Fi pengarah, locum, insentif — item yang hampir semua orang ada setiap bulan |
| **Carry forward** | Bulan baharu bermula dengan jumlah bulan lepas bagi setiap pekerja, bertanda *Carried* sehingga diubah atau dikosongkan. Baris yang *earned in* bulan sebelumnya dibawa dengan bulan *earned in* dianjak satu (baris Januari *earned in* Disember menjadi baris Februari *earned in* Januari); bayaran lewat sekali sahaja (bulan *earned in* lain) tidak dibawa | Fi BOD, locum dan OT yang dibayar sebulan tertunggak |

**Applies to** pada baris yang sama menetapkan **untuk siapa** item itu:
*Everyone*, atau *Selected employees only* — senarai kotak semak nama (dengan
carian) yang disimpan terus tanpa tarikh atau sebab. Hanya orang dalam senarai
mendapat petak lajur item itu (orang lain nampak sengkang **—** dengan
penjelasan bila tetikus di atasnya), hanya mereka ditawarkan item itu dalam
laci *Other income*, pelayan menolak baris untuk orang lain dengan menamakan
orangnya, dan *Carry forward* menyalin untuk mereka sahaja. Baris yang sudah
ditaip untuk orang lain sebelum senarai ditetapkan tetap dibayar — dalam
*Other income*, di mana laci juga mengiranya. Item terbitan (OT, tuntutan,
PCB) tiada senarai: ia terpakai kepada sesiapa yang rekod katakan.

Kedua-duanya hanya untuk item yang ditaip tangan — bukan gaji pokok, lebih
masa, cuti tanpa gaji, tuntutan atau PCB, yang sudah ada lajur sendiri — dan
*Own column* bukan untuk potongan. Salinan dibuat sekali sahaja apabila bulan
dimulakan, bukan pada kiraan semula; bulan yang dibuang dan dimulakan semula
tidak menyalin lagi, jadi baris yang anda kosongkan tidak kembali.

Item bertanda **kunci** ialah item sistem (gaji pokok, lebih masa, potongan
berkanun). Anda boleh matikan lajur **In use**, tapi layanan berkanunnya tidak
boleh diubah di sini.

**Kalau salah set:** suis EPF yang dimatikan pada gaji pokok bermakna caruman
KWSP dikira atas jumlah yang terlalu rendah — pekerja dan klinik sama-sama
kurang caruman, dan tiada apa pada skrin akan kelihatan pelik. Semak lajur ini
sekali, perlahan-lahan, sebelum gaji pertama.

### 2.3 Payroll policies

**Apa gunanya.** Dua keputusan: **siapa boleh meluluskan gaji**, dan
**bagaimana jam lebih dan hari cuti umum dihargakan**.

#### Who can approve payroll

Tiga pilihan, pilih satu:

| Pilihan | Maksudnya | Sesuai untuk |
|---|---|---|
| **Anybody who can approve payroll** | Satu kelulusan, dan orang yang jalankan gaji boleh luluskan sendiri | Klinik satu orang buat semua |
| **Somebody other than the person who ran it** | Satu kelulusan, dari orang kedua | Dua orang kongsi kerja, anda mahu angka dipandang dua kali |
| **Two people, neither of them the one who ran it** | Dua orang berbeza mesti luluskan | Kumpulan yang layan gaji sebagai pembayaran peringkat lembaga |

Ada satu suis di bawahnya: **Account holders may approve their own runs**.
Klinik dengan satu pemegang akaun tiada orang lain untuk ditanya — biarkan
ia **hidup**. Kalau anda matikannya dalam klinik satu orang, anda boleh jadi
tiada sesiapa yang boleh bayar sesiapa.

Kalau peraturan yang anda pilih tidak boleh berkuat kuasa (contoh: anda pilih
dua orang tapi hanya seorang ada kebenaran), Kuwick tulis **This rule will not
change anything yet** dan senaraikan sebabnya. Jangan abaikan — peraturan yang
tidak berkuat kuasa lebih bahaya dari tiada peraturan, sebab anda percaya dua
orang menyemak sedangkan seorang sahaja.

#### How pay is worked out

Setiap **rule set** ialah satu cara menghargakan jam lebih untuk satu kumpulan
pekerja. Tekan **Add rule set** atau **Edit**.

| Medan | Maksudnya | Contoh |
|---|---|---|
| **Name** | Nama kumpulan | `Doctors`, `Clinical staff` |
| **Applies to** | Siapa dihargakan dengan set ini: *Everyone no other rule set covers (the default)*, satu kategori tenaga kerja, atau *Only employees assigned to it by hand* | Klinik kecil: satu set sahaja, pilih **the default** |
| **Overtime, rest days and public holidays** | **Employment Act 1955** atau **Clinic rate** | Lihat bawah |

**Employment Act 1955** bermakna Kuwick kira ikut Akta: sehari = gaji bulanan
÷ 26, sejam = sehari ÷ jam normal, lebih masa 1.5×, hari rehat 2.0×, cuti umum
3.0× dengan dua hari gaji untuk hari itu sendiri. **Ini pilihan yang betul
untuk hampir semua klinik kecil.** Anda tidak perlu taip apa-apa nombor.

**Memadam rule set.** Rule set yang bukan *Default*, tidak menetapkan harga
sesiapa hari ini, tiada siapa ditugaskan kepadanya secara manual, dan tidak
pernah dinamakan pada mana-mana baris slip gaji boleh dipadam: butang
**Delete** muncul di sebelah **Edit** pada baris begitu sahaja, dengan sebab
pilihan. Selain itu pelayan menolak dan menyatakan sebabnya — bulan yang
pernah diharga oleh rule set itu mengekalkan namanya.

**Festive holiday** ialah multiplier keempat: untuk jam melebihi jam biasa
pada cuti umum yang ditanda *Festive* dalam §2.6. Kosong = ikut angka *Public
holiday* (angka klinik jika ditetapkan, jika tidak 3× Akta). Lantai Akta sama
3×, kerana Akta hanya kenal satu jenis cuti umum. Dalam mod kadar klinik, **Per
festive holiday shift** kosong = ikut *Per public holiday shift*.

### Kalau klinik anda bayar LEBIH daripada Akta

Di bawah **What an extra hour is worth** ada tiga kotak — **Overtime**, **Rest
day**, **Public holiday**. Biar kosong, Kuwick guna angka Akta (1.5× / 2× / 3×).
Taip angka anda sendiri kalau klinik membayar lebih:

| Anda mahu | Taip |
|---|---|
| Lebih masa pada 2×, bukan 1.5× | **Overtime** `2` |
| Jam lebih pada cuti umum 4× | **Public holiday** `4` |
| Semua ikut Akta | Biar ketiga-tiga kosong |

### Kalau klinik anda membayar DI BAWAH Akta

Kuwick akan menyimpannya. Ia keputusan klinik, bukan keputusan Kuwick — tetapi
ia tidak boleh berlaku senyap. Apabila angka di bawah kadar Akta ditaip, laci
akan terus menunjukkan amaran yang menyebut:

- seksyen yang menetapkan minimum itu, dan kadar minimumnya
- berapa orang pada set peraturan ini bergaji RM4,000 ke bawah — merekalah yang
  dilindungi Akta. Kalau tiada seorang pun, Kuwick berkata begitu juga
- bahawa klinik memilih untuk membayar di bawah Akta

Untuk menyimpan, anda mesti **menanda kotak pengesahan** dan **menaip sebabnya**.
Menekan Save sahaja tidak mencukupi. Nama anda dan tarikh hari itu direkodkan.

Selepas itu:

- baris set peraturan ditanda **Below the Act** pada skrin, kekal, dengan nama
  orang yang mengesahkan dan tarikhnya
- setiap payslip mencetak kadar yang dibayar DAN kadar Akta
- setiap payroll run memberi amaran menamakan sesiapa yang dibayar kurang bulan
  itu. Ia **tidak menyekat** run — anda boleh terus bayar gaji
- kalau anda ubah angka itu lagi kemudian, Kuwick bertanya semula. Persetujuan
  untuk 1.4× bukan persetujuan untuk 1.1×

Perlindungan ini hanya untuk pekerja bergaji **RM4,000 sebulan ke bawah**
(First Schedule). Di atas itu ss.60, 60A dan 60D tidak terpakai, jadi tiada
minimum untuk dilanggar.

Angka yang **mustahil** masih ditolak: 0, negatif, atau pengganda melebihi 10.
Itu kesilapan menaip, bukan keputusan.

Tiga kotak ini menetapkan harga **JAM** yang melebihi jam normal. **Hari** itu
sendiri pada hari rehat atau cuti umum dikira dalam hari gaji ikut Akta — cuti
umum yang dikerja ialah **dua hari gaji walau berapa jam pun** (s.60D(3)(a)(i))
— dan itu bukan kotak di sini.

Kuwick belum boleh membezakan Raya daripada cuti umum biasa: senarai **Public
holidays** menyimpan tarikh dan nama sahaja, tiada penanda jenis. Satu kadar
cuti umum untuk semua tarikh buat masa ini.

**Clinic rate** bermakna anda taip amaun tetap:

| Medan | Maksudnya | Contoh |
|---|---|---|
| **Per hour of overtime** | RM sejam lebih masa | `RM25.00` |
| **Per public holiday shift** | RM satu syif cuti umum | `RM500.00` |
| **Per rest day shift** | RM satu syif hari rehat | `RM300.00` |
| **Per session** | Hari rehat atau cuti umum yang dikerja separuh jam normal ke bawah | `RM150.00` |

Kadar RM yang jatuh di bawah Akta untuk pekerja yang dilindungi mengikut
peraturan yang sama seperti pengganda di atas: disimpan dengan pengesahan,
dibayar seperti yang ditetapkan, run memberi amaran bukan sekatan.

Mana-mana kotak yang anda biar **kosong** dihargakan ikut Akta. Ini berguna:
taip kadar cuti umum sahaja, biar yang lain kosong.

**Had bawah yang tidak boleh dilanggar.** Untuk sesiapa bergaji **RM4,000 atau
kurang**, Akta ialah lantai. Skrin sendiri tunjuk angka Akta untuk gaji
RM4,000 pada 7.5 jam sehari: **RM30.77 sejam**, **RM307.69 satu cuti umum**,
**RM153.85 satu hari rehat**. Kalau kadar klinik anda di bawah itu, satu
notis emas muncul — *[nama set] pays below the Employment Act for N employees
on RM4,000 or less* — dengan nama setiap orang. **Payroll akan halang orang
yang sama itu** sehingga kadar dinaikkan atau mereka dipindah ke set yang guna
Akta.

> **Klinik kecil biasa:** satu rule set, **Employment Act 1955**, **the
> default**. Guna Clinic rate hanya kalau anda memang bayar doktor kadar syif
> tetap untuk cuti umum.

### 2.4 Memilih mod rule set: Akta, kadar tetap, atau ambang berkala

Ini keputusan yang paling kerap disalah set, jadi ia diberi bahagiannya
sendiri. Rule set ialah **cara klinik menghargakan jam lebih** untuk satu
kumpulan pekerja. Setiap pekerja dihargakan oleh satu rule set sahaja: yang
diberikan terus pada rekod mereka, atau yang untuk kumpulan mereka, atau yang
**default**.

#### Apa yang ada hari ini

Dua mod, dan anda pilih satu untuk setiap rule set.

| | **Employment Act 1955** | **Clinic rate** |
|---|---|---|
| Apa yang anda taip | Tiada apa-apa | Sehingga empat amaun |
| Hari biasa | Jam lebih diluluskan × pengganda **Overtime** (kosong = 1.5×) | Jam lebih diluluskan × **Per hour of overtime** |
| Hari rehat | Hari gaji ikut Akta, campur pengganda **Rest day** (kosong = 2.0×) untuk jam melebihi jam normal | Satu amaun **rata** untuk syif, campur kadar sejam untuk jam melebihi jam normal |
| Cuti umum | Dua hari gaji untuk hari itu, campur pengganda **Public holiday** (kosong = 3.0×) untuk jam melebihi jam normal | Satu amaun **rata** untuk syif, campur kadar sejam untuk jam melebihi jam normal |
| Kotak yang dibiar kosong | — | Dihargakan ikut Akta |
| Had bawah | Ia **ialah** had bawah | Untuk gaji RM4,000 ke bawah, Akta ialah lantai. Kadar lebih rendah akan **menghalang** run |

**Kedua-duanya membayar jam yang diluluskan sahaja.** Mod tidak mengubah itu.

#### Bila klinik patut guna yang mana

| Keadaan klinik | Pilih |
|---|---|
| Semua staf bergaji RM4,000 ke bawah, anda ikut Akta | **Employment Act 1955** |
| Anda tidak pasti | **Employment Act 1955**. Ia tidak boleh terkurang bayar sesiapa |
| Anda bayar doktor kadar syif tetap untuk cuti umum, dan yang lain ikut Akta | Dua rule set: satu **Clinic rate** untuk doktor, satu **Employment Act 1955** sebagai default |
| Doktor langsung tidak dibayar jam lebih | **Bukan rule set langsung.** Lihat nota di bawah |

**Doktor tanpa jam lebih langsung** diset pada **rekod pekerja**, bukan di
sini: tab **Statutory** ▸ **Statutory standing** ▸ **Overtime above the
Employment Act limit** ▸ **Overtime is not paid**. Jawapan itu **mengatasi**
mana-mana rule set kadar klinik yang mereka ada — tiada bayaran jam lebih
dihasilkan pada mana-mana jenis hari. Ia hanya berkuat kuasa untuk gaji
melebihi RM4,000 sebulan; di bawah itu Akta tetap terpakai.

#### Mod ketiga — ambang berkala — belum ada

Sesetengah klinik tidak mengira lebih masa harian langsung. Mereka
menetapkan **ambang jam bagi satu tempoh** — contoh 45 jam seminggu atas 6 hari
kerja — dan setiap jam melebihi ambang itu dibayar pada satu kadar sejam yang
rata, tanpa pengganda 1.5× / 2.0× / 3.0×, sama ada hari biasa, hari rehat atau
cuti umum. Bila ada cuti umum dalam tempoh itu, ambangnya turun sehari.

**Ini belum wujud dalam Kuwick.** Jangan cari mod ketiga pada skrin — hanya ada
dua. Kalau ini cara klinik anda membayar, lihat bahagian 6 untuk apa yang boleh
anda buat sementara itu.

#### Apa jadi bila rule set ditukar pertengahan bulan

Ini berbeza daripada gaji dan daripada statutory standing, dan perbezaannya
penting.

**Gaji dan statutory standing bertarikh.** Anda beritahu Kuwick dari bila ia
berkuat kuasa, dan bulan lepas kekal dengan apa yang benar ketika itu.

**Rule set TIDAK bertarikh.** Tiada medan "berkuat kuasa dari" padanya. Yang
berlaku:

| Keadaan bulan | Apa jadi bila anda tukar rule set |
|---|---|
| Belum dimulakan | Ia akan guna rule set seperti keadaan sekarang |
| Sudah dimulakan, belum diluluskan | Kira semula dan **seluruh bulan dihargakan semula** pada kadar baharu — termasuk hari sebelum anda menukarnya |
| Sudah diluluskan | Kekal dengan angka yang ia diluluskan dengannya. Laci sendiri berkata: *approved months keep the figures they were approved with* |

Yang dibekukan pada setiap run ialah **pembahagi** — bulan 26 hari, 7.5 jam
sehari, cuti tanpa gaji atas 31 hari. **Kadar klinik tidak dibekukan**; ia
dibaca semula setiap kali anda mengira.

Dua akibat praktikal:

1. **Tukar rule set antara bulan, bukan pertengahan bulan.** Kalau anda
   menaikkan kadar sejam pada 20 haribulan dan mengira semula, sembilan belas
   hari pertama bulan itu juga dibayar pada kadar baharu. Itu mungkin apa yang
   anda mahu — tetapi ia keputusan, bukan kemalangan, dan tiada apa pada skrin
   akan menyebutnya.
2. **Selepas menukar, kira semula dan baca tahap Review semula sebelum
   meluluskan.** Menukar mod kepada **Clinic rate** untuk kumpulan yang
   mengandungi sesiapa bergaji RM4,000 ke bawah boleh menimbulkan halangan
   baharu — *[nama set] pays below the Employment Act for N employees* — yang
   tidak ada sebelum anda menukarnya.

### 2.5 Attendance & leave policies

**Apa gunanya.** Apa yang dikira **lewat**, apa yang dikira **sehari penuh**,
dan apa yang tuntutan perlukan.

Di atas sekali ada **Rules for**. Pilih **The whole group (default)** untuk
peraturan semua cawangan, atau nama satu cawangan untuk peraturan khas
cawangan itu. Cip di sebelahnya tulis mana satu sedang berkuat kuasa: *this
branch*, *the group default*, atau *Kuwick's built-in default*.

#### Attendance rules

| Medan | Maksudnya dalam bahasa harian | Bawaan Kuwick | Biasa klinik kecil | Kalau salah set |
|---|---|---|---|---|
| **Late after** | Berapa minit selepas waktu syif baru dikira lewat | 5 min | 10–15 min | Terlalu kecil: separuh staf jadi "lewat" setiap hari dan lajur itu jadi bising sampai tiada orang pandang |
| **Short after** | Berapa minit sebelum habis syif yang masih tidak dikira balik awal | 5 min | 5–10 min | Terlalu besar: balik awal setengah jam pun tidak kelihatan |
| **Overtime minimum** | Masa lebih di bawah ini bukan lebih masa langsung | 30 min | 30 min | 0 bermakna tunggu 3 minit lepas syif pun jadi calon lebih masa |
| **Overtime rounds down to** | Lebih masa dibundarkan **ke bawah** kepada gandaan ini. 0 matikan pembundaran | 15 min | 15 atau 30 min | — |
| **Unpaid break** | Sepatutnya: berapa minit rehat ditolak dari syif. **Tidak berfungsi hari ini** — lihat bahagian 6 | 0 min | Biarkan `0` | Menetapkannya tidak mengubah apa-apa: bukan jam yang dipaparkan, bukan slip gaji |
| **Break applies to shifts over** | Pasangan kepada medan di atas. **Tidak berfungsi hari ini** | 360 min (6 jam) | Biarkan seperti sedia ada | Sama |
| **Longest believable shift** | Pasangan clock in / clock out lebih lama dari ini ditanda, bukan dipercayai | 16 jam | 12–16 jam | Terlalu besar: staf yang lupa clock out dikira kerja 23 jam |

**Susunan penting, dan skrin memberitahunya:** *The minimum is applied before
the rounding.* Dua belas minit atas minimum lima belas minit **bukan** lebih
masa.

Dua suis:

| Suis | Maksudnya | Cadangan |
|---|---|---|
| **Overtime must be approved** | Hidup = masa lebih perlu dipersetujui sebelum sampai ke gaji | **Biarkan hidup** |
| **Early arrival counts as extra time** | Hidup = datang awal dikira lebih masa | **Biarkan mati.** Datang awal setengah jam untuk bersiap bukan tuntutan |

#### Clock-in from the portal (geofence)

Tiga medan menentukan sama ada satu punch ditanda *outside clinic*:

| Medan | Maksudnya | Contoh |
|---|---|---|
| **Clinic latitude** | Kedudukan klinik, enam titik perpuluhan | `3.139003` |
| **Clinic longitude** | Sama | `101.686855` |
| **Counts as at the clinic within** | Jejari dalam meter yang masih dikira "di klinik" | `150` m |

Cara paling mudah: berdiri **dalam klinik**, buka skrin ini di telefon, dan
tekan **Use where this device is now**.

**Tiada punch pernah ditolak.** Punch lebih jauh dari jejari tetap disimpan
dan ditanda *outside clinic* pada timesheet untuk penyelia nilai. Telefon
tanpa lokasi clock in tanpa tanda. Biar latitude dan longitude **kosong** dan
tiada punch dinilai langsung.

Telefon jarang lebih tepat dari 30 m dalam bangunan; **150 m sesuai untuk
kebanyakan kedai lot**. Set 20 m dan staf anda akan ditanda *outside clinic*
sambil berdiri di kaunter.

Ada kotak **Why (optional)** di bawah. Tulis sebab perubahan — tahun depan
seseorang akan tertanya kenapa grace period jadi begitu.

#### Claims

| Medan | Maksudnya | Contoh | Nota |
|---|---|---|---|
| **Mileage rate** | RM sekilometer | `RM0.60` | Portal tunjuk amaun sambil pekerja taip jarak |
| **A receipt is required** | Hidup = tuntutan mesti ada lampiran | Hidup | Mati bermakna tuntutan boleh dihantar kosong dan penyelia nilai atas keterangan sahaja |

**Setiap tuntutan menyimpan kadar yang ia dihantar dengan.** Naikkan kadar
hari ini dan perjalanan semalam tetap pada kadar lama. Itu disengajakan.

### 2.6 Public holidays

**Apa gunanya.** Hari klinik tutup. Attendance dan Leave kedua-duanya baca
senarai ini.

Tekan **+ Add holiday**, isi **Date**, **Holiday name** (contoh:
`Merdeka Day`) dan **Type**: *Ordinary public holiday* atau *Festive*
(Hari Raya, misalnya). Jenis boleh ditukar kemudian dari baris senarai
(**Mark festive** / **Mark ordinary**); setiap tukaran meninggalkan baris
audit. Enjin gaji membaca **jenis** dari kalendar, bukan dari nama cuti —
kadar tidak boleh bergantung pada ejaan.

Apa yang jenis *Festive* beli: pada **rule set** (§2.3) ada **Festive
holiday** multiplier untuk jam melebihi jam biasa, dan dalam mod kadar klinik
**Per festive holiday shift**. Kedua-duanya kosong = ikut angka cuti umum,
jadi tiada apa berubah sehingga anda menanda satu hari dan menetapkan angka.
Hari itu sendiri kekal **dua hari gaji** mengikut Akta (s.60D(3)(a)(i)) dan
tidak boleh ditetapkan. Payslip menunjukkan baris sendiri *Festive holiday
pay*, dan baris harian run berbunyi *festive holiday*.

**Kalau senarai kosong** anda akan nampak notis: *No holidays are recorded for
[tahun]. Until they are, no day this year is treated as a closure — a public
holiday worked will be paid as an ordinary day.* Itulah akibatnya — doktor
yang bekerja pada Hari Raya dibayar seperti hari biasa.

> **Buat ini dahulu sebelum gaji pertama.** Masukkan senarai cuti umum
> persekutuan dan negeri anda untuk tahun semasa. Tarikh Islam dan Cina
> berubah setiap tahun — semak warta, jangan agak.

Kalendar ini satu untuk semua cawangan, dan setiap gaji cawangan membaca
harganya dari sini. Jadi **menambah atau memadam cuti umum adalah kerja
Owner** (`settings.manage`); pengurus cawangan boleh membaca senarai tetapi
butang **Add holiday** dan **Remove** tidak dipaparkan kepadanya, dan pelayan
menolak percubaan lain. Setiap tambahan dan padaman meninggalkan baris audit.

### 2.7 Opening balances

**Apa gunanya.** Hanya untuk klinik yang mula guna Kuwick **pertengahan
tahun**. Ia memberitahu Kuwick berapa yang sudah dibayar dan dipotong bulan-
bulan sebelum ini, supaya cukai bulanan tidak dikira seolah-olah Januari
hingga Jun tidak membayar apa-apa.

Kalau klinik anda mula dengan Kuwick pada Januari, **abaikan skrin ini**. Kad
Settings sendiri akan tulis *Not needed*.

| Medan | Maksudnya |
|---|---|
| **Employing company** | Syarikat mana angka ini milik |
| **Source of the figures** | Dari mana anda salin — contoh: `Payslips from the previous system, Jan–Jun 2026` |
| **Employee**, **Month** | Satu baris untuk satu pekerja untuk satu bulan |
| **Gross for the month** | Jumlah kasar bulan itu, persis seperti slip gaji lama |
| **Of which bonus / additional remuneration** | Berapa daripada jumlah itu ialah bonus |
| **PCB deducted**, **CP38 deducted**, **Zakat via payroll** | Potongan cukai bulan itu |
| **TP1 deductions the month applied** | Pelepasan TP1 yang digunakan bulan itu |
| **EPF / SOCSO / EIS — employee** dan **— employer** | Caruman kedua-dua pihak |
| **LINDUNG 24 JAM withheld** | Kalau ada |

**Satu baris satu bulan, bukan jumlah terkumpul.** Skrin memang menolak jumlah
terkumpul: jumlah tidak boleh disemak atau dibetulkan bulan demi bulan.
Kuwick juga menolak bulan sebelum pekerjaan di sini bermula (itu Borang TP3,
pada rekod pekerja) dan bulan yang run Kuwick yang sudah diluluskan telah
tulis.

### 2.8 Statutory rates

**Apa gunanya.** Menunjukkan kadar KWSP, PERKESO dan LHDN yang Kuwick guna.
**Anda tidak menaip kadar di sini — anda menyemaknya.**

Empat panel: **EPF (KWSP)**, **SOCSO & EIS (PERKESO)**, **PCB / MTD (LHDN)**,
**HRD Corp levy**. Setiap satu menunjukkan kadar yang sedang berkuat kuasa dan
dari jadual mana ia datang. Butang **View SOCSO table** dan **View EIS table**
membuka jadual ikut jalur gaji, sebab caruman PERKESO ialah amaun ringgit ikut
jalur, bukan peratusan rata.

Panel EPF ada satu nota penting: **pilihan setiap pekerja (9% / 11%, caruman
sukarela lebih) diset pada tab Statutory pekerja itu**, bukan di sini.

Bila anda sudah bandingkan dengan laman KWSP dan PERKESO, tekan **Mark as
checked**. Chip di atas bertukar kepada **Checked [tarikh]**.

**Kalau anda tidak menyemaknya:** setiap run gaji membawa amaran
*The EPF, SOCSO and EIS rates have not been checked*, dan slip gaji itu
sendiri tertulis bahawa ia sementara. Run itu tidak patut digunakan untuk
membayar staf atau memfailkan borang.

---

## 3. Skrin harian

### 3.1 Employees

**Bila dibuka.** Bila ada orang masuk kerja, berhenti, naik gaji, atau bila
Payroll kata rekod seseorang tidak lengkap.

**Apa yang anda nampak.** Empat angka di atas: **Active**, **Joined this
year**, **Records incomplete**, **Monthly payroll**. Kemudian senarai pekerja.

Setiap baris ada empat titik kecil: **EPF · SOCSO · EIS · Bank**. Titik penuh
bermakna ada, titik kosong bermakna tiada, dan titik kelabu bermakna belum ada
rekod pekerjaan langsung. Empat titik itulah yang menentukan sama ada orang
ini boleh dibayar dan difailkan.

Dua tab: **Employees** dan **Medical benefits**.

**Apa yang boleh ditekan.**

| Butang | Apa jadi |
|---|---|
| **Add employee** | Borang pekerja baharu |
| **Export** | Muat turun senarai sebagai fail CSV |
| **Show: Active / Resigned / All** | Tapis senarai |
| Klik nama | Buka rekod penuh: **Profile · Employment & salary · Statutory · Bank** |
| **⋯** | View · Edit · **Mark as resigned** |

**Tiada butang padam, dan itu disengajakan.** Orang yang pernah dibayar ialah
orang yang masih disebut Borang EA, penyata KWSP dan lejar. Rekod kekal,
statusnya yang berubah.

**Ralat biasa dan cara betulkan.**

| Apa yang anda nampak | Sebabnya | Betulkan |
|---|---|---|
| **No record** pada lajur Type | Orang ini ada akaun tapi tiada rekod pekerjaan | Klik baris itu — laci lengkapkan rekod akan terbuka |
| Titik Bank kosong | Tiada akaun bank | Buka rekod, tab **Bank** |
| **Records incomplete** tinggi | Tarikh lahir, nombor KWSP atau PERKESO hilang | Angka itu memberitahu yang mana paling kerap hilang |

**Rekod pekerja, selepas Batch 3.** *Job* pada borang kini dilabel **Account
role** (apa yang boleh dibuka dalam Kuwick, dan kumpulan gaji); **Job title**
ialah senarai jawatan klinik sendiri — pilih dari senarai atau tekan *Add a
job title* untuk menambah di situ juga. Senarai bermula dari jawatan yang
sudah ditaip pada rekod sedia ada, dan diurus dari butang **Job titles** di
halaman *Employees* (tukar nama mengikut ke semua rekod; *Retire* mengekalkan
jawatan pada yang memegangnya). **Days a week** (5, 5½, 6) direkod dan
dipaparkan di *Working days* bersama hari rehat — pembahagi 26 kekal milik
rule set. **Rest day** boleh dijawab *Varies week to week*: bulan gaji
berjalan, dan run menyebut (baris INFO) bahawa ia tidak dapat mengesan hari
rehat yang dikerjakan — bayaran hari rehat ditaip tangan jika ada. **Passport
number** diminta untuk bukan warganegara yang dokumennya IC (disimpan untuk
pemfailan, tidak dipaparkan semula). Alamat dipecah: *Street address*,
*Postcode*, *City or town*, *State*. IC Malaysia yang sah mengisi **Date of
birth** dan **Gender** sendiri; kedua-duanya masih boleh ditaip ganti. Setiap
placeholder yang kelihatan seperti data sebenar kini berawalan *e.g.*

**Add employee** kini bertanya di peringkat *Pay & Statutory* dua perkara
yang gaji enggan berjalan tanpanya: **Employed by** (syarikat yang menggaji
— dipilih sendiri jika hanya ada satu) dan **Rest day**; juga **LINDUNG 24
JAM (SKBBK)** (lalai *Enrolled* — dibiarkan kosong pun dikira *Enrolled*,
PERKESO mendaftar semua pekerja kecuali yang keluar melalui borangnya; gaji
tidak dihalang kerananya), serta **Overtime above the Act limit** untuk
gaji melebihi siling Jadual Pertama. Semuanya direkodkan bertarikh dari
tarikh mula kerja. Senarai *Payroll readiness* pada peringkat *Review*
menyenaraikan tepat perkara yang run gaji akan halang, dalam susunannya.
Asas caruman EPF tidak ditanya: tanpa rekod, penilaian statutori terpakai
dan gaji tidak dihalang.

### 3.2 Attendance

**Bila dibuka.** Setiap pagi, sebelum apa-apa yang lain.

**Apa yang anda nampak.** Empat angka: **On time today**, **Late / left
early**, **Missing clock-out**, **OT today**. Kemudian empat tab:
**Timesheet · Roster · Corrections · Monthly summary**.

**Timesheet ialah satu hari sahaja pada satu masa** — gunakan anak panah kiri
dan kanan di atas jadual untuk tukar hari. Senarainya ialah **semua orang yang
dijangka**, bukan hanya yang clock in: orang yang dijadualkan tapi tidak
datang tetap muncul, sebab itulah soalan yang skrin ini wujud untuk menjawab.

Baris datang dari tiga tempat dan setiap baris memberitahu yang mana: punch
sebenar, roster, atau cuti yang diluluskan. **Roster satu cawangan sahaja**,
jadi baris roster hanya muncul bila anda pilih satu cawangan pada **Branch**.

Pada setiap punch ada selfie kecil kalau pekerja benarkan. Cip emas
**Outside clinic · 6.9 km** bermakna telefon lebih jauh dari jejari yang anda
set. Cip **Entered by HR** bermakna punch itu dimasukkan dari skrin ini, bukan
oleh pekerja sendiri.

Kaki jadual sentiasa tulis **Rules in force** — grace period, bila OT mula
dikira, dan sama ada ia perlu kelulusan — dengan pautan ke tempat mengubahnya.

**Apa yang boleh ditekan.**

| Butang | Apa jadi |
|---|---|
| **Pending · approve** pada lajur **OT status** | Meluluskan lebih masa hari itu. Ia akan sampai ke bulan gaji |
| **Fix** | Buka laci pembetulan: **Clock in**, **Clock out**, dan **Why** yang wajib diisi |
| **Export** | Muat turun hari itu |
| Tab **Corrections** | Permohonan pembetulan dari pekerja, menunggu keputusan anda |
| Tab **Monthly summary** | Sebulan seorang satu baris, dengan **OT approved** dan **OT pending** sebagai dua lajur berasingan |

**Ralat biasa dan cara betulkan.**

| Apa yang anda nampak | Maksudnya | Betulkan |
|---|---|---|
| **On duty** | Orang ini clock in dan masih bekerja. **Bukan** punch hilang | Tiada apa nak buat |
| **no clock-out** | Syif sudah habis dan tiada clock out | **Fix**, isi waktu keluar dan sebab |
| **Nothing recorded for this day** dan *Choose a branch…* | Anda sedang lihat semua cawangan | Pilih satu cawangan pada **Branch** |
| **Outside clinic** untuk semua orang | Jejari terlalu kecil, atau titik klinik salah | Settings ▸ Attendance & leave policies |

**Pembetulan tidak memadam apa-apa.** Punch asal kekal pada rekod dengan nama
anda dan sebab anda di sebelahnya, dan pekerja nampak kedua-duanya.

### 3.3 Leave

**Bila dibuka.** Bila lampu nombor menyala di menu Leave, atau sebelum anda
buat jadual minggu depan.

**Apa yang anda nampak.** Empat angka: **Waiting for decision** (dengan
tarikh permohonan paling lama menunggu), **Away today**, **Away next 7 days**,
dan **Unpaid leave, [bulan]** yang memberitahu ia masuk ke potongan gaji.

Tiga tab: **Requests · Calendar · Balances**.

**Apa yang boleh ditekan.**

| Butang | Apa jadi |
|---|---|
| Klik satu baris | Buka laci keputusan |
| **Approve** / **Reject** | Keputusan. Penolakan membawa sebabnya, dan pekerja nampak sebab itu |
| **Record leave** | Untuk cuti yang dimohon di luar portal — telefon, borang. Ia masuk barisan menunggu seperti yang lain, bukan diluluskan terus |
| **Status** | Tapis: Pending / Approved / Rejected |

Laci keputusan menunjukkan semua yang anda perlu tanpa menutup senarai:
**Type**, **Dates**, **Applied**, **Reason**, **Balance after** (baki selepas
permohonan ini), **Also away** (siapa lagi tiada pada tarikh sama), sijil MC
kalau ada, dan apa ia buat kepada gaji.

**Yang meluluskan ialah anda, bukan senarai pilihan.** Tiada kotak untuk
memilih nama orang lain sebagai pelulus.

**Ralat biasa.**

| Apa yang anda nampak | Sebabnya |
|---|---|
| Tab **Balances**: *Nobody has a leave policy yet* | Belum ada polisi cuti. Lihat bahagian 6 — skrin untuk menciptanya belum ada |
| **Balance after** tulis *No balance for this kind of leave* | Jenis cuti ini tiada kelayakan berangka. Anda masih boleh luluskan |

### 3.4 Claims

**Bila dibuka.** Bila lampu nombor menyala, atau sekali seminggu.

**Apa yang anda nampak.** Empat angka: **Waiting for decision** dan jumlahnya,
**Approved, not yet paid** dan gaji bulan mana ia menumpang, berapa dibayar
tahun ini, dan berapa faedah perubatan sudah digunakan.

Tapisan: **All · Waiting · Approved · Paid**, dan satu tapisan **Month**.

**Apa yang boleh ditekan.**

| Butang | Apa jadi |
|---|---|
| Klik satu baris | Buka laci keputusan dengan **resit itu sendiri** |
| **Approve RM…** | Luluskan jumlah yang dituntut |
| **Approve how much** | Tukar jumlah dahulu, kemudian luluskan jumlah lain |
| **Reject** | Tolak. Nota wajib |
| **Record as reimbursed** | Untuk tuntutan yang dibayar berasingan oleh Finance: rekod rujukan pembayaran |

**Keputusan ialah tiga jawapan serentak:** berapa, dari mana (bersama gaji,
atau berasingan oleh Finance), dan kenapa kalau bukan sepenuhnya. **Nota wajib
untuk menolak atau untuk menukar jumlah.**

Tuntutan jarak jauh menunjukkan apa ia dihargakan dengan — contoh
*42 km × RM0.60* — kadar yang dibekukan pada tuntutan itu semasa ia dihantar.

**Record claim** (HR). Untuk resit kertas atau staf tanpa log masuk portal,
tekan **+ Record claim** di atas senarai: pilih pekerja, jenis, tarikh, jumlah
(mileage dikira dari km × kadar klinik, sama seperti portal), tujuan, dan
gambar/imbasan resit — wajib jika polisi tuntutan mewajibkannya. Tuntutan
itu masuk giliran seperti tuntutan lain; laci *Review* menyatakan *entered on
their behalf* dan siapa yang mengunci masuknya. HR hanya boleh merekod untuk
pekerja di cawangan yang diuruskannya.

### 3.5 Payroll

**Bila dibuka.** Hujung bulan, selepas kehadiran, cuti, lebih masa dan
tuntutan bulan itu semua sudah diputuskan.

**Satu run untuk satu bulan.** Bulan dipilih di atas kanan.

Kalau bulan itu belum bermula anda nampak
*[bulan] has not been started* dan butang **Start [bulan] payroll**. Kalau
butang itu mati, sebabnya ditulis di sebelahnya — contoh: *Nobody has a salary
on record, so there is no pay to work out.*

Selepas bermula, bulan itu berjalan melalui empat tahap:

| Tahap | Apa yang berlaku |
|---|---|
| **Prepare** | Daftar gaji, seorang satu baris. **Petak kelabu** datang dari rekod atau dikira untuk anda; **petak putih** membuka senarai item bulan itu. Klik **Other income** atau **Other** untuk tambah, ubah atau buang item (elaun, insentif, fi BOD, locum bulan lepas); setiap item satu baris pada slip gaji, dan bulan dikira semula selepas setiap perubahan. Item dengan **Own column** (Settings › Payroll items) ditaip terus dalam petaknya: taip beberapa petak, tekan **Save changes** sekali — setiap petak dihantar sebagai baris sendiri melalui peraturan pelayan yang sama, dan bulan dikira semula sekali. Lajur yang tiada jumlah bagi sesiapa dalam senarai dilipat; **Show all columns** membukanya untuk jumlah pertama. Petak bertanda *Carried* (garis putus) masih jumlah bulan lepas — ubah atau kosongkan jika tidak berulang; *Review* mengira baris begitu tanpa menyekat. Lajur **OT RM** dan **Unpaid RM** menunjukkan wang di sebelah jam OT dan hari cuti tanpa gaji, dari baris itu sendiri; pemilih bulan di atas grid melompat terus ke mana-mana bulan; **Fix** pada baris yang tersekat membuka tab yang betul pada rekod pekerja dan menyerlahkan panel yang berkenaan |
| **Review** | Apa yang menghalang, apa yang patut dipandang, dan berapa jumlah bulan itu |
| **Approve** | Meluluskan mengunci bulan. Ini saat wang terikat |
| **Pay** | Slip gaji, senarai pembayaran bank, dan angka berkanun untuk difailkan |

Setiap baris ada statusnya sendiri: **Ready**, **Needs attention**, atau
**Blocked**. Sebab bagi setiap status tertulis terus di bawah cip itu, pada
baris yang sama. Tapisan di atas jadual membolehkan anda lihat **Blocked**
sahaja.

Tajuk berkumpulan di atas lajur berkata wang siapa.

**Deductions — employee** ialah bahagian pekerja, ditolak dari gaji mereka:
KWSP, PERKESO, SIP, **SKBBK** (Lindung 24 Jam) dan PCB. SKBBK ditanggung
pekerja sama seperti PERKESO dan SIP, walaupun majikan yang menghantarnya —
sebab itu ia duduk di sini dan bukan di sebelah kanan.

**Employer pays** ialah apa yang klinik bayar di atas gaji itu, **satu lajur
untuk setiap satu**: KWSP majikan, PERKESO majikan, SIP majikan, dan levi HRD.
Ia berasingan sebab borang yang anda isi memerlukannya berasingan — borang
KWSP mahu bahagian majikan KWSP sahaja, borang PERKESO mahu PERKESO dan SIP
berlainan. Satu angka gabungan tidak boleh diisi ke dalam mana-mana borang.
Keempat-empatnya tidak pernah ditolak dari gaji sesiapa, sebab itu ia duduk
selepas **Net pay**, dan jumlah keempat-empatnya ialah angka **Employer
contributions** pada kad di atas skrin.

Jadual ini lebih lebar daripada kebanyakan skrin, jadi ia menatal ke tepi.
Lajur **Employee** dan **Status** kekal terpaku di kiri semasa anda menatal,
supaya anda sentiasa tahu baris siapa yang sedang dibaca. Tiada angka
digabungkan untuk menjimatkan ruang.

Di bawah jadual ada baris **Total** untuk setiap lajur, dikira oleh pelayan.
Ia sentiasa jumlah seluruh bulan: kalau tapisan atau carian sedang menyempitkan
senarai, baris itu berkata begitu. Lajur berkanun juga berkata berapa orang
yang tidak termasuk dalam jumlahnya, kalau ada angka yang tidak dapat dikira.

**Apa yang boleh ditekan.**

| Butang | Apa jadi |
|---|---|
| **Start [bulan] payroll** | Kuwick tarik masuk gaji, lebih masa diluluskan, cuti tanpa gaji, tuntutan, elaun bulanan dan insentif |
| Klik satu nama | Buka halaman gaji seorang itu: pendapatan, potongan, berkanun, hasil |
| **Add input** | Tambah satu item bayaran untuk bulan ini sahaja, atau satu item berulang |
| **Approve this month** | Hanya hidup bila tiada lagi yang menghalang |
| **History** | Semua run bulan-bulan lepas |

**Kuwick tidak akan meluluskan run yang ia tidak boleh kira.** Kalau ada yang
menghalang, butang bertukar menjadi *Locked until the N items are sorted* dan
**See what is blocking it**.

Lihat soalan lazim di bahagian 5 untuk maksud **Blocked**.

**All branches.** Setiap cawangan menjalankan bulannya sendiri. Dengan pemilih
cawangan pada *All branches*, halaman bulan menyenaraikan setiap cawangan
dengan status run-nya, bilangan pekerja dan gaji bersih: **Open** membuka run
cawangan itu, **Start** memilih cawangan itu dahulu. Tiada lagi run satu
cawangan dipaparkan seolah-olah ia bulan seluruh kumpulan.

**HRD levy —.** Apabila petak *HRD levy* bertanda **—**, sebabnya ada pada
baris itu (letak tetikus di atas sengkang) dan satu ayat di bawah grid
menamakan syarikat, tarikh kelas HRD direkodkan berbanding bulan itu, dan apa
yang perlu dibuat: rekod kelas dari tarikh sebenar, atau **Reopen** bulan,
kira semula dan luluskan semula. Bulan yang sudah *Paid* tidak boleh dibuka
semula; levinya diselesaikan di luar Kuwick.

### 3.6 Reports

**Bila dibuka.** Selepas satu bulan diluluskan, bila akauntan minta sesuatu,
atau bila tiba masa memfailkan.

**Apa yang anda nampak.** Bulan gaji di atas, kemudian lima rak:

| Rak | Isinya |
|---|---|
| **Payroll reports** | Apa yang klinik bayar bulan itu, dan apa yang bank perlukan |
| **Government reports** | EPF (KWSP i-Akaun), SOCSO, EIS, PCB / MTD (LHDN e-PCB), levi HRD, Borang EA, Borang E |
| **Payslips** | Slip gaji bulan itu, dengan carian, dan PDF setiap seorang |
| **Everything else** | Laporan lain yang Kuwick sediakan |
| **Not available yet** | Apa yang belum ada, dengan sebabnya |

**Kuwick tidak memfailkan apa-apa, dan tidak menjana fail rasmi mana-mana
pihak berkuasa.** Setiap baris kerajaan memberi anda **CSV listing** — satu
senarai baris yang Kuwick sediakan dari gambaran bulan yang diluluskan. Anda
memuat naiknya di portal pihak berkuasa itu sendiri, kemudian tekan **Record
filing** untuk menyimpan apa yang portal itu keluarkan. Di mana lakaran asal
menjanjikan *CSV · PDF* atau *TXT · PDF*, yang sebenarnya ada ialah CSV.

Slip gaji dan senarai berkanun kedua-duanya datang dari gambaran bulan yang
**diluluskan**. Sebelum bulan diluluskan, panel itu memberitahu anda begitu,
bukan menunjukkan jadual kosong.

**Download all** pada Payslips memuat turun satu per satu melalui pintu yang
sama yang merekod siapa mengambilnya dan bila. **Tiada butang hantar e-mel** —
Kuwick tiada penghantar e-mel untuk gaji, dan pekerja sudah ada setiap slip
gaji di portal mereka sendiri pada hari bulan itu dibayar.

---

## 4. Portal pekerja — My Kuwick

Pekerja log masuk dengan akaun mereka sendiri dan sampai ke **My Kuwick**.
Mereka **hanya** nampak diri sendiri. Lima tab: **Home · Payslips · Leave ·
Claims · Attendance**.

### Home

Slip gaji terkini, baki cuti tahunan, tuntutan, dan **Quick actions**. Di sini
juga butang **Clock in** / **Clock out**.

**Kali pertama menekan Clock in, satu skrin persetujuan muncul** menerangkan
apa yang berlaku kepada selfie mereka. Mereka boleh tekan setuju, atau memilih
punch tanpa selfie. **Selfie tidak pernah wajib** dan tidak pernah boleh
diambil oleh orang lain untuk mereka — kalau HR merekod punch, ia sentiasa
tanpa selfie dan bertanda *entered by HR*.

Kalau telefon tidak memberi lokasi, punch tetap masuk, dan mesej berkata
*(no position from the phone)*.

### Payslips

**Bulan yang sudah dibayar sahaja.** Bulan yang masih dikerjakan tidak muncul
di sini — itu bukan kerosakan. Setiap baris ada PDF yang sama dengan yang HR
keluarkan.

### Leave

Mohon cuti, lampirkan sijil MC, dan lihat status setiap permohonan. Keputusan
anda — termasuk sebab penolakan — muncul di sini.

### Claims

Hantar tuntutan dengan resit. Untuk tuntutan jarak jauh, portal menunjukkan
amaun sambil mereka menaip jarak, menggunakan kadar sekilometer yang anda set.

### Attendance

Rekod kehadiran mereka sendiri, dan permohonan pembetulan kalau ada punch yang
salah. Permohonan itu muncul pada tab **Corrections** anda.

---

## 5. Soalan lazim

### Staff clock out masa rehat — kena set Unpaid break tak?

**Jangan.** Medan itu tidak berfungsi, dan clock out waktu rehat tidak
membantu. Beritahu staf: **clock in sekali pagi, clock out sekali balik.**

Dua sebab, kedua-duanya perlu anda tahu sebelum UAT.

**Satu hari menyimpan satu clock in dan satu clock out sahaja.** Punch pertama
hari itu menjadi waktu masuk dan tidak berubah lagi; setiap punch selepasnya
hanya menggerakkan waktu keluar ke waktu terkini. Punch di tengah **tidak
disimpan langsung**. Jadi staf yang clock out pukul 1, clock in semula pukul 2
dan balik pukul 6 menghasilkan satu baris sahaja — pukul masuk hingga pukul 6 —
dan jam rehat termasuk di dalamnya, sama seperti kalau mereka tidak menekan
apa-apa waktu rehat.

**Medan Unpaid break tidak menolak apa-apa.** Angka yang ia hasilkan tidak
disimpan dan tidak dibaca oleh mana-mana skrin atau slip gaji. Menetapkannya
kepada 60 minit mengubah tiada satu angka pun.

**Jadi hari ini tiada cara automatik untuk mengecualikan rehat dari jam
sehari.** Yang ada: tekan **Fix** pada baris hari itu dan taip waktu masuk dan
keluar yang anda mahu direkodkan, dengan sebabnya. Itu masih satu tempoh, bukan
dua.

**Sejauh mana ia penting.** Pada **hari kerja biasa**, jam yang melambung tidak
mengubah bayaran: gaji ialah angka bulanan, dan lebih masa diukur dari waktu
tamat syif ke punch terakhir, bukan dari jumlah jam. Ia penting pada **hari
rehat dan cuti umum yang dikerja**, di mana jumlah jam menentukan sama ada hari
itu dibayar sebagai sesi separuh hari atau syif penuh, dan berapa jam melebihi
hari normal. Dan ia penting untuk sesiapa yang membaca lajur **Worked** sebagai
jam sebenar — ia bukan.

Lihat bahagian 6.

### OT tak muncul dalam payroll — kenapa?

Hampir pasti **lebih masa itu belum diluluskan**.

Kuwick membayar jam lebih masa **yang diluluskan sahaja**. Jam yang tidak
diluluskan dilaporkan berasingan dan dihargakan sifar. Ini benar walaupun suis
**Overtime must be approved** dimatikan — mematikan suis itu tidak meluluskan
apa-apa secara automatik.

Cara betulkan: **Attendance ▸ Timesheet**, pergi ke hari itu, cari lajur
**OT status**, tekan **Pending · approve**. Kemudian kembali ke Payroll dan
kira semula bulan itu.

Tiga sebab lain yang mungkin:

1. **Masa lebih di bawah Overtime minimum.** Bawaan 30 minit. Dua belas minit
   lebih bukan calon lebih masa langsung.
2. **Pembundaran ke bawah.** Kalau **Overtime rounds down to** ialah 15 minit,
   40 minit dibayar sebagai 30 minit.
3. **Doktor bergaji lebih RM4,000 dengan lebih masa ditetapkan tidak dibayar.**
   Lihat soalan terakhir di bawah.

Pada tab **Monthly summary** ada dua lajur berasingan — **OT approved** dan
**OT pending** — supaya anda nampak berapa yang menunggu sebelum menutup
bulan.

### Payroll kata Blocked — apa maknanya?

**Blocked** bermakna Kuwick tidak boleh mengira orang itu dengan yakin, jadi
ia meninggalkan mereka keluar dari jumlah dan bukan membayar angka yang tiada
sesiapa pilih. Ia bukan amaran — bulan itu tidak boleh diluluskan sehingga ia
selesai.

Tekan **See what is blocking it** pada tahap Review. Setiap baris memberitahu
tiga perkara: apa yang berlaku, akibatnya, dan apa yang perlu anda buat, dengan
pautan terus ke orang atau skrin yang betul.

Yang paling kerap:

| Apa yang tertulis | Maksudnya | Betulkan |
|---|---|---|
| *Salary setup is incomplete* | Tiada gaji pada rekod untuk bulan ini | Set gaji bulanan dari tarikh ia bermula |
| *Date of birth is missing* | KWSP, PERKESO dan SIP semuanya berubah pada umur 60 | Tambah tarikh lahir |
| *No employing company is recorded* | Orang ini tidak terikat kepada mana-mana syarikat | Set syarikat pada rekod mereka |
| *Monthly tax (PCB) is missing* | Cukai bulanan tiada | Lengkapkan tab Statutory, atau taip PCB bulan itu, atau rekod mereka memang tidak membayar PCB |
| *Salary changed from … part-way through …* | Lihat soalan seterusnya | — |
| *Deductions exceed earnings* | Gaji bersih akan jadi negatif | Kurangkan satu potongan, atau bahagikan pemulihan kepada beberapa bulan |

**Needs attention** berbeza dari **Blocked**: ia patut dipandang tetapi tidak
menghalang kelulusan. Contoh: tiada akaun bank, atau lebih masa belum
diluluskan.

### Gaji naik pertengahan bulan — macam mana?

**Kuwick akan halang orang itu, dan ini disengajakan.** Anda akan nampak:
*Salary changed from RM3,000.00 to RM3,500.00 on 15 Sep, part-way through
September 2026.*

Sebabnya: sama ada perubahan pertengahan bulan dibahagi ikut hari, dibayar
penuh, atau dibayar kadar lama — itu polisi yang klinik anda belum putuskan,
dan amalan Malaysia tidak memutuskannya untuk anda. Angka yang dibahagi dengan
betul dan angka yang salah nampak serupa pada slip gaji. **Kuwick tidak akan
membahagi perubahan gaji pertengahan bulan.**

Dua cara keluar:

1. **Cara paling bersih:** tarikhkan kenaikan dari **hari pertama bulan**.
   Buka rekod pekerja ▸ **Employment & salary**, dan set tarikh berkuat kuasa
   ke 1 haribulan. Halangan hilang.
2. Kalau kenaikan memang mesti berkuat kuasa pertengahan bulan, bahagikan run
   itu dan kira dua tempoh berasingan.

**Nasihat praktikal:** buat semua kenaikan gaji berkuat kuasa pada 1 haribulan.
Ia menjimatkan masalah ini setiap kali.

### Staff berhenti — apa nak buat?

Buka **Employees**, cari nama itu, tekan **⋯**, kemudian **Mark as resigned**.
Dua medan:

| Medan | Isi dengan |
|---|---|
| **Last working day** | Hari terakhir mereka bekerja |
| **Reason** | Contoh: `Resigned, moving to Johor Bahru` |

**Jangan cuba padam rekod mereka** — tiada butang padam, sebab Borang EA,
penyata KWSP dan lejar masih menyebut mereka.

Apa yang berlaku selepas itu:

- Bulan terakhir mereka dibayar **ikut hari yang dikerja**, di bawah s.18A Akta
  Kerja: gaji bulanan ÷ hari dalam bulan itu × hari mereka berkhidmat. Anda
  akan nampak baris **PART_MONTH** berwarna maklumat pada run — itu maklumat,
  bukan halangan. Lebih masa masih dihargakan atas gaji bulanan penuh mereka.
- Kalau anda terlupa menandakan mereka dan mereka sudah tiada sepanjang bulan,
  run akan tulis *They were not employed during this month* dan
  meninggalkan mereka keluar sepenuhnya.
- Mereka kekal boleh dicari di bawah tapisan **Resigned** dan **All**.

Buat ini **sebelum** menjalankan gaji bulan itu.

### Claim dah approve tapi tak masuk gaji — kenapa?

Tiga syarat mesti benar serentak sebelum satu tuntutan menumpang gaji, dan
yang ketiga yang biasanya terlepas:

1. Statusnya **Approved**.
2. Ia diluluskan untuk dibayar **bersama gaji**, bukan berasingan oleh Finance.
   Kalau anda pilih Finance, ia tidak akan sampai ke slip gaji — memang begitu,
   supaya satu tuntutan tidak dibayar dua kali.
3. **Ia menumpang gaji bulan TARIKH TUNTUTAN, bukan bulan anda meluluskannya.**

Nombor tiga itulah jawapannya biasanya. Tuntutan bertarikh **28 Ogos** yang
anda luluskan pada **3 September** menumpang gaji **Ogos**. Kalau Ogos sudah
diluluskan atau sudah dibayar, tuntutan itu tidak akan muncul di mana-mana.

Semak pada **Claims**: baris itu tertulis gaji bulan mana ia menumpang.

Cara betulkan:

- Kalau bulan itu masih terbuka: kira semula bulan itu, dan tuntutan akan
  masuk.
- Kalau bulan itu sudah ditutup: buka **Payroll ▸ Prepare** untuk bulan
  semasa, buka baris orang itu, tekan **Add input**, dan masukkan jumlahnya
  dengan sebab yang menyebut tuntutan asal.

**Luluskan tuntutan sebelum anda menutup bulan tuntutan itu.**

### Payslip tak nampak di portal staff — kenapa?

Kerana **bulan itu belum ditandakan dibayar**.

Portal hanya menunjukkan **bulan yang sudah dibayar**. Bulan yang dikira belum
lagi slip gaji — ia draf kerja yang masih boleh berubah. Bulan yang
**diluluskan** pun belum cukup: run yang diluluskan masih boleh dibuka semula
dan dibetulkan, dan slip gaji yang pekerja simpan tidak sepatutnya berubah
di belakang mereka.

Cara betulkan: selesaikan bulan itu ke tahap **Pay**, bayar staf di portal
bank anda, kemudian rekod ia sudah dibayar dalam Kuwick. Slip gaji muncul di
My Kuwick serta-merta.

Kalau bulan itu **sudah** ditandakan dibayar dan seorang pekerja masih tidak
nampak slipnya, sebabnya ialah mereka tiada baris dalam run itu — biasanya
kerana mereka **Blocked** semasa bulan itu diluluskan. Semak run itu di bawah
**History**.

---

## 6. Apa yang belum ada

Setiap perkara di bawah ini bukan kerosakan dan bukan sesuatu yang anda
tersalah set. Ia memang belum wujud dalam Kuwick hari ini.

| Apa | Keadaan sekarang |
|---|---|
| **Kelayakan cuti** — berapa hari setahun setiap pekerja | Tiada skrin untuk menciptanya atau memberikannya. Tab **Balances** akan tulis *Nobody has a leave policy yet*. Cuti masih boleh dimohon, diluluskan dan ditolak; hanya baki berangka yang tiada |
| **Cut-off day untuk gaji** | Kad Settings menyebutnya, tetapi tiada medan sedemikian pada mana-mana skrin |
| **Fail rasmi pihak berkuasa** (i-Akaun, e-PCB, Borang 8A dalam format TXT) | Kuwick memberi senarai CSV sahaja. Anda memuat naik di portal pihak berkuasa dan merekod apa yang dikeluarkan |
| **Hantar slip gaji melalui e-mel** | Tiada. Pekerja mengambilnya sendiri dari My Kuwick |
| **Fail pembayaran bank format bank tertentu** | Kuwick memberi senarai yang anda kunci masuk di portal bank sendiri |
| **Gaji harian atau gaji sejam** | Kuwick mengira gaji bulanan sahaja. Pekerja berkadar harian akan **Blocked** dengan sebab itu |
| **Jam × kadar dalam payroll** | Tiada di mana-mana. Setiap item yang anda tambah pada gaji ialah satu **amaun**, bukan jam darab kadar. Satu-satunya tempat jam didarab kadar ialah enjin lebih masa dan sesi locum |
| **Ambang berkala untuk jam lebih** — contoh 45 jam seminggu, dan setiap jam selepas itu pada satu kadar rata | Tiada. Enjin menghargakan **hari demi hari** dan tidak pernah menjumlahkan satu minggu. Hanya dua mod wujud: Akta dan kadar klinik. Sementara itu, set **Overtime is not paid** pada pekerja berkenaan dan bayar jam lebihan sebagai satu item gaji yang dimasukkan tangan setiap bulan |
| **Lebih dari dua punch sehari** | Tidak disokong. Pangkalan data menyimpan **satu baris satu orang satu hari** dengan satu waktu masuk dan satu waktu keluar, dan punch di tengah tidak disimpan di mana-mana — tiada jejak audit untuknya. Jam sehari ialah punch pertama hingga punch terakhir, bukan jumlah setiap pasangan masuk-keluar |
| **Unpaid break** dan **Break applies to shifts over** | Kedua-duanya boleh diset dan disimpan, tetapi angka yang dihasilkannya tidak disimpan dan tidak dibaca oleh apa-apa. Tiada potongan rehat berlaku |
| **Sesi locum untuk pekerja** | Modul **Locum sessions** hanya menerima orang yang **engagement = contractor**. Untuk pekerja bergaji, pelayan menolak dengan sebabnya. Lihat nota di bawah |
| **Catatan lejar Finance untuk bayaran locum** | Sesi locum membawa status bayaran dan rujukan invois sendiri; catatan lejar ialah jurang yang diakui |

### Nota tentang doktor dan lebih masa

Untuk pekerja bergaji **lebih RM4,000 sebulan**, peruntukan lebih masa Akta
Kerja 1955 tidak sampai kepada mereka. Kuwick **tidak akan meneka** sama ada
anda membayar mereka atau tidak: run akan **Blocked** dengan
*They worked extra hours, and on wages of RM… a month the Employment Act's
overtime provisions do not reach them.*

Jawab sekali sahaja, pada rekod pekerja ▸ tab **Statutory** ▸ **Statutory
standing** ▸ **Overtime above the Employment Act limit**:

| Pilihan | Kesannya |
|---|---|
| **Company pays overtime at the statutory rates** | Dibayar sebagai faedah syarikat pada kadar Akta |
| **Overtime is not paid** | Tiada bayaran langsung untuk jam lebih, pada mana-mana jenis hari. Ini **mengatasi** mana-mana rule set kadar klinik yang mereka ada |

Untuk pekerja bergaji **RM4,000 atau kurang**, Akta tetap terpakai dan pilihan
*Overtime is not paid* tidak mengubah apa-apa untuk mereka.
