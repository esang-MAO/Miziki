/* ================= haptic tick =================
   One light tap, for moments that land something (the launch intro's
   catch). Best-effort and silent when unsupported:
   - The Capacitor app build (see CLAUDE.md's long-term plan) gets a real
     light impact through the Haptics plugin, once that plugin is present.
   - Android browsers vibrate only after the page has had a user gesture
     (navigator.userActivation), so it's checked first rather than letting
     Chrome log a "blocked call" warning on every cold start.
   - iOS Safari has no web vibration API at all; this is a no-op there,
     which is why the intro's catch is also a visible lift, never haptic
     alone. */
export function hapticTick(){
  try{
    const cap = typeof window !== 'undefined' && window.Capacitor;
    const haptics = cap && cap.Plugins && cap.Plugins.Haptics;
    if(haptics && typeof haptics.impact === 'function'){
      haptics.impact({ style: 'LIGHT' });
      return;
    }
    if(typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    const ua = navigator.userActivation;
    if(ua && !ua.hasBeenActive) return;
    navigator.vibrate(8);
  }catch(_e){}
}
