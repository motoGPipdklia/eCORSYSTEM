import { supabase } from './supabase.js';

const $ = (s) => document.querySelector(s);
let session, profile, assignment, parentPlace;

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));

const fmt = (v) => v ? new Date(v).toLocaleString('ms-MY') : '-';

function setReportModeForCurrentRoute() {
  if (!assignment || !parentPlace) return;

  const fromCode = assignment.ecor_tempat_tugas?.kod || '-';
  const toCode = parentPlace.kod || '-';
  const isCorToAccc = fromCode === 'COR' && toCode === 'ACCC';

  $('#routeFrom').textContent = `${fromCode} — ${assignment.ecor_tempat_tugas?.nama || '-'}`;
  $('#routeTo').textContent = `${toCode} — ${parentPlace.nama || '-'}`;

  const form = $('#reportForm');
  if (form) form.dataset.routeMode = isCorToAccc ? 'COR_ACCC' : 'NORMAL';

  const submit = form?.querySelector('button[type="submit"]');
  if (submit) submit.textContent = isCorToAccc ? 'HANTAR LAPORAN KE ACCC' : 'HANTAR LAPORAN';

  const heading = $('#reportPanel h2');
  if (heading) heading.textContent = isCorToAccc ? 'Laporan COR → ACCC' : 'Hantar Laporan';
}

async function boot() {
  const s = await supabase.auth.getSession();
  session = s.data.session;

  if (!session) {
    location.replace('index.html');
    return;
  }

  const p = await supabase
    .from('profiles')
    .select('id,nama,no_badan,pangkat,peranan,aktif')
    .eq('id', session.user.id)
    .single();

  if (p.error || !p.data?.aktif) {
    await supabase.auth.signOut();
    location.replace('index.html');
    return;
  }

  profile = p.data;

  if (profile.peranan === 'PENTADBIR') {
    location.replace('admin.html');
    return;
  }

  $('#nama').textContent = profile.nama;
  $('#profil').textContent = [profile.pangkat, profile.no_badan, profile.peranan]
    .filter(Boolean).join(' • ');

  await loadAssignment();
}

async function loadAssignment() {
  $('#status').textContent = 'Memuatkan penugasan aktif...';

  const { data, error } = await supabase
    .from('ecor_penugasan')
    .select(`
      id,operasi_id,profile_id,tempat_tugas_id,peranan,aktif,created_at,
      ecor_operasi(id,nama_operasi,jenis_insiden,lokasi,tarikh_mula,tarikh_tamat,status),
      ecor_tempat_tugas(id,kod,nama,parent_id)
    `)
    .eq('profile_id', session.user.id)
    .eq('aktif', true)
    .order('created_at', { ascending: false });

  if (error) {
    $('#status').textContent = error.message;
    disableReporting();
    return;
  }

  assignment = (data || []).find(x => x.ecor_operasi?.status === 'AKTIF') || data?.[0];

  if (!assignment) {
    $('#status').textContent = 'Tiada penugasan aktif.';
    disableReporting();
    return;
  }

  const op = assignment.ecor_operasi;
  const place = assignment.ecor_tempat_tugas;

  $('#operationName').textContent = op?.nama_operasi || 'Operasi';
  $('#operationMeta').textContent = [
    op?.jenis_insiden,
    op?.lokasi,
    op?.tarikh_mula ? `Mula: ${fmt(op.tarikh_mula)}` : null
  ].filter(Boolean).join(' • ');

  $('#placeCode').textContent = place?.kod || '-';
  $('#placeName').textContent = place?.nama || '-';
  $('#assignmentRole').textContent = assignment.peranan || '-';

  parentPlace = null;
  if (place?.parent_id) {
    const r = await supabase
      .from('ecor_tempat_tugas')
      .select('id,kod,nama,parent_id')
      .eq('id', place.parent_id)
      .single();

    if (!r.error) parentPlace = r.data;
  }

  if (parentPlace) {
    $('#parentCode').textContent = parentPlace.kod;
    $('#parentName').textContent = parentPlace.nama;
    $('#reportRoute').textContent =
      `Laporan ${place.kod} hanya dihantar kepada ${parentPlace.kod}.`;
    $('#routeFrom').textContent = `${place.kod} — ${place.nama}`;
    $('#routeTo').textContent = `${parentPlace.kod} — ${parentPlace.nama}`;
    $('#openReport').disabled = false;
    setReportModeForCurrentRoute();
  } else {
    $('#parentCode').textContent = '-';
    $('#parentName').textContent = 'Tiada tempat tugas induk';
    $('#reportRoute').textContent =
      'Tempat tugas ini tiada saluran atasan untuk laporan.';
    $('#openReport').disabled = true;
  }

  $('#status').textContent = 'Penugasan aktif dimuatkan.';
  await loadCommunication();
  await renderControlRoom();
}

function disableReporting() {
  $('#openReport').disabled = true;
  $('#placeCode').textContent = '-';
  $('#placeName').textContent = 'Tiada penugasan aktif';
  $('#assignmentRole').textContent = '-';
  $('#parentCode').textContent = '-';
  $('#parentName').textContent = '-';
}

async function loadCommunication() {
  if (!assignment) return;

  const { data, error } = await supabase
    .from('ecor_komunikasi')
    .select(`
      id,jenis,tajuk,kandungan,keutamaan,status,created_at,
      pengirim_id,dari_tempat_tugas_id,kepada_tempat_tugas_id,
      dari:ecor_tempat_tugas!ecor_komunikasi_dari_tempat_tugas_id_fkey(kod,nama),
      kepada:ecor_tempat_tugas!ecor_komunikasi_kepada_tempat_tugas_id_fkey(kod,nama)
    `)
    .eq('operasi_id', assignment.operasi_id)
    .order('created_at', { ascending: false });

  if (error) {
    $('#historyList').innerHTML = `<p class="status">${esc(error.message)}</p>`;
    return;
  }

  const allRows = data || [];
  const rows = allRows.filter(x =>
    x.dari_tempat_tugas_id === assignment.tempat_tugas_id ||
    x.kepada_tempat_tugas_id === assignment.tempat_tugas_id
  );
  const instructions = rows.filter(x =>
    x.jenis === 'ARAHAN' &&
    x.kepada_tempat_tugas_id === assignment.tempat_tugas_id
  );

  $('#instructionCount').textContent = instructions.length;
  $('#communicationCount').textContent = rows.length;

  $('#instructionList').innerHTML = instructions.length
    ? instructions.map(messageCard).join('')
    : '<p class="muted">Tiada arahan diterima.</p>';

  $('#historyList').innerHTML = rows.length
    ? rows.map(messageCard).join('')
    : '<p class="muted">Tiada komunikasi direkodkan.</p>';
}

function messageCard(m) {
  return `<article class="message">
    <div class="message-head">
      <span class="badge ${esc(m.keutamaan)}">${esc(m.keutamaan)}</span>
      <b>${esc(m.jenis)}</b>
      <small>${esc(fmt(m.created_at))}</small>
    </div>
    <h3>${esc(m.tajuk)}</h3>
    <p>${esc(m.kandungan)}</p>
    <div class="message-route">
      ${esc(m.dari?.kod || '-')} → ${esc(m.kepada?.kod || '-')}
      • ${esc(m.status)}
    </div>
  </article>`;
}

$('#openReport').addEventListener('click', () => {
  if (!assignment || !parentPlace) return;
  setReportModeForCurrentRoute();
  $('#reportPanel').classList.remove('hidden');
  $('#reportPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('#closeReport').addEventListener('click', () => {
  $('#reportPanel').classList.add('hidden');
});

$('#reportForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const s = $('#reportStatus');
  if (!assignment || !parentPlace) {
    s.textContent = 'Saluran laporan tidak tersedia.';
    return;
  }

  s.textContent = 'Menghantar laporan...';

  const payload = {
    operasi_id: assignment.operasi_id,
    pengirim_id: session.user.id,
    dari_tempat_tugas_id: assignment.tempat_tugas_id,
    kepada_tempat_tugas_id: parentPlace.id,
    jenis: 'LAPORAN',
    tajuk: $('#reportTitle').value.trim(),
    kandungan: $('#reportBody').value.trim(),
    keutamaan: $('#reportPriority').value,
    status: 'DIHANTAR'
  };

  const { error } = await supabase.from('ecor_komunikasi').insert(payload);

  if (error) {
    s.textContent = error.message;
    return;
  }

  const isCorToAccc = assignment.ecor_tempat_tugas?.kod === 'COR' && parentPlace.kod === 'ACCC';
  s.textContent = isCorToAccc
    ? 'Laporan COR berjaya dihantar kepada ACCC.'
    : `Laporan berjaya dihantar kepada ${parentPlace.kod}.`;
  e.target.reset();
  await loadCommunication();
});

$('#reload').addEventListener('click', loadAssignment);

$('#logout').addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.replace('index.html');
});

await boot();


async function renderControlRoom() {
  const old = document.querySelector('#controlRoomPanel');
  if (old) old.remove();

  const code = assignment?.ecor_tempat_tugas?.kod;
  if (code !== 'COR') return;

  const panel = document.createElement('section');
  panel.id = 'controlRoomPanel';
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="section-head">
      <div><p class="eyebrow">CONTROL ROOM</p><h2>COR — Pusat Pengumpulan Maklumat</h2></div>
      <button id="refreshInbox" class="ghost">MUAT SEMULA</button>
    </div>
    <div class="cor-metrics">
      <div><small>LAPORAN MASUK</small><strong id="corTotal">0</strong></div>
      <div><small>BELUM DIBACA</small><strong id="corNew">0</strong></div>
      <div><small>KRITIKAL</small><strong id="corCritical">0</strong></div>
      <div><small>DALAM TINDAKAN</small><strong id="corAction">0</strong></div>
    </div>
    <h3>Peti Masuk COR</h3>
    <div id="corInbox" class="message-list"><p class="muted">Memuatkan laporan...</p></div>
    <hr>
    <h3>Laporan COR kepada ACCC</h3>
    <p class="muted">COR boleh merumuskan maklumat yang diterima dan menghantar laporan satu aras ke ACCC.</p>
    <button id="corToAccc">SEDIA LAPORAN KE ACCC</button>
  `;
  document.querySelector('main').appendChild(panel);
  document.querySelector('#refreshInbox').onclick = loadCorInbox;
  document.querySelector('#corToAccc').onclick = () => {
    if (!parentPlace || parentPlace.kod !== 'ACCC') {
      alert('Saluran COR → ACCC tidak tersedia. Semak parent tempat tugas COR.');
      return;
    }
    setReportModeForCurrentRoute();
    $('#reportPanel').classList.remove('hidden');
    $('#reportPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('#reportTitle')?.focus();
  };
  await loadCorInbox();
}

async function loadCorInbox() {
  if (assignment?.ecor_tempat_tugas?.kod !== 'COR') return;
  const { data, error } = await supabase
    .from('ecor_komunikasi')
    .select(`
      id,jenis,tajuk,kandungan,keutamaan,status,created_at,pengirim_id,
      dari_tempat_tugas_id,kepada_tempat_tugas_id,
      dari:ecor_tempat_tugas!ecor_komunikasi_dari_tempat_tugas_id_fkey(kod,nama),
      kepada:ecor_tempat_tugas!ecor_komunikasi_kepada_tempat_tugas_id_fkey(kod,nama)
    `)
    .eq('operasi_id', assignment.operasi_id)
    .eq('kepada_tempat_tugas_id', assignment.tempat_tugas_id)
    .eq('jenis', 'LAPORAN')
    .order('created_at', { ascending:false });

  const box=document.querySelector('#corInbox');
  if (error) { box.innerHTML=`<p class="status">${esc(error.message)}</p>`; return; }
  const rows=data||[];
  document.querySelector('#corTotal').textContent=rows.length;
  document.querySelector('#corNew').textContent=rows.filter(x=>x.status==='DIHANTAR'||x.status==='BARU').length;
  document.querySelector('#corCritical').textContent=rows.filter(x=>x.keutamaan==='KRITIKAL').length;
  document.querySelector('#corAction').textContent=rows.filter(x=>x.status==='DALAM TINDAKAN').length;

  box.innerHTML=rows.length ? rows.map(x=>`
    <article class="message">
      <div class="message-head">
        <span class="badge ${esc(x.keutamaan)}">${esc(x.keutamaan)}</span>
        <b>${esc(x.dari?.kod||'-')} → COR</b>
        <small>${esc(fmt(x.created_at))}</small>
      </div>
      <h3>${esc(x.tajuk)}</h3>
      <p>${esc(x.kandungan)}</p>
      <div class="message-route">STATUS: ${esc(x.status)}</div>
      <div class="message-actions">
        <button data-read="${x.id}" class="ghost">TANDA DIBACA</button>
        <button data-action="${x.id}" class="ghost">DALAM TINDAKAN</button>
        <button data-reply="${x.id}">HANTAR ARAHAN</button>
      </div>
    </article>`).join('') : '<p class="muted">Tiada laporan diterima.</p>';

  box.querySelectorAll('[data-read]').forEach(b=>b.onclick=()=>setMessageStatus(b.dataset.read,'DIBACA'));
  box.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>setMessageStatus(b.dataset.action,'DALAM TINDAKAN'));
  box.querySelectorAll('[data-reply]').forEach(b=>b.onclick=()=>replyInstruction(rows.find(x=>x.id===b.dataset.reply)));
}

async function setMessageStatus(id,status) {
  const { error }=await supabase.from('ecor_komunikasi').update({status}).eq('id',id);
  if (error) { alert(error.message); return; }
  await loadCorInbox();
  await loadCommunication();
}

async function replyInstruction(source) {
  if (!source?.dari_tempat_tugas_id) return;
  const title=prompt(`Tajuk arahan kepada ${source.dari?.kod||'tempat tugas'}:`);
  if (!title) return;
  const body=prompt('Kandungan arahan:');
  if (!body) return;

  const { error }=await supabase.from('ecor_komunikasi').insert({
    operasi_id: assignment.operasi_id,
    pengirim_id: session.user.id,
    dari_tempat_tugas_id: assignment.tempat_tugas_id,
    kepada_tempat_tugas_id: source.dari_tempat_tugas_id,
    jenis:'ARAHAN',
    tajuk:title.trim(),
    kandungan:body.trim(),
    keutamaan:source.keutamaan || 'BIASA',
    status:'DIHANTAR'
  });
  if (error) { alert(error.message); return; }
  alert(`Arahan berjaya dihantar kepada ${source.dari?.kod||'tempat tugas'}.`);
  await loadCorInbox();
  await loadCommunication();
}