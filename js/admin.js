import { supabase } from './supabase.js';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const status=$('#status'); let session=null, profiles=[], operations=[], places=[], assignments=[];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=v=>v?new Date(v).toLocaleString('ms-MY'):'-';

async function requireAdmin(){
 const r=await supabase.auth.getSession(); session=r.data.session;
 if(!session){location.replace('index.html');return false}
 const {data:p,error}=await supabase.from('profiles').select('nama,peranan,aktif').eq('id',session.user.id).single();
 if(error||!p?.aktif||p.peranan!=='PENTADBIR'){location.replace('dashboard.html');return false}
 $('#adminName').textContent=p.nama; return true;
}
async function count(table,filter){let q=supabase.from(table).select('*',{count:'exact',head:true});if(filter)q=q.eq(filter[0],filter[1]);const {count,error}=await q;if(error)throw error;return count??0}
async function load(){
 status.textContent='Memuatkan data...';
 try{
  const [counts,pr,op,pl,as]=await Promise.all([
   Promise.all([count('ecor_operasi'),count('profiles'),count('ecor_tempat_tugas'),count('ecor_penugasan',['aktif',true])]),
   supabase.from('profiles').select('id,no_badan,pangkat,nama,no_telefon,peranan,aktif').order('nama'),
   supabase.from('ecor_operasi').select('*').order('created_at',{ascending:false}),
   supabase.from('ecor_tempat_tugas').select('id,kod,nama,parent_id,aktif,susunan').eq('aktif',true).order('susunan'),
   supabase.from('ecor_penugasan').select('id,operasi_id,profile_id,tempat_tugas_id,peranan,aktif,ecor_operasi(nama_operasi),profiles(nama,no_badan),ecor_tempat_tugas(kod,nama)').order('created_at',{ascending:false})
  ]);
  [$('#operasiCount').textContent,$('#userCount').textContent,$('#tempatCount').textContent,$('#assignCount').textContent]=counts;
  for(const r of [pr,op,pl,as]) if(r.error) throw r.error;
  profiles=pr.data||[];operations=op.data||[];places=pl.data||[];assignments=as.data||[];render();status.textContent='Data dikemas kini.';
 }catch(e){status.textContent=e.message}
}
function render(){
 $('#userRows').innerHTML=profiles.map(p=>`<tr><td>${esc(p.no_badan||'-')}</td><td>${esc(p.pangkat||'-')}</td><td>${esc(p.nama)}</td><td>${esc(p.no_telefon||'-')}</td><td>${esc(p.peranan)}</td><td>${p.aktif?'AKTIF':'TIDAK AKTIF'}</td></tr>`).join('');
 $('#operationRows').innerHTML=operations.map(o=>`<tr><td>${esc(o.nama_operasi)}</td><td>${esc(o.jenis_insiden||'-')}</td><td>${esc(o.lokasi||'-')}</td><td>${fmt(o.tarikh_mula)}</td><td>${fmt(o.tarikh_tamat)}</td><td>${esc(o.status)}</td></tr>`).join('');
 $('#aOperasi').innerHTML='<option value="">Pilih operasi</option>'+operations.filter(o=>o.status==='AKTIF').map(o=>`<option value="${o.id}">${esc(o.nama_operasi)}</option>`).join('');
 $('#aPengguna').innerHTML='<option value="">Pilih pengguna</option>'+profiles.filter(p=>p.aktif&&p.peranan!=='PENTADBIR').map(p=>`<option value="${p.id}">${esc([p.no_badan,p.pangkat,p.nama].filter(Boolean).join(' • '))}</option>`).join('');
 $('#aTempat').innerHTML='<option value="">Pilih tempat tugas</option>'+places.map(p=>`<option value="${p.id}">${esc(p.kod+' — '+p.nama)}</option>`).join('');
 $('#assignmentRows').innerHTML=assignments.map(a=>`<tr><td>${esc(a.ecor_operasi?.nama_operasi||'-')}</td><td>${esc([a.profiles?.no_badan,a.profiles?.nama].filter(Boolean).join(' • ')||'-')}</td><td>${esc((a.ecor_tempat_tugas?.kod||'')+' — '+(a.ecor_tempat_tugas?.nama||''))}</td><td>${esc(a.peranan)}</td><td>${a.aktif?'AKTIF':'TIDAK AKTIF'}</td><td>${a.aktif?`<button class="danger" data-disable="${a.id}">NYAHAKTIF</button>`:'-'}</td></tr>`).join('');
 $$('[data-disable]').forEach(b=>b.onclick=()=>disableAssignment(b.dataset.disable));
}
$$('[data-open]').forEach(b=>b.onclick=()=>{$$('.panel[id]').forEach(p=>p.classList.add('hidden'));$('#'+b.dataset.open).classList.remove('hidden');window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'})});
$$('[data-close]').forEach(b=>b.onclick=()=>b.closest('.panel').classList.add('hidden'));
$('#refresh').onclick=load;
$('#logout').onclick=async()=>{await supabase.auth.signOut();location.replace('index.html')};

$('#userForm').addEventListener('submit',async e=>{
 e.preventDefault();const s=$('#userStatus');s.textContent='Mendaftarkan pengguna...';
 const body={no_badan:$('#uNoBadan').value.trim(),pangkat:$('#uPangkat').value.trim(),nama:$('#uNama').value.trim(),no_telefon:$('#uTelefon').value.trim(),email:$('#uEmail').value.trim(),password:$('#uPassword').value,peranan:$('#uPeranan').value};
 try{
  const {data,error}=await supabase.functions.invoke('daftar-pengguna',{body});
  if(error) throw error;if(!data?.success) throw new Error(data?.error||'Pendaftaran gagal.');
  s.textContent=data.message||'Pengguna berjaya didaftarkan.';e.target.reset();await load();
 }catch(err){s.textContent=err.message}
});
$('#operationForm').addEventListener('submit',async e=>{
 e.preventDefault();const s=$('#operationStatus');s.textContent='Mencipta operasi...';
 const row={nama_operasi:$('#oNama').value.trim(),jenis_insiden:$('#oJenis').value.trim()||null,lokasi:$('#oLokasi').value.trim()||null,tarikh_mula:$('#oMula').value?new Date($('#oMula').value).toISOString():null,tarikh_tamat:$('#oTamat').value?new Date($('#oTamat').value).toISOString():null,status:'AKTIF'};
 const {error}=await supabase.from('ecor_operasi').insert(row);if(error){s.textContent=error.message;return}s.textContent='Operasi berjaya dicipta.';e.target.reset();await load();
});
$('#assignmentForm').addEventListener('submit',async e=>{
 e.preventDefault();const s=$('#assignmentStatus');s.textContent='Menyimpan penugasan...';
 const row={operasi_id:$('#aOperasi').value,profile_id:$('#aPengguna').value,tempat_tugas_id:$('#aTempat').value,peranan:$('#aPeranan').value,aktif:true};
 const {error}=await supabase.from('ecor_penugasan').insert(row);if(error){s.textContent=error.code==='23505'?'Penugasan ini telah wujud.':error.message;return}s.textContent='Penugasan berjaya disimpan.';e.target.reset();await load();
});
async function disableAssignment(id){if(!confirm('Nyahaktifkan penugasan ini?'))return;const {error}=await supabase.from('ecor_penugasan').update({aktif:false}).eq('id',id);$('#assignmentStatus').textContent=error?error.message:'Penugasan dinyahaktifkan.';if(!error)await load()}
if(await requireAdmin()) await load();
