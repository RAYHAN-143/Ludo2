const createBtn = document.getElementById('createBtn');
const roomIdInput = document.getElementById('roomId');
const statusEl = document.getElementById('status');
const gameEl = document.getElementById('game');
const playerLabelEl = document.getElementById('playerLabel');
const currentPlayerEl = document.getElementById('currentPlayer');
const diceValueEl = document.getElementById('diceValue');
const rollBtn = document.getElementById('rollBtn');
const readyBtn = document.getElementById('readyBtn');
const messageEl = document.getElementById('message');
const p1PointsEl = document.getElementById('p1Points');
const p2PointsEl = document.getElementById('p2Points');
const boardEl = document.getElementById('board');

let roomRef = null;
let roomId = null;
let myPlayer = null;
let uid = 'u_' + Math.floor(Math.random()*1000000);

const posCoords = [
  {x:60,y:20},{x:120,y:20},{x:180,y:20},{x:240,y:20},{x:300,y:20},{x:360,y:20},{x:420,y:20},{x:420,y:60},
  {x:420,y:120},{x:420,y:180},{x:420,y:240},{x:420,y:300},{x:420,y:360},{x:360,y:360},{x:300,y:360},{x:240,y:360},
  {x:180,y:360},{x:120,y:360},{x:60,y:360},{x:20,y:300},{x:20,y:240},{x:20,y:180},{x:20,y:120},{x:60,y:60}
];

const tokensEls = { p1: [], p2: [] };
for (let i=0;i<4;i++){
  const t1 = document.createElement('div'); t1.className = 'token player1'; boardEl.appendChild(t1); tokensEls.p1.push(t1);
  const t2 = document.createElement('div'); t2.className = 'token player2'; boardEl.appendChild(t2); tokensEls.p2.push(t2);
}

createBtn.addEventListener('click', async () => {
  roomId = roomIdInput.value.trim();
  if (!roomId) return alert('Room id লাগবে');
  roomRef = firebase.database().ref('rooms/' + roomId);

  statusEl.textContent = 'Connecting...';
  const snap = await roomRef.child('players').once('value');
  const players = snap.val() || {};
  if (!players.p1) {
    myPlayer = 'p1'; await roomRef.child('players/p1').set(uid);
  } else if (!players.p2 && players.p1 !== uid) {
    myPlayer = 'p2'; await roomRef.child('players/p2').set(uid);
  } else { alert('Room full!'); return; }

  const init = { state: { currentPlayer: 1, dice: 0, started:false }, tokens: { p1:[0,0,0,0], p2:[0,0,0,0] }, points: { p1:0,p2:0 }, ready:{p1:false,p2:false}, winner:null };
  await roomRef.child('initCheck').transaction(cur => cur || init);

  statusEl.textContent = 'Connected as ' + myPlayer;
  playerLabelEl.textContent = myPlayer;
  gameEl.style.display = 'block';

  roomRef.on('value', snapshot => {
    const data = snapshot.val();
    if (!data) return;
    const state = data.state || {};
    currentPlayerEl.textContent = state.currentPlayer || '-';
    diceValueEl.textContent = state.dice || '-';
    p1PointsEl.textContent = (data.points && data.points.p1) || 0;
    p2PointsEl.textContent = (data.points && data.points.p2) || 0;
    if (data.winner) { messageEl.textContent = data.winner + ' জয়ী!'; rollBtn.disabled = true; }
    else { messageEl.textContent = ''; rollBtn.disabled = !(state.currentPlayer === (myPlayer === 'p1' ? 1 : 2) && state.started); }
    renderTokens((data.tokens) ? data.tokens : { p1:[0,0,0,0], p2:[0,0,0,0] });
  });
});

readyBtn.addEventListener('click', async () => {
  if (!roomRef) return;
  await roomRef.child('ready/' + myPlayer).set(true);
  const r = await roomRef.child('ready').once('value');
  const ready = r.val() || {};
  if (ready.p1 && ready.p2) await roomRef.child('state').update({ started: true, currentPlayer: 1, dice:0 });
});

rollBtn.addEventListener('click', async () => {
  const dice = Math.floor(Math.random()*6)+1;
  await roomRef.child('state/dice').set(dice);
  messageEl.textContent = '🎲 ' + dice;
});

function renderTokens(tokens){
  for(let i=0;i<4;i++){
    const p=tokens.p1?tokens.p1[i]:0;
    const c=posCoords[p]||posCoords[0];
    const e=tokensEls.p1[i];
    e.style.left=(c.x-13)+'px';
    e.style.top=(c.y-13)+'px';
  }
  for(let i=0;i<4;i++){
    const p=tokens.p2?tokens.p2[i]:0;
    const c=posCoords[p]||posCoords[0];
    const e=tokensEls.p2[i];
    e.style.left=(c.x+13)+'px';
    e.style.top=(c.y-13)+'px';
  }
}