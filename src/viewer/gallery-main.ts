// The design gallery's page: all 38 released hulls, and nothing else.
//
// The grid itself is gallery.ts; this is the entry that puts it on `/gallery`
// (gallery.html, an entry in vite.config.ts — a page that is not an entry does
// not build). It owns the gallery's KEYS, which used to live in the combat
// viewer's keydown handler behind a `G` mode toggle: one page opened on the
// gallery with a combat dropdown underneath it, so the combat viewer read as
// deleted and the gallery read as a mode of it. Two pages, one thing each, no
// mode key (TODO 57).

import { createGallery, type GalleryScale, type GalleryView } from './gallery.ts';
import { createStage } from './stage.ts';

const { scene, camera, render } = createStage();

const gallery = createGallery();
scene.add(gallery.root);

const SCALES: GalleryScale[] = ['common', 'relative'];
const VIEWS: GalleryView[] = ['spin', 'front', 'rear', 'top', 'side'];
const cycle = <T,>(list: T[], current: T): T =>
  list[(list.indexOf(current) + 1) % list.length];

window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (key === 's') gallery.scale = cycle(SCALES, gallery.scale);
  if (key === 'v') gallery.view = cycle(VIEWS, gallery.view);
  if (key === '0' || key === 'escape') gallery.focus = null;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const step = e.key === 'ArrowRight' ? 1 : -1;
    gallery.focus = gallery.focus === null
      ? (step > 0 ? 0 : gallery.count - 1)
      : (gallery.focus + step + gallery.count) % gallery.count;
  }
});

const hud = document.getElementById('viewer-hud')!;
let last = performance.now();

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  gallery.update(dt, camera);
  render();
  hud.textContent = gallery.hudLines().join('\n');
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
