/* =========================================================
   KONTRAK DATA KONTEN LANDING PAGE — file ini IDENTIK di kedua repo:
     • form-booking      (landing page, membaca)
     • web-admin-booking (Menu → tab Konten, mengubah)
   Ubah di keduanya bila formatnya berubah.

   Disimpan sebagai satu dokumen JSON di tabel Supabase `app_config`
   (key = 'content'). Foto berupa URL publik (Supabase Storage bucket
   'landing', atau link lain). Kolom foto kosong = tampil latar polos.
   ========================================================= */
export const CONTENT_KEY = 'content';
export const STORAGE_BUCKET = 'landing';

export function defaultContent(){
  return {
    brand: { name:'Kalaatma', tagline:'Pictures & Stories' },
    hero: {
      eyebrow:'Wedding & Portrait Photography',
      title:'Capture the moments you\u2019ll remember forever',
      subtitle:'Kami percaya setiap cerita cinta layak diabadikan dengan cara yang paling indah. Dengan sentuhan seni dan ketulusan, kami hadir untuk menangkap momen terbaik di hari istimewa Anda.',
      cta:'Mulai Booking',
      photo:'',                // foto cover desktop (landscape, subjek di kanan)
      photoMobile:''           // opsional: foto cover HP (portrait); kosong = pakai foto desktop
    },
    services: {
      photos:{}                // { [serviceId]: url } — foto kartu di langkah "Pilih layanan"
    },
    testimonials: {
      eyebrow:'Testimoni',
      title:'Dipercaya untuk momen paling berharga',
      items:[
        {name:'Nadia & Fikri', event:'Wedding', text:'Timnya ramah dan sabar sekali. Hasil fotonya melebihi ekspektasi kami.', rating:5, photo:''},
        {name:'Keluarga Wijaya', event:'Family', text:'Anak-anak jadi nyaman difoto. Prosesnya tenang dan hasilnya hangat.', rating:5, photo:''},
        {name:'Rina', event:'Graduation', text:'Booking mudah, hasil cepat jadi, dan editannya natural.', rating:5, photo:''}
      ]
    },
    footer: {
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
