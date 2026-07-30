import * as THREE from 'three';
import { Game } from './game/game.ts';
import { browserShell } from './engine/browser-shell.ts';

// The one place a canvas becomes a game.
//
// Everything platform-bound lives inside `browserShell`; `Game` itself names no
// DOM API at all — see engine/shell.ts for why that seam is where it is.
const canvas = document.getElementById('scene') as HTMLCanvasElement;
new Game((scene: THREE.Scene) => browserShell(canvas, scene));
