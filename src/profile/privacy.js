/* ================= privacy screen =================
   Step 06 (B3): one place for controls that were scattered across the
   social sign-in wizard and the old "socialSettings" screen (now the
   Account screen, src/profile/settings.js) — profile visibility, the two
   sharing toggles, follow requests, blocked accounts, and backup status.
   Reachable from Profile (renderProfileHome, below) and from the Account
   screen (settings.js's own Privacy link) — both just set
   S.profileView.screen = 'privacy' and re-render.

   Works fully signed out: the backup sentence and status always show
   (backup is off with nothing uploaded, same as everywhere else in the
   social layer when it's inert), and the social-only sections (visibility,
   sharing, requests, blocked) show a calm "sign in to use this" row
   instead of fetching anything. */
import { S } from '../state.js';
import { el } from '../util/dom.js';
import { storeSwitch, timeAgoShort } from './storefront.js';
import { getBackupStatus, collectDownloadData, pushOrClearListeningRhythm } from '../sync/backup.js';

function backupStatusLine(){
  const st = getBackupStatus();
  if(!st.backedUp && !st.lastSyncedAt) return st.waiting ? 'Waiting for connection.' : 'Not backed up.';
  if(st.waiting) return 'Backed up · syncing…';
  if(st.lastError) return 'Backed up · last sync had trouble, will retry.';
  return st.lastSyncedAt ? 'Backed up · ' + timeAgoShort(Date.now() - st.lastSyncedAt) + ' ago' : 'Not backed up.';
}

function visibilityPicker(body, current){
  const opts = [
    {key:'private', label:'Only you'},
    {key:'friends', label:'Friends only'},
    {key:'public', label:'Everyone'},
  ];
  const list = el('div','social-vis-list');
  opts.forEach(o => {
    const row = document.createElement('button');
    row.type = 'button'; row.className = 'social-vis-option';
    row.setAttribute('aria-pressed', String(current === o.key));
    row.appendChild(el('b', null, o.label));
    row.addEventListener('click', async ()=>{
      const r = await MizikiSocial.updateProfile({visibility: o.key});
      if(r.ok) renderPrivacyScreen(body);
    });
    list.appendChild(row);
  });
  return list;
}

function renderSocialSection(body, status){
  const auth = status.auth;
  if(auth !== 'ready'){
    body.appendChild(el('p','note', 'Sign in (from the Account screen) to set your crate’s visibility, control sharing, and manage follow requests and blocked accounts.'));
    return;
  }

  body.appendChild(el('h2', null, 'Who can see your crate'));
  body.appendChild(el('p','note','Loading…'));
  Promise.all([MizikiSocial.getMyProfile(), MizikiSocial.listRequests(), MizikiSocial.listBlocked()])
    .then(([profRes, reqRes, blockedRes]) => {
      body.lastChild.remove();   // the "Loading…" note
      const vis = (profRes.ok && profRes.profile && profRes.profile.visibility) || 'friends';
      body.appendChild(visibilityPicker(body, vis));

      const settings = MizikiSocial.getSettings();
      const spinRow = el('div','social-setting-row');
      spinRow.appendChild(el('h2', null, 'Share what you’re spinning'));
      spinRow.appendChild(storeSwitch('Share what you’re spinning', settings.shareNowSpinning,
        on => MizikiSocial.setSetting('shareNowSpinning', on)));
      body.appendChild(spinRow);
      body.appendChild(el('p','note','Friends who follow you see the album and track while you listen. Off by default.'));

      const milestoneRow = el('div','social-setting-row');
      milestoneRow.appendChild(el('h2', null, 'Share rare-pressing milestones'));
      milestoneRow.appendChild(storeSwitch('Share rare-pressing milestones', settings.shareMilestones,
        on => MizikiSocial.setSetting('shareMilestones', on)));
      body.appendChild(milestoneRow);
      body.appendChild(el('p','note','Off by default. When on, hitting a rare pressing posts to your activity for friends to see.'));

      // DA5 (docs/DAY_ARC.md point 3): "updated at most daily, and
      // immediately when the switch is flipped" -- setSetting() alone only
      // ever changes this device's own local flag, the same as the two
      // toggles just above; pushOrClearListeningRhythm() (src/sync/
      // backup.js) is the one call that actually does the immediate part,
      // fire-and-forget the same way every other sign-in-adjacent action on
      // this screen already is (respondToRequest, unblock, …) rather than
      // making the switch itself wait on a network round trip.
      const rhythmRow = el('div','social-setting-row');
      rhythmRow.appendChild(el('h2', null, 'Share my listening rhythm'));
      rhythmRow.appendChild(storeSwitch('Share my listening rhythm', settings.shareListeningRhythm, on => {
        MizikiSocial.setSetting('shareListeningRhythm', on);
        pushOrClearListeningRhythm(on);
      }));
      body.appendChild(rhythmRow);
      body.appendChild(el('p','note',
        'Off by default. When on, friends who can see your crate see your listening-rhythm verdict and the share for each part of the day — never your individual plays or times. Needs 20 counted plays to show anything.'));

      const requests = (reqRes.ok && reqRes.requests) || [];
      body.appendChild(el('h2', null, 'Follow requests'));
      if(!requests.length) body.appendChild(el('p','note','No pending requests.'));
      else requests.forEach(r => {
        const row = el('div','social-setting-row');
        const prof = r.profiles || {};
        row.appendChild(el('span', null, '@' + prof.handle));
        const accept = el('button','cta ghost','Approve');
        accept.addEventListener('click', async ()=>{ await MizikiSocial.respondToRequest(r.follower_id, true); renderPrivacyScreen(body); });
        const decline = el('button','cta ghost','Decline');
        decline.addEventListener('click', async ()=>{ await MizikiSocial.respondToRequest(r.follower_id, false); renderPrivacyScreen(body); });
        row.appendChild(accept); row.appendChild(decline);
        body.appendChild(row);
      });

      const blocked = (blockedRes.ok && blockedRes.blocked) || [];
      body.appendChild(el('h2', null, 'Blocked accounts'));
      if(!blocked.length) body.appendChild(el('p','note','Nobody is blocked.'));
      else blocked.forEach(b => {
        const row = el('div','social-setting-row');
        const prof = b.profiles || {};
        row.appendChild(el('span', null, '@' + prof.handle));
        const unblockBtn = el('button','cta ghost','Unblock');
        unblockBtn.addEventListener('click', async ()=>{ await MizikiSocial.unblock(b.blocked_id); renderPrivacyScreen(body); });
        row.appendChild(unblockBtn);
        body.appendChild(row);
      });
    });
}

function downloadBlob(filename, text){
  const blob = new Blob([text], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}

function todayFilename(){
  const d = new Date();
  const pad = n => String(n).padStart(2,'0');
  return 'miziki-data-' + d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + '.json';
}

export function renderPrivacyScreen(body){
  body.innerHTML = '';
  const status = MizikiSocial.status();

  body.appendChild(el('h2', null, 'Backup'));
  body.appendChild(el('p','note', backupStatusLine()));
  body.appendChild(el('p','note',
    'Your listening history is backed up privately to your account. Your music and your location never leave this device.'));

  const dlBtn = el('button','cta ghost','Download my data');
  dlBtn.addEventListener('click', async ()=>{
    dlBtn.disabled = true; dlBtn.textContent = 'Preparing…';
    try{
      const data = await collectDownloadData();
      const text = JSON.stringify(data, null, 2);
      if(navigator.share && navigator.canShare && navigator.canShare({files:[new File([text], todayFilename(), {type:'application/json'})]})){
        await navigator.share({files:[new File([text], todayFilename(), {type:'application/json'})]});
      } else {
        downloadBlob(todayFilename(), text);
      }
    }catch(_e){ /* best effort — nothing destructive to undo on failure */ }
    dlBtn.disabled = false; dlBtn.textContent = 'Download my data';
  });
  body.appendChild(dlBtn);
  body.appendChild(el('p','note','One JSON file with everything Miziki holds about you: local stats, settings, playlists and edits, plus your account and social data if you’re signed in. No audio or images.'));

  renderSocialSection(body, status);
}

// takes the caller's own renderProfile (screens.js, settings.js both
// already import it for their own navigation) rather than importing it
// here — privacy.js importing back from screens.js would make the two a
// real circular pair, and screens.js is already the hub several other
// profile/social modules circle back to; no need to add one more edge
// just for this one button.
export function wirePrivacyLink(host, renderProfile){
  const btn = el('button','cta ghost profile-share','Privacy');
  btn.addEventListener('click', ()=>{ S.profileView.screen = 'privacy'; renderProfile(); });
  host.appendChild(btn);
}
