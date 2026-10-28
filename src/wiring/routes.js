/* ================= wiring: route tab bar =================
   The tab bar that switches between the top-level routes
   (library/profile/home). A one-line area of its own, kept separate
   from the library view's own internal tab wiring
   (src/wiring/library-view.js), since this is top-level navigation, not
   a library-screen concern. */
import { showRoute } from '../shell/routes.js';

export function wireRoutes(){
  document.querySelectorAll('.tabbar-btn').forEach(b => b.addEventListener('click', ()=> showRoute(b.dataset.route)));
}
