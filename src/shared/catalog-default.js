/* =========================================================
   KATALOG MENU — Pricelist Kalaatma 2026
   Inilah "menu" yang tampil di landing page: layanan, grup
   paket, paket, add-on, dan syarat & ketentuan. Nantinya isi
   file ini dikelola dari web admin dan disimpan di Supabase;
   untuk sekarang menjadi data bawaan (fallback).
   ========================================================= */

export const SERVICES = {
  wedding:{
    label:'Wedding', title:'Wedding Photography',
    desc:'Dokumentasi momen pernikahan.',
    couple:true, terms:'wedding',
    groups:[{id:'wedding', label:'Wedding Package', packages:[
      {id:'akad', name:'Akad Only', price:2400000, items:['Foto Unlimited','4 Jam Kerja','75 File Photo Edited','Photo on G-Drive','1 Min Cinematic Video','1 Photographer','1 Videographer']},
      {id:'minimalis', name:'Minimalis', price:2800000, items:['Foto Unlimited','8 Jam Kerja','100 File Photo Edited','Photo on G-Drive','1–3 Min Cinematic Video','1 Photographer','1 Videographer']},
      {id:'bronze', name:'Wedding Bronze', price:3700000, items:['Foto Unlimited','8 Jam Kerja','150 File Photo Edited','1 Flashdisk Custom','Photo on G-Drive','1 Album Magazine Photo','1–3 Min Cinematic Video','1 Photographer','1 Videographer','1 Photo 12R + Pigura']},
      {id:'silver', name:'Wedding Silver', price:5300000, items:['Foto Unlimited','8 Jam Kerja','150 File Photo Edited','1 Flashdisk Custom','Photo on G-Drive','2 Exclusive Album Photo','1–3 Min Cinematic Video','2 Photographer','1 Videographer','2 Photo 12R + Pigura']},
      {id:'gold', name:'Wedding Gold', price:6300000, items:['Foto Unlimited','8 Jam Kerja','All File Photo Edited','1 Flashdisk for Original File','Photo on G-Drive','2 Exclusive Album Photo','1–3 Min Cinematic Video','5–10 Min Wedding Video','3 Photo 6R + Pigura','3 Photo 12R + Pigura','2 Photographer','2 Videographer']}
    ]}],
    addons:[{id:'wcc', name:'Wedding Content Creator', price:800000}]
  },

  prewedding:{
    label:'Prewedding', title:'Prewedding Session',
    desc:'Sesi foto sebelum hari pernikahan.',
    couple:true, terms:'wedding',
    groups:[
      {id:'regular', label:'Prewedding Package', packages:[
        {id:'pw-min', name:'Minimalis', price:1200000, items:['Photo Only','3 Jam Kerja','1 Photographer','Moodboard','40 Edited Photo','All File Photo on G-Drive']},
        {id:'pw-sil', name:'Silver', price:2200000, items:['Photo & Video','4 Jam Kerja','1 Photographer','1 Videographer','1–3 Min Cinematic Video','Moodboard','40 Edited Photo','All File Photo on G-Drive']},
        {id:'pw-gold', name:'Gold', price:3700000, items:['Photo & Video','5 Jam Kerja','1 Photographer','1 Videographer','100 Edited Photo','1 Printed 12R + Frame','1–3 Min Cinematic Video','All File Photo on G-Drive','1 Flashdisk Custom','1 Album Magazine','3 Printed 6R + Frame','Moodboard']}
      ]},
      {id:'allin', label:'All-In Package', packages:[
        {id:'pw-sig', name:'Signature', price:3000000, items:['4 Jam Kerja','1 Photographer','1 Videographer','1–3 Min Cinematic Video','Moodboard','40 Edited Photo','All File Photo on G-Drive','Make Up + Hijab Do Clean']},
        {id:'pw-comp', name:'Complete', price:4200000, items:['4 Jam Kerja','1 Photographer','1 Videographer','1–3 Min Cinematic Video','Moodboard','40 Edited Photo','All File Photo on G-Drive','Make Up + Hijab Do Clean','1 Pasang Baju Prewed','Modern / Traditional / Ethnic']}
      ]}
    ],
    addons:[
      {id:'hairdo', name:'Hair Do', price:200000},
      {id:'retouch', name:'Standby Retouch', price:200000, unit:'3 jam', qty:true},
      {id:'wardrobe', name:'Wardrobe', price:350000}
    ]
  },

  engagement:{
    label:'Engagement', title:'Engagement Session',
    desc:'Mengabadikan momen lamaran.',
    couple:true, terms:'wedding',
    groups:[{id:'engagement', label:'Engagement Package', packages:[
      {id:'en-br', name:'Bronze', price:1200000, items:['Photo Only','4 Jam Kerja','1 Photographer','40 Edited Photo','All File Photo on G-Drive']},
      {id:'en-sil', name:'Silver', price:2200000, items:['Photo & Video','5 Jam Kerja','1 Photographer','1 Videographer','50 Edited Photo','1–3 Min Video Cinematic','All File Photo on G-Drive']},
      {id:'en-gold', name:'Gold', price:3200000, items:['6 Jam Kerja','1 Photographer','1 Videographer','100 Edited Photo','1 Printed 12R + Frame','1 Min Cinematic Video','All File Photo on G-Drive','1 Flashdisk Custom','1 Album Magazine','3 Printed 6R + Frame']}
    ]}],
    addons:[]
  },

  graduation:{
    label:'Graduation', title:'Graduation Photography',
    desc:'Mengabadikan momen wisuda bersama orang-orang tersayang.',
    couple:false, usesPeople:true, terms:'graduation',
    groups:[
      {id:'personal', label:'Personal', packages:[
        {id:'gp-min', name:'Minimalis', price:350000, items:['1 Photographer','Unlimited Shoot','60 Minutes Photo Session','All File in Drive','20 Edited Photos','Include Family & Friends']},
        {id:'gp-sil', name:'Silver', price:650000, items:['1 Photographer','Unlimited Shoot','120 Minutes Photo Session','All File in Drive','30 Edited Photos','Include Family & Friends']}
      ]},
      {id:'group', label:'Group', people:true, packages:[
        {id:'gg-min', name:'Minimalis', price:200000, perPerson:true, min:3, max:5, items:['1 Photographer','Max 3–5 Person','Unlimited Shoot','90 Minutes','All File in Drive','30 Edited Photos','Exclude Family & Friends']},
        {id:'gg-sil', name:'Silver', price:175000, perPerson:true, min:6, max:9, items:['1 Photographer','Max 6–9 Person','Unlimited Shoot','120 Minutes','All File in Drive','40 Edited Photos','Exclude Family & Friends']},
        {id:'gg-gold', name:'Gold', price:150000, perPerson:true, min:9, max:15, items:['1 Photographer','Max 9–15 Person','Unlimited Shoot','150 Minutes','All File in Drive','50 Edited Photos','Exclude Family & Friends']}
      ]},
      {id:'couple', label:'Couple', packages:[
        {id:'gc-min', name:'Minimalis', price:550000, items:['1 Photographer','75 Minutes','2 Graduates','Include Individual Shoot','All File in Drive','30 Edited Photos','Exclude Family']},
        {id:'gc-sil', name:'Silver', price:650000, items:['1 Photographer','90 Minutes','2 Graduates','Include Individual Shoot','All File in Drive','40 Edited Photos','Include Family']}
      ]},
      {id:'bundling', label:'Bundling Photo & Video', packages:[
        {id:'gb-gold', name:'Gold', price:1200000, items:['90 Minutes Photo Session','1 Crew Photo & Video','All File in Drive','30 Edited Photos','1–2 Minutes Cinematic Video','Personal Shoot','Family + Friends']}
      ]}
    ],
    addons:[
      {id:'extratime', name:'Extra Time', price:200000, unit:'30 menit', qty:true},
      {id:'cinevid', name:'Cinematic Video', price:850000}
    ]
  },

  family:{
    label:'Family', title:'Family Photography',
    desc:'Mengabadikan momen bersama keluarga.',
    couple:false, usesPeople:true, terms:'family',
    groups:[
      {id:'classic', label:'Classic Package', people:true, packages:[
        {id:'fc-min', name:'Minimalism', price:500000, min:1, max:4, items:['1–4 Family Members','60 Minutes Photo Session','20 Edited Photos','All File Original on G-Drive','Photo Unlimited','1 Crew Photographer']},
        {id:'fc-std', name:'Standard', price:1200000, min:1, max:4, items:['1–4 Family Members','90 Minutes Photo Session','30 Edited Photos','1 Cinematic Video','All File Original on G-Drive','Photo Unlimited','1 Crew']},
        {id:'fc-exc', name:'Exclusive', price:1700000, min:1, max:4, items:['1–4 Family Members','120 Minutes Photo Session','40 Edited Photos','1 Cinematic Video','All File Original on G-Drive','Photo Unlimited','2 Crew']}
      ]},
      {id:'bigfamily', label:'Big Family Session', people:true, packages:[
        {id:'fb-br', name:'Bronze', price:1000000, min:5, max:10, items:['5–10 Family Members','90 Minutes','30 Edited Photos','All File Original on G-Drive','Photo Unlimited','1 Crew']},
        {id:'fb-sil', name:'Silver', price:1500000, min:11, max:20, items:['11–20 Family Members','120 Minutes','50 Edited Photos','All File Original on G-Drive','Photo Unlimited','1 Crew']}
      ]}
    ],
    addons:[{id:'fam-cine', name:'Cinematic Video', price:1000000, group:'bigfamily'}]
  },

  maternity:{
    label:'Maternity', title:'Maternity Session',
    desc:'Mengabadikan momen menanti kehadiran si kecil.',
    couple:false, terms:'maternity',
    groups:[{id:'maternity', label:'Maternity Package', packages:[
      {id:'mt-br', name:'Bronze', price:600000, items:['60 Minutes Photo Session','20 Edited Photo','All File Original on G-Drive','Photo Unlimited','1 Crew']},
      {id:'mt-sil', name:'Silver', price:1300000, items:['90 Minutes Photo Session','30 Edited Photo','All File Original on G-Drive','Photo Unlimited','1–2 Min Cinematic Video','1 Crew']},
      {id:'mt-gold', name:'Gold', price:1700000, items:['120 Minutes Photo Session','45 Edited Photo','All File Original on G-Drive','Photo Unlimited','1–2 Min Cinematic Video','2 Crew']}
    ]}],
    addons:[{id:'mt-cine', name:'Cinematic Video', price:1000000}]
  }
};

export const TERMS = {
  wedding:{ label:'(Wedding · Prewedding · Engagement)', title:'Ketentuan Wedding & Couple Session', list:[
    'DP minimal 40%',
    'DP tidak dapat dikembalikan apabila terjadi pembatalan sepihak',
    'Perubahan jadwal maksimal H-10 jika jadwal photographer tersedia',
    'Reschedule lebih dari H-10 dikenakan biaya tambahan',
    'Pelunasan maksimal hari H',
    'Toleransi keterlambatan 15 menit',
    'Perizinan lokasi dan properti menjadi tanggung jawab client',
    'Akses Google Drive berlaku 1 bulan'
  ]},
  graduation:{ label:'(Graduation)', title:'Ketentuan Graduation', list:[
    'DP 40%',
    'DP tidak dapat dikembalikan jika pembatalan sepihak',
    'Reschedule maksimal H-7 jika jadwal tersedia',
    'Reschedule lebih dari H-7 dikenakan biaya tambahan',
    'Pelunasan maksimal hari H',
    'File mentah maksimal 1×24 jam',
    'Hasil edit maksimal H+1 minggu setelah pemilihan foto',
    'Perizinan lokasi menjadi tanggung jawab client',
    'Google Drive aktif 1 bulan'
  ]},
  family:{ label:'(Family)', title:'Ketentuan Family Session', list:[
    'DP 40%',
    'DP tidak dapat dikembalikan jika pembatalan sepihak',
    'Reschedule maksimal H-10 jika jadwal tersedia',
    'Reschedule lebih dari H-10 dikenakan biaya tambahan',
    'Pelunasan maksimal hari H',
    'Perizinan lokasi dan properti menjadi tanggung jawab client',
    'File mentah maksimal 2×24 jam',
    'Hasil edit maksimal H+1 minggu setelah pemilihan foto',
    'Google Drive aktif 1 bulan'
  ]},
  maternity:{ label:'(Maternity)', title:'Ketentuan Maternity Session', list:[
    'DP 40%',
    'DP tidak dapat dikembalikan jika pembatalan sepihak',
    'Reschedule maksimal H-10 jika jadwal tersedia',
    'Reschedule lebih dari H-10 dikenakan biaya tambahan',
    'Pelunasan maksimal hari H',
    'Perizinan lokasi dan properti menjadi tanggung jawab client',
    'File mentah maksimal 2×24 jam',
    'Hasil edit maksimal H+1 minggu setelah pemilihan foto',
    'Google Drive aktif 1 bulan'
  ]}
};

// Label paket. Isi ID paket berdasarkan data penjualan yang telah dikonfirmasi.
export const PACKAGE_HIGHLIGHTS = {
  bestSellerIds: [],
  recommendedIds: ['bronze','pw-sil','pw-sig','en-sil','gp-sil','gc-sil','gb-gold','fc-std','mt-sil']
};

// Pengaturan bisnis yang juga akan dikelola dari web admin.
export const SETTINGS = {
  dpPercent: 40,                   // persentase DP dari estimasi total
  holdMinutes: 60,                 // lama tanggal ditahan menunggu transfer DP
  bank: { name:'Bank BRI', accountNo:'07463820187', accountName:'Atep Supratman' },
  whatsapp: {
    general: '6281234567890',      // WhatsApp umum tim Kalaatma
    paymentConfirm: '6283245786532' // WhatsApp konfirmasi pembayaran DP
  }
};
