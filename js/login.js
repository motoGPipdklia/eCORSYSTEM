import { supabase } from './supabase.js';
const form=document.querySelector('#loginForm'), status=document.querySelector('#status');
async function routeUser(user){
 const {data:p,error}=await supabase.from('profiles').select('peranan,aktif').eq('id',user.id).single();
 if(error) throw error;
 if(!p?.aktif) throw new Error('Akaun tidak aktif.');
 location.replace(p.peranan==='PENTADBIR'?'admin.html':'dashboard.html');
}
const {data:{session}}=await supabase.auth.getSession(); if(session) routeUser(session.user).catch(e=>status.textContent=e.message);
form.addEventListener('submit',async e=>{e.preventDefault();status.textContent='Sedang log masuk...';const {data,error}=await supabase.auth.signInWithPassword({email:email.value.trim(),password:password.value});if(error){status.textContent=error.message;return;}try{await routeUser(data.user)}catch(err){status.textContent=err.message}});
