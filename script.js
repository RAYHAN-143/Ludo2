/* ========= Ludo Online — Lobby + 3min + real dice ===========

Flow:
- Single global lobby node used (no manual room id)
- First visitor becomes p1, waits in lobby
- Second visitor becomes p2 -> game auto-start
- Game state saved at /game node in Realtime DB
- Timer uses endTime (timestamp) synchronized in DB
- Only currentPlayer can roll their dice
- Dice animates (CSS class), after animation JS sets final number
- Tokens: each player has 4 tokens, start at pos 0 (home).
- Movement: tokenIndex chosen automatically (first non-finished)
- Move by dice value (as user requested)
- Scoring: +1 per cell moved; +10 if capture opponent token.
- When 3 minutes up -> compare scores and show winner.

IMPORTANT: Put board.png in same folder. Set DB rules to allow read/write during testing.
*/

const uid = 'u_' + Math.floor(Math.random()*1000000);
const lobbyRef = firebase.database().ref('lobby'); // who is waiting / players
const gameRef = firebase.database().ref('game');   // centralized single game

// UI
const enterBtn = document.getElementById('enterLobby');
const lobbyStatus = document.getElementById('lobbyStatus');
const messageEl = document.getElementById('message');
const timerEl = document.getElementById('timer');
const rollP1 = document.getElementById('rollP1');
const rollP2 = document.getElementById('rollP2');
const diceP1 = document.getElementById('diceP1');
const diceP2 = document.getElementById('diceP2');
const labelP1 = document.getElementById('labelP1');
const labelP2 = document.getElementById('labelP2');
const scoreP1 = document.getElementById('scoreP1');
const scoreP2 = document.getElementById('scoreP2');
const board = document.getElementById('board');

let myRole = null; // 'p1' or 'p2'
let localGame = null;
let countdownInterval = null;

// pixel map for positions 0..63 relative to 480x480 board
const posCoords = [
  {x:60,y:20},{x:120,y:20},{x:180,y:20},{x:240,y:20},{x:300,y:20},{x:360,y:20},{x:420,y:20},{x:420,y:60},
  {x:420,y:120},{x:420,y:180},{x:420,y:240},{x:420,y:300},{x:420,y:360},{x:360,y:360},{x:300,y:360},{x:240,y:360},
  {x:180,y:360},{x:120,y:360},{x:60,y:360},{x:20,y:300},{x:20,y:240},{x:20,y:180},{x:20,y:120},{x:60,y:60},
  // center-ish path (fill to 64)
  {x:120,y:120},{x:180,y:120},{x:240,y:120},{x:300,y:120},{x:360,y:120},{x:360,y:180},{x:360,y:240},{x:300,y:240},
  {x:240,y:240},{x:180,y:240},{x:120,y:240},{x:120,y:180},{x:180,y:180},{x:240,y:180},{x:300,y:180},{x:420,y:120},
];
while(posCoords.length < 64) posCoords.push(posCoords[posCoords.length-1]);

// create tokens DOM (4 each)
const tokenEls = { p1: [], p2: [] };
for(let i=0;i<4;i++){
  const a = document.createElement('div'); a.className = 'token p1'; a.dataset.idx = i; board.appendChild(a); tokenEls.p1.push(a);
  const b = document.createElement('div'); b.className = 'token p2'; b.dataset.idx = i; board.appendChild(b); tokenEls.p2.push(b);
}

// helper: update token DOM positions
function renderTokens(tokens){
  const t1 = tokens.p1 || [0,0,0,0];
  const t2 = tokens.p2 || [0,0,0,0];
  for(let i=0;i<4;i++){
    const p = t1[i] || 0; const c = posCoords[p];
    tokenEls.p1[i].style.left = (c.x) + 'px';
    tokenEls.p1[i].style.top = (c.y) + 'px';
  }
  for(let i=0;i<4;i++){
    const p = t2[i] || 0; const c = posCoords[p];
    tokenEls.p2[i].style.left = (c.x + 14) + 'px'; // offset so tokens don't overlap exactly
    tokenEls.p2[i].style.top = (c.y) + 'px';
  }
}

// UI enable/disable based on turn & started
function updateControls(state){
  if(!state) return;
  const started = state.started;
  const cur = state.currentPlayer;
  // enable roll button only for current player when started
  rollP1.disabled = !(started && cur === 1 && myRole === 'p1');
  rollP2.disabled = !(started && cur === 2 && myRole === 'p2');
  // set labels
  labelP1.textContent = state.players && state.players.p1 ? 'Connected' : 'Waiting';
  labelP2.textContent = state.players && state.players.p2 ? 'Connected' : 'Waiting';
}

// enter lobby
enterBtn.addEventListener('click', async () => {
  enterBtn.disabled = true;
  lobbyStatus.textContent = 'Entering lobby...';
  const snap = await lobbyRef.child('players').once('value');
  const players = snap.val() || {};
  // join as p1 or p2 or already present
  if(!players.p1){
    myRole = 'p1'; await lobbyRef.child('players/p1').set(uid);
  } else if(!players.p2 && players.p1 !== uid){
    myRole = 'p2'; await lobbyRef.child('players/p2').set(uid);
  } else if(players.p1 === uid){ myRole = 'p1'; }
  else if(players.p2 === uid){ myRole = 'p2'; }
  else { messageEl.textContent = 'Lobby full. Try refresh.'; enterBtn.disabled = false; return; }

  lobbyStatus.textContent = `In lobby as ${myRole}`;
  // try to trigger match start if two players present
  await tryStartMatch();
  // listen lobby and game
  listenLobby();
  listenGame();
});

// when two players present, initialize /game if not yet
async function tryStartMatch(){
  const snap = await lobbyRef.child('players').once('value');
  const players = snap.val() || {};
  if(players.p1 && players.p2){
    // initialize game if not already
    await gameRef.transaction(cur => {
      if(cur && cur.state && cur.state.started) return cur; // already started
      const t = {
        state: { started: true, currentPlayer: 1, dice: 0, endTime: Date.now() + 3*60*1000 },
        players: { p1: players.p1, p2: players.p2 },
        tokens: { p1: [0,0,0,0], p2: [0,0,0,0] },
        points: { p1: 0, p2: 0 },
        winner: null
      };
      return t;
    });
  }
}

// listen lobby changes (players leaving/joining)
function listenLobby(){
  lobbyRef.on('value', snap => {
    const val = snap.val() || {};
    const pls = val.players || {};
    lobbyStatus.textContent = `Lobby: ${pls.p1 ? 'Red' : '-'} vs ${pls.p2 ? 'Orange' : '-'}`;
  });
}

// listen game changes
function listenGame(){
  gameRef.on('value', snap => {
    const val = snap.val();
    localGame = val;
    if(!val) return;
    // update UI
    updateControls(val.state);
    scoreP1.textContent = (val.points && val.points.p1) || 0;
    scoreP2.textContent = (val.points && val.points.p2) || 0;
    renderTokens(val.tokens || { p1:[0,0,0,0], p2:[0,0,0,0] });
    // timer
    if(val.state && val.state.endTime){
      startLocalTimer(val.state.endTime);
    }
    // winner
    if(val.winner){
      messageEl.textContent = `${val.winner} জয়ী!`;
      rollP1.disabled = rollP2.disabled = true;
    } else {
      messageEl.textContent = '';
    }
  });
}

// start local countdown to DB endTime
function startLocalTimer(endTime){
  if(countdownInterval) clearInterval(countdownInterval);
  function tick(){
    const now = Date.now();
    const left = Math.max(0, endTime - now);
    const mm = Math.floor(left/60000);
    const ss = Math.floor((left%60000)/1000);
    timerEl.textContent = `Time: ${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
    if(left <= 0){
      clearInterval(countdownInterval);
      finalizeGame();
    }
  }
  tick();
  countdownInterval = setInterval(tick, 500);
}

// finalize when time up: compute winner by points and set /game/winner
async function finalizeGame(){
  const snap = await gameRef.once('value'); const g = snap.val();
  if(!g) return;
  if(g.winner) return;
  const p1 = (g.points && g.points.p1) || 0; const p2 = (g.points && g.points.p2) || 0;
  let winner = 'Draw';
  if(p1 > p2) winner = 'Red (Player 1)';
  else if(p2 > p1) winner = 'Orange (Player 2)';
  await gameRef.child('winner').set(winner);
  messageEl.textContent = `⏰ Time up! Winner: ${winner}`;
}

// DICE: spin effect + set final number in DB
function spinDiceUI(diceEl, finalNum){
  diceEl.classList.add('spinning');
  setTimeout(()=> {
    diceEl.classList.remove('spinning');
    // show number by setting inner text (faces exist but easier to reflect)
    diceEl.querySelector('.face1').textContent = finalNum;
    // (keep styling simple) — actual face show handled by number
  }, 900);
}

// helper: only current player can roll; roll button handlers:
rollP1.addEventListener('click', async ()=>{
  if(myRole !== 'p1') return;
  await attemptRoll('p1');
});
rollP2.addEventListener('click', async ()=>{
  if(myRole !== 'p2') return;
  await attemptRoll('p2');
});

// attemptRoll: checks turn, updates DB atomically: set dice, move token, points, captures, switch turn
async function attemptRoll(playerKey){
  const snap = await gameRef.child('state').once('value'); const state = snap.val();
  if(!state || !state.started) { messageEl.textContent = 'Game not started yet.'; return; }
  const current = state.currentPlayer;
  const myNum = playerKey === 'p1' ? 1 : 2;
  if(current !== myNum){ messageEl.textContent = 'এখন আপনার পালা নয়'; return; }

  // roll random
  const diceVal = Math.floor(Math.random()*6) + 1;
  // animate local dice
  const diceEl = playerKey === 'p1' ? diceP1 : diceP2;
  spinDiceUI(diceEl, diceVal);

  // perform move on server: use transaction to avoid race
  await gameRef.transaction(g => {
    if(!g) return g;
    // ensure started and current matches
    if(!g.state || !g.state.started) return g;
    if(g.state.currentPlayer !== myNum) return g; // someone else raced
    // choose token index: first token with pos < 63 (not finished)
    const tokens = g.tokens || { p1:[0,0,0,0], p2:[0,0,0,0] };
    const playerTokens = tokens[playerKey] || [0,0,0,0];
    let tokenIndex = -1;
    for(let i=0;i<4;i++){
      if(playerTokens[i] < 63){ tokenIndex = i; break; }
    }
    if(tokenIndex === -1){
      // nothing to move
      g.state.dice = diceVal;
      // switch turn
      g.state.currentPlayer = (myNum === 1 ? 2 : 1);
      return g;
    }
    // move token by diceVal (as requested)
    playerTokens[tokenIndex] += diceVal;
    if(playerTokens[tokenIndex] > 63) playerTokens[tokenIndex] = 63;
    // award points: +diceVal
    g.points = g.points || { p1:0, p2:0 };
    g.points[playerKey] = (g.points[playerKey] || 0) + diceVal;
    // capture check: if any opponent token on same pos, send it home and +10
    const oppKey = playerKey === 'p1' ? 'p2' : 'p1';
    const oppTokens = tokens[oppKey] || [0,0,0,0];
    for(let i=0;i<4;i++){
      if(oppTokens[i] === playerTokens[tokenIndex] && playerTokens[tokenIndex] !== 0){
        oppTokens[i] = 0; g.points[playerKey] += 10;
      }
    }
    // write back tokens
    g.tokens[playerKey] = playerTokens;
    g.tokens[oppKey] = oppTokens;
    // store dice and switch turn
    g.state.dice = diceVal;
    g.state.currentPlayer = (myNum === 1 ? 2 : 1);
    return g;
  });
}

// CLEANUP helpers: if someone leaves, clear lobby and game (optional). Not aggressive here.

window.addEventListener('beforeunload', async ()=>{
  // if in lobby, remove your entry
  if(myRole){
    const p = myRole;
    const snap = await lobbyRef.child('players/' + p).once('value');
    if(snap.val() === uid) await lobbyRef.child('players/' + p).remove();
    // do not auto-destroy game to allow others to see results
  }
});
