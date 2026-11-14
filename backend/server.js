'use strict';
const express=require('express'),crypto=require('crypto'),fs=require('fs'),path=require('path');
const {DatabaseSync}=require('node:sqlite');const nodemailer=require('nodemailer');
try{for(const l of fs.readFileSync('.env','utf8').split('\n')){const m=l.match(/^\s*([A-Z_]+)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^"|"$/g,'')}}catch{}
const E=process.env,PORT=+E.PORT||3000,BASE=(E.BASE_URL||`http://localhost:${PORT}`).replace(/\/$/,'');
const SECRET=E.SESSION_SECRET||(E.NODE_ENV==='test'?'test':null);
if(!SECRET){console.error('SESSION_SECRET is required');process.exit(1)}
const DATA=path.join(__dirname,'data');fs.mkdirSync(path.join(DATA,'uploads'),{recursive:true});
const db=new DatabaseSync(E.DB_FILE||path.join(DATA,'salon.db'));
db.exec(`PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS customers(id INTEGER PRIMARY KEY,name TEXT NOT NULL,phone TEXT NOT NULL,email TEXT NOT NULL UNIQUE,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS services(id INTEGER PRIMARY KEY,name TEXT NOT NULL,description TEXT DEFAULT '',image TEXT DEFAULT '',price_cents INTEGER NOT NULL CHECK(price_cents>=0),duration_min INTEGER NOT NULL CHECK(duration_min>0),requirements TEXT DEFAULT '',category TEXT DEFAULT 'Styling',active INTEGER DEFAULT 1,sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS appointments(id INTEGER PRIMARY KEY,reference TEXT UNIQUE NOT NULL,customer_id INTEGER NOT NULL REFERENCES customers(id),service_id INTEGER NOT NULL REFERENCES services(id),service_name TEXT,date TEXT NOT NULL,start_min INTEGER NOT NULL,end_min INTEGER NOT NULL,price_cents INTEGER NOT NULL,fee_cents INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN('pending_payment','confirmed','cancelled','completed','payment_failed')),hold_expires INTEGER,notes TEXT DEFAULT '',source TEXT DEFAULT 'online',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS ix_appt_date ON appointments(date,status);
CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY,appointment_id INTEGER NOT NULL REFERENCES appointments(id),provider TEXT DEFAULT 'paystack',reference TEXT UNIQUE NOT NULL,amount_cents INTEGER NOT NULL,currency TEXT DEFAULT 'ZAR',status TEXT NOT NULL DEFAULT 'initiated',provider_ref TEXT,paid_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS administrators(id INTEGER PRIMARY KEY,email TEXT UNIQUE NOT NULL,pass_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS blocked_slots(id INTEGER PRIMARY KEY,date TEXT NOT NULL,start_min INTEGER,end_min INTEGER,reason TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY,appointment_id INTEGER REFERENCES appointments(id),type TEXT NOT NULL,channel TEXT NOT NULL,recipient TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',error TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(appointment_id,type,channel,recipient));`);
const DEF={salon_name:'HAIR BY SHACHAH',tagline:'Where every strand is art.',instagram:'',tiktok:'',facebook:'',whatsapp:'27000000000',contact_email:'',address:'Thohoyandou, Limpopo',phone:'',
hours:{0:null,1:[480,1020],2:[480,1020],3:[480,1020],4:[480,1020],5:[480,1020],6:[480,840]},slot_step:30,fee_type:'fixed',fee_value:5000,cancel_hours:24,hold_minutes:15,
hero_image:'',testimonials:[],notify:{admin_email:true,customer_email:true,customer_whatsapp:true,reminder24:true,reminder3:true}};
const getS=()=>{const o={...DEF};for(const r of db.prepare('SELECT * FROM settings').all())o[r.key]=JSON.parse(r.value);return o};
const setS=(k,v)=>db.prepare('INSERT INTO settings(key,value)VALUES(?,?)ON CONFLICT(key)DO UPDATE SET value=excluded.value').run(k,JSON.stringify(v));
const hashPw=(p,s=crypto.randomBytes(16).toString('hex'))=>s+':'+crypto.scryptSync(p,s,64).toString('hex');
const checkPw=(p,h)=>{const[s,x]=h.split(':');const a=Buffer.from(hashPw(p,s).split(':')[1],'hex'),b=Buffer.from(x,'hex');return crypto.timingSafeEqual(a,b)};
if(!db.prepare('SELECT 1 FROM administrators').get()&&E.ADMIN_EMAIL&&E.ADMIN_PASSWORD){if(E.ADMIN_PASSWORD.length<12)throw new Error('ADMIN_PASSWORD must be 12+ chars');db.prepare('INSERT INTO administrators(email,pass_hash)VALUES(?,?)').run(E.ADMIN_EMAIL.toLowerCase(),hashPw(E.ADMIN_PASSWORD))}
if(!db.prepare('SELECT 1 FROM services').get()){const s=db.prepare('INSERT INTO services(name,description,price_cents,duration_min,requirements,category,image,sort)VALUES(?,?,?,?,?,?,?,?)');
[['Soft Locs with Blonde Accent','Long, lightweight soft locs with a golden blonde statement section.',120000,360,'Hair washed, blow-dried and detangled. Extensions included.','Locs','/img/soft-locs-blonde.jpg'],['Boho Knotless Braids','Fine knotless braids with loose, flowing curly ends.',110000,360,'Arrive with clean, blow-dried hair.','Braids','/img/boho-knotless.jpg'],['Butterfly Locs','Textured, bohemian butterfly locs in honey blonde.',100000,300,'Hair washed and blow-dried beforehand.','Locs','/img/butterfly-locs.jpg'],['French Curl Boho Braids','Honey-toned boho braids finished with soft French curls.',95000,300,'Arrive with clean, blow-dried hair.','Braids','/img/boho-french-curl.jpg'],['Island Twists','Full, curly passion-style twists in blonde tones.',70000,240,'Hair washed and blow-dried beforehand.','Twists','/img/island-twists.jpg'],['Goddess Soft Locs','Black soft locs with curly goddess ends and curled face-framing pieces.',130000,360,'Hair washed, blow-dried and detangled.','Locs','/img/goddess-soft-locs.jpg'],['Straight Closure Install','Sleek, natural-parted straight install with a seamless closure.',60000,120,'Bring your unit or ask about supplied hair.','Installs','/img/straight-closure.jpg'],['Fulani Braids','Stitch-feed-in cornrows up front with long braids and curly tips.',65000,180,'Arrive with clean, blow-dried hair.','Braids','/img/fulani-braids.jpg'],['Curly Crochet Style','Voluminous curly crochet with a braided pattern at the front.',45000,150,'Arrive with clean, detangled hair.','Crochet','/img/curly-crochet.jpg'],['Braided Curly Ponytail','Braided base with a bouncy curly ponytail.',40000,120,'Arrive with clean, blow-dried hair.','Braids','/img/braided-ponytail.jpg'],['Body Wave Closure Install','Glossy body-wave install with a neat middle part.',70000,150,'Bring your unit or ask about supplied hair.','Installs','/img/body-wave-closure.jpg'],['Kinky Twists','Medium-length kinky twists with honey tips.',75000,240,'Hair washed and blow-dried beforehand.','Twists','/img/kinky-twists.jpg'],['Stitch Feed-in Braids','Straight-back stitch braids with long knotless finish.',50000,150,'Arrive with clean, blow-dried hair.','Braids','/img/stitch-braids.jpg'],['Knotless Braids with Beads','Classic knotless braids finished with blue and gold beads.',80000,240,'Arrive with clean, blow-dried hair. Beads included.','Braids','/img/knotless-beads.jpg']].forEach((x,i)=>s.run(...x,i))}
const SAST=()=>new Date(Date.now()+7200e3),todayStr=()=>SAST().toISOString().slice(0,10),nowMin=()=>SAST().getUTCHours()*60+SAST().getUTCMinutes();
const dow=d=>new Date(d+'T00:00:00Z').getUTCDay(),validDate=d=>/^\d{4}-\d\d-\d\d$/.test(d)&&!isNaN(new Date(d+'T00:00:00Z'));
const feeFor=(price,S)=>Math.min(price,S.fee_type==='percent'?Math.round(price*S.fee_value/100):S.fee_value);
const fmtT=m=>String(m/60|0).padStart(2,'0')+':'+String(m%60).padStart(2,'0'),R=c=>'R'+(c/100).toFixed(2);
const conflicts=(date,s,e,excl=0)=>{const now=Date.now();
 if(db.prepare(`SELECT 1 FROM appointments WHERE date=? AND id!=? AND start_min<? AND end_min>? AND(status='confirmed' OR(status='pending_payment' AND hold_expires>?))`).get(date,excl,e,s,now))return'That time has just been taken.';
 if(db.prepare('SELECT 1 FROM blocked_slots WHERE date=? AND(start_min IS NULL OR(start_min<? AND end_min>?))').get(date,e,s))return'That time is unavailable.';return null};
function slots(date,dur,S,excl=0){if(!validDate(date)||date<todayStr())return[];const h=S.hours[dow(date)];if(!h)return[];const out=[];
 for(let t=h[0];t+dur<=h[1];t+=S.slot_step){if(date===todayStr()&&t<=nowMin()+60)continue;if(!conflicts(date,t,t+dur,excl))out.push(t)}return out}
const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}};
// ---------- notifications ----------
const mailer=E.SMTP_HOST?nodemailer.createTransport({host:E.SMTP_HOST,port:+E.SMTP_PORT||587,secure:+E.SMTP_PORT===465,auth:E.SMTP_USER?{user:E.SMTP_USER,pass:E.SMTP_PASS}:undefined}):null;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const html=(S,title,rows,foot='')=>`<div style="font-family:Georgia,serif;max-width:520px;margin:auto;border:1px solid #ecd9d3;padding:28px;color:#3b2230"><h2 style="color:#b76e79;font-weight:400">${esc(S.salon_name)}</h2><h3>${esc(title)}</h3><table style="width:100%;font-size:15px">${rows.map(r=>`<tr><td style="padding:5px 0;color:#8a6b72">${esc(r[0])}</td><td style="text-align:right"><b>${esc(r[1])}</b></td></tr>`).join('')}</table><p style="font-size:13px;color:#8a6b72">${foot}</p></div>`;
async function send(apptId,type,channel,to,subject,body,text){if(!to)return;
 const ins=db.prepare('INSERT OR IGNORE INTO notifications(appointment_id,type,channel,recipient)VALUES(?,?,?,?)').run(apptId,type,channel,to);if(!ins.changes)return;const id=ins.lastInsertRowid;
 const done=(st,err)=>db.prepare('UPDATE notifications SET status=?,error=? WHERE id=?').run(st,err||null,id);
 try{if(channel==='email'){if(!mailer)return done('skipped','SMTP not configured');await mailer.sendMail({from:E.MAIL_FROM||E.SMTP_USER,to,subject,html:body,text});done('sent')}
 else{if(!E.WA_TOKEN||!E.WA_PHONE_ID)return done('skipped','WhatsApp API not configured');const r=await fetch(`https://graph.facebook.com/v20.0/${E.WA_PHONE_ID}/messages`,{method:'POST',headers:{Authorization:'Bearer '+E.WA_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:to.replace(/\D/g,''),type:'text',text:{body:text}})});if(!r.ok)throw new Error('WA '+r.status+' '+(await r.text()).slice(0,200));done('sent')}}
 catch(e){done('failed',String(e.message).slice(0,300))}}
const A=id=>db.prepare('SELECT a.*,c.name cname,c.phone,c.email FROM appointments a JOIN customers c ON c.id=a.customer_id WHERE a.id=?').get(id);
async function notify(id,type){const a=A(id),S=getS(),N=S.notify;if(!a)return;const bal=a.price_cents-a.fee_cents;
 const rows=[['Note','Price excludes the cost of hair'],['Reference',a.reference],['Service',a.service_name],['Date',a.date],['Time',fmtT(a.start_min)+' – '+fmtT(a.end_min)],['Total price',R(a.price_cents)],['Booking fee paid',R(a.fee_cents)],['Balance due on the day',R(bal)]];
 const T={confirmed:['Booking confirmed','Your appointment is confirmed. The balance is payable at the salon on the day.'],payment_failed:['Payment unsuccessful','Your payment did not go through, so the appointment was not confirmed. You are welcome to try again.'],cancelled:['Booking cancelled','Your appointment has been cancelled.'],rescheduled:['Appointment rescheduled','Your appointment has been moved to the time below.'],reminder24:['Reminder: appointment tomorrow','We look forward to seeing you.'],reminder3:['Reminder: appointment today','We look forward to seeing you shortly.']}[type];if(!T)return;
 const txt=`${S.salon_name}\n${T[0]}\n${T[1]}\nRef ${a.reference}: ${a.service_name}, ${a.date} ${fmtT(a.start_min)}\nBalance due: ${R(bal)}`;
 if(N.customer_email)await send(a.id,type,'email',a.email,`${S.salon_name}: ${T[0]}`,html(S,T[0],rows,T[1]),txt);
 if(N.customer_whatsapp)await send(a.id,type,'whatsapp',a.phone,'',' ',txt);
 const adm=S.contact_email||E.ADMIN_EMAIL;const AT={confirmed:'New confirmed booking & payment received',payment_failed:'Payment failed',cancelled:'Customer cancelled',rescheduled:'Appointment rescheduled'}[type];
 if(AT&&N.admin_email)await send(a.id,'admin_'+type,'email',adm,`[Admin] ${AT} – ${a.reference}`,html(S,AT,[['Customer',a.cname+' · '+a.phone],...rows]),AT)}
// ---------- payments ----------
const PS=(p,o)=>fetch('https://api.paystack.co'+p,{...o,headers:{Authorization:'Bearer '+E.PAYSTACK_SECRET_KEY,'Content-Type':'application/json'}}).then(r=>r.json());
async function confirmPayment(ref){const p=db.prepare('SELECT * FROM payments WHERE reference=?').get(ref);if(!p)return null;if(p.status==='paid')return p;
 const v=await PS('/transaction/verify/'+encodeURIComponent(ref));const d=v&&v.data;if(!v.status||!d)return p;
 let evt=null;
 tx(()=>{const cur=db.prepare('SELECT * FROM payments WHERE id=?').get(p.id);if(cur.status==='paid')return;const a=db.prepare('SELECT * FROM appointments WHERE id=?').get(p.appointment_id);
  if(d.status==='success'){if(d.amount!==cur.amount_cents||String(d.currency).toUpperCase()!=='ZAR'||d.reference!==ref){db.prepare("UPDATE payments SET status='amount_mismatch',provider_ref=? WHERE id=?").run(String(d.id),p.id);return}
   db.prepare("UPDATE payments SET status='paid',provider_ref=?,paid_at=CURRENT_TIMESTAMP WHERE id=?").run(String(d.id),p.id);
   if(a.status==='pending_payment'||a.status==='payment_failed'){if(conflicts(a.date,a.start_min,a.end_min,a.id)){db.prepare("UPDATE appointments SET status='cancelled',notes=notes||' [Paid after slot was lost - REFUND REQUIRED]' WHERE id=?").run(a.id);evt='cancelled'}else{db.prepare("UPDATE appointments SET status='confirmed',hold_expires=NULL WHERE id=?").run(a.id);evt='confirmed'}}}
  else if(['failed','abandoned','reversed'].includes(d.status)){db.prepare("UPDATE payments SET status='failed' WHERE id=?").run(p.id);if(a.status==='pending_payment'){db.prepare("UPDATE appointments SET status='payment_failed',hold_expires=NULL WHERE id=?").run(a.id);evt='payment_failed'}}});
 if(evt)notify(p.appointment_id,evt).catch(console.error);return db.prepare('SELECT * FROM payments WHERE id=?').get(p.id)}
// ---------- app ----------
const app=express();app.disable('x-powered-by');
app.use((q,s,n)=>{s.set({'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin'});n()});
app.post('/api/webhooks/paystack',express.raw({type:'*/*',limit:'1mb'}),(q,s)=>{const sig=crypto.createHmac('sha512',E.PAYSTACK_SECRET_KEY||'').update(q.body).digest('hex');
 const h=String(q.headers['x-paystack-signature']||'');if(!E.PAYSTACK_SECRET_KEY||h.length!==sig.length||!crypto.timingSafeEqual(Buffer.from(h),Buffer.from(sig)))return s.sendStatus(401);
 let ev;try{ev=JSON.parse(q.body)}catch{return s.sendStatus(400)}const ref=ev.data&&ev.data.reference;s.sendStatus(200);if(ref&&/^charge\./.test(ev.event||''))confirmPayment(ref).catch(console.error)});
app.use(express.json({limit:'6mb'}));
const wrap=f=>(q,s,n)=>Promise.resolve(f(q,s,n)).catch(e=>{console.error(e);s.status(500).json({error:'Server error'})});
const bad=(s,m,c=400)=>s.status(c).json({error:m});
const str=(v,max)=>typeof v==='string'?v.trim().slice(0,max):'';
// public
app.get('/api/config',(q,s)=>{const S=getS();s.json({salon_name:S.salon_name,tagline:S.tagline,whatsapp:S.whatsapp,address:S.address,phone:S.phone,hours:S.hours,hero_image:S.hero_image,instagram:S.instagram,tiktok:S.tiktok,facebook:S.facebook,email:S.contact_email,testimonials:S.testimonials,fee_type:S.fee_type,fee_value:S.fee_value,cancel_hours:S.cancel_hours,payments_ready:!!E.PAYSTACK_SECRET_KEY,today:todayStr()})});
app.get('/api/services',(q,s)=>{const S=getS();s.json(db.prepare('SELECT * FROM services WHERE active=1 ORDER BY sort,id').all().map(x=>({...x,fee_cents:feeFor(x.price_cents,S)})))});
app.get('/api/gallery',(q,s)=>{const it=db.prepare('SELECT name,category,image FROM services WHERE active=1 AND image!=\'\' ORDER BY sort,id').all().map(x=>({type:'image',src:x.image,title:x.name,category:x.category}));
 let v=[];try{v=fs.readdirSync(path.join(__dirname,'public','videos')).filter(f=>/\.(mp4|webm)$/i.test(f)).map(f=>({type:'video',src:'/videos/'+f,title:f.replace(/\.[^.]+$/,'').replace(/[-_]+/g,' '),category:'Videos'}))}catch{}
 s.json([...v,...it])});
app.get('/api/availability',(q,s)=>{const sv=db.prepare('SELECT * FROM services WHERE id=? AND active=1').get(+q.query.service_id);if(!sv)return bad(s,'Service unavailable',404);
 const d=String(q.query.date||'');if(!validDate(d))return bad(s,'Invalid date');const S=getS();s.json({date:d,slots:slots(d,sv.duration_min,S).map(t=>({start:t,label:fmtT(t)})),closed:!S.hours[dow(d)]})});
app.post('/api/bookings',wrap(async(q,s)=>{const b=q.body||{},S=getS();if(!E.PAYSTACK_SECRET_KEY)return bad(s,'Online payments are not configured yet.',503);
 const name=str(b.name,80),phone=str(b.phone,20).replace(/[^\d+]/g,''),email=str(b.email,120).toLowerCase(),notes=str(b.notes,500),date=str(b.date,10),start=Number.isInteger(b.start)?b.start:-1;
 if(name.length<2||!/^\+?\d{9,15}$/.test(phone)||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))return bad(s,'Please check your name, phone number and email.');
 const sv=db.prepare('SELECT * FROM services WHERE id=? AND active=1').get(+b.service_id);if(!sv)return bad(s,'Service unavailable');if(!validDate(date)||!slots(date,sv.duration_min,S).includes(start))return bad(s,'That time is no longer available. Please choose another.',409);
 const ref='HB-'+crypto.randomBytes(4).toString('hex').toUpperCase(),fee=feeFor(sv.price_cents,S);let id;
 try{id=tx(()=>{const c=conflicts(date,start,start+sv.duration_min);if(c)throw Object.assign(new Error(c),{conflict:1});
  db.prepare('INSERT INTO customers(name,phone,email)VALUES(?,?,?)ON CONFLICT(email)DO UPDATE SET name=excluded.name,phone=excluded.phone').run(name,phone,email);const cid=db.prepare('SELECT id FROM customers WHERE email=?').get(email).id;
  const r=db.prepare("INSERT INTO appointments(reference,customer_id,service_id,service_name,date,start_min,end_min,price_cents,fee_cents,status,hold_expires,notes)VALUES(?,?,?,?,?,?,?,?,?,'pending_payment',?,?)").run(ref,cid,sv.id,sv.name,date,start,start+sv.duration_min,sv.price_cents,fee,Date.now()+S.hold_minutes*60e3,notes);
  db.prepare('INSERT INTO payments(appointment_id,reference,amount_cents)VALUES(?,?,?)').run(r.lastInsertRowid,ref,fee);return r.lastInsertRowid})}catch(e){if(e.conflict)return bad(s,e.message,409);throw e}
 const r=await PS('/transaction/initialize',{method:'POST',body:JSON.stringify({email,amount:fee,currency:'ZAR',reference:ref,callback_url:BASE+'/api/payments/callback',metadata:{booking:ref}})});
 if(!r.status){db.prepare("UPDATE appointments SET status='payment_failed',hold_expires=NULL WHERE id=?").run(id);return bad(s,'Could not start payment. Please try again.',502)}
 {const a=A(id);if(getS().notify.admin_email)send(id,'admin_new_pending','email',getS().contact_email||E.ADMIN_EMAIL,`[New booking started] ${a.service_name} – ${a.reference}`,html(getS(),'New booking awaiting payment',[['Customer',a.cname],['Phone',a.phone],['Email',a.email],['Service',a.service_name],['Date',a.date],['Time',fmtT(a.start_min)],['Price (excl. hair)',R(a.price_cents)],['Fee due',R(a.fee_cents)],['Notes',a.notes||'-']],'Not confirmed until payment is verified.'),'New booking '+a.reference).catch(()=>{})}
 s.json({reference:ref,payment_url:r.data.authorization_url})}));
app.get('/api/payments/callback',wrap(async(q,s)=>{const ref=String(q.query.reference||q.query.trxref||'');if(/^HB-[0-9A-F]{8}$/.test(ref))await confirmPayment(ref);s.redirect('/book?ref='+encodeURIComponent(ref))}));
const pub=a=>({reference:a.reference,service:a.service_name,date:a.date,time:fmtT(a.start_min)+' – '+fmtT(a.end_min),status:a.status,price_cents:a.price_cents,fee_cents:a.fee_cents,balance_cents:a.price_cents-a.fee_cents,name:a.cname});
app.get('/api/bookings/:ref',wrap(async(q,s)=>{let a=db.prepare('SELECT id FROM appointments WHERE reference=?').get(q.params.ref);if(!a)return bad(s,'Not found',404);
 if(A(a.id).status==='pending_payment'&&E.PAYSTACK_SECRET_KEY)await confirmPayment(q.params.ref);s.json(pub(A(a.id)))}));
app.post('/api/bookings/:ref/cancel',wrap(async(q,s)=>{const a=db.prepare('SELECT id FROM appointments WHERE reference=?').get(q.params.ref),S=getS();if(!a)return bad(s,'Not found',404);const x=A(a.id);
 if(str(q.body.email,120).toLowerCase()!==x.email)return bad(s,'Email does not match this booking',403);if(!['confirmed','pending_payment'].includes(x.status))return bad(s,'This booking cannot be cancelled');
 if((new Date(x.date+'T00:00:00Z').getTime()+x.start_min*60e3-7200e3)-Date.now()<S.cancel_hours*3600e3)return bad(s,`Bookings can only be cancelled online ${S.cancel_hours}h or more before the appointment. Please contact the salon.`,403);
 db.prepare("UPDATE appointments SET status='cancelled',hold_expires=NULL WHERE id=?").run(x.id);notify(x.id,'cancelled');s.json({ok:true})}));
// admin auth
const sign=p=>{const b=Buffer.from(JSON.stringify(p)).toString('base64url');return b+'.'+crypto.createHmac('sha256',SECRET).update(b).digest('base64url')};
const unsign=t=>{const[b,m]=String(t||'').split('.');if(!m)return null;const x=crypto.createHmac('sha256',SECRET).update(b).digest('base64url');if(m.length!==x.length||!crypto.timingSafeEqual(Buffer.from(m),Buffer.from(x)))return null;const p=JSON.parse(Buffer.from(b,'base64url'));return p.exp>Date.now()?p:null};
const ck=q=>Object.fromEntries((q.headers.cookie||'').split(';').map(c=>c.trim().split('=')).filter(c=>c[0]));
const fails=new Map();
app.post('/api/admin/login',(q,s)=>{const ip=q.ip,f=fails.get(ip)||{n:0,t:0};if(f.n>=8&&Date.now()-f.t<9e5)return bad(s,'Too many attempts. Try later.',429);
 const a=db.prepare('SELECT * FROM administrators WHERE email=?').get(str(q.body.email,120).toLowerCase());if(!a||!checkPw(String(q.body.password||''),a.pass_hash)){fails.set(ip,{n:f.n+1,t:Date.now()});return bad(s,'Invalid credentials',401)}
 fails.delete(ip);s.set('Set-Cookie',`adm=${sign({id:a.id,exp:Date.now()+12*36e5})}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${BASE.startsWith('https')?'; Secure':''}`);s.json({ok:true})});
app.post('/api/admin/logout',(q,s)=>{s.set('Set-Cookie','adm=; HttpOnly; Path=/; Max-Age=0');s.json({ok:true})});
const admin=express.Router();admin.use((q,s,n)=>{if(!unsign(ck(q).adm))return bad(s,'Unauthorised',401);if(q.method!=='GET'&&!/json/.test(q.headers['content-type']||''))return bad(s,'Bad request');n()});app.use('/api/admin',admin);
admin.get('/me',(q,s)=>s.json({ok:true}));
admin.get('/stats',(q,s)=>{const t=todayStr(),c=(w,...p)=>db.prepare('SELECT COUNT(*) n FROM appointments WHERE '+w).get(...p).n;
 const paid=db.prepare("SELECT COALESCE(SUM(amount_cents),0) v FROM payments WHERE status='paid'").get().v,out=db.prepare("SELECT COALESCE(SUM(price_cents-fee_cents),0) v FROM appointments WHERE status='confirmed'").get().v;
 s.json({total:c('1=1'),today:c("date=? AND status IN('confirmed','completed')",t),upcoming:c("date>=? AND status='confirmed'",t),pending:c("status='pending_payment' AND hold_expires>?",Date.now()),confirmed:c("status='confirmed'"),cancelled:c("status='cancelled'"),fees_collected_cents:paid,outstanding_cents:out})});
const LIST=`SELECT a.*,c.name cname,c.phone,c.email,p.reference pay_ref,p.status pay_status,p.provider_ref FROM appointments a JOIN customers c ON c.id=a.customer_id LEFT JOIN payments p ON p.appointment_id=a.id`;
admin.get('/appointments',(q,s)=>{const w=[],p=[],Q=q.query;if(Q.q){w.push('(c.name LIKE ? OR a.reference LIKE ?)');p.push(`%${Q.q}%`,`%${Q.q}%`)}if(Q.status){w.push('a.status=?');p.push(Q.status)}if(Q.from){w.push('a.date>=?');p.push(Q.from)}if(Q.to){w.push('a.date<=?');p.push(Q.to)}
 s.json(db.prepare(LIST+(w.length?' WHERE '+w.join(' AND '):'')+' ORDER BY a.date DESC,a.start_min LIMIT 500').all(...p))});
admin.post('/appointments',wrap(async(q,s)=>{const b=q.body,S=getS(),sv=db.prepare('SELECT * FROM services WHERE id=?').get(+b.service_id);if(!sv)return bad(s,'Service not found');const date=str(b.date,10),start=b.start;
 const name=str(b.name,80),phone=str(b.phone,20),email=str(b.email,120).toLowerCase()||`walkin-${Date.now()}@noemail.local`;if(!name||!validDate(date)||date<todayStr()||!Number.isInteger(start))return bad(s,'Invalid details');
 const h=S.hours[dow(date)];if(!h||start<h[0]||start+sv.duration_min>h[1])return bad(s,'Outside operating hours');const ref='HB-'+crypto.randomBytes(4).toString('hex').toUpperCase();let id;
 try{id=tx(()=>{const c=conflicts(date,start,start+sv.duration_min);if(c)throw Object.assign(new Error(c),{conflict:1});db.prepare('INSERT INTO customers(name,phone,email)VALUES(?,?,?)ON CONFLICT(email)DO UPDATE SET name=excluded.name,phone=excluded.phone').run(name,phone,email);
  return db.prepare("INSERT INTO appointments(reference,customer_id,service_id,service_name,date,start_min,end_min,price_cents,fee_cents,status,notes,source)VALUES(?,(SELECT id FROM customers WHERE email=?),?,?,?,?,?,?,0,'confirmed',?,'manual')").run(ref,email,sv.id,sv.name,date,start,start+sv.duration_min,sv.price_cents,str(b.notes,500)).lastInsertRowid})}catch(e){if(e.conflict)return bad(s,e.message,409);throw e}
 notify(id,'confirmed');s.json({id,reference:ref})}));
admin.post('/appointments/:id/status',(q,s)=>{const st=q.body.status,a=A(+q.params.id);if(!a)return bad(s,'Not found',404);if(!['confirmed','cancelled','completed'].includes(st))return bad(s,'Invalid status');
 if(st==='confirmed'&&a.status!=='confirmed'&&conflicts(a.date,a.start_min,a.end_min,a.id))return bad(s,'Slot no longer free',409);
 if(st==='completed'&&a.status!=='confirmed')return bad(s,'Only confirmed bookings can be completed');db.prepare('UPDATE appointments SET status=?,hold_expires=NULL WHERE id=?').run(st,a.id);if(st==='cancelled')notify(a.id,'cancelled');s.json({ok:true})});
admin.post('/appointments/:id/reschedule',(q,s)=>{const a=A(+q.params.id),S=getS(),date=str(q.body.date,10),start=q.body.start;if(!a||!validDate(date)||!Number.isInteger(start))return bad(s,'Invalid');const h=S.hours[dow(date)],end=start+(a.end_min-a.start_min);
 if(date<todayStr()||!h||start<h[0]||end>h[1])return bad(s,'Outside operating hours or in the past');try{tx(()=>{const c=conflicts(date,start,end,a.id);if(c)throw Object.assign(new Error(c),{conflict:1});db.prepare('UPDATE appointments SET date=?,start_min=?,end_min=? WHERE id=?').run(date,start,end,a.id);
 db.prepare("DELETE FROM notifications WHERE appointment_id=? AND type IN('reminder24','reminder3')").run(a.id)})}catch(e){return bad(s,e.message,409)}
 db.prepare("DELETE FROM notifications WHERE appointment_id=? AND type='rescheduled'").run(a.id);notify(a.id,'rescheduled');s.json({ok:true})});
admin.get('/slots',(q,s)=>{const sv=db.prepare('SELECT * FROM services WHERE id=?').get(+q.query.service_id);const S=getS();s.json(sv?slots(String(q.query.date),sv.duration_min,S,+q.query.exclude||0).map(t=>({start:t,label:fmtT(t)})):[])});
const img=(d)=>{if(!d)return null;const m=/^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(d);if(!m)return null;const buf=Buffer.from(m[2],'base64');if(buf.length>4e6)return null;const f=crypto.randomBytes(8).toString('hex')+'.'+(m[1]==='jpeg'?'jpg':m[1]);fs.writeFileSync(path.join(DATA,'uploads',f),buf);return'/uploads/'+f};
admin.get('/services',(q,s)=>s.json(db.prepare('SELECT * FROM services ORDER BY sort,id').all()));
const svcVals=b=>{const price=Math.round(+b.price*100),dur=+b.duration_min;if(!str(b.name,100)||!(price>=0)||!(dur>0&&dur<=720))return null;return[str(b.name,100),str(b.description,800),price,dur,str(b.requirements,300),str(b.category,40)||'Styling',b.active?1:0,+b.sort||0]};
admin.post('/services',(q,s)=>{const v=svcVals(q.body);if(!v)return bad(s,'Invalid service');const im=img(q.body.image_data)||str(q.body.image,300);s.json({id:db.prepare('INSERT INTO services(name,description,price_cents,duration_min,requirements,category,active,sort,image)VALUES(?,?,?,?,?,?,?,?,?)').run(...v,im).lastInsertRowid})});
admin.put('/services/:id',(q,s)=>{const v=svcVals(q.body);if(!v)return bad(s,'Invalid service');const im=img(q.body.image_data);db.prepare('UPDATE services SET name=?,description=?,price_cents=?,duration_min=?,requirements=?,category=?,active=?,sort=?'+(im?',image=?':'')+' WHERE id=?').run(...v,...(im?[im]:[]),+q.params.id);s.json({ok:true})});
admin.delete('/services/:id',(q,s)=>{if(db.prepare('SELECT 1 FROM appointments WHERE service_id=?').get(+q.params.id)){db.prepare('UPDATE services SET active=0 WHERE id=?').run(+q.params.id);return s.json({ok:true,note:'Service has bookings so it was disabled instead of deleted.'})}db.prepare('DELETE FROM services WHERE id=?').run(+q.params.id);s.json({ok:true})});
admin.get('/settings',(q,s)=>s.json(getS()));
admin.put('/settings',(q,s)=>{const b=q.body,K=Object.keys(DEF);for(const k of K)if(k in b){let v=b[k];
 if(k==='hours'){for(let d=0;d<7;d++){const h=v[d];if(h!==null&&!(Array.isArray(h)&&h[0]>=0&&h[1]<=1440&&h[0]<h[1]))return bad(s,'Invalid hours')}}
 else if(k==='fee_type'&&!['fixed','percent'].includes(v))return bad(s,'Invalid fee type');else if(k==='fee_value'&&!(Number.isInteger(v)&&v>=0&&(b.fee_type!=='percent'||v<=100)))return bad(s,'Invalid fee value');
 else if(['cancel_hours','slot_step','hold_minutes'].includes(k)&&!(Number.isInteger(v)&&v>0||k==='cancel_hours'&&v===0))return bad(s,'Invalid '+k);
 else if(k==='hero_image'&&v&&v.startsWith('data:'))v=img(v)||'';
 setS(k,v)}s.json({ok:true})});
admin.get('/blocks',(q,s)=>s.json(db.prepare('SELECT * FROM blocked_slots WHERE date>=? ORDER BY date,start_min').all(todayStr())));
admin.post('/blocks',(q,s)=>{const b=q.body;if(!validDate(b.date))return bad(s,'Invalid date');const full=b.start==null;if(!full&&!(b.start>=0&&b.end>b.start))return bad(s,'Invalid times');db.prepare('INSERT INTO blocked_slots(date,start_min,end_min,reason)VALUES(?,?,?,?)').run(b.date,full?null:b.start,full?null:b.end,str(b.reason,100));s.json({ok:true})});
admin.delete('/blocks/:id',(q,s)=>{db.prepare('DELETE FROM blocked_slots WHERE id=?').run(+q.params.id);s.json({ok:true})});
admin.get('/customers',(q,s)=>s.json(db.prepare(`SELECT c.*,COUNT(a.id) bookings,MAX(a.date) last_visit FROM customers c LEFT JOIN appointments a ON a.customer_id=c.id GROUP BY c.id ORDER BY c.created_at DESC`).all()));
admin.get('/customers/:id/history',(q,s)=>s.json(db.prepare('SELECT reference,service_name,date,start_min,status,price_cents,fee_cents FROM appointments WHERE customer_id=? ORDER BY date DESC').all(+q.params.id)));
admin.get('/notifications',(q,s)=>s.json(db.prepare('SELECT n.*,a.reference FROM notifications n LEFT JOIN appointments a ON a.id=n.appointment_id ORDER BY n.id DESC LIMIT 200').all()));
// static
app.use('/uploads',express.static(path.join(DATA,'uploads'),{maxAge:'7d',index:false}));
app.use(express.static(path.join(__dirname,'public'),{extensions:['html'],maxAge:'1h'}));
// background jobs: expire holds, reminders
setInterval(()=>{try{db.prepare("UPDATE appointments SET status='payment_failed',hold_expires=NULL WHERE status='pending_payment' AND hold_expires<?").run(Date.now());
 const S=getS(),now=Date.now();for(const a of db.prepare("SELECT id,date,start_min FROM appointments WHERE status='confirmed' AND date>=?").all(todayStr())){const t=new Date(a.date+'T00:00:00Z').getTime()+a.start_min*60e3-7200e3,d=t-now;
  if(d>0&&d<=24*36e5&&d>4*36e5&&S.notify.reminder24)notify(a.id,'reminder24');if(d>0&&d<=3*36e5&&S.notify.reminder3)notify(a.id,'reminder3')}}catch(e){console.error(e)}},60e3);
if(require.main===module)app.listen(PORT,()=>console.log('Salon on '+BASE));
module.exports={app,db,slots,getS,feeFor,confirmPayment,conflicts};
