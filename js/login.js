import { supabase } from './supabase.js';

const form = document.querySelector('#loginForm');
const status = document.querySelector('#status');
const noBadanInput = document.querySelector('#noBadan');
const passwordInput = document.querySelector('#password');

async function routeUser(user) {
  const { data: p, error } = await supabase
    .from('profiles')
    .select('peranan,aktif')
    .eq('id', user.id)
    .single();

  if (error) throw error;
  if (!p?.aktif) {
    await supabase.auth.signOut();
    throw new Error('Akaun tidak aktif.');
  }

  location.replace(p.peranan === 'PENTADBIR' ? 'admin.html' : 'dashboard.html');
}

const { data: { session } } = await supabase.auth.getSession();
if (session) {
  routeUser(session.user).catch(e => status.textContent = e.message);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const noBadan = String(noBadanInput?.value || '').trim();
  const password = String(passwordInput?.value || '');

  if (!noBadan || !password) {
    status.textContent = 'Sila masukkan No. Badan dan Kata Laluan.';
    return;
  }

  status.textContent = 'Sedang log masuk...';

  // Tukarkan No. Badan kepada e-mel Auth secara dalaman.
  // Pengguna tidak perlu mengetahui atau menaip e-mel.
  const { data: loginEmail, error: lookupError } = await supabase.rpc(
    'ecor_get_login_email',
    { p_no_badan: noBadan }
  );

  if (lookupError) {
    console.error('ecor_get_login_email:', lookupError);
    status.textContent = 'Log masuk No. Badan belum diaktifkan. Jalankan SQL FIX 124 di Supabase.';
    return;
  }

  if (!loginEmail) {
    status.textContent = 'No. Badan tidak ditemui atau akaun tidak aktif.';
    return;
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: loginEmail,
    password
  });

  if (error) {
    status.textContent = 'No. Badan atau Kata Laluan tidak sah.';
    return;
  }

  try {
    await routeUser(data.user);
  } catch (err) {
    status.textContent = err.message;
  }
});
