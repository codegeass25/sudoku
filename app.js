'use strict';

const API_BASE = 'https://suduko.mdmsportal.uk';

const $ = s => document.querySelector(s);
const els = {
  badge: $('#connectionBadge'), lobby: $('#lobbyView'), ready: $('#readyView'), game: $('#gameView'), result: $('#resultView'),
  joinForm: $('#joinForm'), code: $('#competitionCode'), no: $('#contestantNo'), name: $('#fullName'), school: $('#schoolTeam'), joinMessage: $('#joinMessage'),
  readyTitle: $('#readyTitle'), readyDescription: $('#readyDescription'), readyName: $('#readyName'), readyNo: $('#readyNo'), readyOrg: $('#readyOrg'), readyMessage: $('#readyMessage'), startBtn: $('#startBtn'),
  gameTitle: $('#gameTitle'), gamePlayer: $('#gamePlayer'), timer: $('#timer'), saveStatus: $('#saveStatus'), board: $('#sudokuBoard'), numberPad: $('#numberPad'), desktopPad: $('#desktopNumberPad'),
  erase: $('#eraseBtn'), dErase: $('#desktopEraseBtn'), undo: $('#undoBtn'), dUndo: $('#desktopUndoBtn'), unselect: $('#clearSelectionBtn'), filled: $('#filledCount'), progress: $('#progressBar'), submit: $('#submitBtn'),
  modal: $('#confirmModal'), cancelSubmit: $('#cancelSubmitBtn'), confirmSubmit: $('#confirmSubmitBtn'),
  resultIcon: $('#resultIcon'), resultHeadline: $('#resultHeadline'), resultSubline: $('#resultSubline'), resultCorrect: $('#resultCorrect'), resultAccuracy: $('#resultAccuracy'), resultTime: $('#resultTime'), resultRank: $('#resultRank'),
  leaderboardPanel: $('#leaderboardPanel'), publicLeaderboard: $('#publicLeaderboard'), returnHome: $('#returnHomeBtn'), toasts: $('#toastStack')
};

const state = { competition:null, contestant:null, attempt:null, token:null, puzzle:'', board:Array(81).fill('0'), selected:null, history:[], saveTimer:null, saving:false, pendingSave:false, socket:null, serverOffset:0, timerRAF:null };

function showView(el){ [els.lobby,els.ready,els.game,els.result].forEach(v=>v.classList.remove('active')); el.classList.add('active'); window.scrollTo({top:0,behavior:'smooth'}); }
function message(el,text,type=''){ el.textContent=text||''; el.className='form-message'+(type?` ${type}`:''); }
function toast(text,type=''){ const d=document.createElement('div'); d.className='toast '+type; d.textContent=text; els.toasts.appendChild(d); setTimeout(()=>d.remove(),3500); }
function setConnection(mode,text){ els.badge.className=`status-pill status-${mode}`; els.badge.querySelector('span:last-child').textContent=text; }
function formatTime(ms){ ms=Math.max(0,Number(ms)||0); const m=Math.floor(ms/60000), s=Math.floor((ms%60000)/1000), x=Math.floor(ms%1000); return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(x).padStart(3,'0')}`; }
function normalizeDigits(v){ return String(v??'').replace(/[^0-9]/g,'').slice(0,81); }
async function api(path,opts={}){
  const headers={...(opts.headers||{})}; if(opts.body && !(opts.body instanceof FormData)){ headers['Content-Type']='application/json'; if(typeof opts.body!=='string') opts.body=JSON.stringify(opts.body); }
  const res=await fetch(API_BASE+path,{...opts,headers}); let data={}; try{data=await res.json();}catch{}
  if(!res.ok) throw new Error(data.error||`Request failed (${res.status})`); return data;
}
function storeActive(){
  if(state.token) localStorage.setItem('sudoku_live_active_token',state.token);
  if(state.attempt) localStorage.setItem('sudoku_live_cached_attempt',JSON.stringify({attempt:state.attempt,board:state.board,competition:state.competition,contestant:state.contestant,token:state.token}));
}
function clearActive(){ localStorage.removeItem('sudoku_live_active_token'); localStorage.removeItem('sudoku_live_cached_attempt'); }
function mergeClues(answers,puzzle){ const a=(normalizeDigits(answers)+'0'.repeat(81)).slice(0,81).split(''); for(let i=0;i<81;i++) if(puzzle[i]&&puzzle[i]!=='0') a[i]=puzzle[i]; return a; }

async function healthCheck(){
  try{ const r=await fetch(API_BASE+'/health',{cache:'no-store'}); if(!r.ok) throw 0; setConnection('online','Server Online'); }
  catch{ setConnection('offline','Server Offline'); }
}
async function loadSocketClient(){
  if(window.io) return true;
  return new Promise(resolve=>{ const s=document.createElement('script'); s.src=API_BASE+'/socket.io/socket.io.js'; s.async=true; s.onload=()=>resolve(true); s.onerror=()=>resolve(false); document.head.appendChild(s); });
}
async function connectAttemptSocket(){
  if(!state.token) return;
  const ok=await loadSocketClient(); if(!ok){setConnection('offline','Live Sync Offline');return;}
  if(state.socket) state.socket.disconnect();
  state.socket=io(API_BASE,{auth:{attempt_token:state.token},reconnection:true,reconnectionDelay:700,reconnectionDelayMax:3500,transports:['polling','websocket']});
  state.socket.on('connect',()=>{ setConnection('online','Live Sync'); state.socket.emit('contestant:watch',{competition_id:state.attempt?.competition?.id || state.competition?.id}); state.socket.emit('time:sync',{},r=>{if(r?.server_now)state.serverOffset=r.server_now-Date.now();}); if(state.pendingSave) queueSave(50); });
  state.socket.on('disconnect',()=>setConnection('connecting','Reconnecting'));
  state.socket.on('connect_error',()=>setConnection('offline','Live Sync Offline'));
  state.socket.on('server:hello',p=>{ if(p?.server_now)state.serverOffset=p.server_now-Date.now(); });
  state.socket.on('competition:status',p=>{ if(!p)return; if(state.competition)state.competition.status=p.status; if(state.attempt?.competition)state.attempt.competition.status=p.status; updateProgress(); if(p.status==='closed'&&state.attempt?.state==='playing')toast('Competition has been closed by the administrator. Final submission is currently locked.','error'); });
  state.socket.on('leaderboard:updated',p=>{ if(p?.leaderboard){ els.leaderboardPanel.classList.remove('hidden'); renderLeaderboard(p.leaderboard); const mine=p.leaderboard.find(r=>r.attempt_id===state.attempt?.id); if(mine)els.resultRank.textContent=`#${mine.rank}`; } });
}

els.joinForm.addEventListener('submit',async e=>{
  e.preventDefault(); message(els.joinMessage,'Checking competition…');
  try{
    const code=els.code.value.trim().toUpperCase(); const body={contestant_no:els.no.value.trim(),full_name:els.name.value.trim(),school_team:els.school.value.trim()};
    const data=await api(`/api/competitions/${encodeURIComponent(code)}/check-in`,{method:'POST',body});
    state.competition=data.competition; state.contestant=data.contestant;
    localStorage.setItem('sudoku_live_last_identity',JSON.stringify({code,contestant_no:body.contestant_no,full_name:body.full_name,school_team:body.school_team}));
    els.readyTitle.textContent=state.competition.name; els.readyDescription.textContent=state.competition.description||'Solve accurately and submit as fast as you can.';
    els.readyName.textContent=state.contestant.full_name; els.readyNo.textContent=state.contestant.contestant_no; els.readyOrg.textContent=state.competition.organization||'Competition Organizer';
    els.startBtn.textContent=data.has_active_attempt?'RESUME SUDOKU →':'START SUDOKU →'; message(els.joinMessage,''); showView(els.ready);
  }catch(err){ message(els.joinMessage,err.message,'error'); }
});

els.startBtn.addEventListener('click',async()=>{
  if(!state.competition||!state.contestant)return; els.startBtn.disabled=true; message(els.readyMessage,'Securing your official attempt…');
  try{
    const remembered=localStorage.getItem('sudoku_live_active_token')||'';
    const data=await api(`/api/competitions/${encodeURIComponent(state.competition.code)}/start`,{method:'POST',body:{contestant_no:state.contestant.contestant_no,full_name:state.contestant.full_name,attempt_token:remembered}});
    state.token=data.attempt_token; state.attempt=data.attempt; state.serverOffset=(data.server_now||Date.now())-Date.now(); state.puzzle=data.attempt.competition.puzzle; state.board=mergeClues(data.attempt.answers,state.puzzle); state.history=[];
    state.competition={...state.competition,...data.attempt.competition}; storeActive(); enterGame(); await connectAttemptSocket(); toast(data.resumed?'Attempt resumed. Timer continued running.':'Official timer started.','success');
  }catch(err){message(els.readyMessage,err.message,'error');}finally{els.startBtn.disabled=false;}
});

function enterGame(){
  showView(els.game); els.gameTitle.textContent=state.attempt?.competition?.name||state.competition?.name||'Sudoku Competition'; els.gamePlayer.textContent=`${state.contestant?.contestant_no||state.attempt?.contestant?.contestant_no} · ${state.contestant?.full_name||state.attempt?.contestant?.full_name}`;
  renderBoard(); renderPads(); startTimer(); updateProgress();
}
function renderPads(){
  for(const wrap of [els.numberPad,els.desktopPad]){ wrap.innerHTML=''; for(let n=1;n<=9;n++){ const b=document.createElement('button'); b.className='number-key'; b.textContent=n; b.type='button'; b.addEventListener('click',()=>setValue(String(n))); wrap.appendChild(b); } }
}
function renderBoard(){
  els.board.innerHTML=''; for(let i=0;i<81;i++){ const b=document.createElement('button'); b.type='button'; b.className='sudoku-cell'; if(Math.floor(i/9)%3===2 && Math.floor(i/9)!==8)b.classList.add('box-bottom'); const clue=state.puzzle[i]!=='0'; if(clue)b.classList.add('clue'); else if(state.board[i]!=='0')b.classList.add('player-value'); b.textContent=state.board[i]==='0'?'':state.board[i]; b.dataset.index=i; b.setAttribute('role','gridcell'); b.addEventListener('click',()=>selectCell(i)); els.board.appendChild(b); } applyHighlights();
}
function selectCell(i){ state.selected=i; applyHighlights(); }
function applyHighlights(){
  const cells=[...els.board.children], sel=state.selected; cells.forEach((c,i)=>{c.classList.remove('selected','peer','same'); if(sel===null)return; if(i===sel)c.classList.add('selected'); const sr=Math.floor(sel/9),sc=sel%9,r=Math.floor(i/9),col=i%9; const sameBox=Math.floor(sr/3)===Math.floor(r/3)&&Math.floor(sc/3)===Math.floor(col/3); if(i!==sel&&(r===sr||col===sc||sameBox))c.classList.add('peer'); const v=state.board[sel]; if(v!=='0'&&state.board[i]===v&&i!==sel)c.classList.add('same'); });
}
function setValue(v){
  const i=state.selected; if(i===null||state.puzzle[i]!=='0'||state.attempt?.state!=='playing')return;
  if(state.board[i]===v)return; state.history.push({i,prev:state.board[i]}); if(state.history.length>100)state.history.shift(); state.board[i]=v; const cell=els.board.children[i]; cell.textContent=v==='0'?'':v; cell.classList.toggle('player-value',v!=='0'); applyHighlights(); updateProgress(); storeActive(); queueSave();
}
function erase(){setValue('0')}
function undo(){const h=state.history.pop();if(!h)return;state.selected=h.i;state.board[h.i]=h.prev;const cell=els.board.children[h.i];cell.textContent=h.prev==='0'?'':h.prev;cell.classList.toggle('player-value',h.prev!=='0');applyHighlights();updateProgress();storeActive();queueSave();}
els.erase.addEventListener('click',erase); els.dErase.addEventListener('click',erase); els.undo.addEventListener('click',undo); els.dUndo.addEventListener('click',undo); els.unselect.addEventListener('click',()=>{state.selected=null;applyHighlights();});
document.addEventListener('keydown',e=>{ if(!els.game.classList.contains('active'))return; if(/^[1-9]$/.test(e.key))setValue(e.key); else if(e.key==='Backspace'||e.key==='Delete'||e.key==='0')erase(); else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undo();} });
function updateProgress(){ const count=state.board.filter(v=>v!=='0').length; els.filled.textContent=count; els.progress.style.width=`${count/81*100}%`; const status=state.competition?.status||state.attempt?.competition?.status; els.submit.disabled=!navigator.onLine||status!=='open'; }
function queueSave(delay=450){ clearTimeout(state.saveTimer); state.pendingSave=true; els.saveStatus.textContent=navigator.onLine?'Saving…':'Offline — changes queued'; state.saveTimer=setTimeout(saveAnswers,delay); }
async function saveAnswers(){
  if(!state.token||state.attempt?.state!=='playing'||state.saving)return; state.saving=true;
  try{ const r=await api('/api/attempt/answers',{method:'PUT',headers:{'X-Attempt-Token':state.token},body:{answers:state.board.join('')}}); state.pendingSave=false; els.saveStatus.textContent='All changes saved'; state.attempt.last_saved_at=r.last_saved_at; storeActive(); }
  catch(err){ state.pendingSave=true; els.saveStatus.textContent=navigator.onLine?'Save pending — retrying':'Offline — changes queued'; setTimeout(()=>{if(state.pendingSave&&navigator.onLine)saveAnswers()},2200); }
  finally{state.saving=false;}
}
function startTimer(){ cancelAnimationFrame(state.timerRAF); const tick=()=>{ if(state.attempt?.started_at){ const now=Date.now()+state.serverOffset; const end=state.attempt.submitted_at||now; els.timer.textContent=formatTime((state.attempt.elapsed_ms??(end-state.attempt.started_at))); if(!state.attempt.submitted_at) state.attempt.elapsed_ms=null; } state.timerRAF=requestAnimationFrame(tick); }; tick(); }

els.submit.addEventListener('click',()=>{ if(!navigator.onLine){toast('Internet connection is required for final submission.','error');return;} const blanks=state.board.filter(v=>v==='0').length; if(blanks) toast(`${blanks} cell${blanks===1?' is':'s are'} still blank. You may still submit if intentional.`); els.modal.classList.add('open'); els.modal.setAttribute('aria-hidden','false'); });
els.cancelSubmit.addEventListener('click',()=>closeModal()); $('.modal-backdrop').addEventListener('click',()=>closeModal());
function closeModal(){els.modal.classList.remove('open');els.modal.setAttribute('aria-hidden','true');}
els.confirmSubmit.addEventListener('click',async()=>{
  closeModal(); els.submit.disabled=true; els.confirmSubmit.disabled=true; els.saveStatus.textContent='Submitting securely…';
  try{
    const data=await api('/api/attempt/submit',{method:'POST',headers:{'X-Attempt-Token':state.token},body:{answers:state.board.join('')}}); state.attempt=data.result; storeActive(); showResult(data); toast('Final submission recorded.','success');
  }catch(err){toast(err.message,'error');els.submit.disabled=false;}finally{els.confirmSubmit.disabled=false;}
});
function showResult(data){
  cancelAnimationFrame(state.timerRAF); showView(els.result); const r=data.result; const perfect=!!r.is_perfect; els.resultIcon.textContent=perfect?'✓':'!'; els.resultIcon.classList.toggle('imperfect',!perfect); els.resultHeadline.textContent=perfect?'Perfect solution!':'Submission recorded';
  els.resultSubline.textContent=perfect?'Your solution is 100% correct. Ranking is determined by official elapsed time.':'Your submission contains an incorrect or blank cell. Correctness is prioritized before time.';
  els.resultCorrect.textContent=`${r.correct_count}/81`; els.resultAccuracy.textContent=`${Number(r.accuracy).toFixed(2)}%`; els.resultTime.textContent=formatTime(r.elapsed_ms); els.resultRank.textContent=data.rank?`#${data.rank}`:(data.leaderboard_visible?'Calculating…':'Hidden');
  if(data.leaderboard_visible) loadPublicLeaderboard(); else els.leaderboardPanel.classList.add('hidden');
}
async function loadPublicLeaderboard(){ try{const d=await api(`/api/competitions/${encodeURIComponent(state.competition?.code||state.attempt?.competition?.code)}/leaderboard`);els.leaderboardPanel.classList.remove('hidden');renderLeaderboard(d.leaderboard);const mine=d.leaderboard.find(x=>x.attempt_id===state.attempt?.id);if(mine)els.resultRank.textContent=`#${mine.rank}`;}catch{} }
function renderLeaderboard(rows){ els.publicLeaderboard.innerHTML=''; if(!rows?.length){els.publicLeaderboard.innerHTML='<p class="muted small">No submitted results yet.</p>';return;} rows.slice(0,20).forEach(r=>{const d=document.createElement('div');d.className='leader-row';d.innerHTML=`<span class="rank-no ${r.rank<=3?'podium':''}">#${r.rank}</span><span class="leader-name"><strong>${escapeHtml(r.full_name)}</strong><small>${escapeHtml(r.contestant_no)}${r.school_team?' · '+escapeHtml(r.school_team):''}</small></span><span class="leader-time"><strong>${formatTime(r.elapsed_ms)}</strong><small>${r.correct_count}/81 · ${Number(r.accuracy).toFixed(1)}%</small></span>`;els.publicLeaderboard.appendChild(d);}); }
function escapeHtml(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
els.returnHome.addEventListener('click',()=>{ clearActive(); state.token=null; state.attempt=null; state.selected=null; if(state.socket)state.socket.disconnect(); showView(els.lobby); });

window.addEventListener('online',()=>{healthCheck();updateProgress();if(state.pendingSave)queueSave(100);}); window.addEventListener('offline',()=>{setConnection('offline','Offline');updateProgress();els.saveStatus.textContent='Offline — changes queued';});

async function restoreAttempt(){
  const token=localStorage.getItem('sudoku_live_active_token'); if(!token)return false;
  try{
    const d=await api('/api/attempt',{headers:{'X-Attempt-Token':token}}); state.token=token; state.attempt=d.attempt; state.serverOffset=(d.server_now||Date.now())-Date.now(); state.puzzle=d.attempt.competition.puzzle; state.board=mergeClues(d.attempt.answers,state.puzzle); state.competition=d.attempt.competition; state.contestant=d.attempt.contestant; storeActive();
    if(d.attempt.state==='playing'){enterGame();await connectAttemptSocket();toast('Active attempt restored. Official timer continued running.');}
    else{showResult({result:d.attempt,rank:null,leaderboard_visible:false});await connectAttemptSocket();}
    return true;
  }catch{
    try{const cached=JSON.parse(localStorage.getItem('sudoku_live_cached_attempt')||'null'); if(cached?.attempt?.state==='playing'&&!navigator.onLine){state.token=cached.token;state.attempt=cached.attempt;state.competition=cached.competition;state.contestant=cached.contestant;state.puzzle=cached.attempt.competition.puzzle;state.board=mergeClues(cached.board?.join?.('')||cached.attempt.answers,state.puzzle);enterGame();setConnection('offline','Offline');els.saveStatus.textContent='Offline — reconnect to sync';return true;}}catch{}
    return false;
  }
}

(async function init(){
  if('serviceWorker' in navigator){try{await navigator.serviceWorker.register('./sw.js')}catch{}}
  const last=JSON.parse(localStorage.getItem('sudoku_live_last_identity')||'null'); if(last){els.code.value=last.code||'';els.no.value=last.contestant_no||'';els.name.value=last.full_name||'';els.school.value=last.school_team||'';}
  await healthCheck(); await restoreAttempt();
})();
