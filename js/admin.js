import { supabase } from './supabase.js';
const $=s=>document.querySelector(s), status=$('#status');
async function requireAdmin(){const {data:{session}}=await supabase.auth.getSession();if(!session){location.replace('index.html');return null;}const {data:p,error}=await supabase.from('profiles').select('nama,peranan,aktif').eq('id',session.user.id).single();if(error||!p?.aktif||p.peranan!=='PENTADBIR'){location.replace('dashboard.html');return null;}$('#adminName').textContent=p.nama;return session;}
async function count(table, filter){let q=supabase.from(table).select('*',{count:'exact',head:true});if(filter) q=q.eq(filter[0],filter[1]);const {count,error}=await q;if(error) throw error;return count??0;}
async function load(){status.textContent='Memuatkan data...';try{const [o,u,t,a]=await Promise.all([count('ecor_operasi'),count('profiles'),count('ecor_tempat_tugas'),count('ecor_penugasan',['aktif',true])]);$('#operasiCount').textContent=o;$('#userCount').textContent=u;$('#tempatCount').textContent=t;$('#assignCount').textContent=a;status.textContent='Data dikemas kini.';}catch(e){status.textContent=e.message}}
if(await requireAdmin()) await load();
$('#refresh').addEventListener('click',load);$('#logout').addEventListener('click',async()=>{await supabase.auth.signOut();location.replace('index.html')});
