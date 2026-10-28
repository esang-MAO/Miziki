import { S } from '../state.js';
import { el, $ } from '../util/dom.js';
import { timeAgoShort } from './storefront.js';
import { renderProfile } from './screens.js';
import { renderHome, clearHomeFeedCache } from '../social/screens/home.js';
import { wirePrivacyLink } from './privacy-link.js';
import { legalLinksRow } from './legal-links.js';
import { getBackupStatus, listBackupDevices, removeBackupDevice, dismissStaleDeviceNotice } from '../sync/backup.js';
import { openLayer, closeLayer, forceCloseLayer } from '../shell/nav-stack.js';

let socialAuth = null;

// A handle must already look valid (same shape as MizikiSocial's own
// HANDLE_RX) before it's worth pre-filling or checking — a username with
// spaces/punctuation, or too short once stripped, just leaves the field
// blank for the user to type their own, same as a fresh sign-in always has.
function handleFromUsername(username){
  const h = String(username || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24);
  return /^[a-z0-9_]{3,24}$/.test(h) ? h : '';
}

export function beginSocialSignIn(){
  const auth = MizikiSocial.status().auth;
  const prefillHandle = auth === 'needsProfile' ? handleFromUsername(S.profile.username) : '';
  socialAuth = {
    step: auth === 'needsProfile' ? 'handle' : 'email',
    email: '', code: '', handle: prefillHandle, displayName: '', visibility: 'friends',
    error: null, busy: false, handleStatus: null
  };
  const overlay = $('#socialAuthOverlay');
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden','false');
  renderSocialAuth();
  if(prefillHandle) checkPrefilledHandle(prefillHandle);
  openLayer('social-auth', closeSocialAuth, { container: overlay });
}

async function checkPrefilledHandle(h){
  const r = await MizikiSocial.checkHandle(h);
  if(!socialAuth || socialAuth.handle !== h) return;   // user already changed it
  socialAuth.handleStatus = !r.ok ? r.error.message
    : r.available ? '@' + h + ' is available.'
    : (r.reason === 'reserved' ? 'That handle is reserved.' : 'That handle is taken.');
  if(socialAuth.step === 'handle') renderSocialAuth();
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
  // closeSocialAuth first — otherwise the sign-in modal would stay open on
  // top of the profile screen underneath it once renderProfile() runs.
  body.appendChild(el('p','note','By continuing, you agree to our Privacy Policy and Terms of use.'));
  body.appendChild(legalLinksRow(renderProfile, () => forceCloseLayer('social-auth')));
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
    if(r.status.auth === 'ready'){ closeLayer('social-auth'); refreshSocialEntryHost(); return; }
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
  const status = el('p','note', socialAuth.handleStatus || '3–24 characters: letters, numbers, underscore.');
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
        : (r.reason === 'format' ? '3–24 characters: letters, numbers, underscore.'
          : r.reason === 'reserved' ? 'That handle is reserved.' : 'That handle is taken.');
    }, 350);
  });
  body.appendChild(socialPrimaryStack(socialAuth.busy ? 'Checking…' : 'Continue', async ()=>{
    const h = input.value.trim().toLowerCase();
    socialAuth.busy = true; socialAuth.error = null; renderSocialAuth();
    const avail = await MizikiSocial.checkHandle(h);
    if(!avail.ok || !avail.available){
      socialAuth.busy = false;
      socialAuth.error = !avail.ok ? avail.error.message
        : avail.reason === 'reserved' ? 'That handle is reserved.'
        : avail.reason === 'format' ? '3–24 characters: letters, numbers, underscore.'
        : 'That handle is taken.';
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
    closeLayer('social-auth');
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

// Account screen (step 06, B3) — @handle + email, backup status, the
// device list, sign out (this device only) / sign out everywhere (every
// device — a lost-phone escape hatch) / delete account. The sharing
// toggles and crate visibility moved to the Privacy screen
// (src/profile/privacy.js); the crate-sync review banner/skip notices
// below are kept here, not there, since they're about this account's
// crate sync specifically, not a privacy control.
function accountBackupStatusLine(){
  const st = getBackupStatus();
  // RF17 (docs/12_REFINE.md, point 4): a remote row this build's own
  // SCHEMA_VERSION doesn't understand yet is left out of the merge
  // entirely (src/sync/backup-doc.js's fromDocs()), not guessed at — this
  // is the one thing the user can actually do something about (update
  // this device), so it's surfaced ahead of the ordinary sync status.
  if(st.newerVersionSeen) return 'Another device has a newer Miziki.';
  if(st.waiting) return 'Backed up · syncing…';
  if(st.lastSyncedAt) return 'Backed up · ' + timeAgoShort(Date.now() - st.lastSyncedAt) + ' ago';
  return 'Waiting for connection.';
}

// RF25 point 3 (docs/12_REFINE.md): "[Device] hasn't synced since [date].
// Remove it?" — a device untouched for 12 months, with a way to keep it.
function renderStaleDeviceNotice(body, d, onResolved){
  const notice = el('div','social-setting-row stale-device-notice');
  const since = new Date(d.updatedAt).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' });
  notice.appendChild(el('p','note', d.label + ' hasn’t synced since ' + since + '. Remove it?'));
  const actions = el('div','stack');
  const removeBtn = el('button','cta ghost','Remove');
  const keepBtn = el('button','cta ghost','Keep');
  removeBtn.addEventListener('click', async ()=>{
    removeBtn.disabled = true; keepBtn.disabled = true;
    const ok = await removeBackupDevice(d.deviceId);
    if(ok) onResolved(); else { removeBtn.disabled = false; keepBtn.disabled = false; }
  });
  keepBtn.addEventListener('click', async ()=>{
    removeBtn.disabled = true; keepBtn.disabled = true;
    const ok = await dismissStaleDeviceNotice(d.deviceId);
    if(ok) onResolved(); else { removeBtn.disabled = false; keepBtn.disabled = false; }
  });
  actions.appendChild(removeBtn); actions.appendChild(keepBtn);
  notice.appendChild(actions);
  body.appendChild(notice);
}

function renderDeviceList(body){
  const section = el('div','social-setting-row');
  section.appendChild(el('h2', null, 'Devices'));
  body.appendChild(section);
  const list = el('p','note','Loading…');
  body.appendChild(list);
  listBackupDevices().then(devices => {
    list.remove();
    if(!devices.length){ body.appendChild(el('p','note','No devices yet.')); return; }
    devices.forEach(d => {
      if(d.isStale){ renderStaleDeviceNotice(body, d, () => renderSocialSettingsScreen(body)); return; }
      const row = el('div','social-setting-row');
      row.appendChild(el('span', null, d.label + (d.isThisDevice ? ' (this device)' : '')));
      row.appendChild(el('em', null, d.updatedAt ? 'Synced ' + timeAgoShort(Date.now() - d.updatedAt) + ' ago' : 'Never synced'));
      body.appendChild(row);
    });
  });
}

function renderDeleteAccount(body, profile){
  const section = el('div','social-setting-row');
  section.appendChild(el('h2', null, 'Delete account'));
  body.appendChild(section);
  body.appendChild(el('p','note',
    'This permanently removes your account, handle, backup and social data from the server. '
    + 'Your music and listening history on this device stay exactly as they are.'));
  const confirmInput = el('input','pl-input');
  confirmInput.type = 'text'; confirmInput.placeholder = 'Type @' + profile.handle + ' to confirm';
  confirmInput.autocapitalize = 'none'; confirmInput.autocorrect = 'off';
  body.appendChild(confirmInput);
  const deleteBtn = el('button','cta forget-btn','Delete account');
  deleteBtn.disabled = true;
  confirmInput.addEventListener('input', ()=>{
    deleteBtn.disabled = confirmInput.value.trim().toLowerCase().replace(/^@/,'') !== profile.handle.toLowerCase();
  });
  deleteBtn.addEventListener('click', async ()=>{
    deleteBtn.disabled = true; deleteBtn.textContent = 'Deleting…';
    const r = await MizikiSocial.deleteAccount();
    if(!r.ok){
      deleteBtn.textContent = 'Delete account';
      body.appendChild(el('p','note', r.error.message));
      return;
    }
    // NV4 (docs/11_SMOOTH_NAVIGATION.md): the Home feed's own device-only
    // cache must never survive a sign-out/account deletion.
    clearHomeFeedCache();
    S.profileView.screen = 'home';
    renderProfile();
  });
  body.appendChild(deleteBtn);
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

  MizikiSocial.getMyProfile().then(profRes => {
    const profile = profRes.ok ? profRes.profile : null;
    if(!profile) return;
    MizikiSocial.getClient().auth.getUser().then(({data}) => {
      const email = data && data.user && data.user.email;
      const idRow = el('div','social-setting-row');
      idRow.appendChild(el('b', null, '@' + profile.handle));
      if(email) idRow.appendChild(el('em', null, email));
      body.insertBefore(idRow, body.firstChild);
      body.insertBefore(el('p','note', accountBackupStatusLine()), idRow.nextSibling);
    });
  });

  renderDeviceList(body);

  const signOutStack = el('div','stack social-stack');
  const signOutBtn = el('button','cta ghost','Sign out');
  signOutBtn.addEventListener('click', async ()=>{
    await MizikiSocial.signOut();
    clearHomeFeedCache();
    S.profileView.screen = 'home';
    renderProfile();
  });
  signOutStack.appendChild(signOutBtn);
  const signOutAllBtn = el('button','cta ghost','Sign out everywhere');
  signOutAllBtn.addEventListener('click', async ()=>{
    await MizikiSocial.signOutEverywhere();
    clearHomeFeedCache();
    S.profileView.screen = 'home';
    renderProfile();
  });
  signOutStack.appendChild(signOutAllBtn);
  body.appendChild(signOutStack);

  wirePrivacyLink(body, renderProfile);

  MizikiSocial.getMyProfile().then(profRes => {
    if(profRes.ok && profRes.profile) renderDeleteAccount(body, profRes.profile);
  });
}
