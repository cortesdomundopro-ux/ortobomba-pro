import { Q, type Question } from "./questions";

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyA7bNETm-vYNo4wKmWEFqbxL00EPtilO2k",
  authDomain: "ortobomba-2d1d9.firebaseapp.com",
  databaseURL: "https://ortobomba-2d1d9-default-rtdb.firebaseio.com",
  projectId: "ortobomba-2d1d9",
  storageBucket: "ortobomba-2d1d9.firebasestorage.app",
  messagingSenderId: "797890574922",
  appId: "1:797890574922:web:c5b739f98ca16b079504b3"
};

const ADMIN_CODE: string =
  (import.meta as unknown as { env: Record<string, string | undefined> } ).env
    .VITE_ADMIN_CODE ?? "OB_ADMIN";
const TURN_DURATION = 10;
const MAX_PLAYERS = 4;
const PLAYER_STALE_MS = 35_000;
const BOMB_PASS_MS = 940;
const BOMBER_WIDTH = 13;
const BOMBER_HEIGHT = 11;
const BOMBER_BOMB_MS = 2200;
const BOMBER_EXPLOSION_MS = 650;
const BOMBER_HIT_COOLDOWN_MS = 900;
const BOMBER_STEP_MS = 150;
const BOMBER_STARTS: ArenaSlotPoint[] = [
  { x: 1, y: 1 },
  { x: BOMBER_WIDTH - 2, y: 1 },
  { x: 1, y: BOMBER_HEIGHT - 2 },
  { x: BOMBER_WIDTH - 2, y: BOMBER_HEIGHT - 2 }
];
const PLAYER_EMOJIS = ["\u{1F604}", "\u{1F60E}", "\u{1F916}", "\u{1F47B}"];
const SLOT_COLORS = ["#00d9ff", "#ff4fb8", "#35f06b", "#ffc700"];

declare const firebase: any;

type Player = {
  id: string;
  nick: string;
  skinIndex: number;
  lives: number;
  score: number;
  online: boolean;
  joinedAt: number;
  seenAt?: number;
  eliminatedAt?: number | null;
};

type Room = {
  code: string;
  quick?: boolean;
  status: "lobby" | "playing" | "finished";
  hostId: string;
  players: Record<string, Player>;
  bomber?: BomberState | null;
  currentTurn: string | null;
  currentQIndex: number | null;
  usedQ: number[];
  currentQ: Question | null;
  turnStartedAt: number;
  roundCount: number;
  eliminationOrder: string[];
  winnerId?: string | null;
  updatedAt?: number;
};

type BombPoint = {
  x: number;
  y: number;
};

type BomberCell = "empty" | "wall" | "block";

type BomberPlayerState = {
  x: number;
  y: number;
  lives: number;
  alive: boolean;
  bombLimit?: number;
  bombRange?: number;
  speedLevel?: number;
  shieldUntil?: number;
  skullUntil?: number;
  lastHitAt?: number;
};

type BomberBomb = {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  placedAt: number;
  explodeAt: number;
  range: number;
};

type BomberExplosion = {
  id: string;
  cells: ArenaSlotPoint[];
  createdAt: number;
  expiresAt: number;
};

type BomberPowerupKind = "speed" | "range" | "bomb" | "heart" | "shield" | "skull";

type BomberPowerup = {
  id: string;
  kind: BomberPowerupKind;
  x: number;
  y: number;
};

type BomberState = {
  width: number;
  height: number;
  cells: BomberCell[];
  players: Record<string, BomberPlayerState>;
  bombs: BomberBomb[];
  explosions: BomberExplosion[];
  powerups: BomberPowerup[];
  startedAt: number;
  updatedAt: number;
};

type PlayerVisualState =
  | "idle"
  | "holdingBomb"
  | "catchingBomb"
  | "throwingBomb"
  | "hit"
  | "victory"
  | "defeat";

let db: any = null;
let ME = { nick: "", id: "", salaId: "", host: false, skinIndex: 0 };
let salaRef: any = null;
let reactionRef: any = null;
const sentReactionIds = new Set<string>();
let adminRef: any = null;
let bombTimerInterval: ReturnType<typeof setInterval> | null = null;
let presenceInterval: ReturnType<typeof setInterval> | null = null;
let particlesActive = true;
let muted = false;
let AC: AudioContext | null = null;
let GS: Room = emptyRoom("");
let prevTurnId: string | null = null;
let activeBombPass: Animation | null = null;
let winnerSaved = false;
let localMode = false;
let localRoom: Room | null = null;
let lastTickSecond: number | null = null;
let reactionEventsBound = false;
let bomberEventsBound = false;
let bomberTickInterval: ReturnType<typeof setInterval> | null = null;
let bomberMovePending = false;
let bomberStepLockedUntil = 0;
const previousBomberPositions = new Map<string, ArenaSlotPoint>();
let lastRoomSignature = "";
let runtimePlayerId = uid();
const REACTION_EMOJIS = ["\u{1F602}", "\u{1F525}", "\u{1F4A3}"];
const REACTION_SPARKS = REACTION_EMOJIS;
const DEFAULT_REACTION = REACTION_EMOJIS[0];
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const previousLives = new Map<string, number>();

function emptyRoom(code: string): Room {
  return {
    code,
    status: "lobby",
    hostId: "",
    players: {},
    currentTurn: null,
    currentQIndex: null,
    usedQ: [],
    currentQ: null,
    turnStartedAt: 0,
    roundCount: 1,
    eliminationOrder: [],
    winnerId: null
  };
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Elemento #${id} nao encontrado`);
  return node as T;
}

function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>'"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c] ?? c)
  );
}

function attrEsc(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function skinIndexOf(skinIndex: number): number {
  return ((skinIndex % PLAYER_EMOJIS.length) + PLAYER_EMOJIS.length) % PLAYER_EMOJIS.length;
}

function avatarHtml(skinIndex: number): string {
  const idx = skinIndexOf(skinIndex);
  return `<span class="avatar-head emoji-avatar">${PLAYER_EMOJIS[idx]}</span>`;
}

function playerAssetForSkin(skinIndex: number): string {
  return `/arena/players/player-${skinIndexOf(skinIndex) + 1}.png`;
}

function playerArtHtml(skinIndex: number, className = "player-art-avatar"): string {
  return `<img class="${className}" src="${playerAssetForSkin(skinIndex)}" alt="" draggable="false">`;
}

function normalizeReactionEmoji(raw: string): string {
  const emoji = String(raw || "").trim();
  return REACTION_EMOJIS.includes(emoji) ? emoji : DEFAULT_REACTION;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function now(): number {
  return Date.now();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function saveNick(n: string) {
  try { localStorage.setItem("ob_nick", n); } catch {}
}

function loadNick(): string {
  try { return localStorage.getItem("ob_nick") ?? ""; } catch { return ""; }
}

function getPlayerId(): string {
  return runtimePlayerId;
}

function toast(msg: string, col = "#00d97e", d = 2500) {
  const t = el<HTMLDivElement>("toast");
  t.textContent = msg;
  t.style.background = col;
  t.style.color = "#fff";
  t.style.opacity = "1";
  clearTimeout((t as any)._t);
  (t as any)._t = setTimeout(() => { t.style.opacity = "0"; }, d);
}

function getAC(): AudioContext | null {
  if (muted) return null;
  if (!AC) {
    try { AC = new (window.AudioContext ?? (window as any).webkitAudioContext)(); } catch {}
  }
  return AC;
}

function playTick(urgent: boolean) {
  const ac = getAC();
  if (!ac) return;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = urgent ? "square" : "sine";
  o.frequency.setValueAtTime(urgent ? 1200 : 800, ac.currentTime);
  g.gain.setValueAtTime(0.1, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.01, ac.currentTime + 0.05);
  o.connect(g);
  g.connect(ac.destination);
  o.start();
  o.stop(ac.currentTime + 0.05);
}

function playBoom() {
  const ac = getAC();
  if (!ac) return;
  const o1 = ac.createOscillator();
  const g1 = ac.createGain();
  o1.type = "sawtooth";
  o1.frequency.setValueAtTime(100, ac.currentTime);
  o1.frequency.exponentialRampToValueAtTime(20, ac.currentTime + 0.5);
  g1.gain.setValueAtTime(0.8, ac.currentTime);
  g1.gain.linearRampToValueAtTime(0, ac.currentTime + 0.8);
  o1.connect(g1);
  g1.connect(ac.destination);
  o1.start();
  o1.stop(ac.currentTime + 0.8);
}

function playCorrect() {
  const ac = getAC();
  if (!ac) return;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(600, ac.currentTime);
  o.frequency.exponentialRampToValueAtTime(1200, ac.currentTime + 0.1);
  g.gain.setValueAtTime(0.2, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.01, ac.currentTime + 0.2);
  o.connect(g);
  g.connect(ac.destination);
  o.start();
  o.stop(ac.currentTime + 0.2);
}

function playWin() {
  const ac = getAC();
  if (!ac) return;
  [660, 880, 1050, 1320].forEach((freq, i) => {
    const start = ac.currentTime + i * 0.1;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(freq, start);
    g.gain.setValueAtTime(0.2, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
    o.connect(g);
    g.connect(ac.destination);
    o.start(start);
    o.stop(start + 0.35);
  });
}

(function initParticles() {
  const c = document.getElementById("bg-canvas") as HTMLCanvasElement | null;
  if (!c) return;
  const ctx = c.getContext("2d");
  if (!ctx) return;
  const canvas = c;
  const context = ctx;
  let w = 0;
  let h = 0;
  let rafId = 0;
  const pts: { x: number; y: number; r: number; vx: number; vy: number; a: number }[] = [];
  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.floor(w * ratio);
    canvas.height = Math.floor(h * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  resize();
  window.addEventListener("resize", () => {
    resize();
    start();
  });
  const count = prefersReducedMotion.matches ? 0 : 40;
  for (let i = 0; i < count; i++) {
    pts.push({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      r: Math.random() * 1.8 + 0.4,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.25,
      a: Math.random() * Math.PI * 2
    });
  }
  function shouldRun() { return particlesActive && !document.hidden && !prefersReducedMotion.matches; }
  function start() { if (!rafId && shouldRun()) rafId = requestAnimationFrame(draw); }
  function stop() { if (rafId) cancelAnimationFrame(rafId); rafId = 0; context.clearRect(0, 0, w, h); }
  function draw() {
    rafId = 0;
    if (!shouldRun()) { stop(); return; }
    context.clearRect(0, 0, w, h);
    pts.forEach((p) => {
      p.x = (p.x + p.vx + w) % w;
      p.y = (p.y + p.vy + h) % h;
      p.a += 0.012;
      const op = 0.3 + 0.28 * Math.sin(p.a);
      context.beginPath();
      context.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      context.fillStyle = `rgba(200,100,255,${op})`;
      context.fill();
    });
    rafId = requestAnimationFrame(draw);
  }
  (window as any).__setOrtoParticles = (active: boolean) => {
    particlesActive = active;
    if (active) start();
    else stop();
  };
  start();
})();

function setParticlesActive(active: boolean) {
  particlesActive = active;
  const controller = (window as any).__setOrtoParticles;
  if (typeof controller === "function") controller(active);
}

function initTiles() {
  const c = document.getElementById("setup-tiles-container");
  if (!c) return;
  c.innerHTML = "";
  [
    { l: "A", t: "8%", left: "3%", dur: "7.5s", del: "0s" },
    { l: "R", t: "30%", left: "3%", dur: "9s", del: "1s" },
    { l: "T", t: "60%", left: "4%", dur: "8s", del: "2s" },
    { l: "O", t: "10%", left: "87%", dur: "8.5s", del: "0.5s" },
    { l: "B", t: "40%", left: "90%", dur: "7s", del: "1.5s" },
    { l: "M", t: "70%", left: "86%", dur: "9.5s", del: "0.8s" }
  ].forEach(({ l, t, left, dur, del }) => {
    const d = document.createElement("div");
    d.className = "tile-letter";
    d.textContent = l;
    d.style.top = t;
    d.style.left = left;
    d.style.setProperty("--dur", dur);
    d.style.setProperty("--del", del);
    c.appendChild(d);
  });
}

function initFB(retries = 12) {
  try {
    if (typeof firebase === "undefined") {
      if (retries > 0) window.setTimeout(() => initFB(retries - 1), 200);
      return;
    }
    if (!firebase.apps?.length) firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.database();
  } catch { db = null; }
}

async function ensureDbReady(timeoutMs = 8000): Promise<boolean> {
  if (db) return true;
  initFB();
  const startedAt = now();
  while (!db && now() - startedAt < timeoutMs) {
    await delay(150);
    if (typeof firebase !== "undefined") initFB(0);
  }
  return Boolean(db);
}

function showScreen(id: "setup" | "lobby" | "game" | "admin") {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  el<HTMLDivElement>("scr-" + id).classList.add("active");
  el<HTMLDivElement>("emoji-menu").style.display = id === "game" ? "flex" : "none";
  if (id === "game") bindReactionButtons();
  setParticlesActive(id === "setup");
  if (AC && AC.state === "suspended") void AC.resume();
  if (id !== "game") stopTimer();
  if (id !== "game") stopBomberTick();
}

function getNickOrToast(): string | null {
  const input = el<HTMLInputElement>("nick-input");
  const nick = input.value.trim().slice(0, 15);
  if (!nick) {
    toast("Digite seu nick primeiro.", "#ff3535");
    input.focus();
    return null;
  }
  saveNick(nick);
  ME.nick = nick;
  ME.id = getPlayerId();
  return nick;
}

function makePlayer(nick: string, skinIndex?: number): Player {
  const stamp = now();
  return {
    id: ME.id,
    nick,
    skinIndex: skinIndex ?? Math.floor(Math.random() * PLAYER_EMOJIS.length),
    lives: 3,
    score: 0,
    online: true,
    joinedAt: stamp,
    seenAt: stamp,
    eliminatedAt: null
  };
}

function isFreshPlayer(p?: Player | null): p is Player {
  if (!p || !p.online) return false;
  const seen = Number(p.seenAt || 0);
  if (!seen) return now() - Number(p.joinedAt || 0) <= PLAYER_STALE_MS;
  return now() - seen <= PLAYER_STALE_MS;
}

function nextSkinIndex(players: Player[], preferred = players.length): number {
  const used = new Set(players.map((p) => ((p.skinIndex % PLAYER_EMOJIS.length) + PLAYER_EMOJIS.length) % PLAYER_EMOJIS.length));
  for (let i = 0; i < PLAYER_EMOJIS.length; i++) {
    const idx = (preferred + i) % PLAYER_EMOJIS.length;
    if (!used.has(idx)) return idx;
  }
  return preferred % PLAYER_EMOJIS.length;
}

function roomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 5; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

async function partidaRapida() {
  if (!getNickOrToast()) return;
  if (!(await ensureDbReady())) { startLocalDemo(); return; }
  const snap = await db.ref("rooms").orderByChild("quick").equalTo(true).once("value");
  const rooms = (snap.val() ?? {}) as Record<string, Room>;
  const open = Object.values(rooms).find((r) => {
    const players = Object.values(r.players ?? {}).filter(isFreshPlayer);
    const host = r.players?.[r.hostId];
    return r.status === "lobby" && players.length < MAX_PLAYERS && isFreshPlayer(host);
  });
  if (open) await joinRoom(open.code);
  else await criarSala(true);
}

async function criarSala(quick = false) {
  const nick = getNickOrToast();
  if (!nick) return;
  if (!(await ensureDbReady())) { startLocalDemo(); return; }
  const code = quick ? `RAP${roomCode().slice(0, 3)}` : roomCode();
  ME.salaId = code;
  ME.host = true;
  ME.skinIndex = Math.floor(Math.random() * PLAYER_EMOJIS.length);
  const player = makePlayer(nick, ME.skinIndex);
  const room: Room = {
    ...emptyRoom(code),
    quick,
    hostId: ME.id,
    players: { [ME.id]: player },
    updatedAt: now()
  };
  await db.ref(`rooms/${code}`).set(room);
  listenRoom(code);
  showScreen("lobby");
}

async function entrarSala() {
  const code = el<HTMLInputElement>("code-input").value.trim().toUpperCase();
  if (!code) { toast("Digite o codigo da sala.", "#ff3535"); return; }
  await joinRoom(code);
}

async function joinRoom(code: string) {
  const nick = getNickOrToast();
  if (!nick) return;
  if (!(await ensureDbReady())) { startLocalDemo(); return; }
  const ref = db.ref(`rooms/${code}`);
  const snap = await ref.once("value");
  const room = snap.val() as Room | null;
  if (!room) { toast("Sala nao encontrada.", "#ff3535"); return; }
  if (room.status !== "lobby") { toast("Essa sala ja esta em jogo.", "#ff3535"); return; }
  const players = Object.values(room.players ?? {}).filter(isFreshPlayer);
  const existingPlayer = room.players?.[ME.id];
  if (existingPlayer?.online) {
    ME.skinIndex = existingPlayer.skinIndex;
  } else {
    if (players.length >= MAX_PLAYERS) { toast("Sala cheia.", "#ff3535"); return; }
    ME.skinIndex = nextSkinIndex(players);
  }
  ME.salaId = code;
  ME.host = room.hostId === ME.id;
  await ref.child(`players/${ME.id}`).update({
    ...makePlayer(nick, ME.skinIndex),
    joinedAt: existingPlayer?.joinedAt ?? now()
  });
  await ref.child("updatedAt").set(now());
  listenRoom(code);
  showScreen("lobby");
}

function touchPresence() {
  if (!salaRef || !ME.id) return;
  void salaRef.child(`players/${ME.id}`).update({ online: true, seenAt: now() });
}

function startPresence() {
  if (presenceInterval) clearInterval(presenceInterval);
  touchPresence();
  presenceInterval = window.setInterval(touchPresence, 8_000);
}

function recoverLobbyHost(room: Room) {
  if (!salaRef || room.status !== "lobby") return;
  const players = sortedPlayers(room.players);
  if (!players.length) return;
  if (isFreshPlayer(room.players?.[room.hostId])) return;
  const nextHost = players.find((p) => p.id === ME.id || isFreshPlayer(p)) ?? players[0];
  if (!nextHost || nextHost.id === room.hostId) return;
  void salaRef.update({ hostId: nextHost.id, updatedAt: now() });
}

function listenRoom(code: string) {
  if (salaRef) salaRef.off();
  if (reactionRef) reactionRef.off();
  if (presenceInterval) clearInterval(presenceInterval);
  lastRoomSignature = "";
  salaRef = db.ref(`rooms/${code}`);
  salaRef.on("value", (snap: any) => {
    const room = snap.val() as Room | null;
    if (!room) {
      cleanupRoom(false);
      toast("A sala foi encerrada.", "#ff3535");
      showScreen("setup");
      return;
    }
    const nextRoom = normalizeRoom(room);
    recoverLobbyHost(nextRoom);
    const nextSignature = roomRenderSignature(nextRoom);
    if (lastRoomSignature === nextSignature) {
      GS = nextRoom;
      return;
    }
    lastRoomSignature = nextSignature;
    GS = nextRoom;
    ME.host = GS.hostId === ME.id;
    if (GS.status === "lobby") { renderLobby(); showScreen("lobby"); }
    else if (GS.status === "playing") { renderGame(); showScreen("game"); }
    else { renderGame(); renderWin(); }
  });
  salaRef.child(`players/${ME.id}`).onDisconnect().update({ online: false });
  startPresence();
  reactionRef = salaRef.child("reactions");
  reactionRef.limitToLast(1).on("child_added", (snap: any) => {
    const r = snap.val();
    if (!r || r.at < now() - 3000) return;
    if (r.localId && sentReactionIds.delete(r.localId)) return;
    showReaction(r.playerId, r.emoji);
  });
}

function normalizeRoom(room: Room): Room {
  return {
    ...emptyRoom(room.code),
    ...room,
    players: room.players ?? {},
    bomber: normalizeBomberState(room.bomber),
    usedQ: room.usedQ ?? [],
    eliminationOrder: room.eliminationOrder ?? []
  };
}

function normalizeBomberState(state?: BomberState | null): BomberState | null {
  if (!state) return null;
  return {
    width: state.width ?? BOMBER_WIDTH,
    height: state.height ?? BOMBER_HEIGHT,
    cells: Array.isArray(state.cells) ? state.cells : makeBomberCells(),
    players: state.players ?? {},
    bombs: Array.isArray(state.bombs) ? state.bombs : [],
    explosions: Array.isArray(state.explosions) ? state.explosions : [],
    powerups: Array.isArray(state.powerups) ? state.powerups : [],
    startedAt: state.startedAt ?? now(),
    updatedAt: state.updatedAt ?? now()
  };
}

function roomRenderSignature(room: Room): string {
  const players = sortedPlayers(room.players).map((p) => [
    p.id,
    p.nick,
    p.skinIndex,
    p.lives,
    p.score,
    p.online,
    p.eliminatedAt ?? null
  ]);
  return JSON.stringify([
    room.code,
    room.status,
    room.hostId,
    room.currentTurn,
    room.currentQIndex,
    room.turnStartedAt,
    room.roundCount,
    room.winnerId ?? null,
    room.bomber ?? null,
    players
  ]);
}

function renderLobby() {
  el<HTMLDivElement>("lobby-code-val").textContent = GS.code;
  const list = el<HTMLDivElement>("players-list");
  const players = sortedPlayers(GS.players);
  list.innerHTML = players.map((p) => `
    <div class="player-row">
      <div class="mini-avatar">${avatarHtml(p.skinIndex)}</div>
      <strong>${esc(p.nick)}</strong>
      ${p.id === GS.hostId ? `<span class="host-badge">HOST</span>` : ""}
    </div>
  `).join("");
  const start = el<HTMLButtonElement>("btn-start");
  if (ME.host) {
    start.disabled = players.length < 2;
    start.textContent = players.length < 2 ? "AGUARDANDO JOGADORES..." : "INICIAR PARTIDA";
  } else {
    start.disabled = true;
    start.textContent = "AGUARDANDO O HOST...";
  }
}

function sortedPlayers(players: Record<string, Player>): Player[] {
  return Object.values(players).filter(isFreshPlayer).sort((a, b) => a.joinedAt - b.joinedAt);
}

function alivePlayers(room: Room): Player[] {
  return sortedPlayers(room.players).filter((p) => p.lives > 0);
}

function chooseQuestion(used: number[]): { idx: number; q: Question; used: number[] } {
  const cleanUsed = used.filter((idx) => idx >= 0 && idx < Q.length);
  const available = Q.map((_, idx) => idx).filter((idx) => !cleanUsed.includes(idx));
  const pool = available.length ? available : Q.map((_, idx) => idx);
  const idx = pool[Math.floor(Math.random() * pool.length)];
  const nextUsed = available.length ? [...cleanUsed, idx] : [idx];
  return { idx, q: Q[idx], used: nextUsed };
}

function bomberIdx(x: number, y: number, width = BOMBER_WIDTH): number {
  return y * width + x;
}

function bomberCell(state: BomberState, x: number, y: number): BomberCell {
  if (x < 0 || y < 0 || x >= state.width || y >= state.height) return "wall";
  return state.cells[bomberIdx(x, y, state.width)] ?? "empty";
}

function isStartSafeZone(x: number, y: number): boolean {
  return BOMBER_STARTS.some((start) => Math.abs(start.x - x) + Math.abs(start.y - y) <= 1);
}

function makeBomberCells(): BomberCell[] {
  const cells: BomberCell[] = [];
  for (let y = 0; y < BOMBER_HEIGHT; y++) {
    for (let x = 0; x < BOMBER_WIDTH; x++) {
      const border = x === 0 || y === 0 || x === BOMBER_WIDTH - 1 || y === BOMBER_HEIGHT - 1;
      const pillar = x % 2 === 0 && y % 2 === 0;
      if (border || pillar) cells.push("wall");
      else if (isStartSafeZone(x, y)) cells.push("empty");
      else cells.push((x * 17 + y * 31) % 5 === 0 ? "empty" : "block");
    }
  }
  return cells;
}

function createBomberState(players: Player[]): BomberState {
  const bomberPlayers: Record<string, BomberPlayerState> = {};
  players.slice(0, MAX_PLAYERS).forEach((player, index) => {
    const start = BOMBER_STARTS[index] ?? BOMBER_STARTS[0];
    bomberPlayers[player.id] = { x: start.x, y: start.y, lives: 3, alive: true, bombLimit: 1, bombRange: 2, speedLevel: 0 };
  });
  return {
    width: BOMBER_WIDTH,
    height: BOMBER_HEIGHT,
    cells: makeBomberCells(),
    players: bomberPlayers,
    bombs: [],
    explosions: [],
    powerups: [],
    startedAt: now(),
    updatedAt: now()
  };
}

function bomberAliveIds(room: Room): string[] {
  const state = room.bomber;
  if (!state) return [];
  return sortedPlayers(room.players)
    .filter((p) => state.players[p.id]?.alive && p.lives > 0)
    .map((p) => p.id);
}

function bomberBombAt(state: BomberState, x: number, y: number): boolean {
  return state.bombs.some((bomb) => bomb.x === x && bomb.y === y);
}

function bomberPlayerAt(state: BomberState, x: number, y: number, exceptId = ""): boolean {
  return Object.entries(state.players).some(([id, player]) =>
    id !== exceptId && player.alive && player.x === x && player.y === y
  );
}

function canMoveTo(state: BomberState, x: number, y: number, playerId: string): boolean {
  return bomberCell(state, x, y) === "empty" &&
    !bomberBombAt(state, x, y) &&
    !bomberPlayerAt(state, x, y, playerId);
}

function powerupKindFor(x: number, y: number): BomberPowerupKind {
  const kinds: BomberPowerupKind[] = ["range", "bomb", "speed", "heart", "shield", "skull"];
  return kinds[Math.abs(x * 11 + y * 7) % kinds.length];
}

function maybeCreatePowerup(x: number, y: number): BomberPowerup | null {
  return (x * 19 + y * 23) % 4 === 0 ? { id: uid(), kind: powerupKindFor(x, y), x, y } : null;
}

function applyPowerupToPlayer(player: Player, bp: BomberPlayerState, powerup: BomberPowerup): Player {
  if (powerup.kind === "range") {
    bp.bombRange = Math.min(5, Number(bp.bombRange || 2) + 1);
    return { ...player, score: player.score + 15 };
  }
  if (powerup.kind === "bomb") {
    bp.bombLimit = Math.min(3, Number(bp.bombLimit || 1) + 1);
    return { ...player, score: player.score + 10 };
  }
  if (powerup.kind === "heart") {
    bp.lives = Math.min(4, bp.lives + 1);
    return { ...player, lives: bp.lives, score: player.score + 20 };
  }
  if (powerup.kind === "shield") {
    bp.shieldUntil = now() + 9000;
    return { ...player, score: player.score + 12 };
  }
  if (powerup.kind === "skull") {
    bp.skullUntil = now() + 7000;
    return { ...player, score: Math.max(0, player.score - 8) };
  }
  bp.speedLevel = Math.min(2, Number(bp.speedLevel || 0) + 1);
  return { ...player, score: player.score + 10 };
}

function bomberStepMsFor(player?: BomberPlayerState): number {
  const skullPenalty = Number(player?.skullUntil || 0) > now() ? 55 : 0;
  return Math.max(95, BOMBER_STEP_MS - Number(player?.speedLevel || 0) * 22 + skullPenalty);
}

function explosionCellsFor(state: BomberState, bomb: BomberBomb): ArenaSlotPoint[] {
  const cells: ArenaSlotPoint[] = [{ x: bomb.x, y: bomb.y }];
  const dirs = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 }
  ];
  dirs.forEach((dir) => {
    for (let step = 1; step <= bomb.range; step++) {
      const x = bomb.x + dir.x * step;
      const y = bomb.y + dir.y * step;
      const cell = bomberCell(state, x, y);
      if (cell === "wall") break;
      cells.push({ x, y });
      if (cell === "block") break;
    }
  });
  return cells;
}

function applyBomberDamage(playersIn: Record<string, Player>, state: BomberState, cells: ArenaSlotPoint[]): Record<string, Player> {
  const players = { ...playersIn };
  const stamp = now();
  Object.entries(state.players).forEach(([id, bp]) => {
    if (!bp.alive) return;
    if (stamp - Number(bp.lastHitAt || 0) < BOMBER_HIT_COOLDOWN_MS) return;
    const hit = cells.some((cell) => cell.x === bp.x && cell.y === bp.y);
    if (!hit) return;
    if (Number(bp.shieldUntil || 0) > stamp) {
      bp.shieldUntil = 0;
      bp.lastHitAt = stamp;
      playShieldSound();
      return;
    }
    bp.lives = Math.max(0, bp.lives - 1);
    bp.lastHitAt = stamp;
    playDamageSound();
    const player = players[id];
    if (player) {
      players[id] = { ...player, lives: bp.lives };
      if (bp.lives <= 0) {
        bp.alive = false;
        bp.lastHitAt = stamp;
        players[id].eliminatedAt = stamp;
        playDeathSound();
      }
    }
  });
  return players;
}

function settleBomberRoom(room: Room, nextState: BomberState, players: Record<string, Player>): Room {
  const aliveIds = Object.entries(nextState.players)
    .filter(([, p]) => p.alive && p.lives > 0)
    .map(([id]) => id)
    .filter((id) => isFreshPlayer(players[id]));
  if (aliveIds.length <= 1) {
    return {
      ...room,
      players,
      bomber: nextState,
      status: "finished",
      winnerId: aliveIds[0] ?? null,
      updatedAt: now()
    };
  }
  return { ...room, players, bomber: nextState, updatedAt: now() };
}

function tickBomberRoom(room: Room): Room | null {
  const state = room.bomber;
  if (!state || room.status !== "playing") return null;
  const stamp = now();
  const exploding: BomberBomb[] = state.bombs.filter((bomb) => bomb.explodeAt <= stamp);
  const explodingIds = new Set(exploding.map((bomb) => bomb.id));
  const hasExpiredExplosions = state.explosions.some((explosion) => explosion.expiresAt <= stamp);
  if (!exploding.length && !hasExpiredExplosions) return null;
  let nextState: BomberState = {
    ...state,
    cells: [...state.cells],
    bombs: state.bombs.filter((bomb) => !explodingIds.has(bomb.id)),
    explosions: state.explosions.filter((explosion) => explosion.expiresAt > stamp),
    powerups: [...state.powerups],
    players: Object.fromEntries(Object.entries(state.players).map(([id, p]) => [id, { ...p }]))
  };
  let players = { ...room.players };
  for (let i = 0; i < exploding.length; i++) {
    const bomb = exploding[i];
    const cells = explosionCellsFor(nextState, bomb);
    cells.forEach((cell) => {
      const idx = bomberIdx(cell.x, cell.y, nextState.width);
      if (nextState.cells[idx] === "block") {
        nextState.cells[idx] = "empty";
        if (players[bomb.ownerId]) {
          players[bomb.ownerId] = { ...players[bomb.ownerId], score: players[bomb.ownerId].score + 5 };
        }
        const powerup = maybeCreatePowerup(cell.x, cell.y);
        if (powerup) nextState.powerups.push(powerup);
      }
      const chainedBombs = nextState.bombs.filter((candidate) => candidate.x === cell.x && candidate.y === cell.y);
      chainedBombs.forEach((candidate) => {
        if (explodingIds.has(candidate.id)) return;
        explodingIds.add(candidate.id);
        exploding.push(candidate);
        nextState.bombs = nextState.bombs.filter((item) => item.id !== candidate.id);
      });
    });
    nextState.explosions.push({
      id: uid(),
      cells,
      createdAt: stamp,
      expiresAt: stamp + BOMBER_EXPLOSION_MS
    });
    players = applyBomberDamage(players, nextState, cells);
    playBoom();
    triggerScreenImpact("boom");
  }
  nextState.updatedAt = stamp;
  return settleBomberRoom(room, nextState, players);
}

async function updateBomber(mutator: (room: Room) => Room | null) {
  if (localMode && localRoom) {
    const nextRoom = mutator(normalizeRoom(localRoom));
    if (!nextRoom) return;
    localRoom = nextRoom;
    GS = nextRoom;
    afterRoomMutation();
    return;
  }
  if (!salaRef) return;
  const snap = await salaRef.once("value");
  const room = normalizeRoom(snap.val());
  const nextRoom = mutator(room);
  if (!nextRoom) return;
  await salaRef.update({
    players: nextRoom.players,
    bomber: nextRoom.bomber,
    status: nextRoom.status,
    winnerId: nextRoom.winnerId ?? null,
    updatedAt: nextRoom.updatedAt ?? now()
  });
}

function playBlip(freq = 420, duration = 0.08, gain = 0.12, type: OscillatorType = "sine") {
  const ac = getAC();
  if (!ac) return;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, ac.currentTime);
  g.gain.setValueAtTime(gain, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
  o.connect(g);
  g.connect(ac.destination);
  o.start();
  o.stop(ac.currentTime + duration);
}

function playStepSound() {
  playBlip(180, 0.045, 0.045, "triangle");
}

function playPlantSound() {
  playBlip(260, 0.08, 0.12, "square");
  window.setTimeout(() => playBlip(180, 0.08, 0.09, "sine"), 48);
}

function playPickupSound(kind: BomberPowerupKind) {
  const base = kind === "skull" ? 160 : kind === "heart" ? 620 : 520;
  playBlip(base, 0.08, 0.12, kind === "skull" ? "sawtooth" : "triangle");
  window.setTimeout(() => playBlip(kind === "skull" ? 90 : base + 180, 0.12, 0.10, "sine"), 70);
}

function playDamageSound() {
  playBlip(130, 0.16, 0.18, "sawtooth");
}

function playShieldSound() {
  playBlip(720, 0.08, 0.11, "triangle");
  window.setTimeout(() => playBlip(980, 0.12, 0.08, "sine"), 60);
}

function playDeathSound() {
  const ac = getAC();
  if (!ac) return;
  [260, 190, 120].forEach((freq, i) => {
    window.setTimeout(() => playBlip(freq, 0.16, 0.14, "sawtooth"), i * 90);
  });
}

function moveBomberPlayer(dx: number, dy: number) {
  if (GS.status !== "playing" || !GS.bomber || !ME.id) return;
  if (bomberMovePending || now() < bomberStepLockedUntil) return;
  bomberMovePending = true;
  let moved = false;
  void updateBomber((room) => {
    const state = room.bomber;
    const bp = state?.players[ME.id];
    if (!state || !bp?.alive) return null;
    const nx = bp.x + dx;
    const ny = bp.y + dy;
    if (!canMoveTo(state, nx, ny, ME.id)) return null;
    moved = true;
    const powerup = state.powerups.find((item) => item.x === nx && item.y === ny);
    const player = room.players[ME.id];
    const nextBp = { ...bp, x: nx, y: ny };
    if (powerup) playPickupSound(powerup.kind);
    const players = powerup && player
      ? { ...room.players, [ME.id]: applyPowerupToPlayer(player, nextBp, powerup) }
      : room.players;
    const nextState: BomberState = {
      ...state,
      players: { ...state.players, [ME.id]: nextBp },
      powerups: powerup ? state.powerups.filter((item) => item.id !== powerup.id) : state.powerups,
      updatedAt: now()
    };
    return { ...room, players, bomber: nextState, updatedAt: now() };
  }).finally(() => {
    if (!moved) {
      bomberMovePending = false;
      return;
    }
    playStepSound();
    const stepMs = bomberStepMsFor(GS.bomber?.players[ME.id]);
    bomberStepLockedUntil = now() + stepMs;
    window.setTimeout(() => {
      bomberMovePending = false;
      bomberStepLockedUntil = 0;
    }, stepMs);
  });
}

function placeBomberBomb() {
  if (GS.status !== "playing" || !GS.bomber || !ME.id) return;
  void updateBomber((room) => {
    const state = room.bomber;
    const bp = state?.players[ME.id];
    if (!state || !bp?.alive) return null;
    if (state.bombs.filter((bomb) => bomb.ownerId === ME.id).length >= Number(bp.bombLimit || 1)) return null;
    if (bomberBombAt(state, bp.x, bp.y)) return null;
    playPlantSound();
    const stamp = now();
    const bomb: BomberBomb = {
      id: uid(),
      ownerId: ME.id,
      x: bp.x,
      y: bp.y,
      placedAt: stamp,
      explodeAt: stamp + BOMBER_BOMB_MS,
      range: Number(bp.bombRange || 2)
    };
    return {
      ...room,
      bomber: { ...state, bombs: [...state.bombs, bomb], updatedAt: stamp },
      updatedAt: stamp
    };
  });
}

function startBomberTick() {
  if (bomberTickInterval || GS.status !== "playing") return;
  bomberTickInterval = window.setInterval(() => {
    if (GS.status !== "playing" || !GS.bomber) {
      stopBomberTick();
      return;
    }
    const clock = document.getElementById("bomber-clock-val");
    if (clock) clock.textContent = formatGameTime(GS.bomber.startedAt);
    if (ME.host || localMode) {
      void updateBomber((room) => tickBomberRoom(room));
    }
  }, 220);
}

function stopBomberTick() {
  if (!bomberTickInterval) return;
  clearInterval(bomberTickInterval);
  bomberTickInterval = null;
}

function bindBomberEvents() {
  if (bomberEventsBound) return;
  bomberEventsBound = true;
  window.addEventListener("keydown", (ev) => {
    if (GS.status !== "playing") return;
    const key = ev.key.toLowerCase();
    if (["arrowup", "w"].includes(key)) { ev.preventDefault(); moveBomberPlayer(0, -1); }
    else if (["arrowdown", "s"].includes(key)) { ev.preventDefault(); moveBomberPlayer(0, 1); }
    else if (["arrowleft", "a"].includes(key)) { ev.preventDefault(); moveBomberPlayer(-1, 0); }
    else if (["arrowright", "d"].includes(key)) { ev.preventDefault(); moveBomberPlayer(1, 0); }
    else if (key === " " || key === "enter") { ev.preventDefault(); placeBomberBomb(); }
  });
  document.addEventListener("pointerdown", (ev) => {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    const btn = target.closest<HTMLElement>("[data-bomber-action]");
    if (!btn) return;
    ev.preventDefault();
    const action = btn.dataset.bomberAction;
    if (action === "up") moveBomberPlayer(0, -1);
    else if (action === "down") moveBomberPlayer(0, 1);
    else if (action === "left") moveBomberPlayer(-1, 0);
    else if (action === "right") moveBomberPlayer(1, 0);
    else if (action === "bomb") placeBomberBomb();
  }, true);
}

async function startGame() {
  if (localMode && localRoom) {
    localRoom = startRoomState(localRoom);
    GS = localRoom;
    renderGame();
    showScreen("game");
    return;
  }
  if (!ME.host || !salaRef) return;
  const snap = await salaRef.once("value");
  const room = normalizeRoom(snap.val());
  if (alivePlayers(room).length < 2) { toast("Precisa de pelo menos 2 jogadores.", "#ff3535"); return; }
  await salaRef.update(startRoomState(room));
}

function startRoomState(room: Room): Room {
  const players: Record<string, Player> = {};
  sortedPlayers(room.players).forEach((p) => {
    players[p.id] = { ...p, lives: 3, score: 0, eliminatedAt: null, online: true };
  });
  const activePlayers = sortedPlayers(players).slice(0, MAX_PLAYERS);
  return {
    ...room,
    status: "playing",
    players,
    bomber: createBomberState(activePlayers),
    currentTurn: null,
    currentQIndex: null,
    currentQ: null,
    usedQ: [],
    turnStartedAt: now(),
    roundCount: 1,
    eliminationOrder: [],
    winnerId: null,
    updatedAt: now()
  };
}

function bombScale(): number {
  return window.innerWidth < 600 ? 0.42 : 0.52;
}

function bombTransform(point: BombPoint, scale = bombScale()): string {
  return `translate(calc(-50% + ${point.x.toFixed(1)}px), calc(-50% + ${point.y.toFixed(1)}px)) scale(${scale.toFixed(2)})`;
}

type ArenaSlotPoint = {
  x: number;
  y: number;
};

const ARENA_ASSET_WIDTH = 1152;
const ARENA_ASSET_HEIGHT = 928;

type PlayerLayerSlot = {
  asset: string;
  x: number;
  y: number;
  width: number;
  height: number;
  bomb: ArenaSlotPoint;
};

const PLAYER_LAYER_SLOTS: PlayerLayerSlot[] = [
  { asset: "/arena/players/player-1.png", x: 238, y: 197, width: 160, height: 218, bomb: { x: 0.18, y: 0.19 } },
  { asset: "/arena/players/player-2.png", x: 905, y: 199, width: 198, height: 226, bomb: { x: 0.79, y: 0.19 } },
  { asset: "/arena/players/player-3.png", x: 247, y: 632, width: 202, height: 232, bomb: { x: 0.20, y: 0.64 } },
  { asset: "/arena/players/player-4.png", x: 917, y: 626, width: 202, height: 232, bomb: { x: 0.80, y: 0.63 } }
];

function arenaStageSize(isMobile: boolean): { width: number; height: number } {
  const vw = Math.max(320, window.innerWidth || 320);
  const vh = Math.max(520, window.innerHeight || 720);
  const reservedHeight = isMobile ? 350 : 250;
  const maxWidthByHeight = Math.max(isMobile ? 320 : 720, (vh - reservedHeight) * 1.25);
  const maxWidthByViewport = vw * (isMobile ? 0.98 : 0.92);
  const maxWidth = isMobile ? 460 : 1180;
  const minWidth = isMobile ? Math.min(vw * 0.94, 380) : Math.min(vw * 0.76, 820);
  const width = Math.round(Math.max(minWidth, Math.min(maxWidth, maxWidthByViewport, maxWidthByHeight)));
  return { width, height: Math.round(width * ARENA_ASSET_HEIGHT / ARENA_ASSET_WIDTH) };
}

function pointToBomb(stage: { width: number; height: number }, point: ArenaSlotPoint): BombPoint {
  return {
    x: (point.x - 0.5) * stage.width,
    y: (point.y - 0.5) * stage.height
  };
}

function playerVisualState(
  player: Player,
  isTurn: boolean,
  isThrowingFrom: boolean,
  isCatchingTo: boolean,
  lostLife: boolean
): PlayerVisualState {
  if (GS.status === "finished" && GS.winnerId === player.id) return "victory";
  if (player.lives <= 0) return "defeat";
  if (lostLife) return "hit";
  if (isThrowingFrom) return "throwingBomb";
  if (isCatchingTo) return "catchingBomb";
  if (isTurn) return "holdingBomb";
  return "idle";
}

function renderLives(lives: number): string {
  return [0, 1, 2].map((idx) => (
    `<span class="life-heart ${idx < lives ? "filled" : "empty"}" aria-hidden="true">&hearts;</span>`
  )).join("");
}

function triggerScreenImpact(kind: "boom" | "hit" = "hit") {
  const game = document.getElementById("scr-game");
  if (!game || prefersReducedMotion.matches) return;
  game.classList.remove("screen-impact", "screen-impact-boom");
  void game.offsetWidth;
  game.classList.add(kind === "boom" ? "screen-impact-boom" : "screen-impact");
  window.setTimeout(() => game.classList.remove("screen-impact", "screen-impact-boom"), kind === "boom" ? 620 : 360);
}

function spawnExplosionFx() {
  const circle = document.getElementById("players-circle");
  const bomb = document.getElementById("bomb-el");
  if (!circle || !bomb || prefersReducedMotion.matches) return;
  const circleRect = circle.getBoundingClientRect();
  const bombRect = bomb.getBoundingClientRect();
  const x = bombRect.left + bombRect.width / 2 - circleRect.left;
  const y = bombRect.top + bombRect.height / 2 - circleRect.top;
  const burst = document.createElement("div");
  burst.className = "explosion-burst";
  burst.style.left = `${x.toFixed(1)}px`;
  burst.style.top = `${y.toFixed(1)}px`;
  for (let i = 0; i < 16; i++) {
    const spark = document.createElement("span");
    const angle = (Math.PI * 2 * i) / 16;
    const distance = 28 + (i % 4) * 12;
    spark.style.setProperty("--ex", `${(Math.cos(angle) * distance).toFixed(1)}px`);
    spark.style.setProperty("--ey", `${(Math.sin(angle) * distance).toFixed(1)}px`);
    spark.style.setProperty("--ed", `${(i % 5) * 0.025}s`);
    burst.appendChild(spark);
  }
  circle.appendChild(burst);
  window.setTimeout(() => burst.remove(), 900);
}

function animateBombPass(bomb: HTMLElement, from: BombPoint, to: BombPoint) {
  const targetTransform = bombTransform(to);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);

  if (distance < 4) {
    bomb.classList.remove("bomb-throwing", "pass-pop");
    bomb.style.transition = "";
    bomb.style.transform = targetTransform;
    return;
  }

  const passMs = prefersReducedMotion.matches ? Math.round(BOMB_PASS_MS * 0.72) : BOMB_PASS_MS;
  const arcMultiplier = prefersReducedMotion.matches ? 0.14 : 0.28;
  const arcCap = prefersReducedMotion.matches ? 64 : 112;
  bomb.style.setProperty("--throw-distance", `${distance.toFixed(1)}px`);
  bomb.style.setProperty("--throw-angle", `${(Math.atan2(dy, dx) * 180 / Math.PI).toFixed(1)}deg`);
  bomb.style.setProperty("--throw-arc", `${Math.min(92, Math.max(36, distance * 0.24)).toFixed(1)}px`);
  bomb.style.setProperty("--throw-time", `${passMs}ms`);

  activeBombPass?.cancel();
  activeBombPass = null;
  bomb.classList.remove("bomb-throwing", "pass-pop");
  bomb.style.transition = "none";
  bomb.style.transform = bombTransform(from);
  void bomb.offsetWidth;

  const arc = Math.min(arcCap, Math.max(32, distance * arcMultiplier));
  const recoil = { x: from.x - dx * 0.08, y: from.y - dy * 0.08 - arc * 0.1 };
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - arc };
  const settle = { x: to.x + dx * 0.035, y: to.y + dy * 0.035 + arc * 0.05 };

  bomb.classList.add("bomb-throwing", "pass-pop");
  if (typeof bomb.animate !== "function") {
    window.requestAnimationFrame(() => {
      bomb.style.transition = `transform ${passMs}ms cubic-bezier(.16,.92,.18,1)`;
      bomb.style.transform = targetTransform;
    });
    window.setTimeout(() => {
      bomb.classList.remove("bomb-throwing", "pass-pop");
      bomb.style.transition = "";
      bomb.style.transform = targetTransform;
    }, passMs + 90);
    return;
  }

  const passAnimation = bomb.animate(
    [
      { transform: bombTransform(from), offset: 0, easing: "cubic-bezier(.3,0,.55,1)" },
      { transform: bombTransform(recoil), offset: 0.14, easing: "cubic-bezier(.1,.8,.2,1)" },
      { transform: bombTransform(mid), offset: 0.52, easing: "cubic-bezier(.18,.9,.18,1)" },
      { transform: bombTransform(settle), offset: 0.86, easing: "cubic-bezier(.14,.9,.22,1)" },
      { transform: targetTransform, offset: 1 }
    ],
    { duration: passMs, easing: "linear", fill: "both" }
  );
  activeBombPass = passAnimation;

  const finishPass = () => {
    if (activeBombPass !== passAnimation) return;
    bomb.classList.remove("bomb-throwing", "pass-pop");
    bomb.style.transition = "";
    bomb.style.transform = targetTransform;
    if (activeBombPass === passAnimation) passAnimation.cancel();
    activeBombPass = null;
  };

  passAnimation.onfinish = finishPass;
  window.setTimeout(finishPass, passMs + 90);
}

function setBombFuseProgress(ratio: number) {
  const bomb = document.getElementById("bomb-el");
  if (!bomb) return;
  const visibleRatio = Math.max(0, Math.min(1, ratio));
  const burned = 1 - visibleRatio;
  bomb.style.setProperty("--fuse-visible", `${Math.max(4, 48 * visibleRatio).toFixed(1)}px`);
  bomb.style.setProperty("--spark-x", `${(-18 * burned).toFixed(1)}px`);
  bomb.style.setProperty("--spark-y", `${(13 * burned).toFixed(1)}px`);
  bomb.style.setProperty("--spark-scale", `${(1 + burned * 0.42).toFixed(2)}`);
}

function formatGameTime(startedAt: number): string {
  const elapsed = Math.max(0, Math.floor((now() - startedAt) / 1000));
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function powerupLabel(kind: BomberPowerupKind): string {
  if (kind === "range") return "+";
  if (kind === "bomb") return "B";
  if (kind === "heart") return "H";
  if (kind === "shield") return "O";
  if (kind === "skull") return "!";
  return "S";
}

function activePowerupBadges(bp?: BomberPlayerState): string {
  if (!bp) return "";
  const badges = [
    Number(bp.bombLimit || 1) > 1 ? `B${bp.bombLimit}` : "",
    Number(bp.bombRange || 2) > 2 ? `F${bp.bombRange}` : "",
    Number(bp.speedLevel || 0) > 0 ? `S${bp.speedLevel}` : "",
    Number(bp.shieldUntil || 0) > now() ? "ESC" : "",
    Number(bp.skullUntil || 0) > now() ? "!" : ""
  ].filter(Boolean);
  return badges.map((badge) => `<span>${badge}</span>`).join("");
}

function explosionClassFor(cells: Set<string>, x: number, y: number): string {
  if (!cells.has(`${x},${y}`)) return "";
  const left = cells.has(`${x - 1},${y}`);
  const right = cells.has(`${x + 1},${y}`);
  const up = cells.has(`${x},${y - 1}`);
  const down = cells.has(`${x},${y + 1}`);
  const horizontal = left || right;
  const vertical = up || down;
  if (horizontal && vertical) return "explosion-center";
  if (horizontal) {
    if (!left) return "explosion-end-left";
    if (!right) return "explosion-end-right";
    return "explosion-horizontal";
  }
  if (vertical) {
    if (!up) return "explosion-end-up";
    if (!down) return "explosion-end-down";
    return "explosion-vertical";
  }
  return "explosion-center";
}

function renderGame() {
  const state = GS.bomber;
  const board = el<HTMLDivElement>("players-circle");
  const hud = el<HTMLDivElement>("q-card");
  if (!state) {
    board.innerHTML = "";
    hud.style.display = "none";
    return;
  }

  bindBomberEvents();
  startBomberTick();
  stopTimer();
  el<HTMLSpanElement>("round-val").textContent = String(Math.max(1, Math.floor((now() - state.startedAt) / 60_000) + 1));
  el<HTMLDivElement>("scr-game").classList.add("bomber-mode");

  const players = sortedPlayers(GS.players).slice(0, MAX_PLAYERS);
  const explosionCells = new Set<string>();
  state.explosions.forEach((explosion) => {
    explosion.cells.forEach((cell) => explosionCells.add(`${cell.x},${cell.y}`));
  });

  const playerByCell = new Map<string, Player>();
  players.forEach((player) => {
    const bp = state.players[player.id];
    if (bp?.alive) playerByCell.set(`${bp.x},${bp.y}`, player);
  });
  const bombsByCell = new Map<string, BomberBomb>();
  state.bombs.forEach((bomb) => bombsByCell.set(`${bomb.x},${bomb.y}`, bomb));
  const powerupsByCell = new Map<string, BomberPowerup>();
  state.powerups.forEach((powerup) => powerupsByCell.set(`${powerup.x},${powerup.y}`, powerup));

  const cellsHtml = state.cells.map((cell, idx) => {
    const x = idx % state.width;
    const y = Math.floor(idx / state.width);
    const key = `${x},${y}`;
    const player = playerByCell.get(key);
    const bomb = bombsByCell.get(key);
    const powerup = powerupsByCell.get(key);
    const bp = player ? state.players[player.id] : null;
    const slotIndex = player ? players.findIndex((p) => p.id === player.id) : -1;
    const previousPosition = player ? previousBomberPositions.get(player.id) : undefined;
    const stepDx = previousPosition && player ? previousPosition.x - x : 0;
    const stepDy = previousPosition && player ? previousPosition.y - y : 0;
    const isStepMove = Boolean(player && previousPosition && Math.abs(stepDx) + Math.abs(stepDy) === 1);
    const explosionClass = explosionClassFor(explosionCells, x, y);
    const playerHit = Boolean(bp?.lastHitAt && now() - bp.lastHitAt < 520);
    const playerStateClass = player
      ? GS.status === "finished" && GS.winnerId === player.id
        ? "state-victory"
        : bp?.alive
          ? playerHit ? "state-hit" : "state-idle"
          : "state-defeat"
      : "";
    const statusClass = [
      bp && Number(bp.shieldUntil || 0) > now() ? "has-shield" : "",
      bp && Number(bp.skullUntil || 0) > now() ? "has-skull" : ""
    ].filter(Boolean).join(" ");
    const className = [
      "bomber-cell",
      `cell-${cell}`,
      (x + y) % 2 === 0 ? "tile-a" : "tile-b",
      explosionClass ? `cell-explosion ${explosionClass}` : "",
      player ? "has-player" : "",
      player?.id === ME.id ? "is-me" : ""
    ].filter(Boolean).join(" ");
    return `
      <div class="${className}" data-x="${x}" data-y="${y}">
        ${cell === "block" ? '<span class="bomber-crate"></span>' : ""}
        ${bomb ? '<span class="bomber-bomb" aria-label="Bomba"></span>' : ""}
        ${powerup && cell === "empty" ? `<span class="bomber-powerup powerup-${powerup.kind}" aria-label="Power-up ${powerup.kind}">${powerupLabel(powerup.kind)}</span>` : ""}
        ${player ? `
          <span class="bomber-player p-slot ${bp?.alive ? "" : "eliminated"} ${playerStateClass} ${statusClass} ${isStepMove ? "step-moving" : ""}" data-player-id="${esc(player.id)}" style="--slot-color:${SLOT_COLORS[Math.max(0, slotIndex) % SLOT_COLORS.length]};--step-from-x:${stepDx};--step-from-y:${stepDy};--step-ms:${bomberStepMsFor(bp)}ms">
            ${playerArtHtml(player.skinIndex, "bomber-character-art")}
          </span>
        ` : ""}
      </div>
    `;
  }).join("");

  players.forEach((player) => {
    const bp = state.players[player.id];
    if (bp?.alive) previousBomberPositions.set(player.id, { x: bp.x, y: bp.y });
    else previousBomberPositions.delete(player.id);
  });

  board.style.setProperty("--bomber-cols", String(state.width));
  board.style.setProperty("--bomber-rows", String(state.height));
  board.innerHTML = `
    <div class="bomber-board" role="grid" aria-label="Arena Bomberman">
      ${cellsHtml}
    </div>
  `;

  const myBomber = state.players[ME.id];
  const aliveCount = bomberAliveIds(GS).length;
  const scoreboard = players.map((player, index) => {
    const bp = state.players[player.id];
    const lives = bp?.lives ?? player.lives;
    return `
      <div class="bomber-score ${player.id === ME.id ? "me" : ""} ${bp?.alive ? "" : "out"}" style="--slot-color:${SLOT_COLORS[index % SLOT_COLORS.length]}">
        <span class="bomber-score-art">${playerArtHtml(player.skinIndex, "bomber-score-character")}</span>
        <span class="bomber-score-main">
          <strong>${esc(player.nick)}</strong>
          <em>${renderLives(lives)}</em>
          <small>${activePowerupBadges(bp)}</small>
        </span>
        <span class="bomber-score-points">${player.score}</span>
      </div>
    `;
  }).join("");

  hud.style.display = "block";
  hud.className = "q-container bomber-hud";
  hud.innerHTML = `
    <div class="bomber-hud-top">
      <div class="bomber-match-clock">
        <span class="lbl-small">Tempo</span>
        <strong id="bomber-clock-val">${formatGameTime(state.startedAt)}</strong>
      </div>
      <div class="bomber-alive-count">
        <span class="lbl-small">Jogadores vivos</span>
        <strong>${aliveCount}</strong>
      </div>
      <button class="btn btn-gold bomber-bomb-action" data-bomber-action="bomb" ${myBomber?.alive ? "" : "disabled"}>BOMBA</button>
    </div>
    <div class="bomber-scoreboard">${scoreboard}</div>
    <div class="bomber-controls" aria-label="Controles">
      <button data-bomber-action="up">^</button>
      <button data-bomber-action="left">&lt;</button>
      <button data-bomber-action="down">v</button>
      <button data-bomber-action="right">&gt;</button>
    </div>
  `;
}

function renderQuestion() {
  const q = GS.currentQ;
  if (!q) return;
  const card = el<HTMLDivElement>("q-card");
  card.style.display = "block";
  el<HTMLDivElement>("q-cat").textContent = q.cat.toUpperCase();
  
  const wordDisplay = q.word.replace(/__/g, ' <span class="q-blank-pro">__</span> ').replace(/_/g, ' <span class="q-blank-pro">_</span> ');
  el<HTMLDivElement>("q-word").innerHTML = wordDisplay;

  const ops = el<HTMLDivElement>("opcoes");
  ops.innerHTML = "";
  q.options.forEach((o) => {
    const btn = document.createElement("button");
    btn.className = "op-btn";
    btn.textContent = o;
    btn.onclick = () => void submitAnswer(o);
    ops.appendChild(btn);
  });
  
  startTimer();
}

function startTimer() {
  stopTimer();
  setBombFuseProgress(1);
  updateTimer();
  bombTimerInterval = setInterval(updateTimer, 100);
}

function stopTimer() {
  if (bombTimerInterval) clearInterval(bombTimerInterval);
  bombTimerInterval = null;
  lastTickSecond = null;
  const bomb = document.getElementById("bomb-el");
  bomb?.classList.remove("warning", "danger");
  setBombFuseProgress(1);
  document.getElementById("bomb-timer")?.classList.remove("danger");
  document.getElementById("arena-time-val")?.classList.remove("danger");
  document.querySelectorAll(".arena-player-marker").forEach((av) => av.classList.remove("panic"));
}

function updateTimer() {
  if (GS.status !== "playing") { stopTimer(); return; }
  
  const baseDuration = Math.max(3, TURN_DURATION + 0.5 - ((GS.roundCount || 1) * 0.5));
  const elapsed = (now() - GS.turnStartedAt) / 1000;
  const remaining = Math.max(0, Math.ceil(baseDuration - elapsed));
  const fuseRatio = Math.max(0, Math.min(1, (baseDuration - elapsed) / baseDuration));
  
  const timer = el<HTMLDivElement>("bomb-timer");
  timer.textContent = String(remaining).padStart(2, "0");
  el<HTMLDivElement>("arena-time-val").textContent = String(remaining).padStart(2, "0");
  const isDanger = remaining <= 3 && remaining > 0;
  const isWarning = remaining <= 5 && remaining > 3;
  timer.classList.toggle("danger", isDanger);
  el<HTMLDivElement>("arena-time-val").classList.toggle("danger", isDanger);
  const bomb = el<HTMLDivElement>("bomb-el");
  bomb.classList.toggle("danger", isDanger);
  bomb.classList.toggle("warning", isWarning);
  setBombFuseProgress(fuseRatio);
  
  if (remaining <= 3 && remaining > 0) {
    document.querySelectorAll(".arena-player-marker").forEach(av => av.classList.add("panic"));
  } else {
    document.querySelectorAll(".arena-player-marker").forEach(av => av.classList.remove("panic"));
  }

  if (remaining <= 5 && remaining > 0 && Math.floor(elapsed * 10) % 10 === 0) {
    playTick(remaining <= 3);
  }

  if (remaining <= 0 && (ME.host || localMode)) {
    stopTimer();
    void handleTimeout();
  }
}

async function handleTimeout() {
  playBoom();
  triggerScreenImpact("boom");
  spawnExplosionFx();
  if (localMode && localRoom) {
    const nextState = applyAnswerToRoom(localRoom, GS.currentTurn ?? "", false);
    localRoom = { ...localRoom, ...nextState };
    GS = localRoom;
    afterRoomMutation();
  } else if (salaRef) {
    const snap = await salaRef.once("value");
    const room = normalizeRoom(snap.val());
    await salaRef.update(applyAnswerToRoom(room, room.currentTurn ?? "", false));
  }
}

async function submitAnswer(ans: string) {
  const isCorrect = ans.toLowerCase() === GS.currentQ?.answer.toLowerCase();
  if (isCorrect) playCorrect();
  else {
    playBoom();
    triggerScreenImpact("hit");
    spawnExplosionFx();
  }

  if (localMode && localRoom) {
    const nextState = applyAnswerToRoom(localRoom, ME.id, isCorrect);
    localRoom = { ...localRoom, ...nextState };
    GS = localRoom;
    afterRoomMutation();
  } else if (salaRef) {
    const snap = await salaRef.once("value");
    const room = normalizeRoom(snap.val());
    await salaRef.update(applyAnswerToRoom(room, ME.id, isCorrect));
  }
}

function applyAnswerToRoom(room: Room, playerId: string, correct: boolean): Room {
  const players = { ...room.players };
  const player = players[playerId];
  if (!player) return room;

  if (!correct) {
    player.lives -= 1;
    if (player.lives <= 0) {
      player.eliminatedAt = now();
      room.eliminationOrder = [...(room.eliminationOrder || []), playerId];
    }
  } else {
    player.score += 10;
  }

  const alive = Object.values(players).filter((p) => p.lives > 0 && isFreshPlayer(p));
  if (alive.length <= 1) {
    return {
      ...room,
      players,
      status: "finished",
      winnerId: alive[0]?.id ?? playerId,
      updatedAt: now()
    };
  }

  const sortedIds = sortedPlayers(players).map(p => p.id);
  const aliveIds = alive.map(p => p.id);
  let currentIndex = sortedIds.indexOf(playerId);
  let nextId = "";
  let newRound = room.roundCount || 1;

  for (let i = 1; i <= sortedIds.length; i++) {
    const nextIdx = (currentIndex + i) % sortedIds.length;
    if (nextIdx === 0) newRound++;
    const candidate = sortedIds[nextIdx];
    if (aliveIds.includes(candidate)) {
      nextId = candidate;
      break;
    }
  }

  const { idx, q, used } = chooseQuestion(room.usedQ);
  return {
    ...room,
    players,
    currentTurn: nextId,
    currentQIndex: idx,
    currentQ: q,
    usedQ: used,
    turnStartedAt: now(),
    roundCount: newRound,
    updatedAt: now()
  };
}

function afterRoomMutation() {
  if (GS.status === "playing") renderGame();
  else renderWin();
}

function renderWin() {
  stopTimer();
  stopBomberTick();
  const overlay = el<HTMLDivElement>("win-overlay");
  const winner = GS.winnerId ? GS.players[GS.winnerId] : null;
  el<HTMLDivElement>("winner-name").textContent = winner?.nick ?? "Sem vencedor";
  overlay.style.display = "flex";
  if (!winnerSaved) { winnerSaved = true; playWin(); }
}

async function jogarNovamente() {
  el<HTMLDivElement>("win-overlay").style.display = "none";
  winnerSaved = false;
  if (localMode && localRoom) {
    localRoom = startRoomState(localRoom);
    GS = localRoom;
    afterRoomMutation();
    return;
  }
  if (!ME.host || !salaRef) return;
  const snap = await salaRef.once("value");
  const room = normalizeRoom(snap.val());
  await salaRef.update(startRoomState(room));
}

function showReaction(playerId: string, emoji: string) {
  const slot =
    document.querySelector<HTMLElement>(`.p-slot[data-player-id="${attrEsc(playerId)}"]`) ??
    el<HTMLDivElement>("emoji-menu");
  const safeEmoji = normalizeReactionEmoji(emoji);
  const pop = document.createElement("div");
  pop.className = "reaction-pop";
  pop.textContent = safeEmoji;
  pop.setAttribute("aria-hidden", "true");
  slot.appendChild(pop);

  const avatar = slot.querySelector<HTMLElement>(".arena-player-marker");
  if (avatar) {
    avatar.classList.remove("reaction-hit");
    void avatar.offsetWidth;
    avatar.classList.add("reaction-hit");
    window.setTimeout(() => avatar.classList.remove("reaction-hit"), 460);
  }

  const burst = document.createElement("div");
  burst.className = "reaction-burst";
  burst.setAttribute("aria-hidden", "true");
  const sparkCount = 10;
  for (let i = 0; i < sparkCount; i++) {
    const spark = document.createElement("span");
    spark.className = "reaction-spark";
    spark.textContent = REACTION_SPARKS[i % REACTION_SPARKS.length];
    const angle = -112 + (224 / (sparkCount - 1)) * i;
    const dist = 34 + (i % 3) * 12;
    const tx = Math.cos((angle * Math.PI) / 180) * dist;
    const ty = Math.sin((angle * Math.PI) / 180) * dist - 16;
    spark.style.setProperty("--tx", `${tx.toFixed(1)}px`);
    spark.style.setProperty("--ty", `${ty.toFixed(1)}px`);
    spark.style.setProperty("--rot", `${Math.round(angle * 1.6)}deg`);
    spark.style.setProperty("--del", `${(i % 4) * 0.035}s`);
    burst.appendChild(spark);
  }
  slot.appendChild(burst);
  window.setTimeout(() => burst.remove(), 1250);

  setTimeout(() => pop.remove(), 2000);
}

function getReactionPlayerId(): string {
  if (ME.id) return ME.id;
  const nickMatch = sortedPlayers(GS.players).find((p) => p.nick === ME.nick);
  const visiblePlayer =
    document.querySelector<HTMLElement>(".p-slot:not(.eliminated)")?.dataset.playerId ??
    document.querySelector<HTMLElement>(".p-slot")?.dataset.playerId;
  return nickMatch?.id ?? GS.currentTurn ?? sortedPlayers(GS.players)[0]?.id ?? visiblePlayer ?? "";
}

async function sendReaction(emoji: string) {
  const reactionPlayerId = getReactionPlayerId();
  const localId = uid();
  sentReactionIds.add(localId);
  showReaction(reactionPlayerId, emoji);
  if (!reactionPlayerId) {
    sentReactionIds.delete(localId);
    return;
  }
  if (localMode || !reactionRef) {
    sentReactionIds.delete(localId);
    return;
  }
  try {
    await reactionRef.push({ playerId: reactionPlayerId, emoji, at: now(), localId });
  } catch {
    sentReactionIds.delete(localId);
  }
}

async function copiarCodigo() {
  const code = ME.salaId || GS.code;
  if (!code) return;
  try { await navigator.clipboard.writeText(code); toast("Codigo copiado."); }
  catch { toast(code); }
}

function cleanupRoom(updateRemote = true) {
  stopTimer();
  stopBomberTick();
  if (presenceInterval) {
    clearInterval(presenceInterval);
    presenceInterval = null;
  }
  if (salaRef) {
    salaRef.off();
    if (updateRemote && ME.id) salaRef.child(`players/${ME.id}`).update({ online: false });
  }
  salaRef = null;
  reactionRef = null;
  lastRoomSignature = "";
  bomberMovePending = false;
  bomberStepLockedUntil = 0;
  previousBomberPositions.clear();
  localMode = false;
  ME.salaId = "";
  ME.host = false;
}

async function sairSala() {
  const roomCode = ME.salaId;
  const wasHost = ME.host;
  const ref = salaRef;

  if (localMode) {
    cleanupRoom(false);
    localRoom = null;
    GS = emptyRoom("");
    showScreen("setup");
    return;
  }

  cleanupRoom(false);
  showScreen("setup");

  if (!ref || !ME.id) return;
  try {
    if (wasHost) {
      const snap = await ref.once("value");
      const room = normalizeRoom(snap.val() ?? emptyRoom(roomCode));
      const remaining = sortedPlayers(room.players).filter((p) => p.id !== ME.id && isFreshPlayer(p));
      if (!remaining.length) {
        await ref.remove();
        return;
      }
      await ref.update({
        hostId: remaining[0].id,
        [`players/${ME.id}/online`]: false,
        updatedAt: now()
      });
      return;
    }
    await ref.child(`players/${ME.id}`).update({ online: false });
    await ref.child("updatedAt").set(now());
  } catch {
    toast("Nao foi possivel sair da sala agora.", "#ff3535");
  }
}

async function adminPanel() {
  const code = prompt("Codigo admin:");
  if (code !== ADMIN_CODE) { toast("Codigo admin incorreto.", "#ff3535"); return; }
  showScreen("admin");
  await renderAdmin();
}

async function renderAdmin() {
  if (!(await ensureDbReady())) return;
  if (adminRef) adminRef.off();
  adminRef = db.ref("rooms");
  adminRef.on("value", (snap: any) => {
    const rooms = (snap.val() ?? {}) as Record<string, Room>;
    const arr = Object.values(rooms);
    const onlinePlayers = arr.reduce((total, r) => total + Object.values(r.players ?? {}).filter(isFreshPlayer).length, 0);
    const activeGames = arr.filter((r) => r.status === "playing").length;
    el<HTMLDivElement>("stat-rooms").textContent = String(arr.length);
    el<HTMLDivElement>("stat-players").textContent = String(onlinePlayers);
    el<HTMLDivElement>("stat-games").textContent = String(activeGames);
    el<HTMLDivElement>("admin-rooms-list").innerHTML = arr.map((r) => `
      <div class="room-card">
        <div class="room-title">${esc(r.code)} - ${esc(r.status)}</div>
        <div class="room-players">
          ${Object.values(r.players ?? {}).filter(isFreshPlayer).map((p) => `<span class="p-badge">${esc(p.nick)}</span>`).join("")}
        </div>
      </div>
    `).join("") || "Nenhuma sala.";
  });
}

function startLocalDemo() {
  const nick = getNickOrToast();
  if (!nick) return;
  localMode = true; ME.host = true; ME.salaId = "LOCAL";
  const players: Record<string, Player> = {
    [ME.id]: makePlayer(nick, 0),
    "bot-1": { ...makePlayer("Lila", 1), id: "bot-1" }
  };
  localRoom = { ...emptyRoom("LOCAL"), hostId: ME.id, players };
  GS = localRoom;
  renderLobby();
  showScreen("lobby");
}

function reactFromButton(btn: HTMLElement, ev: Event) {
  ev.preventDefault();
  const last = Number(btn.dataset.lastReactionAt || 0);
  if (now() - last < 350) return;
  btn.dataset.lastReactionAt = String(now());
  void sendReaction(btn.dataset.emoji ?? DEFAULT_REACTION);
}

function bindReactionButtons() {
  document.querySelectorAll<HTMLElement>(".emoji-btn").forEach((btn) => {
    const react = (ev: Event) => reactFromButton(btn, ev);
    btn.onpointerdown = react;
    btn.onclick = react;
    btn.ontouchend = react;
  });
}

function bindReactionEvents() {
  if (reactionEventsBound) return;
  reactionEventsBound = true;
  const react = (ev: Event) => {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    const btn = target.closest<HTMLElement>(".emoji-btn");
    if (btn) reactFromButton(btn, ev);
  };
  document.addEventListener("pointerdown", react, true);
  document.addEventListener("click", react, true);
  document.addEventListener("touchend", react, { capture: true, passive: false });
  bindReactionButtons();
}

function bindEvents() {
  el<HTMLButtonElement>("btn-rapida").onclick = () => void partidaRapida();
  el<HTMLButtonElement>("btn-criar").onclick = () => void criarSala(false);
  el<HTMLButtonElement>("btn-entrar").onclick = () => void entrarSala();
  el<HTMLButtonElement>("btn-start").onclick = () => void startGame();
  el<HTMLButtonElement>("btn-admin").onclick = () => void adminPanel();
  el<HTMLButtonElement>("btn-jogar-novamente").onclick = () => void jogarNovamente();
  el<HTMLButtonElement>("btn-copiar").onclick = () => void copiarCodigo();
  el<HTMLButtonElement>("btn-sair-lobby").onclick = () => void sairSala();
  el<HTMLButtonElement>("btn-sair-jogo").onclick = () => void sairSala();
  el<HTMLButtonElement>("btn-admin-voltar").onclick = () => showScreen("setup");
  el<HTMLButtonElement>("btn-mute").onclick = () => {
    muted = !muted;
    el<HTMLButtonElement>("btn-mute").textContent = muted ? "Mudo" : "Som";
  };
  el<HTMLButtonElement>("btn-limpar").onclick = async () => {
    if (!db) return;
    if (!confirm("Limpar todas as salas?")) return;
    await db.ref("rooms").remove();
    toast("Salas limpas.");
  };
  bindReactionEvents();
}

window.addEventListener("DOMContentLoaded", () => {
  initFB();
  const saved = loadNick();
  if (saved) el<HTMLInputElement>("nick-input").value = saved;
  initTiles();
  bindReactionEvents();
  bindEvents();
});
