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

  setupHistoryToggle();
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
  await renderIcpRoom();
  await renderIcpTriageStatus();
  await renderIcpOverallVictimStatus();
  await renderAduModule();
  await renderTriageModule();
  await renderCorAduStatus();
}

function disableReporting() {
  $('#openReport').disabled = true;
  $('#placeCode').textContent = '-';
  $('#placeName').textContent = 'Tiada penugasan aktif';
  $('#assignmentRole').textContent = '-';
  $('#parentCode').textContent = '-';
  $('#parentName').textContent = '-';
}


function setupHistoryToggle() {
  const historyList = document.querySelector('#historyList');
  const btn = document.querySelector('#toggleHistory');
  if (!historyList || !btn) return;

  // MESTI tertutup setiap kali dashboard dibuka / refresh.
  historyList.hidden = true;
  historyList.style.display = 'none';
  btn.textContent = 'PAPAR';
  btn.setAttribute('aria-expanded', 'false');

  if (btn.dataset.bound === '1') return;
  btn.dataset.bound = '1';

  btn.addEventListener('click', () => {
    const sedangTutup = historyList.hidden || historyList.style.display === 'none';

    if (sedangTutup) {
      historyList.hidden = false;
      historyList.style.display = '';
      btn.textContent = 'TUTUP';
      btn.setAttribute('aria-expanded', 'true');
    } else {
      historyList.hidden = true;
      historyList.style.display = 'none';
      btn.textContent = 'PAPAR';
      btn.setAttribute('aria-expanded', 'false');
    }
  });
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

// boot() dipanggil di hujung fail selepas semua modul ADU diinisialisasi.


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
  if (assignment?.ecor_tempat_tugas?.kod === 'ICP') await loadIcpInbox();
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
  if (assignment?.ecor_tempat_tugas?.kod === 'ICP') await loadIcpInbox();
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


// ===== ICP PETI MASUK =====
async function renderIcpRoom() {
  const old = document.querySelector('#icpControlPanel');
  if (old) old.remove();

  const code = String(assignment?.ecor_tempat_tugas?.kod || '').trim().toUpperCase();
  if (code !== 'ICP') return;

  const panel = document.createElement('section');
  panel.id = 'icpControlPanel';
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="section-head">
      <div>
        <p class="eyebrow">INCIDENT COMMAND POST</p>
        <h2>ICP — Peti Masuk Laporan</h2>
      </div>
      <button id="refreshIcpInbox" class="ghost">MUAT SEMULA</button>
    </div>
    <div class="cor-metrics">
      <div><small>LAPORAN MASUK</small><strong id="icpTotal">0</strong></div>
      <div><small>BELUM DIBACA</small><strong id="icpNew">0</strong></div>
      <div><small>KRITIKAL</small><strong id="icpCritical">0</strong></div>
      <div><small>DALAM TINDAKAN</small><strong id="icpAction">0</strong></div>
    </div>
    <h3>Peti Masuk ICP</h3>
    <p class="muted">Laporan daripada submodul di bawah ICP dipaparkan di sini.</p>
    <div id="icpInbox" class="message-list"><p class="muted">Memuatkan laporan...</p></div>`;

  const anchor = document.querySelector('#chronologyPanel');
  if (anchor) anchor.insertAdjacentElement('afterend', panel);
  else document.querySelector('main').appendChild(panel);

  $('#refreshIcpInbox').onclick = loadIcpInbox;
  await loadIcpInbox();
}

async function loadIcpInbox() {
  if (String(assignment?.ecor_tempat_tugas?.kod || '').trim().toUpperCase() !== 'ICP') return;

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

  const box = $('#icpInbox');
  if (!box) return;
  if (error) { box.innerHTML = `<p class="status">${esc(error.message)}</p>`; return; }

  const rows = data || [];
  $('#icpTotal').textContent = rows.length;
  $('#icpNew').textContent = rows.filter(x => x.status === 'DIHANTAR' || x.status === 'BARU').length;
  $('#icpCritical').textContent = rows.filter(x => x.keutamaan === 'KRITIKAL').length;
  $('#icpAction').textContent = rows.filter(x => x.status === 'DALAM_TINDAKAN').length;

  box.innerHTML = rows.length ? rows.map(x => `
    <article class="message">
      <div class="message-head">
        <span class="badge ${esc(x.keutamaan)}">${esc(x.keutamaan)}</span>
        <b>${esc(x.dari?.kod || '-')} → ICP</b>
        <small>${esc(fmt(x.created_at))}</small>
      </div>
      <h3>${esc(x.tajuk)}</h3>
      <p>${esc(x.kandungan)}</p>
      <div class="message-route">STATUS: ${esc(x.status === 'DALAM_TINDAKAN' ? 'DALAM TINDAKAN' : (x.status === 'DIMAJUKAN' ? 'TELAH DIMAJUKAN KE COR' : x.status))}</div>
      <div class="message-actions">
        <button data-icp-action="${x.id}" class="ghost">DALAM TINDAKAN</button>
        <button data-icp-reply="${x.id}">BALAS</button>
        <button data-icp-forward="${x.id}" ${x.status === 'DIMAJUKAN' ? 'disabled' : ''}>${x.status === 'DIMAJUKAN' ? 'TELAH DIMAJUKAN' : 'MAJU KE SALURAN ATASAN'}</button>
      </div>
    </article>`).join('') : '<p class="muted">Tiada laporan daripada submodul ICP.</p>';

  box.querySelectorAll('[data-icp-action]').forEach(b =>
    b.onclick = () => setMessageStatus(b.dataset.icpAction, 'DALAM_TINDAKAN')
  );
  box.querySelectorAll('[data-icp-reply]').forEach(b =>
    b.onclick = () => replyInstruction(rows.find(x => x.id === b.dataset.icpReply))
  );
  box.querySelectorAll('[data-icp-forward]').forEach(b =>
    b.onclick = () => forwardIcpReport(rows.find(x => x.id === b.dataset.icpForward), b)
  );
}

async function forwardIcpReport(source, button) {
  if (!source?.id || !assignment) return;

  const currentCode = String(assignment.ecor_tempat_tugas?.kod || '').trim().toUpperCase();
  if (currentCode !== 'ICP') return;

  // ICP mesti memajukan laporan hanya kepada saluran atasannya, iaitu COR.
  if (!parentPlace || String(parentPlace.kod || '').trim().toUpperCase() !== 'COR') {
    alert('Saluran atasan ICP → COR tidak tersedia. Semak parent tempat tugas ICP.');
    return;
  }

  if (!confirm(`Majukan laporan "${source.tajuk || '-'}" kepada COR?`)) return;

  // Kunci butang serta-merta untuk mengelakkan double-click / penghantaran berganda.
  if (button) {
    button.disabled = true;
    button.textContent = 'SEDANG DIMAJUKAN...';
  }

  const payload = {
    operasi_id: assignment.operasi_id,
    pengirim_id: session.user.id,
    dari_tempat_tugas_id: assignment.tempat_tugas_id,
    kepada_tempat_tugas_id: parentPlace.id,
    jenis: 'LAPORAN',
    tajuk: source.tajuk,
    kandungan: source.kandungan,
    keutamaan: source.keutamaan || 'BIASA',
    status: 'DIHANTAR'
  };

  const sent = await supabase.from('ecor_komunikasi').insert(payload).select('id').single();
  if (sent.error) {
    if (button) { button.disabled = false; button.textContent = 'MAJU KE SALURAN ATASAN'; }
    alert(`Gagal memajukan laporan ke COR: ${sent.error.message}`);
    return;
  }

  // FIX 021: Rekod asal KEKAL di Peti Masuk ICP selepas dimajukan.
  // Status DIMAJUKAN digunakan untuk mengunci butang MAJU tanpa membuang mesej.
  // Mesej hanya hilang daripada Peti Masuk apabila BALAS berjaya, kerana
  // replyInstruction() akan menukar status asal kepada DITERIMA.
  const marked = await supabase
    .from('ecor_komunikasi')
    .update({ status: 'DIMAJUKAN' })
    .eq('id', source.id)
    .eq('operasi_id', assignment.operasi_id)
    .eq('kepada_tempat_tugas_id', assignment.tempat_tugas_id)
    .select('id,status')
    .maybeSingle();

  if (marked.error || !marked.data) {
    if (button) { button.disabled = true; button.textContent = 'TELAH DIMAJUKAN'; }
    alert(`Laporan telah dihantar ke COR, tetapi status DIMAJUKAN gagal disimpan. ${marked.error?.message || 'Semak polisi RLS UPDATE ecor_komunikasi.'}`);
    await loadCommunication();
    return;
  }

  if (button) { button.disabled = true; button.textContent = 'TELAH DIMAJUKAN'; }
  alert('Laporan berjaya dimajukan dari ICP ke COR. Laporan kekal dalam Peti Masuk sehingga dibalas.');
  await loadIcpInbox();
  await loadCommunication();
}

// ===== ADU FASA 3 =====
const ADU_TAGS=['PUTIH','MERAH','KUNING','HIJAU'];
const aduLabel=t=>({PUTIH:'Putih — Meninggal Dunia',MERAH:'Merah — Cedera Parah',KUNING:'Kuning — Cedera Ringan',HIJAU:'Hijau — Tiada Kecederaan'})[t]||t;
const aduDot=t=>({PUTIH:'⚪',MERAH:'🔴',KUNING:'🟡',HIJAU:'🟢'})[t]||'•';
const isAduSupervisor=()=>String(assignment?.ecor_tempat_tugas?.kod||'').trim().toUpperCase()==='ADU' &&
  String(assignment?.peranan||profile?.peranan||'').trim().toUpperCase()==='PENYELIA';
const aduOptions=(s='')=>ADU_TAGS.map(t=>`<option value="${t}" ${t===s?'selected':''}>${aduLabel(t)}</option>`).join('');

function ensureAduStyles(){
 if($('#aduStyles'))return;
 const x=document.createElement('style'); x.id='aduStyles';
 x.textContent=`.adu-metrics{display:grid;grid-template-columns:repeat(5,minmax(110px,1fr));gap:12px;margin:16px 0}.adu-metric{border:1px solid #244052;border-radius:12px;padding:14px;text-align:center}.adu-metric small{display:block;margin-bottom:6px}.adu-metric strong{font-size:1.7rem}.adu-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.adu-grid .full{grid-column:1/-1}.adu-wrap{overflow-x:auto;border:1px solid #244052;border-radius:14px;background:rgba(4,20,31,.35)}.adu-table{width:100%;min-width:950px;border-collapse:separate;border-spacing:0}.adu-table th{padding:14px 16px;background:#0d2635;color:#62e0bd;font-size:.78rem;letter-spacing:.05em;text-align:left;border-bottom:1px solid #2b4a5d}.adu-table td{padding:14px 16px;border-bottom:1px solid #183646;text-align:left;vertical-align:middle}.adu-table tbody tr:last-child td{border-bottom:0}.adu-table tbody tr:nth-child(even){background:rgba(255,255,255,.018)}.adu-table tbody tr:hover{background:rgba(98,224,189,.055)}.adu-bil{font-weight:800;color:#dce9f3}.adu-tag{display:inline-flex;align-items:center;gap:8px;min-width:108px;padding:6px 10px;border:1px solid #29485a;border-radius:999px;background:#0a1c28;font-weight:800}.adu-gender{display:inline-flex;padding:5px 10px;border-radius:8px;background:#102838;border:1px solid #24495d;font-weight:700}.adu-note{color:#c6d5df}.adu-summary{margin-top:22px;border:1px solid #244052;border-radius:14px;overflow:hidden;background:rgba(4,20,31,.35)}.adu-summary-title{padding:14px 16px;background:#0d2635;border-bottom:1px solid #2b4a5d}.adu-summary-title h3{margin:0}.adu-summary-grid{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:0}.adu-summary-item{padding:16px;border-right:1px solid #183646;border-bottom:1px solid #183646}.adu-summary-item:nth-child(4n){border-right:0}.adu-summary-item small{display:block;color:#9fb7c7;margin-bottom:5px;font-size:.74rem}.adu-summary-item strong{font-size:1.35rem}.adu-summary-item.gender strong{font-size:1.15rem}.adu-actions{display:flex;gap:8px;flex-wrap:wrap}.adu-transfer{margin-top:16px;padding:16px;border:1px solid #183646;border-radius:14px}.adu-destination{font-weight:800}.adu-status-active{color:#5ee0b5}.adu-status-out{color:#f2c66d}@media(max-width:900px){.adu-summary-grid{grid-template-columns:repeat(2,1fr)}.adu-summary-item:nth-child(4n){border-right:1px solid #183646}.adu-summary-item:nth-child(2n){border-right:0}}@media(max-width:800px){.adu-metrics{grid-template-columns:repeat(2,1fr)}.adu-grid{grid-template-columns:1fr}.adu-table{min-width:720px}}@media(max-width:520px){.adu-summary-grid{grid-template-columns:1fr}.adu-summary-item{border-right:0!important}}`;
 document.head.appendChild(x);
}

async function renderAduModule(){
 $('#aduPanel')?.remove(); if(!isAduSupervisor())return; ensureAduStyles();
 const p=document.createElement('section'); p.id='aduPanel'; p.className='panel';
 p.innerHTML=`<div class="section-head"><div><p class="eyebrow">AIR DISASTER UNIT</p><h2>ADU — Pengurusan Mangsa</h2><p class="muted">Tag TRIAGE asal dikekalkan. Tag ADU semasa digunakan untuk status terkini.</p></div><button id="aduRefresh" class="ghost">MUAT SEMULA</button></div>
 <div class="adu-metrics">${['Putih','Merah','Kuning','Hijau','Jumlah'].map(x=>`<div class="adu-metric"><small>${x.toUpperCase()}</small><strong id="adu${x}">0</strong></div>`).join('')}</div>
 <h3>Daftar Mangsa</h3><form id="aduVictimForm"><div class="adu-grid">
 <label>No./ID Mangsa<input id="aduNo" required placeholder="Contoh: ADU-001"></label>
 <label>Nama Mangsa<input id="aduNama" placeholder="BELUM DIKENAL PASTI"></label>
 <label>No. KP / Pasport<input id="aduId"></label>
 <label>Jantina<select id="aduJantina"><option value="">- PILIH -</option><option>LELAKI</option><option>PEREMPUAN</option><option>TIDAK DIKETAHUI</option></select></label>
 <label>Warganegara<input id="aduNegara"></label>
 <label>Tag TRIAGE Asal<select id="aduTriage">${aduOptions()}</select></label>
 <label>Tag ADU Semasa<select id="aduSemasa">${aduOptions()}</select></label>
 <label class="full">Catatan Penilaian<textarea id="aduCatatan"></textarea></label></div><button type="submit">DAFTAR MANGSA</button></form>
 <p id="aduStatus" class="status"></p><h3>Senarai Mangsa Aktif ADU</h3><div id="aduList"></div>
 <div class="adu-transfer"><h3>Rekod Keluar ADU</h3><div id="aduTransferList"><p class="muted">Tiada rekod pemindahan.</p></div></div>`;
 document.querySelector('main').appendChild(p);
 $('#aduRefresh').onclick=loadAduData; $('#aduVictimForm').onsubmit=registerAduVictim; await loadAduData();
}

async function loadAduData(){
 if(!isAduSupervisor())return;
 const b=await supabase.from('ecor_adu_mangsa').select('*').eq('operasi_id',assignment.operasi_id).order('masa_terima_adu',{ascending:false});
 const rows=b.data||[], box=$('#aduList'), transfer=$('#aduTransferList');
 if(b.error){box.innerHTML=`<p class="status">${esc(b.error.message)}</p>`;return}
 const active=rows.filter(m=>String(m.status_lokasi||'DALAM_ADU').toUpperCase()==='DALAM_ADU');
 const moved=rows.filter(m=>String(m.status_lokasi||'DALAM_ADU').toUpperCase()!=='DALAM_ADU');
 const count=t=>active.filter(m=>String(m.tag_adu_semasa||'').toUpperCase()===t).length;
 $('#aduPutih').textContent=count('PUTIH'); $('#aduMerah').textContent=count('MERAH'); $('#aduKuning').textContent=count('KUNING'); $('#aduHijau').textContent=count('HIJAU'); $('#aduJumlah').textContent=active.length;
 box.innerHTML=active.length?`<div class="adu-wrap"><table class="adu-table"><thead><tr><th>BIL</th><th>ID MANGSA</th><th>NAMA</th><th>MASA TERIMA</th><th>TAG TRIAGE</th><th>TAG ADU SEMASA</th><th>CATATAN</th><th>TINDAKAN</th></tr></thead><tbody>${active.map((m,i)=>`<tr><td>${i+1}</td><td><b>${esc(m.no_mangsa)}</b></td><td>${esc(m.nama_mangsa||'BELUM DIKENAL PASTI')}</td><td>${esc(fmt(m.masa_terima_adu))}</td><td>${aduDot(m.tag_triage)} ${esc(m.tag_triage)}</td><td>${aduDot(m.tag_adu_semasa)} ${esc(m.tag_adu_semasa)}</td><td>${esc(m.catatan||'-')}</td><td><div class="adu-actions"><button class="ghost" data-up="${m.id}">KEMAS KINI TAG</button><button class="ghost" data-move="${m.id}">PINDAH / KELUAR ADU</button><button class="ghost" data-his="${m.id}">SEJARAH TAG</button></div></td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">Tiada mangsa aktif di ADU.</p>';
 if(transfer) transfer.innerHTML=moved.length?`<div class="adu-wrap"><table class="adu-table"><thead><tr><th>BIL</th><th>ID MANGSA</th><th>TAG AKHIR</th><th>DESTINASI</th><th>MASA KELUAR</th><th>CATATAN</th></tr></thead><tbody>${moved.map((m,i)=>`<tr><td>${i+1}</td><td><b>${esc(m.no_mangsa)}</b></td><td>${aduDot(m.tag_adu_semasa)} ${esc(m.tag_adu_semasa||'-')}</td><td class="adu-destination">${esc(m.destinasi||m.status_lokasi||'-')}</td><td>${esc(fmt(m.masa_keluar_adu))}</td><td>${esc(m.catatan_pemindahan||'-')}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">Tiada rekod pemindahan.</p>';
 box.querySelectorAll('[data-up]').forEach(x=>x.onclick=()=>updateAduTag(active.find(m=>m.id===x.dataset.up)));
 box.querySelectorAll('[data-move]').forEach(x=>x.onclick=()=>transferAduVictim(active.find(m=>m.id===x.dataset.move)));
 box.querySelectorAll('[data-his]').forEach(x=>x.onclick=()=>showAduHistory(active.find(m=>m.id===x.dataset.his)));
}
async function registerAduVictim(e){
 e.preventDefault(); const s=$('#aduStatus'), tri=$('#aduTriage').value, cur=$('#aduSemasa').value; s.textContent='Menyimpan...';
 const payload={operasi_id:assignment.operasi_id,no_mangsa:$('#aduNo').value.trim(),nama_mangsa:$('#aduNama').value.trim()||null,no_pengenalan:$('#aduId').value.trim()||null,jantina:$('#aduJantina').value||null,warganegara:$('#aduNegara').value.trim()||null,tag_triage:tri,tag_adu_semasa:cur,catatan:$('#aduCatatan').value.trim()||null,didaftarkan_oleh:session.user.id,status_lokasi:'DALAM_ADU',destinasi:null,masa_keluar_adu:null,catatan_pemindahan:null};
 const q=await supabase.from('ecor_adu_mangsa').insert(payload).select('id').single(); if(q.error){s.textContent=q.error.message;return}
 if(tri!==cur){const log=await supabase.from('ecor_adu_sejarah_tag').insert({mangsa_id:q.data.id,operasi_id:assignment.operasi_id,tag_sebelum:tri,tag_baharu:cur,catatan:payload.catatan,diubah_oleh:session.user.id}); if(log.error)console.warn(log.error.message)}
 e.target.reset(); s.textContent='Mangsa berjaya didaftarkan.'; await loadAduData();
}

async function updateAduTag(m){
 const v=prompt(`Tag ADU semasa: ${m.tag_adu_semasa}\nMasukkan tag baharu: PUTIH / MERAH / KUNING / HIJAU`,m.tag_adu_semasa); if(!v)return;
 const t=v.trim().toUpperCase(); if(!ADU_TAGS.includes(t)){alert('Tag tidak sah.');return} if(t===m.tag_adu_semasa){alert('Tag tidak berubah.');return}
 const note=prompt(`Catatan perubahan ${m.tag_adu_semasa} → ${t}:`)||'';
 const q=await supabase.from('ecor_adu_mangsa').update({tag_adu_semasa:t,catatan:note.trim()||m.catatan||null}).eq('id',m.id).eq('operasi_id',assignment.operasi_id);
 if(q.error){alert(q.error.message);return}
 const log=await supabase.from('ecor_adu_sejarah_tag').insert({mangsa_id:m.id,operasi_id:assignment.operasi_id,tag_sebelum:m.tag_adu_semasa,tag_baharu:t,catatan:note.trim()||null,diubah_oleh:session.user.id});
 if(log.error)console.warn(log.error.message);
 if(t==='PUTIH' && confirm('Mangsa telah ditag PUTIH (meninggal dunia). Hantar keluar dari ADU ke BODY HOLDING AREA (BHA) sekarang?')){
   await moveAduVictim(m,'BHA','BODY HOLDING AREA (BHA)',note);
   return;
 }
 alert(`Tag berjaya dikemas kini: ${m.tag_adu_semasa} → ${t}`); await loadAduData();
}

async function transferAduVictim(m){
 const raw=prompt('Destinasi keluar ADU:\n1 = BODY HOLDING AREA (BHA)\n2 = HOSPITAL\n3 = SURVIVOR RECEPTION CENTRE (SRC)','2'); if(!raw)return;
 if(raw.trim()==='1'){
   if(String(m.tag_adu_semasa||'').toUpperCase()!=='PUTIH' && !confirm('Tag semasa bukan PUTIH. Teruskan pemindahan ke BHA?'))return;
   const note=prompt('Catatan pemindahan ke BHA:')||'';
   await moveAduVictim(m,'BHA','BODY HOLDING AREA (BHA)',note); return;
 }
 if(raw.trim()==='2'){
   const hospital=prompt('Masukkan nama hospital berdekatan:'); if(!hospital?.trim())return;
   const note=prompt(`Catatan pemindahan ke ${hospital.trim()}:`)||'';
   await moveAduVictim(m,'HOSPITAL',hospital.trim(),note); return;
 }
 if(raw.trim()==='3'){
   const note=prompt('Catatan pemindahan ke SURVIVOR RECEPTION CENTRE (SRC):')||'';
   await moveAduVictim(m,'SRC','SURVIVOR RECEPTION CENTRE (SRC)',note); return;
 }
 alert('Pilihan tidak sah.');
}

async function moveAduVictim(m,statusLokasi,destinasi,note=''){
 if(!confirm(`Sahkan mangsa ${m.no_mangsa} keluar dari ADU ke ${destinasi}?`))return;
 const q=await supabase.from('ecor_adu_mangsa').update({status_lokasi:statusLokasi,destinasi,masa_keluar_adu:new Date().toISOString(),catatan_pemindahan:note.trim()||null}).eq('id',m.id).eq('operasi_id',assignment.operasi_id);
 if(q.error){alert(q.error.message);return}
 alert(`Mangsa berjaya dikeluarkan dari ADU ke ${destinasi}.`); await loadAduData();
}
async function showAduHistory(m){
 const q=await supabase.from('ecor_adu_sejarah_tag').select('*').eq('mangsa_id',m.id).order('masa_perubahan');
 if(q.error){alert(q.error.message);return}
 alert(`SEJARAH TAG — ${m.no_mangsa}\n\n${(q.data||[]).map(x=>`${fmt(x.masa_perubahan)} — ${x.tag_sebelum||'-'} → ${x.tag_baharu}${x.catatan?`\n${x.catatan}`:''}`).join('\n\n')||'Tiada perubahan tag.'}`);
}

async function sendAduReport(){
 if(!confirm('Hantar laporan situasi mangsa ADU terkini kepada COR?'))return;
 const s=$('#aduReportStatus'); s.textContent='Menghantar laporan...';
 const q=await supabase.rpc('ecor_hantar_laporan_adu',{p_operasi_id:assignment.operasi_id,p_catatan:$('#aduReportNote').value.trim()||null});
 if(q.error){s.textContent=q.error.message;return} $('#aduReportNote').value=''; s.textContent='Laporan ADU berjaya dihantar ke COR.'; await loadCommunication();
}

async function renderCorAduStatus(){
  $('#corAduPanel')?.remove();
  if(String(assignment?.ecor_tempat_tugas?.kod||'').trim().toUpperCase()!=='COR') return;
  ensureAduStyles();

  const p=document.createElement('section');
  p.id='corAduPanel';
  p.className='panel';
  p.innerHTML=`<div class="section-head"><div><p class="eyebrow">MANGSA KESELURUHAN</p><h2>Status Mangsa Keseluruhan</h2><p class="muted">VIEW ONLY — status terkini setiap mangsa berdasarkan rekod TRIAGE dan ADU, termasuk mangsa ke SRC, BHA dan Hospital. Mangsa yang sama dikira sekali sahaja.</p></div><button id="corAduRefresh" class="ghost">MUAT SEMULA</button></div>
  <div id="corAduTable"><p class="muted">Memuatkan data mangsa keseluruhan...</p></div>
  <div id="corAduSummary"></div>
  <p id="corAduStatus" class="status"></p>`;
  ($('#controlRoomPanel')||document.querySelector('main')).insertAdjacentElement($('#controlRoomPanel')?'afterend':'beforeend',p);
  $('#corAduRefresh').onclick=loadCorAduStatus;
  await loadCorAduStatus();
}

async function loadCorAduStatus(){
  if(String(assignment?.ecor_tempat_tugas?.kod||'').trim().toUpperCase()!=='COR') return;

  const [triageQ,aduQ]=await Promise.all([
    supabase.from('ecor_triage_mangsa')
      .select('id,no_mangsa,nama_mangsa,jantina,tag_triage,catatan,masa_terima_triage,status_lokasi,destinasi,masa_keluar_triage,catatan_pemindahan')
      .eq('operasi_id',assignment.operasi_id),
    supabase.from('ecor_adu_mangsa')
      .select('id,no_mangsa,nama_mangsa,jantina,tag_triage,tag_adu_semasa,catatan,masa_terima_adu,status_lokasi,destinasi,masa_keluar_adu,catatan_pemindahan')
      .eq('operasi_id',assignment.operasi_id)
  ]);

  const box=$('#corAduTable'),summary=$('#corAduSummary'),status=$('#corAduStatus');
  const err=triageQ.error||aduQ.error;
  if(err){if(box)box.innerHTML=`<p class="status">${esc(err.message)}</p>`;if(status)status.textContent=err.message;return;}

  const normGender=v=>{const x=String(v||'').trim().toUpperCase();if(x==='LELAKI')return 'LELAKI';if(x==='PEREMPUAN'||x==='WANITA')return 'WANITA';return 'BELUM DIKENALPASTI';};
  const normKey=m=>String(m.no_mangsa||m.id||'').trim().toUpperCase();
  const locOf=m=>String(m.status_lokasi||'').trim().toUpperCase();
  const timeMs=v=>{const t=v?new Date(v).getTime():0;return Number.isFinite(t)?t:0;};

  // Gabungkan TRIAGE + ADU. Untuk mangsa yang sama, hanya status paling terkini dipaparkan.
  const latest=new Map();
  const consider=(raw,sumber)=>{
    const key=normKey(raw); if(!key)return;
    const isAdu=sumber==='ADU';
    const masa=isAdu?(raw.masa_keluar_adu||raw.masa_terima_adu):(raw.masa_keluar_triage||raw.masa_terima_triage);
    const candidate={...raw,sumber,tag_semasa:isAdu?(raw.tag_adu_semasa||raw.tag_triage):raw.tag_triage,masa_rujukan:masa,_masa:timeMs(masa)};
    const current=latest.get(key);
    if(!current||candidate._masa>current._masa||(candidate._masa===current._masa&&sumber==='ADU')) latest.set(key,candidate);
  };
  (triageQ.data||[]).forEach(m=>consider(m,'TRIAGE'));
  (aduQ.data||[]).forEach(m=>consider(m,'ADU'));
  const rows=[...latest.values()].sort((a,b)=>a._masa-b._masa);

  const statusDestinasi=m=>{
    const loc=locOf(m);
    if(loc==='DALAM_TRIAGE')return 'DALAM TRIAGE';
    if(loc==='DALAM_ADU'||loc==='ADU')return 'DALAM ADU';
    if(loc==='SRC')return m.destinasi||'SURVIVOR RECEPTION CENTRE (SRC)';
    if(loc==='BHA')return m.destinasi||'BODY HOLDING AREA (BHA)';
    if(loc==='HOSPITAL')return m.destinasi||'HOSPITAL';
    return m.destinasi||String(m.status_lokasi||'-').replaceAll('_',' ');
  };

  if(box)box.innerHTML=rows.length?`<div class="adu-wrap"><table class="adu-table" style="min-width:900px"><thead><tr><th style="width:80px">BIL</th><th>JENIS WARNA KAD</th><th>JANTINA</th><th>STATUS / DESTINASI</th><th>CATATAN</th></tr></thead><tbody>${rows.map((m,i)=>`<tr><td class="adu-bil">${String(i+1).padStart(2,'0')}</td><td><span class="adu-tag">${aduDot(m.tag_semasa)} <span>${esc(m.tag_semasa||'-')}</span></span></td><td><span class="adu-gender">${esc(normGender(m.jantina))}</span></td><td class="adu-destination">${esc(statusDestinasi(m))}</td><td class="adu-note">${esc(m.catatan_pemindahan||m.catatan||'-')}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">Tiada mangsa direkodkan.</p>';

  const countTag=t=>rows.filter(m=>String(m.tag_semasa||'').toUpperCase()===t).length;
  const countGender=g=>rows.filter(m=>normGender(m.jantina)===g).length;
  const countLoc=(...locs)=>rows.filter(m=>locs.includes(locOf(m))).length;
  if(summary)summary.innerHTML=`<div class="adu-summary"><div class="adu-summary-title"><h3>JUMLAH KESELURUHAN</h3></div><div class="adu-summary-grid">
    <div class="adu-summary-item"><small>⚪ 1. PUTIH</small><strong>${countTag('PUTIH')}</strong></div>
    <div class="adu-summary-item"><small>🔴 2. MERAH</small><strong>${countTag('MERAH')}</strong></div>
    <div class="adu-summary-item"><small>🟡 3. KUNING</small><strong>${countTag('KUNING')}</strong></div>
    <div class="adu-summary-item"><small>🟢 4. HIJAU</small><strong>${countTag('HIJAU')}</strong></div>
    <div class="adu-summary-item gender"><small>5. JANTINA (LELAKI)</small><strong>${countGender('LELAKI')}</strong></div>
    <div class="adu-summary-item gender"><small>6. JANTINA (WANITA)</small><strong>${countGender('WANITA')}</strong></div>
    <div class="adu-summary-item gender"><small>7. JANTINA (BELUM DIKENALPASTI)</small><strong>${countGender('BELUM DIKENALPASTI')}</strong></div>
    <div class="adu-summary-item"><small>8. DALAM TRIAGE</small><strong>${countLoc('DALAM_TRIAGE')}</strong></div>
    <div class="adu-summary-item"><small>9. DALAM ADU</small><strong>${countLoc('DALAM_ADU','ADU')}</strong></div>
    <div class="adu-summary-item"><small>10. KE BHA</small><strong>${countLoc('BHA')}</strong></div>
    <div class="adu-summary-item"><small>11. KE HOSPITAL</small><strong>${countLoc('HOSPITAL')}</strong></div>
    <div class="adu-summary-item"><small>12. KE SRC</small><strong>${countLoc('SRC')}</strong></div>
    <div class="adu-summary-item"><small>13. JUMLAH MANGSA</small><strong>${rows.length}</strong></div>
  </div></div>`;
  if(status)status.textContent=`Status mangsa keseluruhan terkini. Jumlah mangsa: ${rows.length}.`;
}


// ===== FIX 022: ICP — STATUS MANGSA TRIAGE (VIEW ONLY) =====
async function renderIcpTriageStatus(){
  $('#icpTriageStatusPanel')?.remove();
  if(String(assignment?.ecor_tempat_tugas?.kod||'').trim().toUpperCase()!=='ICP') return;
  ensureAduStyles();
  const p=document.createElement('section');
  p.id='icpTriageStatusPanel'; p.className='panel';
  p.innerHTML=`<div class="section-head"><div><p class="eyebrow">TRIAGE</p><h2>Status Mangsa TRIAGE</h2><p class="muted">VIEW ONLY — berdasarkan mangsa yang masih aktif di TRIAGE.</p></div><button id="icpTriageRefresh" class="ghost">MUAT SEMULA</button></div>
  <div id="icpTriageTable"><p class="muted">Memuatkan data mangsa TRIAGE...</p></div>
  <div id="icpTriageSummary"></div><p id="icpTriageStatus" class="status"></p>`;
  const anchor=$('#icpControlPanel');
  if(anchor) anchor.insertAdjacentElement('afterend',p); else document.querySelector('main').appendChild(p);
  $('#icpTriageRefresh').onclick=loadIcpTriageStatus;
  await loadIcpTriageStatus();
}

async function loadIcpTriageStatus(){
  if(String(assignment?.ecor_tempat_tugas?.kod||'').trim().toUpperCase()!=='ICP') return;

  const q=await supabase.from('ecor_triage_mangsa')
    .select('id,no_mangsa,nama_mangsa,jantina,tag_triage,catatan,masa_terima_triage,status_lokasi,destinasi,masa_keluar_triage,catatan_pemindahan')
    .eq('operasi_id',assignment.operasi_id)
    .order('masa_terima_triage',{ascending:true});

  const box=$('#icpTriageTable'), summary=$('#icpTriageSummary'), status=$('#icpTriageStatus');
  if(q.error){
    if(box) box.innerHTML=`<p class="status">${esc(q.error.message)}</p>`;
    if(status) status.textContent=q.error.message;
    return;
  }

  // ICP mesti melihat SEMUA rekod TRIAGE, termasuk mangsa yang sudah keluar.
  const rows=q.data||[];

  const normGender=v=>{
    const x=String(v||'').trim().toUpperCase();
    if(x==='LELAKI') return 'LELAKI';
    if(x==='PEREMPUAN'||x==='WANITA') return 'WANITA';
    return 'BELUM DIKENALPASTI';
  };

  const statusDestinasi=m=>{
    const loc=String(m.status_lokasi||'DALAM_TRIAGE').trim().toUpperCase();
    if(loc==='DALAM_TRIAGE') return 'DALAM TRIAGE';
    if(loc==='ADU') return m.destinasi || 'AIR DISASTER UNIT (ADU)';
    if(loc==='BHA') return m.destinasi || 'BODY HOLDING AREA (BHA)';
    if(loc==='HOSPITAL') return m.destinasi || 'HOSPITAL';
    if(loc==='SRC') return m.destinasi || 'SURVIVOR RECEPTION CENTRE (SRC)';
    return m.destinasi || m.status_lokasi || '-';
  };

  if(box) box.innerHTML=rows.length
    ? `<div class="adu-wrap"><table class="adu-table" style="min-width:900px">
        <thead><tr>
          <th style="width:80px">BIL</th>
          <th>JENIS WARNA KAD</th>
          <th>JANTINA</th>
          <th>STATUS / DESTINASI</th>
          <th>CATATAN</th>
        </tr></thead>
        <tbody>${rows.map((m,i)=>`<tr>
          <td class="adu-bil">${String(i+1).padStart(2,'0')}</td>
          <td><span class="adu-tag">${aduDot(m.tag_triage)} <span>${esc(m.tag_triage||'-')}</span></span></td>
          <td><span class="adu-gender">${esc(normGender(m.jantina))}</span></td>
          <td>${esc(statusDestinasi(m))}</td>
          <td class="adu-note">${esc(m.catatan_pemindahan||m.catatan||'-')}</td>
        </tr>`).join('')}</tbody>
      </table></div>`
    : '<p class="muted">Tiada mangsa TRIAGE direkodkan.</p>';

  const countTag=t=>rows.filter(m=>String(m.tag_triage||'').toUpperCase()===t).length;
  const countGender=g=>rows.filter(m=>normGender(m.jantina)===g).length;
  const countLoc=loc=>rows.filter(m=>String(m.status_lokasi||'').trim().toUpperCase()===loc).length;

  if(summary) summary.innerHTML=`<div class="adu-summary">
    <div class="adu-summary-title"><h3>JUMLAH KESELURUHAN</h3></div>
    <div class="adu-summary-grid">
      <div class="adu-summary-item"><small>⚪ 1. PUTIH</small><strong>${countTag('PUTIH')}</strong></div>
      <div class="adu-summary-item"><small>🔴 2. MERAH</small><strong>${countTag('MERAH')}</strong></div>
      <div class="adu-summary-item"><small>🟡 3. KUNING</small><strong>${countTag('KUNING')}</strong></div>
      <div class="adu-summary-item"><small>🟢 4. HIJAU</small><strong>${countTag('HIJAU')}</strong></div>
      <div class="adu-summary-item gender"><small>5. JANTINA (LELAKI)</small><strong>${countGender('LELAKI')}</strong></div>
      <div class="adu-summary-item gender"><small>6. JANTINA (WANITA)</small><strong>${countGender('WANITA')}</strong></div>
      <div class="adu-summary-item gender"><small>7. JANTINA (BELUM DIKENALPASTI)</small><strong>${countGender('BELUM DIKENALPASTI')}</strong></div>
      <div class="adu-summary-item"><small>8. KE ADU</small><strong>${countLoc('ADU')}</strong></div>
      <div class="adu-summary-item"><small>9. KE BHA</small><strong>${countLoc('BHA')}</strong></div>
      <div class="adu-summary-item"><small>10. KE HOSPITAL</small><strong>${countLoc('HOSPITAL')}</strong></div>
      <div class="adu-summary-item"><small>11. KE SRC</small><strong>${countLoc('SRC')}</strong></div>
      <div class="adu-summary-item"><small>12. JUMLAH MANGSA</small><strong>${rows.length}</strong></div>
    </div>
  </div>`;

  if(status) status.textContent=`Status mangsa TRIAGE terkini. Jumlah mangsa: ${rows.length}.`;
}

// ===== FIX 025: ICP — STATUS MANGSA KESELURUHAN (STATUS TERKINI SEBENAR) =====
async function renderIcpOverallVictimStatus(){
  $('#icpOverallVictimPanel')?.remove();
  if(String(assignment?.ecor_tempat_tugas?.kod||'').trim().toUpperCase()!=='ICP') return;
  ensureAduStyles();

  const p=document.createElement('section');
  p.id='icpOverallVictimPanel';
  p.className='panel';
  p.innerHTML=`<div class="section-head"><div><p class="eyebrow">MANGSA KESELURUHAN</p><h2>Status Mangsa Keseluruhan</h2><p class="muted">VIEW ONLY — status terkini setiap mangsa berdasarkan rekod TRIAGE dan ADU. Mangsa yang sama dikira sekali sahaja.</p></div><button id="icpOverallVictimRefresh" class="ghost">MUAT SEMULA</button></div>
  <div id="icpOverallVictimTable"><p class="muted">Memuatkan data mangsa keseluruhan...</p></div>
  <div id="icpOverallVictimSummary"></div>
  <p id="icpOverallVictimStatus" class="status"></p>`;

  const anchor=$('#icpTriageStatusPanel') || $('#icpControlPanel');
  if(anchor) anchor.insertAdjacentElement('afterend',p); else document.querySelector('main').appendChild(p);
  $('#icpOverallVictimRefresh').onclick=loadIcpOverallVictimStatus;
  await loadIcpOverallVictimStatus();
}

async function loadIcpOverallVictimStatus(){
  if(String(assignment?.ecor_tempat_tugas?.kod||'').trim().toUpperCase()!=='ICP') return;

  const [triageQ, aduQ] = await Promise.all([
    supabase.from('ecor_triage_mangsa')
      .select('id,no_mangsa,nama_mangsa,jantina,tag_triage,catatan,masa_terima_triage,status_lokasi,destinasi,masa_keluar_triage,catatan_pemindahan')
      .eq('operasi_id',assignment.operasi_id),
    supabase.from('ecor_adu_mangsa')
      .select('id,no_mangsa,nama_mangsa,jantina,tag_triage,tag_adu_semasa,catatan,masa_terima_adu,status_lokasi,destinasi,masa_keluar_adu,catatan_pemindahan')
      .eq('operasi_id',assignment.operasi_id)
  ]);

  const box=$('#icpOverallVictimTable'), summary=$('#icpOverallVictimSummary'), status=$('#icpOverallVictimStatus');
  const err=triageQ.error || aduQ.error;
  if(err){
    if(box) box.innerHTML=`<p class="status">${esc(err.message)}</p>`;
    if(status) status.textContent=err.message;
    return;
  }

  const normGender=v=>{
    const x=String(v||'').trim().toUpperCase();
    if(x==='LELAKI') return 'LELAKI';
    if(x==='PEREMPUAN'||x==='WANITA') return 'WANITA';
    return 'BELUM DIKENALPASTI';
  };
  const normKey=m=>String(m.no_mangsa||m.id||'').trim().toUpperCase();
  const locOf=m=>String(m.status_lokasi||'').trim().toUpperCase();
  const timeMs=v=>{ const t=v ? new Date(v).getTime() : 0; return Number.isFinite(t)?t:0; };

  // Pilih rekod PALING TERKINI bagi ID mangsa yang sama.
  // Ini membetulkan keadaan rekod ADU lama menindih rekod TRIAGE yang lebih baharu.
  const latest=new Map();
  const consider=(raw,sumber)=>{
    const key=normKey(raw); if(!key) return;
    const isAdu=sumber==='ADU';
    const masa_rujukan=isAdu
      ? (raw.masa_keluar_adu || raw.masa_terima_adu)
      : (raw.masa_keluar_triage || raw.masa_terima_triage);
    const candidate={
      ...raw,
      sumber,
      tag_semasa:isAdu ? (raw.tag_adu_semasa || raw.tag_triage) : raw.tag_triage,
      masa_rujukan,
      _masa:timeMs(masa_rujukan)
    };
    const current=latest.get(key);
    if(!current || candidate._masa>current._masa || (candidate._masa===current._masa && sumber==='ADU')) latest.set(key,candidate);
  };
  (triageQ.data||[]).forEach(m=>consider(m,'TRIAGE'));
  (aduQ.data||[]).forEach(m=>consider(m,'ADU'));

  const rows=[...latest.values()].sort((a,b)=>a._masa-b._masa);

  const statusDestinasi=m=>{
    const loc=locOf(m);
    if(loc==='DALAM_TRIAGE') return 'DALAM TRIAGE';
    if(loc==='DALAM_ADU' || loc==='ADU') return 'DALAM ADU';
    if(loc==='SRC') return m.destinasi || 'SURVIVOR RECEPTION CENTRE (SRC)';
    if(loc==='BHA') return m.destinasi || 'BODY HOLDING AREA (BHA)';
    if(loc==='HOSPITAL') return m.destinasi || 'HOSPITAL';
    return m.destinasi || String(m.status_lokasi||'-').replaceAll('_',' ');
  };

  if(box) box.innerHTML=rows.length
    ? `<div class="adu-wrap"><table class="adu-table" style="min-width:900px"><thead><tr><th style="width:80px">BIL</th><th>JENIS WARNA KAD</th><th>JANTINA</th><th>STATUS / DESTINASI</th><th>CATATAN</th></tr></thead><tbody>${rows.map((m,i)=>`<tr><td class="adu-bil">${String(i+1).padStart(2,'0')}</td><td><span class="adu-tag">${aduDot(m.tag_semasa)} <span>${esc(m.tag_semasa||'-')}</span></span></td><td><span class="adu-gender">${esc(normGender(m.jantina))}</span></td><td class="adu-destination">${esc(statusDestinasi(m))}</td><td class="adu-note">${esc(m.catatan_pemindahan||m.catatan||'-')}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">Tiada mangsa direkodkan.</p>';

  const countTag=t=>rows.filter(m=>String(m.tag_semasa||'').toUpperCase()===t).length;
  const countGender=g=>rows.filter(m=>normGender(m.jantina)===g).length;
  const countLoc=(...locs)=>rows.filter(m=>locs.includes(locOf(m))).length;

  if(summary) summary.innerHTML=`<div class="adu-summary"><div class="adu-summary-title"><h3>JUMLAH KESELURUHAN</h3></div><div class="adu-summary-grid">
    <div class="adu-summary-item"><small>⚪ 1. PUTIH</small><strong>${countTag('PUTIH')}</strong></div>
    <div class="adu-summary-item"><small>🔴 2. MERAH</small><strong>${countTag('MERAH')}</strong></div>
    <div class="adu-summary-item"><small>🟡 3. KUNING</small><strong>${countTag('KUNING')}</strong></div>
    <div class="adu-summary-item"><small>🟢 4. HIJAU</small><strong>${countTag('HIJAU')}</strong></div>
    <div class="adu-summary-item gender"><small>5. JANTINA (LELAKI)</small><strong>${countGender('LELAKI')}</strong></div>
    <div class="adu-summary-item gender"><small>6. JANTINA (WANITA)</small><strong>${countGender('WANITA')}</strong></div>
    <div class="adu-summary-item gender"><small>7. JANTINA (BELUM DIKENALPASTI)</small><strong>${countGender('BELUM DIKENALPASTI')}</strong></div>
    <div class="adu-summary-item"><small>8. DALAM TRIAGE</small><strong>${countLoc('DALAM_TRIAGE')}</strong></div>
    <div class="adu-summary-item"><small>9. DALAM ADU</small><strong>${countLoc('DALAM_ADU','ADU')}</strong></div>
    <div class="adu-summary-item"><small>10. KE SRC</small><strong>${countLoc('SRC')}</strong></div>
    <div class="adu-summary-item"><small>11. KE BHA</small><strong>${countLoc('BHA')}</strong></div>
    <div class="adu-summary-item"><small>12. KE HOSPITAL</small><strong>${countLoc('HOSPITAL')}</strong></div>
    <div class="adu-summary-item"><small>13. JUMLAH MANGSA KESELURUHAN</small><strong>${rows.length}</strong></div>
  </div></div>`;

  if(status) status.textContent=`Status mangsa keseluruhan terkini. Jumlah mangsa: ${rows.length}.`;
}

// ===== TRIAGE FIX 023 =====
const isTriageSupervisor=()=>String(assignment?.ecor_tempat_tugas?.kod||'').trim().toUpperCase()==='TRIAGE' &&
 String(assignment?.peranan||profile?.peranan||'').trim().toUpperCase()==='PENYELIA';

async function renderTriageModule(){
 $('#triagePanel')?.remove(); if(!isTriageSupervisor())return; ensureAduStyles();
 const p=document.createElement('section'); p.id='triagePanel'; p.className='panel';
 p.innerHTML=`<div class="section-head"><div><p class="eyebrow">TRIAGE</p><h2>TRIAGE — Pengurusan Mangsa</h2><p class="muted">Mangsa dari kawasan bencana didaftarkan dan dinilai terlebih dahulu di TRIAGE.</p></div><button id="triageRefresh" class="ghost">MUAT SEMULA</button></div>
 <div class="adu-metrics">${['Putih','Merah','Kuning','Hijau','Jumlah'].map(x=>`<div class="adu-metric"><small>${x.toUpperCase()}</small><strong id="triage${x}">0</strong></div>`).join('')}</div>
 <h3>Daftar Mangsa TRIAGE</h3><form id="triageVictimForm"><div class="adu-grid">
 <label>No./ID Mangsa<input id="triageNo" required placeholder="Contoh: MANGSA-001"></label><label>Nama Mangsa<input id="triageNama" placeholder="BELUM DIKENAL PASTI"></label>
 <label>No. KP / Pasport<input id="triageId"></label><label>Jantina<select id="triageJantina"><option value="">- PILIH -</option><option>LELAKI</option><option>PEREMPUAN</option><option>TIDAK DIKETAHUI</option></select></label>
 <label>Warganegara<input id="triageNegara"></label><label>Tag TRIAGE<select id="triageTag">${aduOptions()}</select></label>
 <label class="full">Catatan Penilaian Awal<textarea id="triageCatatan"></textarea></label></div><button type="submit">DAFTAR MANGSA</button></form>
 <p id="triageStatus" class="status"></p><h3>Senarai Mangsa Aktif TRIAGE</h3><div id="triageList"></div>
 <div class="adu-transfer"><h3>Rekod Keluar TRIAGE</h3><div id="triageTransferList"><p class="muted">Tiada rekod pemindahan.</p></div></div>`;
 document.querySelector('main').appendChild(p);
 $('#triageRefresh').onclick=loadTriageData; $('#triageVictimForm').onsubmit=registerTriageVictim; await loadTriageData();
}
async function loadTriageData(){
 if(!isTriageSupervisor())return;
 const q=await supabase.from('ecor_triage_mangsa').select('*').eq('operasi_id',assignment.operasi_id).order('masa_terima_triage',{ascending:false});
 const rows=q.data||[], box=$('#triageList'), transfer=$('#triageTransferList'); if(q.error){box.innerHTML=`<p class="status">${esc(q.error.message)}</p>`;return}
 const active=rows.filter(m=>String(m.status_lokasi||'DALAM_TRIAGE').toUpperCase()==='DALAM_TRIAGE'), moved=rows.filter(m=>String(m.status_lokasi||'DALAM_TRIAGE').toUpperCase()!=='DALAM_TRIAGE');
 const count=t=>active.filter(m=>String(m.tag_triage||'').toUpperCase()===t).length;
 $('#triagePutih').textContent=count('PUTIH');$('#triageMerah').textContent=count('MERAH');$('#triageKuning').textContent=count('KUNING');$('#triageHijau').textContent=count('HIJAU');$('#triageJumlah').textContent=active.length;
 box.innerHTML=active.length?`<div class="adu-wrap"><table class="adu-table"><thead><tr><th>BIL</th><th>ID MANGSA</th><th>NAMA</th><th>MASA TERIMA</th><th>TAG TRIAGE</th><th>JANTINA</th><th>CATATAN</th><th>TINDAKAN</th></tr></thead><tbody>${active.map((m,i)=>`<tr><td>${i+1}</td><td><b>${esc(m.no_mangsa)}</b></td><td>${esc(m.nama_mangsa||'BELUM DIKENAL PASTI')}</td><td>${esc(fmt(m.masa_terima_triage))}</td><td><span class="adu-tag">${aduDot(m.tag_triage)} ${esc(m.tag_triage)}</span></td><td><span class="adu-gender">${esc(m.jantina||'BELUM DIKENALPASTI')}</span></td><td>${esc(m.catatan||'-')}</td><td><div class="adu-actions"><button class="ghost" data-tu="${m.id}">KEMAS KINI TAG</button><button class="ghost" data-tm="${m.id}">PINDAH / KELUAR TRIAGE</button><button class="ghost" data-th="${m.id}">SEJARAH TAG</button></div></td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">Tiada mangsa aktif di TRIAGE.</p>';
 transfer.innerHTML=moved.length?`<div class="adu-wrap"><table class="adu-table"><thead><tr><th>BIL</th><th>ID MANGSA</th><th>TAG AKHIR</th><th>DESTINASI</th><th>MASA KELUAR</th><th>CATATAN</th></tr></thead><tbody>${moved.map((m,i)=>`<tr><td>${i+1}</td><td><b>${esc(m.no_mangsa)}</b></td><td>${aduDot(m.tag_triage)} ${esc(m.tag_triage)}</td><td class="adu-destination">${esc(m.destinasi||m.status_lokasi)}</td><td>${esc(fmt(m.masa_keluar_triage))}</td><td>${esc(m.catatan_pemindahan||'-')}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">Tiada rekod pemindahan.</p>';
 box.querySelectorAll('[data-tu]').forEach(x=>x.onclick=()=>updateTriageTag(active.find(m=>m.id===x.dataset.tu)));box.querySelectorAll('[data-tm]').forEach(x=>x.onclick=()=>transferTriageVictim(active.find(m=>m.id===x.dataset.tm)));box.querySelectorAll('[data-th]').forEach(x=>x.onclick=()=>showTriageHistory(active.find(m=>m.id===x.dataset.th)));
}
async function registerTriageVictim(e){
 e.preventDefault();const st=$('#triageStatus');st.textContent='Menyimpan...';
 const payload={operasi_id:assignment.operasi_id,no_mangsa:$('#triageNo').value.trim(),nama_mangsa:$('#triageNama').value.trim()||null,no_pengenalan:$('#triageId').value.trim()||null,jantina:$('#triageJantina').value||null,warganegara:$('#triageNegara').value.trim()||null,tag_triage:$('#triageTag').value,catatan:$('#triageCatatan').value.trim()||null,didaftarkan_oleh:session.user.id,status_lokasi:'DALAM_TRIAGE'};
 const q=await supabase.from('ecor_triage_mangsa').insert(payload);if(q.error){st.textContent=q.error.message;return}e.target.reset();st.textContent='Mangsa berjaya didaftarkan di TRIAGE.';await loadTriageData();
}
async function updateTriageTag(m){
 const v=prompt(`Tag TRIAGE semasa: ${m.tag_triage}\nMasukkan tag baharu: PUTIH / MERAH / KUNING / HIJAU`,m.tag_triage);if(!v)return;const t=v.trim().toUpperCase();if(!ADU_TAGS.includes(t)){alert('Tag tidak sah.');return}if(t===m.tag_triage){alert('Tag tidak berubah.');return}
 const note=prompt(`Catatan perubahan ${m.tag_triage} → ${t}:`)||'';const q=await supabase.from('ecor_triage_mangsa').update({tag_triage:t,catatan:note.trim()||m.catatan||null}).eq('id',m.id);if(q.error){alert(q.error.message);return}
 await supabase.from('ecor_triage_sejarah_tag').insert({mangsa_id:m.id,operasi_id:assignment.operasi_id,tag_sebelum:m.tag_triage,tag_baharu:t,catatan:note.trim()||null,diubah_oleh:session.user.id});await loadTriageData();
}
async function transferTriageVictim(m){
 const raw=prompt('Destinasi keluar TRIAGE:\n1 = ADU\n2 = BODY HOLDING AREA (BHA)\n3 = HOSPITAL\n4 = SURVIVOR RECEPTION CENTRE (SRC)','1');if(!raw)return;
 if(raw.trim()==='1'){await moveTriageVictim(m,'ADU','AIR DISASTER UNIT (ADU)',prompt('Catatan pemindahan ke ADU:')||'');return}
 if(raw.trim()==='2'){if(String(m.tag_triage).toUpperCase()!=='PUTIH'&&!confirm('Tag TRIAGE bukan PUTIH. Teruskan ke BHA?'))return;await moveTriageVictim(m,'BHA','BODY HOLDING AREA (BHA)',prompt('Catatan pemindahan ke BHA:')||'');return}
 if(raw.trim()==='3'){const h=prompt('Masukkan nama hospital berdekatan:');if(!h?.trim())return;await moveTriageVictim(m,'HOSPITAL',h.trim(),prompt(`Catatan pemindahan ke ${h.trim()}:`)||'');return}
 if(raw.trim()==='4'){await moveTriageVictim(m,'SRC','SURVIVOR RECEPTION CENTRE (SRC)',prompt('Catatan pemindahan ke SURVIVOR RECEPTION CENTRE (SRC):')||'');return}
 alert('Pilihan tidak sah.');
}
async function moveTriageVictim(m,statusLokasi,destinasi,note=''){
 if(!confirm(`Sahkan mangsa ${m.no_mangsa} keluar dari TRIAGE ke ${destinasi}?`))return;
 if(statusLokasi==='ADU'){
  const ex=await supabase.from('ecor_adu_mangsa').select('id').eq('operasi_id',assignment.operasi_id).eq('no_mangsa',m.no_mangsa).maybeSingle();if(ex.error){alert(ex.error.message);return}
  if(!ex.data){const a=await supabase.from('ecor_adu_mangsa').insert({operasi_id:assignment.operasi_id,no_mangsa:m.no_mangsa,nama_mangsa:m.nama_mangsa,no_pengenalan:m.no_pengenalan,jantina:m.jantina,warganegara:m.warganegara,tag_triage:m.tag_triage,tag_adu_semasa:m.tag_triage,catatan:note.trim()||m.catatan||null,didaftarkan_oleh:session.user.id,status_lokasi:'DALAM_ADU'});if(a.error){alert(`Gagal menghantar rekod ke ADU: ${a.error.message}`);return}}
 }
 const q=await supabase.from('ecor_triage_mangsa').update({status_lokasi:statusLokasi,destinasi,masa_keluar_triage:new Date().toISOString(),catatan_pemindahan:note.trim()||null}).eq('id',m.id);if(q.error){alert(q.error.message);return}alert(`Mangsa berjaya dipindahkan ke ${destinasi}.`);await loadTriageData();
}
async function showTriageHistory(m){
 const q=await supabase.from('ecor_triage_sejarah_tag').select('*').eq('mangsa_id',m.id).order('masa_perubahan');if(q.error){alert(q.error.message);return}
 alert(`SEJARAH TAG TRIAGE — ${m.no_mangsa}\n\n${(q.data||[]).map(x=>`${fmt(x.masa_perubahan)} — ${x.tag_sebelum||'-'} → ${x.tag_baharu}${x.catatan?`\n${x.catatan}`:''}`).join('\n\n')||'Tiada perubahan tag.'}`);
}
// FIX 019: mula aplikasi hanya selepas semua const/fungsi modul ADU selesai diinisialisasi.
await boot();