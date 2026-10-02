/* =====================================================================
   DATA DEMO — hanya dipakai kalau Supabase belum dikonfigurasi.
   Bentuknya sama dengan tabel Supabase (lihat supabase/schema.sql).
   ===================================================================== */
import { iso } from './core.js';
import { defaultCatalog } from './shared/catalog.js';

export function makeDemo(){
  const d = n => { const x=new Date(); x.setHours(0,0,0,0); x.setDate(x.getDate()+n); return iso(x); };
  const freelancers = [
    {id:'f1', name:'Farhan Maulana', role:'PHOTOGRAPHER', whatsapp:'6281234500001', email:'farhan@kalaatma.id', rate:1000000, rate_type:'PER_PROJECT', is_active:true, gear:['Sony A7 III','Lensa 24-70mm f/2.8','Lensa 85mm f/1.8','Godox V1']},
    {id:'f2', name:'Budi Santoso',   role:'VIDEOGRAPHER', whatsapp:'6281234500002', email:'budi@kalaatma.id',   rate:250000,  rate_type:'PER_HOUR',    is_active:true, gear:['Sony FX3','DJI RS3 Mini','Rode Wireless GO II']},
    {id:'f3', name:'Arul Prakoso',   role:'VIDEOGRAPHER', whatsapp:'6281234500003', email:'arul@kalaatma.id',   rate:900000,  rate_type:'PER_PROJECT', is_active:true, gear:['Sony A7S III','Gimbal Zhiyun Crane']},
    {id:'f4', name:'Silma Nadia',    role:'PHOTOGRAPHER', whatsapp:'6281234500004', email:'silma@kalaatma.id',  rate:750000,  rate_type:'PER_DAY',     is_active:true, gear:['Canon R6','Lensa RF 50mm f/1.2']},
    {id:'f5', name:'Azmi Ridwan',    role:'EDITOR',       whatsapp:'6281234500005', email:'azmi@kalaatma.id',   rate:400000,  rate_type:'PER_PROJECT', is_active:false, gear:[]}
  ];

  // HPP estimasi per paket menu landing page (± 36% dari harga)
  const packageCosts = {};
  defaultCatalog().services.forEach(s => s.groups.forEach(g => g.packages.forEach(p => {
    packageCosts[p.id] = Math.round(p.price * 0.36 / 5000) * 5000;
  })));

  const B = (id,bid,svcName,pkg,price,dt,who,status,extra={}) => ({
    id, booking_id:bid, service:svcName, service_id:extra.sid||null, sub_category:extra.sub||null,
    package_id:extra.pid||null, package_name:pkg, package_price:price,
    add_ons:extra.addons||[], add_on_price:(extra.addons||[]).reduce((n,a)=>n+a.total,0), number_of_people:extra.people||2,
    session_date:dt, session_time:extra.time||'09:00', session_end_time:extra.end||'13:00', location:extra.loc||'Bandung',
    map_link:extra.map||null, latitude:extra.lat??null, longitude:extra.lng??null,
    whatsapp:extra.wa||'0812'+Math.floor(10000000+Math.random()*89999999),
    notes:extra.notes||null, status, source:extra.src||'website',
    bride_name:extra.bride||null, groom_name:extra.groom||null, client_name:who,
    bride_instagram:extra.bIg||null, groom_instagram:null, client_instagram:extra.ig||null,
    custom_package_price:extra.custom??null, additional_charge:extra.add||0, extra_time_charge:extra.et||0,
    transport_charge:extra.tr||0, other_charge:0, discount:extra.disc||0,
    hpp_snapshot:extra.hpp||Math.round(price*0.36),
    photographer_id:extra.ph||null, videographer_id:extra.vg||null,
    needs_photographer:extra.needP!==false, needs_videographer:extra.needV!==false,
    photo_drive_link:extra.pl||null, video_drive_link:extra.vl||null, raw_file_link:null, final_file_link:extra.fl||null,
    delivery_date:extra.dd||null, invoice_number:extra.inv||null, payment_due_date:extra.due||null,
    gcal_event_id:extra.gc||null, labels:extra.lb||[], created_at:new Date(Date.now()-(extra.age??Math.random()*60)*864e5).toISOString()
  });

  const bookings = [
    B('b1','KLA-2026-A1B2','Wedding','Wedding Gold',6300000,d(0),null,'CONFIRMED',
      {sid:'wedding',pid:'gold',bride:'Ayu Lestari',groom:'Raka Pratama',custom:5800000,tr:200000,disc:300000,
       addons:[{id:'wcc',name:'Wedding Content Creator',qty:1,unit_price:800000,total:800000}],
       ph:'f1',vg:'f2',loc:'Gedung Sate, Bandung',time:'08:00',end:'18:00',people:120,
       map:'https://www.google.com/maps?q=-6.9024812,107.6186407',lat:-6.9024812,lng:107.6186407,inv:'INV-KAL-202608-001',due:d(-4),gc:'evt_1'}),
    B('b2','KLA-2026-C3D4','Graduation','Silver',650000,d(1),'Dina Maharani','CONFIRMED',
      {sid:'graduation',pid:'gp-sil',sub:'Personal',ph:'f4',needV:false,loc:'ITB, Bandung',time:'15:00',end:'17:00',people:1,
       map:'https://www.google.com/maps?q=-6.8915,107.6107',lat:-6.8915,lng:107.6107,inv:'INV-KAL-202608-002'}),
    B('b3','KLA-2026-E5F6','Family','Bronze',1000000,d(3),'Keluarga Sari','NEW',
      {sid:'family',pid:'fb-br',sub:'Big Family Session',loc:'Lembang',people:8,tr:150000,age:0.2}),
    B('b4','KLA-2026-G7H8','Prewedding','Gold',3700000,d(6),null,'WAITING_DP',
      {sid:'prewedding',pid:'pw-gold',sub:'Prewedding Package',bride:'Nadia Putri',groom:'Iqbal Ramadhan',ph:'f1',loc:'Ranca Upas',time:'06:00',due:d(-1),lb:['EDITING']}),
    B('b5','KLA-2026-J9K0','Wedding','Wedding Silver',5300000,d(12),null,'BOOKED',
      {sid:'wedding',pid:'silver',bride:'Sinta Dewi',groom:'Bagas Wicaksono',ph:'f4',vg:'f3',tr:250000,
       addons:[{id:'wcc',name:'Wedding Content Creator',qty:1,unit_price:800000,total:800000}],
       loc:'Hotel Savoy Homann',people:200,inv:'INV-KAL-202608-003'}),
    B('b6','KLA-2026-L1M2','Engagement','Silver',2200000,d(18),null,'NEW',
      {sid:'engagement',pid:'en-sil',bride:'Rani Anggraini',groom:'Doni Kusuma',loc:'Dago Pakar',age:0.5}),
    B('b7','KLA-2026-N3P4','Graduation','Gold',1200000,d(24),'Fajar Nugroho','NEW',
      {sid:'graduation',pid:'gb-gold',sub:'Bundling Photo & Video',loc:'UNPAD Jatinangor',people:1,age:1}),
    B('b8','KLA-2026-Q5R6','Maternity','Silver',1300000,d(30),'Putri Handayani','NEW',
      {sid:'maternity',pid:'mt-sil',needV:false,loc:'Studio Kalaatma',people:2,age:2}),
    B('b9','KLA-2026-S7T8','Wedding','Wedding Bronze',3700000,d(-9),null,'DELIVERED',
      {sid:'wedding',pid:'bronze',bride:'Maya Sari',groom:'Rizky Aditya',ph:'f1',vg:'f2',loc:'Ciwidey',people:80,
       inv:'INV-KAL-202607-011',lb:['EDITING'],pl:'https://drive.google.com/drive/folders/demo-photo-1',
       vl:'https://drive.google.com/drive/folders/demo-video-1',dd:d(-2),gc:'evt_9'}),
    B('b10','KLA-2026-U9V0','Family','Exclusive',1700000,d(-16),'Keluarga Wibowo','COMPLETED',
      {sid:'family',pid:'fc-exc',sub:'Classic Package',ph:'f4',vg:'f3',loc:'Kebun Raya Cibodas',people:4,inv:'INV-KAL-202607-008',lb:['DONE'],
       pl:'https://drive.google.com/drive/folders/demo-photo-2',fl:'https://drive.google.com/drive/folders/demo-final-2',dd:d(-8)}),
    B('b11','KLA-2026-W1X2','Graduation','Silver',650000,d(-22),'Alya Ramadhani','COMPLETED',
      {sid:'graduation',pid:'gp-sil',sub:'Personal',ph:'f1',needV:false,loc:'UPI Bandung',people:1,inv:'INV-KAL-202607-004',
       pl:'https://drive.google.com/drive/folders/demo-photo-3',dd:d(-15)}),
    B('b12','KLA-2026-Y3Z4','Prewedding','Signature',3000000,d(-30),null,'COMPLETED',
      {sid:'prewedding',pid:'pw-sig',sub:'All-In Package',bride:'Laras Wulandari',groom:'Yoga Pratama',ph:'f4',vg:'f2',loc:'Pangalengan',
       inv:'INV-KAL-202607-001',pl:'https://drive.google.com/drive/folders/demo-photo-4',dd:d(-22)})
  ];

  const payments = [
    {id:'y1', booking_id:'b1', amount:2600000, paid_at:d(-20), kind:'DP', method:'Transfer BCA'},
    {id:'y2', booking_id:'b2', amount:650000,  paid_at:d(-5),  kind:'SETTLEMENT', method:'QRIS'},
    {id:'y3', booking_id:'b5', amount:2540000, paid_at:d(-12), kind:'DP', method:'Transfer BCA'},
    {id:'y4', booking_id:'b9', amount:3700000, paid_at:d(-14), kind:'SETTLEMENT', method:'Transfer BCA'},
    {id:'y5', booking_id:'b10',amount:1700000, paid_at:d(-18), kind:'SETTLEMENT', method:'Cash'},
    {id:'y6', booking_id:'b11',amount:650000,  paid_at:d(-24), kind:'SETTLEMENT', method:'QRIS'},
    {id:'y7', booking_id:'b12',amount:3000000, paid_at:d(-32), kind:'SETTLEMENT', method:'Transfer BCA'}
  ];
  const crewFees = [
    {id:'c1', booking_id:'b1', freelancer_id:'f1', role:'PHOTOGRAPHER', fee:1000000},
    {id:'c2', booking_id:'b1', freelancer_id:'f2', role:'VIDEOGRAPHER', fee:750000},
    {id:'c3', booking_id:'b9', freelancer_id:'f1', role:'PHOTOGRAPHER', fee:900000},
    {id:'c4', booking_id:'b10',freelancer_id:'f4', role:'PHOTOGRAPHER', fee:600000}
  ];
  const ago = n => new Date(Date.now()-n*864e5).toISOString();
  const leads = [
    {id:'l1', name:'Gita Permata',  whatsapp:'6281300000001', email:'gita@mail.com',  category:'Wedding',    source:'Instagram', status:'NEGOTIATION', follow_up_date:d(-3), estimated_value:5300000, notes:'Minta breakdown Silver vs Gold', created_at:ago(9)},
    {id:'l2', name:'Hendra Wijaya', whatsapp:'6281300000002', email:null,             category:'Prewedding', source:'WhatsApp',  status:'CONTACTED',   follow_up_date:d(0),  estimated_value:3700000, notes:'Rencana Oktober', created_at:ago(4)},
    {id:'l3', name:'Intan Puspita', whatsapp:'6281300000003', email:'intan@mail.com', category:'Graduation', source:'Referral',  status:'QUALIFIED',   follow_up_date:d(2),  estimated_value:650000,  notes:'Wisuda UNPAD', created_at:ago(2)},
    {id:'l4', name:'Bayu Saputra',  whatsapp:'6281300000004', email:null,             category:'Family',     source:'Instagram', status:'NEW',         follow_up_date:d(1),  estimated_value:1700000, notes:null, created_at:ago(1)},
    {id:'l5', name:'Citra Amelia',  whatsapp:'6281300000005', email:'citra@mail.com', category:'Wedding',    source:'Website',   status:'WON',         follow_up_date:null,  estimated_value:6300000, notes:'Jadi booking KLA-2026-A1B2', created_at:ago(30)},
    {id:'l6', name:'Eka Nurhayati', whatsapp:'6281300000006', email:null,             category:'Engagement', source:'TikTok',    status:'CONTACTED',   follow_up_date:d(-8), estimated_value:2200000, notes:'Belum balas 2 minggu', created_at:ago(21)}
  ];
  const clients = [
    {id:'k1', name:'Ayu Lestari & Raka Pratama', whatsapp:'6281234511111', email:'ayuraka@mail.com', instagram:'@ayulestari', drive_folder_link:null},
    {id:'k2', name:'Maya Sari & Rizky Aditya',   whatsapp:'6281234522222', email:'maya@mail.com',    instagram:'@mayasari',   drive_folder_link:'https://drive.google.com/drive/folders/demo-client-2'},
    {id:'k3', name:'Keluarga Wibowo',            whatsapp:'6281234533333', email:'wibowo@mail.com',  instagram:null,          drive_folder_link:null}
  ];
  const transactions = [
    {id:'t1', kind:'IN',  amount:2600000, category:'DP Booking',   description:'DP Wedding Ayu & Raka',      booking_id:'b1',  occurred_on:d(-20)},
    {id:'t2', kind:'IN',  amount:3700000, category:'Pelunasan',    description:'Pelunasan Wedding Maya',     booking_id:'b9',  occurred_on:d(-14)},
    {id:'t3', kind:'OUT', amount:900000,  category:'Fee Crew',     description:'Fee photographer Farhan',    booking_id:'b9',  occurred_on:d(-13)},
    {id:'t4', kind:'IN',  amount:2540000, category:'DP Booking',   description:'DP Wedding Sinta & Bagas',   booking_id:'b5',  occurred_on:d(-12)},
    {id:'t5', kind:'OUT', amount:450000,  category:'Operasional',  description:'Sewa lensa 24-70mm',         booking_id:null,  occurred_on:d(-10)},
    {id:'t6', kind:'IN',  amount:650000,  category:'Pelunasan',    description:'Graduation Dina',            booking_id:'b2',  occurred_on:d(-5)},
    {id:'t7', kind:'OUT', amount:1250000, category:'Peralatan',    description:'Cicilan gimbal',             booking_id:null,  occurred_on:d(-4)},
    {id:'t8', kind:'OUT', amount:320000,  category:'Transport',    description:'Transport crew Ciwidey',     booking_id:'b9',  occurred_on:d(-9)},
    {id:'t9', kind:'IN',  amount:1700000, category:'Pelunasan',    description:'Family Wibowo',              booking_id:'b10', occurred_on:d(-18)},
    {id:'t10',kind:'OUT', amount:600000,  category:'Fee Crew',     description:'Fee Silma — Family Wibowo',  booking_id:'b10', occurred_on:d(-17)}
  ];
  const at = h => new Date(Date.now()-h*36e5).toISOString();
  const activity = [
    {id:'a1', at:at(2),  actor:'Demo Admin', action:'status', entity:'Booking',    target:'Ayu Lestari & Raka Pratama', detail:'Status: BOOKED → CONFIRMED'},
    {id:'a2', at:at(5),  actor:'Demo Admin', action:'create', entity:'Pembayaran', target:'Ayu Lestari & Raka Pratama', detail:'DP Rp2.600.000 · Transfer BCA'},
    {id:'a3', at:at(26), actor:'Demo Admin', action:'update', entity:'Paket',      target:'Wedding › Wedding Gold',     detail:'Harga: Rp6.000.000 → Rp6.300.000'},
    {id:'a4', at:at(30), actor:'Demo Admin', action:'update', entity:'Booking',    target:'Maya Sari & Rizky Aditya',   detail:'Link foto diisi · Link video diisi'}
  ];
  return {bookings, freelancers, payments, packageCosts, leads, clients, transactions, crewFees, activity, invSeq:3};
}
