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
  await renderAcccRoom();
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
    ? instructionTable(instructions)
    : '<p class="muted">Tiada arahan diterima.</p>';

  // KRONOLOGI: hanya LAPORAN / ARAHAN yang DITERIMA oleh tempat tugas semasa.
  // Susunan paling awal di atas supaya perjalanan komunikasi mudah diikuti.
  const receivedChronology = rows
    .filter(x =>
      x.kepada_tempat_tugas_id === assignment.tempat_tugas_id &&
      (x.jenis === 'LAPORAN' || x.jenis === 'ARAHAN')
    )
    .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));

  renderChronology(receivedChronology);

  $('#historyList').innerHTML = rows.length
    ? rows.map(messageCard).join('')
    : '<p class="muted">Tiada komunikasi direkodkan.</p>';
}


function renderChronology(items) {
  let panel = document.querySelector('#chronologyPanel');

  if (!panel) {
    const instructionList = document.querySelector('#instructionList');
    const instructionPanel = instructionList?.closest('section');
    if (!instructionPanel) return;

    panel = document.createElement('section');
    panel.id = 'chronologyPanel';
    panel.className = 'panel';
    panel.innerHTML = `
      <h2>KRONOLOGI</h2>
      <div id="chronologyList" class="message-list">
        <p class="muted">Tiada laporan atau arahan diterima.</p>
      </div>`;
    instructionPanel.insertAdjacentElement('afterend', panel);
  }

  const box = panel.querySelector('#chronologyList');
  if (!box) return;

  box.innerHTML = items.length
    ? chronologyTable(items)
    : '<p class="muted">Tiada laporan atau arahan diterima.</p>';
}

function chronologyTable(items) {
  const body = items.map((m, index) => {
    const dt = m.created_at ? new Date(m.created_at) : null;
    const tarikh = dt ? dt.toLocaleDateString('ms-MY') : '-';
    const masa = dt ? dt.toLocaleTimeString('ms-MY', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }) : '-';
    const penghantar = m.dari?.kod || m.dari?.nama || '-';

    return `<tr>
      <td>${index + 1}</td>
      <td>${esc(tarikh)}</td>
      <td>${esc(masa)}</td>
      <td><strong>${esc(m.tajuk || '-')}</strong></td>
      <td>${esc(m.kandungan || '-')}</td>
      <td><strong>${esc(penghantar)}</strong></td>
    </tr>`;
  }).join('');

  return `<div style="overflow-x:auto;width:100%;">
    <table style="width:100%;border-collapse:collapse;min-width:980px;">
      <thead>
        <tr>
          <th style="text-align:left;padding:12px;border-bottom:1px solid #244052;">BIL</th>
          <th style="text-align:left;padding:12px;border-bottom:1px solid #244052;">TARIKH</th>
          <th style="text-align:left;padding:12px;border-bottom:1px solid #244052;">MASA</th>
          <th style="text-align:left;padding:12px;border-bottom:1px solid #244052;">PERKARA</th>
          <th style="text-align:left;padding:12px;border-bottom:1px solid #244052;">CATATAN</th>
          <th style="text-align:left;padding:12px;border-bottom:1px solid #244052;">PENGHANTAR</th>
        </tr>
      </thead>
      <tbody>${body.replaceAll('<td>', '<td style="padding:12px;border-bottom:1px solid #1b3444;vertical-align:top;">')}</tbody>
    </table>
  </div>`;
}


function instructionTable(instructions) {
  const rows = instructions.map(m => {
    const dt = m.created_at ? new Date(m.created_at) : null;
    const tarikh = dt ? dt.toLocaleDateString('ms-MY') : '-';
    const masa = dt ? dt.toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-';
    const catatan = m.kandungan || '-';

    return `<tr>
      <td>${esc(tarikh)}</td>
      <td>${esc(masa)}</td>
      <td><strong>${esc(m.tajuk || '-')}</strong></td>
      <td>${esc(catatan)}</td>
    </tr>`;
  }).join('');

  return `<div style="overflow-x:auto;width:100%;">
    <table style="width:100%;border-collapse:collapse;min-width:720px;">
      <thead>
        <tr>
          <th style="text-align:left;padding:12px;border-bottom:1px solid #244052;">TARIKH</th>
          <th style="text-align:left;padding:12px;border-bottom:1px solid #244052;">MASA</th>
          <th style="text-align:left;padding:12px;border-bottom:1px solid #244052;">PERKARA</th>
          <th style="text-align:left;padding:12px;border-bottom:1px solid #244052;">CATATAN</th>
        </tr>
      </thead>
      <tbody>${rows.replaceAll('<td>', '<td style="padding:12px;border-bottom:1px solid #1b3444;vertical-align:top;">')}</tbody>
    </table>
  </div>`;
}

function messageCard(m) {
  const currentCode = assignment?.ecor_tempat_tugas?.kod;
  const isCorSentToAccc = currentCode === 'COR' && m.dari?.kod === 'COR' && m.kepada?.kod === 'ACCC';
  const statusText = isCorSentToAccc && m.status === 'DIBACA'
    ? 'DIBACA OLEH ACCC'
    : isCorSentToAccc && m.status === 'DALAM_TINDAKAN'
      ? 'DALAM TINDAKAN OLEH ACCC'
      : (m.status === 'DALAM_TINDAKAN' ? 'DALAM TINDAKAN' : m.status);

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
      • ${esc(statusText)}
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
    .neq('status', 'DITERIMA')
    .order('created_at', { ascending:false });

  const box=document.querySelector('#corInbox');
  if (error) { box.innerHTML=`<p class="status">${esc(error.message)}</p>`; return; }
  const rows=data||[];
  document.querySelector('#corTotal').textContent=rows.length;
  document.querySelector('#corNew').textContent=rows.filter(x=>x.status==='DIHANTAR'||x.status==='BARU').length;
  document.querySelector('#corCritical').textContent=rows.filter(x=>x.keutamaan==='KRITIKAL').length;
  document.querySelector('#corAction').textContent=rows.filter(x=>x.status==='DALAM_TINDAKAN').length;

  box.innerHTML=rows.length ? rows.map(x=>`
    <article class="message">
      <div class="message-head">
        <span class="badge ${esc(x.keutamaan)}">${esc(x.keutamaan)}</span>
        <b>${esc(x.dari?.kod||'-')} → COR</b>
        <small>${esc(fmt(x.created_at))}</small>
      </div>
      <h3>${esc(x.tajuk)}</h3>
      <p>${esc(x.kandungan)}</p>
      <div class="message-route">STATUS: ${esc(x.status === 'DALAM_TINDAKAN' ? 'DALAM TINDAKAN' : x.status)}</div>
      <div class="message-actions">
        <button data-action="${x.id}" class="ghost">DALAM TINDAKAN</button>
        <button data-reply="${x.id}">BALAS</button>
      </div>
    </article>`).join('') : '<p class="muted">Tiada laporan diterima.</p>';

  box.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>setMessageStatus(b.dataset.action,'DALAM_TINDAKAN'));
  box.querySelectorAll('[data-reply]').forEach(b=>b.onclick=()=>replyInstruction(rows.find(x=>x.id===b.dataset.reply)));
}

async function setMessageStatus(id, status) {
  // Penting: .select() digunakan supaya kita boleh kesan jika RLS menyebabkan
  // UPDATE tidak mengubah sebarang rekod walaupun Supabase tidak memulangkan error.
  const { data, error } = await supabase
    .from('ecor_komunikasi')
    .update({ status })
    .eq('id', id)
    .eq('operasi_id', assignment.operasi_id)
    .eq('kepada_tempat_tugas_id', assignment.tempat_tugas_id)
    .select('id,status,dari_tempat_tugas_id,kepada_tempat_tugas_id')
    .maybeSingle();

  if (error) {
    alert(`Gagal mengubah status: ${error.message}`);
    return;
  }

  if (!data) {
    alert('Status tidak berubah. Polisi RLS Supabase belum membenarkan penerima mengemas kini mesej ini. Jalankan fail SQL yang disertakan.');
    return;
  }

  // Beri maklum balas terus kepada ACCC/COR selepas butang ditekan.
  const label = status === 'DIBACA' ? 'TANDA DIBACA' : (status === 'DALAM_TINDAKAN' ? 'DALAM TINDAKAN' : status);
  alert(`Status berjaya dikemas kini: ${label}`);

  if (assignment?.ecor_tempat_tugas?.kod === 'COR') await loadCorInbox();
  if (assignment?.ecor_tempat_tugas?.kod === 'ACCC') await loadAcccInbox();
  await loadCommunication();
}

async function replyInstruction(source) {
  if (!source?.dari_tempat_tugas_id) return;

  // FIX 012: Balasan mengekalkan tajuk/perkara asal. Pengguna hanya isi catatan.
  const title = (source.tajuk || '').trim();
  if (!title) {
    alert('Tajuk asal tidak ditemui. Sila muat semula halaman dan cuba lagi.');
    return;
  }

  const body = prompt(`Catatan balasan kepada ${source.dari?.kod || 'tempat tugas'}:`);
  if (!body || !body.trim()) return;

  const { error }=await supabase.from('ecor_komunikasi').insert({
    operasi_id: assignment.operasi_id,
    pengirim_id: session.user.id,
    dari_tempat_tugas_id: assignment.tempat_tugas_id,
    kepada_tempat_tugas_id: source.dari_tempat_tugas_id,
    jenis:'ARAHAN',
    tajuk:title,
    kandungan:body.trim(),
    keutamaan:source.keutamaan || 'BIASA',
    status:'DIHANTAR'
  });
  if (error) { alert(error.message); return; }

  // FIX 014:
  // Selepas balasan berjaya dihantar, laporan asal dianggap telah selesai
  // diproses dan tidak lagi dipaparkan dalam Peti Masuk.
  // Rekod asal TIDAK dipadam supaya kekal dalam KRONOLOGI / Sejarah Komunikasi.
  const { data: sourceUpdated, error: sourceUpdateError } = await supabase
    .from('ecor_komunikasi')
    .update({ status: 'DITERIMA' })
    .eq('id', source.id)
    .eq('operasi_id', assignment.operasi_id)
    .eq('kepada_tempat_tugas_id', assignment.tempat_tugas_id)
    .select('id,status')
    .maybeSingle();

  if (sourceUpdateError) {
    alert(`Balasan berjaya dihantar, tetapi laporan asal gagal dikeluarkan daripada Peti Masuk: ${sourceUpdateError.message}`);
  } else if (!sourceUpdated) {
    alert('Balasan berjaya dihantar, tetapi laporan asal tidak dapat dikemas kini. Semak polisi RLS UPDATE untuk ecor_komunikasi.');
  } else {
    alert(`Balasan berjaya dihantar kepada ${source.dari?.kod||'tempat tugas'}.`);
  }

  if (assignment?.ecor_tempat_tugas?.kod === 'COR') await loadCorInbox();
  if (assignment?.ecor_tempat_tugas?.kod === 'ACCC') await loadAcccInbox();
  await loadCommunication();
}

async function renderAcccRoom() {
  const old = document.querySelector('#acccControlPanel');
  if (old) old.remove();

  const code = assignment?.ecor_tempat_tugas?.kod;
  if (code !== 'ACCC') return;

  const panel = document.createElement('section');
  panel.id = 'acccControlPanel';
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="section-head">
      <div>
        <p class="eyebrow">AIRPORT CRISIS CONTROL CENTRE</p>
        <h2>ACCC — Kawalan Krisis Utama</h2>
      </div>
      <button id="refreshAcccInbox" class="ghost">MUAT SEMULA</button>
    </div>
    <div class="cor-metrics">
      <div><small>LAPORAN COR</small><strong id="acccTotal">0</strong></div>
      <div><small>BELUM DIBACA</small><strong id="acccNew">0</strong></div>
      <div><small>KRITIKAL</small><strong id="acccCritical">0</strong></div>
      <div><small>DALAM TINDAKAN</small><strong id="acccAction">0</strong></div>
    </div>
    <h3>Peti Masuk ACCC</h3>
    <p class="muted">Laporan daripada COR dipaparkan di sini. ACCC boleh menandakan status dan menghantar arahan kembali kepada COR.</p>
    <div id="acccInbox" class="message-list"><p class="muted">Memuatkan laporan COR...</p></div>
  `;

  document.querySelector('main').appendChild(panel);
  document.querySelector('#refreshAcccInbox').onclick = loadAcccInbox;
  await loadAcccInbox();
}

async function loadAcccInbox() {
  if (assignment?.ecor_tempat_tugas?.kod !== 'ACCC') return;

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
    .neq('status', 'DITERIMA')
    .order('created_at', { ascending:false });

  const box = document.querySelector('#acccInbox');
  if (!box) return;
  if (error) {
    box.innerHTML = `<p class="status">${esc(error.message)}</p>`;
    return;
  }

  // ACCC hanya memproses laporan yang datang daripada COR.
  const rows = (data || []).filter(x => x.dari?.kod === 'COR');

  document.querySelector('#acccTotal').textContent = rows.length;
  document.querySelector('#acccNew').textContent = rows.filter(x => x.status === 'DIHANTAR' || x.status === 'BARU').length;
  document.querySelector('#acccCritical').textContent = rows.filter(x => x.keutamaan === 'KRITIKAL').length;
  document.querySelector('#acccAction').textContent = rows.filter(x => x.status === 'DALAM_TINDAKAN').length;

  box.innerHTML = rows.length ? rows.map(x => `
    <article class="message">
      <div class="message-head">
        <span class="badge ${esc(x.keutamaan)}">${esc(x.keutamaan)}</span>
        <b>COR → ACCC</b>
        <small>${esc(fmt(x.created_at))}</small>
      </div>
      <h3>${esc(x.tajuk)}</h3>
      <p>${esc(x.kandungan)}</p>
      <div class="message-route">STATUS: ${esc(x.status === 'DALAM_TINDAKAN' ? 'DALAM TINDAKAN' : x.status)}</div>
      <div class="message-actions">
        <button data-accc-action="${x.id}" class="ghost">DALAM TINDAKAN</button>
        <button data-accc-reply="${x.id}">BALAS</button>
      </div>
    </article>`).join('') : '<p class="muted">Tiada laporan COR diterima.</p>';

  box.querySelectorAll('[data-accc-action]').forEach(b =>
    b.onclick = () => setMessageStatus(b.dataset.acccAction, 'DALAM_TINDAKAN')
  );
  box.querySelectorAll('[data-accc-reply]').forEach(b =>
    b.onclick = () => replyInstruction(rows.find(x => x.id === b.dataset.acccReply))
  );
}