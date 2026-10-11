import { S } from '../state.js';
import { el, $ } from '../util/dom.js';
import { storeSwitch, timeAgoShort } from './storefront.js';
import { renderProfile } from './screens.js';
import { renderHome } from '../social/screens/home.js';

let socialAuth = null;

export function beginSocialSignIn(){
  const auth = MizikiSocial.status().auth;
  socialAuth = {
    step: auth === 'needsProfile' ? 'handle' : 'email',
    email: '', code: '', handle: '', displayName: '', visibility: 'friends',
    error: null, busy: false
  };
  $('#socialAuthOverlay').classList.add('open');
  $('#socialAuthOverlay').setAttribute('aria-hidden','false');
  renderSocialAuth();
}
export function closeSocialAuth(){
  $('#socialAuthOverlay').classList.remove('open');
  $('#socialAuthOverlay').setAttribute('aria-hidden','true');
  socialAuth = null;
}

// The sign-in wizard's "Open your store" entry point exists on both the
// Profile and Home tabs; refresh whichever one is actually on screen so
// finishing sign-in doesn't leave the other tab showing its stale pre-signin state.
function refreshSocialEntryHost(){
  const homeRoute = document.getElementById('route-home');
  if(homeRoute && homeRoute.classList.contains('on')) renderHome();
  else renderProfile();
}

function socialField(labelText, value, attrs){
  const row = el('div','slider-row');
  const head = el('div','slider-head'); head.appendChild(el('span', null, labelText));
  row.appendChild(head);
  const input = el('input','pl-input');
  Object.assign(input, attrs || {});
  input.value = value || '';
  row.appendChild(input);
  return { row, input };
}

function socialPrimaryStack(label, onClick, disabled){
  const stack = el('div','stack social-stack');
  const btn = el('button','cta', label);
  if(disabled) btn.disabled = true;
  btn.addEventListener('click', onClick);
  stack.appendChild(btn);
  return stack;
}

function renderSocialAuth(){
  const title = $('#socialAuthTitle');
  const body = $('#socialAuthBody'); body.innerHTML = '';
  if(socialAuth.step === 'email') renderSocialAuthEmail(title, body);
  else if(socialAuth.step === 'code') renderSocialAuthCode(title, body);
  else if(socialAuth.step === 'handle') renderSocialAuthHandle(title, body);
  else renderSocialAuthVisibility(title, body);
}

function renderSocialAuthEmail(title, body){
  title.textContent = 'Sign in';
  body.appendChild(el('p','note','We’ll email you a 6-digit code — no password to remember.'));
  const { row, input } = socialField('Email', socialAuth.email,
    {type:'email', placeholder:'you@example.com', autocomplete:'email'});
  body.appendChild(row);
  if(socialAuth.error) body.appendChild(el('p','note', socialAuth.error));
  body.appendChild(socialPrimaryStack(socialAuth.busy ? 'Sending…' : 'Send code', async ()=>{
    const email = input.value.trim();
    socialAuth.busy = true; socialAuth.error = null; renderSocialAuth();
    const r = await MizikiSocial.sendCode(email);
    socialAuth.busy = false;
    if(!r.ok){ socialAuth.error = r.error.message; renderSocialAuth(); return; }
    socialAuth.email = email; socialAuth.step = 'code';
    renderSocialAuth();
  }, socialAuth.busy));
}

function renderSocialAuthCode(title, body){
  title.textContent = 'Check your email';
  body.appendChild(el('p','note','Enter the 6-digit code we sent to ' + socialAuth.email + '.'));
  const { row, input } = socialField('Code', socialAuth.code,
    {type:'text', inputMode:'numeric', maxLength:8, placeholder:'123456', autocomplete:'one-time-code'});
  body.appendChild(row);
  if(socialAuth.error) body.appendChild(el('p','note', socialAuth.error));
  body.appendChild(socialPrimaryStack(socialAuth.busy ? 'Verifying…' : 'Verify', async ()=>{
    const code = input.value.trim();
    socialAuth.busy = true; socialAuth.error = null; renderSocialAuth();
    const r = await MizikiSocial.verifyCode(socialAuth.email, code);
    socialAuth.busy = false;
    if(!r.ok){ socialAuth.error = r.error.message; renderSocialAuth(); return; }
    if(r.status.auth === 'ready'){ closeSocialAuth(); refreshSocialEntryHost(); return; }
    socialAuth.step = 'handle';
    renderSocialAuth();
  }, socialAuth.busy));
  const linkRow = el('div','stack');
  const resend = el('button','cta ghost','Resend code');
  resend.addEventListener('click', async ()=>{
    socialAuth.busy = true; socialAuth.error = null; renderSocialAuth();
    await MizikiSocial.sendCode(socialAuth.email);
    socialAuth.busy = false; renderSocialAuth();
  });
  const back = el('button','cta ghost','Use a different email');
  back.addEventListener('click', ()=>{ socialAuth.step = 'email'; socialAuth.error = null; renderSocialAuth(); });
  linkRow.appendChild(resend); linkRow.appendChild(back);
  body.appendChild(linkRow);
}

function renderSocialAuthHandle(title, body){
  title.textContent = 'Create your crate';
  body.appendChild(el('p','note','Your handle is how friends find you — it’s also your crate name.'));
  const { row, input } = socialField('Handle', socialAuth.handle,
    {type:'text', placeholder:'yourname', maxLength:24, autocapitalize:'none', autocorrect:'off'});
  body.appendChild(row);
  const status = el('p','note','3–24 characters: letters, numbers, underscore.');
  body.appendChild(status);
  const { row: nameRow, input: nameInput } = socialField('Display name (optional)', socialAuth.displayName,
    {type:'text', placeholder:'Shown under your handle', maxLength:50});
  body.appendChild(nameRow);
  if(socialAuth.error) body.appendChild(el('p','note', socialAuth.error));
  let seq = 0, debounceTimer = null;
  input.addEventListener('input', ()=>{
    clearTimeout(debounceTimer);
    const h = input.value.trim().toLowerCase();
    debounceTimer = setTimeout(async ()=>{
      if(!h){ status.textContent = '3–24 characters: letters, numbers, underscore.'; return; }
      const mySeq = ++seq;
      status.textContent = 'Checking…';
      const r = await MizikiSocial.checkHandle(h);
      if(mySeq !== seq) return;
      if(!r.ok){ status.textContent = r.error.message; return; }
      status.textContent = r.available ? '@' + h + ' is available.'
        : (r.reason === 'format' ? '3–24 characters: letters, numbers, underscore.' : 'That handle is taken.');
    }, 350);
  });
  body.appendChild(socialPrimaryStack(socialAuth.busy ? 'Checking…' : 'Continue', async ()=>{
    const h = input.value.trim().toLowerCase();
    socialAuth.busy = true; socialAuth.error = null; renderSocialAuth();
    const avail = await MizikiSocial.checkHandle(h);
    if(!avail.ok || !avail.available){
      socialAuth.busy = false;
      socialAuth.error = (avail.ok && avail.reason !== 'format') ? 'That handle is taken.'
        : '3–24 characters: letters, numbers, underscore.';
      socialAuth.handle = h;
      renderSocialAuth(); return;
    }
    socialAuth.handle = h; socialAuth.displayName = nameInput.value.trim(); socialAuth.busy = false;
    socialAuth.step = 'visibility';
    renderSocialAuth();
  }, socialAuth.busy));
}

function renderSocialAuthVisibility(title, body){
  title.textContent = 'Who can see your crate?';
  const opts = [
    {key:'private', label:'Only you', desc:'Nothing is visible to anyone else yet.'},
    {key:'friends', label:'Friends only', desc:'People you approve can browse your crate.'},
    {key:'public', label:'Everyone', desc:'Anyone can find and follow your crate.'}
  ];
  const list = el('div','social-vis-list');
  opts.forEach(o => {
    const row = document.createElement('button');
    row.type = 'button'; row.className = 'social-vis-option';
    row.setAttribute('aria-pressed', String(socialAuth.visibility === o.key));
    const text = el('div');
    text.appendChild(el('b', null, o.label));
    text.appendChild(el('div','note', o.desc));
    row.appendChild(text);
    row.addEventListener('click', ()=>{ socialAuth.visibility = o.key; renderSocialAuth(); });
    list.appendChild(row);
  });
  body.appendChild(list);
  if(socialAuth.error) body.appendChild(el('p','note', socialAuth.error));
  body.appendChild(socialPrimaryStack(socialAuth.busy ? 'Opening your crate…' : 'Finish', async ()=>{
    socialAuth.busy = true; socialAuth.error = null; renderSocialAuth();
    const created = await MizikiSocial.createProfile({handle: socialAuth.handle, displayName: socialAuth.displayName});
    if(!created.ok){
      socialAuth.busy = false; socialAuth.error = created.error.message; socialAuth.step = 'handle';
      renderSocialAuth(); return;
    }
    if(socialAuth.visibility !== 'friends'){
      const updated = await MizikiSocial.updateProfile({visibility: socialAuth.visibility});
      if(!updated.ok){ socialAuth.busy = false; socialAuth.error = updated.error.message; renderSocialAuth(); return; }
    }
    socialAuth.busy = false;
    closeSocialAuth();
    refreshSocialEntryHost();
  }, socialAuth.busy));
}

function socialSyncStatusLine(status){
  if(status.sync === 'syncing') return 'Syncing…';
  if(status.sync === 'offline') return 'Offline — will retry automatically.';
  if(status.sync === 'error') return 'Couldn’t sync' + (status.lastError ? ': ' + status.lastError.message : '.');
  if(status.sync === 'needsReview') return 'Paused — review removed records below.';
  if(status.lastSyncedAt) return 'Synced ' + timeAgoShort(Date.now() - status.lastSyncedAt);
  return 'Not synced yet.';
}

export function renderSocialSettingsScreen(body){
  body.innerHTML = '';
  const status = MizikiSocial.status();
  if(status.sync === 'needsReview' && status.pendingRemovals > 0){
    const banner = el('div','store-open-card');
    banner.appendChild(el('h3', null, status.pendingRemovals === 1 ? '1 record disappeared from your library'
      : status.pendingRemovals + ' records disappeared from your library'));
    banner.appendChild(el('p', null, 'Remove them from your crate too, or keep them there until you’re sure.'));
    const btn = el('button','cta','Confirm removal');
    btn.addEventListener('click', async ()=>{ await MizikiSocial.confirmRemovals(); renderSocialSettingsScreen(body); });
    banner.appendChild(btn);
    body.appendChild(banner);
  }
  body.appendChild(el('p','note', socialSyncStatusLine(status)));
  if(status.skipped && (status.skipped.collisions > 0 || status.skipped.noArtist > 0)){
    if(status.skipped.collisions > 0) body.appendChild(el('p','note',
      status.skipped.collisions + ' album' + (status.skipped.collisions === 1 ? '' : 's') + ' share a title with another in your library, so only one of each made it to your crate.'));
    if(status.skipped.noArtist > 0) body.appendChild(el('p','note',
      status.skipped.noArtist + ' album' + (status.skipped.noArtist === 1 ? ' has' : 's have') + ' no artist tagged, so ' +
      (status.skipped.noArtist === 1 ? 'it' : 'they') + ' can’t be shared yet.'));
  }

  const settings = MizikiSocial.getSettings();
  const spinRow = el('div','social-setting-row');
  spinRow.appendChild(el('h2', null, 'Share what you’re spinning'));
  spinRow.appendChild(storeSwitch('Share what you’re spinning', settings.shareNowSpinning,
    on => MizikiSocial.setSetting('shareNowSpinning', on)));
  body.appendChild(spinRow);
  body.appendChild(el('p','note','Friends who follow you see the album and track while you listen.'));

  const milestoneRow = el('div','social-setting-row');
  milestoneRow.appendChild(el('h2', null, 'Share rare-pressing milestones'));
  milestoneRow.appendChild(storeSwitch('Share rare-pressing milestones', settings.shareMilestones,
    on => MizikiSocial.setSetting('shareMilestones', on)));
  body.appendChild(milestoneRow);
  body.appendChild(el('p','note','Off by default. When on, hitting a rare pressing posts to your activity for friends to see.'));

  const signOutStack = el('div','stack social-stack');
  const signOutBtn = el('button','cta ghost','Sign out');
  signOutBtn.addEventListener('click', async ()=>{
    await MizikiSocial.signOut();
    S.profileView.screen = 'home';
    renderProfile();
  });
  signOutStack.appendChild(signOutBtn);
  body.appendChild(signOutStack);
}
