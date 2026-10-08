/* =========================================================
   KONTRAK DATA KONTEN LANDING PAGE — file ini IDENTIK di kedua repo:
     • form-booking      (landing page, membaca)
     • web-admin-booking (Menu → tab Konten, mengubah)
   Ubah di keduanya bila formatnya berubah.

   Disimpan sebagai satu dokumen JSON di tabel Supabase `app_config`
   (key = 'content'). Foto berupa URL publik (Supabase Storage bucket
   'landing', atau link lain). Kolom foto kosong = tampil bingkai polos.
   ========================================================= */
export const CONTENT_KEY = 'content';
export const STORAGE_BUCKET = 'landing';

export function defaultContent(){
  return {
    brand: { name:'Kalaatma', tagline:'Pictures & Stories' },
    hero: {
      eyebrow:'Wedding & Portrait Photography',
      title:'Setiap Momen, Dibingkai dengan Cinta',
      subtitle:'Kami mengabadikan hari bahagia Anda dengan sentuhan yang hangat, jujur, dan abadi — dari wedding hingga momen keluarga.',
      cta:'Booking Sekarang',
      photo:'',
      galleryTitle:'Galeri singkat',
      gallery:['', ''],
      rating:'4.9/5',
      ratingNote:'dari ratusan client bahagia',
      tags:['#Wedding', '#Prewedding', '#Engagement', '#Graduation', '#Family']
    },
    highlight: {
      title:'Karena Setiap Momen Berarti',
      text:'Setiap tawa, pelukan, dan air mata bahagia layak diingat selamanya. Itulah yang kami jaga di setiap sesi.',
      number:'6+',
      numberLabel:'Tahun pengalaman'
    },
    about: {
      eyebrow:'Tentang Kalaatma',
      title:'Perjalanan Sebuah Cinta',
      text:'Kalaatma Pictures adalah studio foto & video yang percaya bahwa foto terbaik lahir dari momen yang jujur. Kami mendampingi Anda dari persiapan hingga hari H, supaya Anda cukup menikmati setiap detiknya.',
      photos:['', '']
    },
    services: {
      eyebrow:'Layanan',
      title:'Sentuhan Khas Kami',
      text:'Pilih layanan yang paling sesuai dengan momen Anda, lalu lanjutkan ke paket dan jadwal.',
      photos:{}                 // { [serviceId]: url }
    },
    stats: [
      {value:'300+', label:'Wedding terabadikan'},
      {value:'1.2K+', label:'Client bahagia'},
      {value:'50+', label:'Venue partner'},
      {value:'6+', label:'Tahun pengalaman'}
    ],
    why: {
      eyebrow:'Kenapa Kalaatma',
      title:'Esensi Kalaatma',
      text:'Kami tidak sekadar memotret — kami bercerita. Pendekatan yang tenang dan personal membuat Anda nyaman, sehingga setiap foto terasa seperti Anda.',
      photo:'',
      sidePhoto:'',
      sideText:'Kami tidak hanya merencanakan sesi, kami menciptakan kenangan yang tak terlupakan.'
    },
    portfolio: {
      eyebrow:'Portfolio',
      title:'Kenangan yang Abadi',
      items:[
        {title:'Alicia & Martin', subtitle:'Wedding · Bandung', photos:['', '', '']},
        {title:'Dinda & Raka', subtitle:'Prewedding · Lembang', photos:['', '', '']}
      ]
    },
    testimonials: {
      eyebrow:'Testimoni',
      title:'Kata Mereka',
      items:[
        {name:'Nadia & Fikri', event:'Wedding', text:'Timnya ramah dan sabar sekali. Hasil fotonya melebihi ekspektasi kami!', rating:5, photo:''},
        {name:'Keluarga Wijaya', event:'Family', text:'Anak-anak jadi nyaman difoto. Prosesnya cepat dan hasilnya hangat.', rating:5, photo:''},
        {name:'Rina', event:'Graduation', text:'Booking mudah, hasil cepat jadi, dan editannya natural.', rating:5, photo:''}
      ]
    },
    faq: {
      eyebrow:'FAQ',
      title:'Pertanyaan yang Sering Ditanyakan',
      photo:'',
      items:[
        {q:'Bagaimana cara booking?', a:'Klik "Booking Sekarang", pilih layanan & paket, isi detail acara, lalu transfer DP untuk mengunci tanggal.'},
        {q:'Berapa DP yang harus dibayar?', a:'DP dibayar di awal untuk mengunci jadwal. Besarnya tertera di langkah pembayaran.'},
        {q:'Kapan hasil foto dikirim?', a:'Waktu pengerjaan menyesuaikan paket. Semua file dikirim lewat Google Drive.'},
        {q:'Apakah bisa sesi di luar kota?', a:'Bisa. Biaya transport crew menyesuaikan lokasi dan akan dikonfirmasi oleh tim kami.'}
      ]
    },
    cta: {
      title:'Rencanakan Momen Anda bersama Kalaatma',
      text:'Tanggal favorit cepat terisi. Amankan jadwal Anda sekarang.',
      button:'Booking Sekarang',
      photo:''
    },
    footer: {
      text:'Studio foto & video untuk wedding, prewedding, graduation, dan family.',
      address:'Bandung, Jawa Barat',
      email:'',
      instagram:'kalaatmapictures',
      phone:''
    }
  };
}

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

/* Gabungkan konten tersimpan dengan bawaan, supaya kolom baru selalu ada
   dan konten lama/rusak tidak membuat halaman error. */
export function mergeContent(saved){
  const base = defaultContent();
  if(!isObj(saved)) return base;
  const merge = (b, s) => {
    if(Array.isArray(b)) return Array.isArray(s) ? s : b;
    if(isObj(b)){
      const out = {...b};
      if(isObj(s)) for(const k of Object.keys(s)) out[k] = k in b ? merge(b[k], s[k]) : s[k];
      return out;
    }
    return (s === undefined || s === null) ? b : s;
  };
  return merge(base, saved);
}

export const isContent = c => isObj(c) && isObj(c.hero);
