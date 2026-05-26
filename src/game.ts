import { ANIMALS } from "./animals";
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
  (import.meta as unknown as { env: Record<string, string | undefined> }).env
    .VITE_ADMIN_CODE ?? "OB_ADMIN";
const TURN_DURATION = 10;
const MAX_PLAYERS = 6;

declare const firebase: any;

type Player = {
  id: string;
  nick: string;
  skinIndex: number;
  lives: number;
  score: number;
  online: boolean;
  joinedAt: number;
  eliminatedAt?: number | null;
};

type Room = {
  code: string;
  quick?: boolean;
  status: "lobby" | "playing" | "finished";
  hostId: string;
  players: Record<string, Player>;
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

let db: any = null;
let ME = { nick: "", id: "", salaId: "", host: false, skinIndex: 0 };
let salaRef: any = null;
let reactionRef: any = null;
let adminRef: any = null;
let bombTimerInterval: ReturnType<typeof setInterval> | null = null;
let particlesActive = true;
let muted = false;
let AC: AudioContext | null = null;
let GS: Room = emptyRoom("");
let prevTurnId: string | null = null;
let winnerSaved = false;
let timeoutLock = "";
let localMode = false;
let localRoom: Room | null = null;
const REACTION_SPARKS = ["😂", "🔥", "💥", "✨", "💣", "😈", "🤯", "🥶"];

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
    roundCount: 0,
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

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function now(): number {
  return Date.now();
}

function saveNick(n: string) {
  try { localStorage.setItem("ob_nick", n); } catch {}
}

function loadNick(): string {
  try { return localStorage.getItem("ob_nick") ?? ""; } catch { return ""; }
}

function getPlayerId(): string {
  try {
    const saved = sessionStorage.getItem("ob_player_id");
    if (saved) return saved;
    const id = uid();
    sessionStorage.setItem("ob_player_id", id);
    return id;
  } catch {
    return uid();
  }
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
  o.frequency.setValueAtTime(urgent ? 1600 : 960, ac.currentTime);
  g.gain.setValueAtTime(urgent ? 0.13 : 0.09, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.06);
  o.connect(g);
  g.connect(ac.destination);
  o.start();
  o.stop(ac.currentTime + 0.06);
}

function playBoom() {
  const ac = getAC();
  if (!ac) return;
  const bufLen = Math.floor(ac.sampleRate * 0.5);
  const buf = ac.createBuffer(1, bufLen, ac.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) ch[i] = Math.random() * 2 - 1;
  const noise = ac.createBufferSource();
  const filter = ac.createBiquadFilter();
  const gain = ac.createGain();
  noise.buffer = buf;
  filter.type = "bandpass";
  filter.frequency.value = 300;
  gain.gain.setValueAtTime(1.1, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.48);
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ac.destination);
  noise.start();
  noise.stop(ac.currentTime + 0.48);
}

function playCorrect() {
  const ac = getAC();
  if (!ac) return;
  [880, 1100].forEach((freq, i) => {
    const start = ac.currentTime + i * 0.11;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(freq, start);
    g.gain.setValueAtTime(0.2, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + 0.2);
    o.connect(g);
    g.connect(ac.destination);
    o.start(start);
    o.stop(start + 0.2);
  });
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
  const pts: { x: number; y: number; r: number; vx: number; vy: number; a: number }[] = [];
  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener("resize", resize);
  for (let i = 0; i < 60; i++) {
    pts.push({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      r: Math.random() * 1.8 + 0.4,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.25,
      a: Math.random() * Math.PI * 2
    });
  }
  function draw() {
    requestAnimationFrame(draw);
    if (!particlesActive) {
      context.clearRect(0, 0, w, h);
      return;
    }
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
  }
  draw();
})();

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

function initFB() {
  try {
    if (typeof firebase === "undefined") return;
    if (!firebase.apps?.length) firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.database();
  } catch {
    db = null;
  }
}

function showScreen(id: "setup" | "lobby" | "game" | "admin") {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  el<HTMLDivElement>("scr-" + id).classList.add("active");
  el<HTMLDivElement>("emoji-menu").style.display = id === "game" ? "flex" : "none";
  particlesActive = id === "setup";
  const ac = getAC();
  if (ac && ac.state === "suspended") void ac.resume();
  if (id !== "game") stopTimer();
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
  return {
    id: ME.id,
    nick,
    skinIndex: skinIndex ?? Math.floor(Math.random() * ANIMALS.length),
    lives: 3,
    score: 0,
    online: true,
    joinedAt: now(),
    eliminatedAt: null
  };
}

function roomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 5; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

async function partidaRapida() {
  if (!getNickOrToast()) return;
  if (!db) {
    startLocalDemo();
    return;
  }
  const snap = await db.ref("rooms").orderByChild("quick").equalTo(true).once("value");
  const rooms = (snap.val() ?? {}) as Record<string, Room>;
  const open = Object.values(rooms).find((r) => {
    const players = Object.values(r.players ?? {}).filter((p) => p.online);
    return r.status === "lobby" && players.length < MAX_PLAYERS;
  });
  if (open) {
    await joinRoom(open.code);
  } else {
    await criarSala(true);
  }
}

async function criarSala(quick = false) {
  const nick = getNickOrToast();
  if (!nick) return;
  if (!db) {
    startLocalDemo();
    return;
  }
  const code = quick ? `RAP${roomCode().slice(0, 3)}` : roomCode();
  ME.salaId = code;
  ME.host = true;
  ME.skinIndex = Math.floor(Math.random() * ANIMALS.length);
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
  if (!code) {
    toast("Digite o codigo da sala.", "#ff3535");
    return;
  }
  await joinRoom(code);
}

async function joinRoom(code: string) {
  const nick = getNickOrToast();
  if (!nick) return;
  if (!db) {
    startLocalDemo();
    return;
  }
  const ref = db.ref(`rooms/${code}`);
  const snap = await ref.once("value");
  const room = snap.val() as Room | null;
  if (!room) {
    toast("Sala nao encontrada.", "#ff3535");
    return;
  }
  if (room.status !== "lobby") {
    toast("Essa sala ja esta em jogo.", "#ff3535");
    return;
  }
  const players = Object.values(room.players ?? {}).filter((p) => p.online);
  if (!room.players?.[ME.id] && players.length >= MAX_PLAYERS) {
    toast("Sala cheia.", "#ff3535");
    return;
  }
  ME.salaId = code;
  ME.host = room.hostId === ME.id;
  ME.skinIndex = players.length % ANIMALS.length;
  await ref.child(`players/${ME.id}`).set(makePlayer(nick, ME.skinIndex));
  await ref.child("updatedAt").set(now());
  listenRoom(code);
  showScreen("lobby");
}

function listenRoom(code: string) {
  if (salaRef) salaRef.off();
  if (reactionRef) reactionRef.off();
  salaRef = db.ref(`rooms/${code}`);
  salaRef.on("value", (snap: any) => {
    const room = snap.val() as Room | null;
    if (!room) {
      cleanupRoom(false);
      toast("A sala foi encerrada.", "#ff3535");
      showScreen("setup");
      return;
    }
    GS = normalizeRoom(room);
    ME.host = GS.hostId === ME.id;
    if (GS.status === "lobby") {
      renderLobby();
      showScreen("lobby");
    } else if (GS.status === "playing") {
      renderGame();
      showScreen("game");
    } else {
      renderGame();
      renderWin();
    }
  });
  salaRef.child(`players/${ME.id}`).onDisconnect().update({ online: false });
  reactionRef = salaRef.child("reactions");
  reactionRef.limitToLast(1).on("child_added", (snap: any) => {
    const r = snap.val();
    if (!r || r.at < now() - 3000) return;
    showReaction(r.playerId, r.emoji);
  });
}

function normalizeRoom(room: Room): Room {
  return {
    ...emptyRoom(room.code),
    ...room,
    players: room.players ?? {},
    usedQ: room.usedQ ?? [],
    eliminationOrder: room.eliminationOrder ?? []
  };
}

function renderLobby() {
  el<HTMLDivElement>("lobby-code-val").textContent = GS.code;
  const list = el<HTMLDivElement>("players-list");
  const players = sortedPlayers(GS.players);
  list.innerHTML = players.map((p) => `
    <div class="player-row">
      <div class="mini-avatar">${ANIMALS[p.skinIndex % ANIMALS.length]}</div>
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
  return Object.values(players).sort((a, b) => a.joinedAt - b.joinedAt);
}

function alivePlayers(room = GS): Player[] {
  return sortedPlayers(room.players).filter((p) => p.online && p.lives > 0 && !p.eliminatedAt);
}

function chooseQuestion(used: number[]): { idx: number; q: Question; used: number[] } {
  const cleanUsed = used.filter((idx) => idx >= 0 && idx < Q.length);
  const available = Q.map((_, idx) => idx).filter((idx) => !cleanUsed.includes(idx));
  const pool = available.length ? available : Q.map((_, idx) => idx);
  const idx = pool[Math.floor(Math.random() * pool.length)];
  const nextUsed = available.length ? [...cleanUsed, idx] : [idx];
  return { idx, q: Q[idx], used: nextUsed };
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
  const alive = alivePlayers(room);
  if (alive.length < 2) {
    toast("Precisa de pelo menos 2 jogadores.", "#ff3535");
    return;
  }
  await salaRef.update(startRoomState(room));
}

function startRoomState(room: Room): Room {
  const players: Record<string, Player> = {};
  sortedPlayers(room.players).forEach((p) => {
    players[p.id] = { ...p, lives: 3, score: 0, eliminatedAt: null, online: true };
  });
  const first = sortedPlayers(players)[0];
  if (!first) {
    return {
      ...room,
      status: "lobby",
      players,
      currentTurn: null,
      currentQIndex: null,
      currentQ: null,
      usedQ: [],
      turnStartedAt: 0,
      roundCount: 0,
      eliminationOrder: [],
      winnerId: null,
      updatedAt: now()
    };
  }
  const nextQ = chooseQuestion([]);
  return {
    ...room,
    status: "playing",
    players,
    currentTurn: first.id,
    currentQIndex: nextQ.idx,
    currentQ: nextQ.q,
    usedQ: nextQ.used,
    turnStartedAt: now(),
    roundCount: 1,
    eliminationOrder: [],
    winnerId: null,
    updatedAt: now()
  };
}

function renderGame() {
  renderPlayers();
  renderQuestion();
  positionBomb();
  updateRound();
  startTimer();
}

function updateRound() {
  el<HTMLDivElement>("round-badge").textContent = `RODADA ${Math.max(1, GS.roundCount || 1)}`;
}

function renderPlayers() {
  const circle = el<HTMLDivElement>("players-circle");
  circle.querySelectorAll(".p-slot").forEach((n) => n.remove());
  const players = sortedPlayers(GS.players);
  const size = circle.clientWidth || 290;
  const radius = Math.max(92, size / 2 - (size >= 500 ? 72 : 48));
  const center = size / 2;
  players.forEach((p, idx) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * idx) / Math.max(players.length, 1);
    const slot = document.createElement("div");
    slot.className = `p-slot ${p.id === GS.currentTurn ? "active-turn" : ""} ${p.lives <= 0 || p.eliminatedAt ? "eliminated" : ""}`;
    slot.dataset.playerId = p.id;
    slot.dataset.angle = String(angle);
    slot.style.left = `${center + Math.cos(angle) * radius - 38}px`;
    slot.style.top = `${center + Math.sin(angle) * radius - 50}px`;
    slot.innerHTML = `
      <div class="p-avatar-wrap ${p.id === GS.currentTurn ? "panic" : ""}">
        ${p.id === GS.hostId ? `<div class="p-crown">HOST</div>` : ""}
        ${ANIMALS[p.skinIndex % ANIMALS.length]}
      </div>
      <div class="p-name">${esc(p.nick)}</div>
      <div class="p-hearts">${"VIDA ".repeat(Math.max(0, p.lives)).trim() || "FORA"}</div>
      <div class="p-score">${p.score}</div>
    `;
    circle.appendChild(slot);
  });
}

function positionBomb() {
  const bomb = el<HTMLDivElement>("bomb-el");
  const circle = el<HTMLDivElement>("players-circle");
  const size = circle.clientWidth || 290;
  let x = 0;
  let y = 0;
  const slot = GS.currentTurn ? circle.querySelector<HTMLElement>(`.p-slot[data-player-id="${attrEsc(GS.currentTurn)}"]`) : null;
  if (slot) {
    const angle = Number(slot.dataset.angle ?? 0);
    const radius = Math.max(70, size * 0.22);
    x = Math.cos(angle) * radius;
    y = Math.sin(angle) * radius;
  }
  bomb.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
  if (prevTurnId !== GS.currentTurn) {
    bomb.classList.remove("pass-pop");
    void bomb.offsetWidth;
    bomb.classList.add("pass-pop");
    setTimeout(() => bomb.classList.remove("pass-pop"), 480);
  }
  prevTurnId = GS.currentTurn;
}

function renderQuestion() {
  const qCard = el<HTMLDivElement>("q-card");
  if (GS.status !== "playing" || !GS.currentQ) {
    qCard.style.display = "none";
    return;
  }
  qCard.style.display = "block";
  const q = GS.currentQ;
  const meTurn = GS.currentTurn === ME.id;
  const me = GS.players[ME.id];
  const canAnswer = meTurn && !!me && me.lives > 0 && !me.eliminatedAt;
  el<HTMLDivElement>("q-cat").textContent = q.cat;
  el<HTMLDivElement>("my-turn-hint").style.display = canAnswer ? "block" : "none";
  el<HTMLDivElement>("q-word").innerHTML = esc(q.word).split("__").join(`<span class="q-blank">?</span>`);
  const opcoes = el<HTMLDivElement>("opcoes");
  opcoes.innerHTML = "";
  q.options.forEach((op) => {
    const btn = document.createElement("button");
    btn.className = "op-btn";
    btn.textContent = op;
    btn.disabled = !canAnswer;
    btn.addEventListener("click", () => answerQuestion(op, btn));
    opcoes.appendChild(btn);
  });
  const tip = el<HTMLDivElement>("q-tip");
  tip.style.display = canAnswer ? "none" : "block";
  const current = GS.currentTurn ? GS.players[GS.currentTurn] : null;
  tip.textContent = canAnswer ? "" : `Agora e a vez de ${current ? current.nick : "outro jogador"}.`;
}

async function answerQuestion(option: string, btn: HTMLButtonElement) {
  if (!GS.currentQ || GS.currentTurn !== ME.id) return;
  const correct = option === GS.currentQ.answer;
  document.querySelectorAll<HTMLButtonElement>(".op-btn").forEach((b) => {
    b.disabled = true;
    if (b.textContent === GS.currentQ?.answer) b.classList.add("correct");
  });
  btn.classList.add(correct ? "correct" : "wrong");
  el<HTMLDivElement>("q-tip").style.display = "block";
  el<HTMLDivElement>("q-tip").textContent = correct ? "Acertou! A bomba foi passada." : GS.currentQ.tip;
  if (correct) playCorrect();
  if (!correct) {
    playBoom();
    triggerExplosion();
  }
  window.setTimeout(() => void applyAnswer(correct), correct ? 420 : 720);
}

async function applyAnswer(correct: boolean) {
  if (localMode && localRoom) {
    localRoom = applyAnswerToRoom(localRoom, ME.id, correct);
    GS = localRoom;
    afterRoomMutation();
    return;
  }
  if (!salaRef) return;
  const snap = await salaRef.once("value");
  const room = normalizeRoom(snap.val());
  if (room.status !== "playing" || room.currentTurn !== ME.id) return;
  await salaRef.update(applyAnswerToRoom(room, ME.id, correct));
}

function applyAnswerToRoom(room: Room, playerId: string, correct: boolean): Room {
  const next = structuredCloneRoom(room);
  const player = next.players[playerId];
  if (!player || player.lives <= 0) return next;
  if (correct) {
    player.score += 100;
  } else {
    player.lives = Math.max(0, player.lives - 1);
    if (player.lives <= 0 && !player.eliminatedAt) {
      player.eliminatedAt = now();
      next.eliminationOrder = [...(next.eliminationOrder ?? []), playerId];
    }
  }
  return prepareNextTurnOrFinish(next, playerId);
}

function prepareNextTurnOrFinish(room: Room, fromPlayerId: string): Room {
  const alive = alivePlayers(room);
  if (alive.length <= 1) {
    return {
      ...room,
      status: "finished",
      winnerId: alive[0]?.id ?? fromPlayerId,
      currentTurn: null,
      turnStartedAt: 0,
      updatedAt: now()
    };
  }
  const nextPlayer = nextAlivePlayer(room, fromPlayerId);
  const nextQ = chooseQuestion(room.usedQ);
  return {
    ...room,
    status: "playing",
    currentTurn: nextPlayer.id,
    currentQIndex: nextQ.idx,
    currentQ: nextQ.q,
    usedQ: nextQ.used,
    turnStartedAt: now(),
    roundCount: (room.roundCount || 0) + 1,
    updatedAt: now()
  };
}

function nextAlivePlayer(room: Room, fromPlayerId: string): Player {
  const players = sortedPlayers(room.players);
  const aliveIds = new Set(alivePlayers(room).map((p) => p.id));
  const start = Math.max(0, players.findIndex((p) => p.id === fromPlayerId));
  for (let offset = 1; offset <= players.length; offset++) {
    const p = players[(start + offset) % players.length];
    if (aliveIds.has(p.id)) return p;
  }
  const fallback = alivePlayers(room)[0];
  if (!fallback) throw new Error("Nenhum jogador vivo encontrado");
  return fallback;
}

function structuredCloneRoom(room: Room): Room {
  return JSON.parse(JSON.stringify(room)) as Room;
}

function startTimer() {
  if (bombTimerInterval) return;
  bombTimerInterval = setInterval(updateTimer, 200);
  updateTimer();
}

function stopTimer() {
  if (bombTimerInterval) clearInterval(bombTimerInterval);
  bombTimerInterval = null;
}

function updateTimer() {
  const timer = el<HTMLDivElement>("bomb-timer");
  if (GS.status !== "playing" || !GS.turnStartedAt || !GS.currentTurn) {
    timer.textContent = String(TURN_DURATION);
    timer.classList.remove("danger");
    return;
  }
  const elapsed = (now() - GS.turnStartedAt) / 1000;
  const remaining = Math.max(0, Math.ceil(TURN_DURATION - elapsed));
  timer.textContent = String(remaining).padStart(2, "0");
  timer.classList.toggle("danger", remaining <= 3);
  if (remaining <= 5 && remaining > 0 && Math.abs(elapsed - Math.round(elapsed)) < 0.12) {
    playTick(remaining <= 3);
  }
  const key = `${GS.currentTurn}:${GS.turnStartedAt}`;
  if (remaining <= 0 && timeoutLock !== key && (ME.host || localMode)) {
    timeoutLock = key;
    void handleTimeout();
  }
}

async function handleTimeout() {
  playBoom();
  triggerExplosion();
  window.setTimeout(async () => {
    if (localMode && localRoom) {
      localRoom = applyAnswerToRoom(localRoom, localRoom.currentTurn ?? "", false);
      GS = localRoom;
      afterRoomMutation();
      return;
    }
    if (!salaRef) return;
    const snap = await salaRef.once("value");
    const room = normalizeRoom(snap.val());
    if (room.status !== "playing" || !room.currentTurn) return;
    await salaRef.update(applyAnswerToRoom(room, room.currentTurn, false));
  }, 720);
}

function triggerExplosion() {
  const circle = el<HTMLDivElement>("players-circle");
  circle.classList.remove("bomb-exploding");
  void circle.offsetWidth;
  circle.classList.add("bomb-exploding");
  setTimeout(() => circle.classList.remove("bomb-exploding"), 760);
}

function afterRoomMutation() {
  if (localRoom) GS = localRoom;
  if (GS.status === "playing") {
    renderGame();
    showScreen("game");
  } else {
    renderGame();
    renderWin();
  }
}

function renderWin() {
  stopTimer();
  const overlay = el<HTMLDivElement>("win-overlay");
  const winner = GS.winnerId ? GS.players[GS.winnerId] : null;
  el<HTMLDivElement>("winner-name").textContent = winner?.nick ?? "Sem vencedor";
  const ranking = rankingPlayers();
  el<HTMLDivElement>("ranking-section").innerHTML = `
    <div class="ranking-title">Ranking final</div>
    ${ranking.map((p, idx) => `
      <div class="ranking-row">
        <div class="rank-medal">${idx + 1}</div>
        <div class="rank-name">${esc(p.nick)}</div>
        <div class="rank-pos">${p.score} pts</div>
      </div>
    `).join("")}
  `;
  makeStars();
  overlay.style.display = "flex";
  if (!winnerSaved) {
    winnerSaved = true;
    playWin();
  }
}

function rankingPlayers(): Player[] {
  return sortedPlayers(GS.players).sort((a, b) => {
    const aliveA = a.lives > 0 && !a.eliminatedAt ? 1 : 0;
    const aliveB = b.lives > 0 && !b.eliminatedAt ? 1 : 0;
    if (aliveA !== aliveB) return aliveB - aliveA;
    if (a.score !== b.score) return b.score - a.score;
    return (b.eliminatedAt ?? Number.MAX_SAFE_INTEGER) - (a.eliminatedAt ?? Number.MAX_SAFE_INTEGER);
  });
}

function makeStars() {
  const box = el<HTMLDivElement>("win-stars");
  if (box.childElementCount) return;
  for (let i = 0; i < 34; i++) {
    const s = document.createElement("div");
    s.className = "win-star";
    s.style.left = `${Math.random() * 100}%`;
    s.style.setProperty("--dur", `${2 + Math.random() * 3}s`);
    s.style.setProperty("--del", `${Math.random() * 2}s`);
    box.appendChild(s);
  }
}

async function jogarNovamente() {
  el<HTMLDivElement>("win-overlay").style.display = "none";
  el<HTMLDivElement>("win-stars").innerHTML = "";
  winnerSaved = false;
  if (localMode && localRoom) {
    localRoom = startRoomState(localRoom);
    GS = localRoom;
    afterRoomMutation();
    return;
  }
  if (!ME.host || !salaRef) {
    toast("Apenas o host pode reiniciar.", "#ff3535");
    return;
  }
  const snap = await salaRef.once("value");
  const room = normalizeRoom(snap.val());
  await salaRef.update(startRoomState(room));
}

function showReaction(playerId: string, emoji: string) {
  const slot = document.querySelector<HTMLElement>(`.p-slot[data-player-id="${attrEsc(playerId)}"]`);
  if (!slot) return;
  const pop = document.createElement("div");
  pop.className = "reaction-pop";
  pop.textContent = emoji || "😂";
  const burst = document.createElement("div");
  burst.className = "reaction-burst";
  for (let i = 0; i < 7; i++) {
    const spark = document.createElement("div");
    spark.className = "reaction-spark";
    spark.textContent = i === 0 ? pop.textContent : REACTION_SPARKS[Math.floor(Math.random() * REACTION_SPARKS.length)];
    const angle = -Math.PI + (Math.PI * 2 * i) / 7 + Math.random() * 0.35;
    const distance = 30 + Math.random() * 34;
    spark.style.setProperty("--tx", `${Math.cos(angle) * distance}px`);
    spark.style.setProperty("--ty", `${Math.sin(angle) * distance - 34}px`);
    spark.style.setProperty("--rot", `${Math.floor(Math.random() * 120 - 60)}deg`);
    spark.style.setProperty("--del", `${i * 0.035}s`);
    burst.appendChild(spark);
  }
  slot.appendChild(pop);
  slot.appendChild(burst);
  setTimeout(() => {
    pop.remove();
    burst.remove();
  }, 2100);
}

async function sendReaction(emoji: string) {
  if (localMode) {
    showReaction(ME.id, emoji);
    return;
  }
  if (!reactionRef || !ME.id) return;
  await reactionRef.push({ playerId: ME.id, emoji, at: now() });
}

async function copiarCodigo() {
  if (!ME.salaId && !GS.code) return;
  const code = ME.salaId || GS.code;
  try {
    await navigator.clipboard.writeText(code);
    toast("Codigo copiado.");
  } catch {
    toast(code);
  }
}

function cleanupRoom(updateRemote = true) {
  stopTimer();
  el<HTMLDivElement>("win-overlay").style.display = "none";
  if (reactionRef) reactionRef.off();
  if (salaRef) {
    salaRef.off();
    if (updateRemote && ME.id) {
      void salaRef.child(`players/${ME.id}`).update({ online: false });
    }
  }
  salaRef = null;
  reactionRef = null;
  localMode = false;
  localRoom = null;
  ME.salaId = "";
  ME.host = false;
  prevTurnId = null;
}

async function adminPanel() {
  const code = prompt("Codigo admin:");
  if (code !== ADMIN_CODE) {
    toast("Codigo admin incorreto.", "#ff3535");
    return;
  }
  showScreen("admin");
  await renderAdmin();
}

async function renderAdmin() {
  if (!db) {
    toast("Firebase indisponivel.", "#ff3535");
    return;
  }
  if (adminRef) adminRef.off();
  adminRef = db.ref("rooms");
  adminRef.on("value", (snap: any) => {
    const rooms = (snap.val() ?? {}) as Record<string, Room>;
    const arr = Object.values(rooms);
    const online = arr.reduce((sum, r) => sum + Object.values(r.players ?? {}).filter((p) => p.online).length, 0);
    el<HTMLDivElement>("stat-rooms").textContent = String(arr.length);
    el<HTMLDivElement>("stat-players").textContent = String(online);
    el<HTMLDivElement>("stat-games").textContent = String(arr.filter((r) => r.status === "playing").length);
    el<HTMLDivElement>("admin-rooms-list").innerHTML = arr.map((r) => `
      <div class="room-card">
        <div class="room-title">${esc(r.code)} - ${esc(r.status)}</div>
        <div class="room-info"><span>Host</span><span>${esc(r.players?.[r.hostId]?.nick ?? r.hostId)}</span></div>
        <div class="room-info"><span>Rodada</span><span>${r.roundCount || 0}</span></div>
        <div class="room-players">
          ${Object.values(r.players ?? {}).map((p) => `<span class="p-badge">${esc(p.nick)} ${p.online ? "on" : "off"}</span>`).join("")}
        </div>
      </div>
    `).join("") || `<div class="room-card">Nenhuma sala criada.</div>`;
  });
}

async function limparTudo() {
  if (!db) return;
  if (!confirm("Limpar todas as salas?")) return;
  await db.ref("rooms").remove();
  toast("Salas removidas.");
}

function startLocalDemo() {
  const nick = getNickOrToast();
  if (!nick) return;
  localMode = true;
  ME.host = true;
  ME.salaId = "LOCAL";
  ME.skinIndex = 0;
  const names = [nick, "Lila", "Tom", "Elly"];
  const players: Record<string, Player> = {};
  names.forEach((name, idx) => {
    const id = idx === 0 ? ME.id : `bot-${idx}`;
    players[id] = {
      id,
      nick: name,
      skinIndex: idx % ANIMALS.length,
      lives: 3,
      score: 0,
      online: true,
      joinedAt: now() + idx,
      eliminatedAt: null
    };
  });
  localRoom = { ...emptyRoom("LOCAL"), hostId: ME.id, players };
  GS = localRoom;
  renderLobby();
  showScreen("lobby");
  toast("Firebase indisponivel: modo demo local.", "#ffc700", 3000);
}

function initSetupChars() {
  const sc = el<HTMLDivElement>("setup-chars");
  sc.innerHTML = "";
  [0, 1, 2, 3, 4].forEach((i, idx) => {
    const d = document.createElement("div");
    d.className = "setup-char";
    d.style.setProperty("--d", `${idx * 0.15}s`);
    d.innerHTML = ANIMALS[i];
    sc.appendChild(d);
  });
}

function bindEvents() {
  el<HTMLButtonElement>("btn-mute").addEventListener("click", () => {
    muted = !muted;
    el<HTMLButtonElement>("btn-mute").textContent = muted ? "Mudo" : "Som";
    if (muted && AC) void AC.suspend();
    else if (AC) void AC.resume();
  });
  el<HTMLButtonElement>("btn-sair-lobby").addEventListener("click", () => {
    cleanupRoom();
    showScreen("setup");
  });
  el<HTMLButtonElement>("btn-sair-jogo").addEventListener("click", () => {
    if (!confirm("Sair da partida?")) return;
    cleanupRoom();
    showScreen("setup");
  });
  el<HTMLButtonElement>("btn-rapida").addEventListener("click", () => void partidaRapida());
  el<HTMLButtonElement>("btn-criar").addEventListener("click", () => void criarSala(false));
  el<HTMLButtonElement>("btn-entrar").addEventListener("click", () => void entrarSala());
  el<HTMLInputElement>("code-input").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") void entrarSala();
  });
  el<HTMLInputElement>("nick-input").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") void partidaRapida();
  });
  el<HTMLButtonElement>("btn-admin").addEventListener("click", () => void adminPanel());
  el<HTMLButtonElement>("btn-copiar").addEventListener("click", () => void copiarCodigo());
  el<HTMLButtonElement>("btn-start").addEventListener("click", () => void startGame());
  el<HTMLButtonElement>("btn-admin-voltar").addEventListener("click", () => {
    if (adminRef) adminRef.off();
    showScreen("setup");
  });
  el<HTMLButtonElement>("btn-limpar").addEventListener("click", () => void limparTudo());
  el<HTMLButtonElement>("btn-jogar-novamente").addEventListener("click", () => void jogarNovamente());
  document.querySelectorAll<HTMLElement>(".emoji-btn").forEach((b) => {
    b.addEventListener("click", () => void sendReaction(b.dataset.emoji ?? b.textContent ?? "OK"));
  });
  window.addEventListener("resize", () => {
    if (GS.status === "playing") renderGame();
  });
  window.addEventListener("beforeunload", () => cleanupRoom());
}

window.addEventListener("DOMContentLoaded", () => {
  initFB();
  const saved = loadNick();
  if (saved) el<HTMLInputElement>("nick-input").value = saved;
  initSetupChars();
  initTiles();
  bindEvents();
});
