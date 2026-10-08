import { supabase } from './supabase.js';

const $ = (s) => document.querySelector(s);
let session, profile, assignment, parentPlace;

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));

const fmt = (v) => v ? new Date(v).toLocaleString('ms-MY') : '-';

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
  } else {
    $('#parentCode').textContent = '-';
    $('#parentName').textContent = 'Tiada tempat tugas induk';
    $('#reportRoute').textContent =
      'Tempat tugas ini tiada saluran atasan untuk laporan.';
    $('#openReport').disabled = true;
  }

  $('#status').textContent = 'Penugasan aktif dimuatkan.';
  await loadCommunication();
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

  const rows = data || [];
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

  s.textContent = `Laporan berjaya dihantar kepada ${parentPlace.kod}.`;
  e.target.reset();
  await loadCommunication();
});

$('#reload').addEventListener('click', loadAssignment);

$('#logout').addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.replace('index.html');
});

await boot();
