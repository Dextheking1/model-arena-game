/* Model Arena - browser UI. Game rules live in game-core.js. */
(function () {
  'use strict';

  var Core = window.ModelArenaCore;
  var API_BASE = 'https://gen.pollinations.ai';
  var KEY_STORAGE = 'model-arena-polli-key';

  var el = {};
  [
    'modeBadge', 'keyStatus', 'keyInput', 'validateKeyBtn', 'clearKeyBtn',
    'keyMessage', 'modelPicker', 'customModel', 'pickerMessage',
    'startBtn', 'nextRoundBtn', 'autoBtn', 'resetBtn',
    'demoBanner', 'matchTitle', 'matchScore',
    'nameA', 'nameB', 'moveA', 'moveB', 'metaA', 'metaB',
    'reasoningA', 'reasoningB', 'fighterA', 'fighterB',
    'championBanner', 'standingsBody', 'fixtureList', 'matchLog'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  var league = null;
  var busy = false;
  var autoPlaying = false;

  function getKey() {
    return (el.keyInput.value || '').trim();
  }

  function isLive() {
    return getKey().length > 0;
  }

  function setKeyMessage(text, kind) {
    el.keyMessage.textContent = text || '';
    el.keyMessage.className = 'key-message' + (kind ? ' ' + kind : '');
  }

  function refreshMode() {
    if (isLive()) {
      el.modeBadge.textContent = 'Live mode - real model calls';
      el.modeBadge.className = 'badge badge-live';
      el.keyStatus.textContent = 'Key set (stored in this browser only)';
      el.demoBanner.textContent = 'Live mode: every move below is a real call to the named model on gen.pollinations.ai, paid with your Pollen.';
      el.demoBanner.className = 'demo-banner live';
    } else {
      el.modeBadge.textContent = 'Demo mode - simulated moves';
      el.modeBadge.className = 'badge badge-demo';
      el.keyStatus.textContent = 'No key set';
      el.demoBanner.textContent = 'Demo mode: no key set, so all moves are simulated locally. Add a key to watch real models play.';
      el.demoBanner.className = 'demo-banner';
    }
  }

  /* ---------------- key handling ---------------- */

  function initKey() {
    try {
      var saved = localStorage.getItem(KEY_STORAGE);
      if (saved) el.keyInput.value = saved;
    } catch (e) { /* localStorage unavailable */ }
    el.keyInput.addEventListener('input', function () {
      try {
        if (getKey()) localStorage.setItem(KEY_STORAGE, getKey());
        else localStorage.removeItem(KEY_STORAGE);
      } catch (e) { /* ignore */ }
      setKeyMessage('');
      refreshMode();
    });
    el.clearKeyBtn.addEventListener('click', function () {
      el.keyInput.value = '';
      try { localStorage.removeItem(KEY_STORAGE); } catch (e) { /* ignore */ }
      setKeyMessage('Key cleared from this browser.');
      refreshMode();
    });
    el.validateKeyBtn.addEventListener('click', validateKey);
    refreshMode();
  }

  function validateKey() {
    var key = getKey();
    if (!key) {
      setKeyMessage('Paste a key first, or just play in demo mode.', 'err');
      return;
    }
    if (key.indexOf('sk_') !== 0 && key.indexOf('pk_') !== 0) {
      setKeyMessage('That does not look like a Pollinations key. Keys start with sk_ or pk_.', 'err');
      return;
    }
    setKeyMessage('Checking key against gen.pollinations.ai ...');
    fetch(API_BASE + '/account/balance', {
      headers: { Authorization: 'Bearer ' + key }
    }).then(function (res) {
      if (res.status === 200) {
        return res.json().then(function (data) {
          var balance = data && data.accountBalance ? data.accountBalance.total : data.balance;
          setKeyMessage('Key works. Account balance: ' + balance + ' Pollen.', 'ok');
          refreshMode();
        });
      }
      if (res.status === 401 || res.status === 403) {
        setKeyMessage('Key rejected by gen.pollinations.ai (HTTP ' + res.status + '). Check the key and try again.', 'err');
        return null;
      }
      setKeyMessage('Unexpected reply (HTTP ' + res.status + '). The key may still work for model calls.', 'err');
      return null;
    }).catch(function () {
      setKeyMessage('Could not reach gen.pollinations.ai. Check your connection.', 'err');
    });
  }

  /* ---------------- model picker ---------------- */

  function initPicker() {
    Core.DEFAULT_MODELS.forEach(function (model, idx) {
      var label = document.createElement('label');
      label.className = 'model-option';
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.value = model.id;
      box.checked = idx < 4;
      box.addEventListener('change', refreshPickerMessage);
      var name = document.createElement('span');
      name.textContent = model.label;
      var id = document.createElement('span');
      id.className = 'model-id';
      id.textContent = model.id;
      label.appendChild(box);
      label.appendChild(name);
      label.appendChild(id);
      el.modelPicker.appendChild(label);
    });
    refreshPickerMessage();
  }

  function selectedModels() {
    var picked = [];
    el.modelPicker.querySelectorAll('input[type="checkbox"]').forEach(function (box) {
      if (box.checked) picked.push(box.value);
    });
    var custom = (el.customModel.value || '').trim();
    if (custom) {
      if (picked.length === 4) picked[3] = custom;
      else if (picked.length === 3) picked.push(custom);
    }
    return picked;
  }

  function refreshPickerMessage() {
    var picked = selectedModels();
    el.pickerMessage.textContent = picked.length === 4
      ? 'League lineup: ' + picked.join(', ')
      : 'Pick exactly 4 models (' + picked.length + ' selected so far). A custom id counts as one pick.';
    el.pickerMessage.className = 'key-message' + (picked.length === 4 ? ' ok' : '');
  }

  /* ---------------- model calls ---------------- */

  function callModel(modelId, prompt) {
    return fetch(API_BASE + '/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + getKey(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: prompt }],
        reasoning_effort: 'low',
        max_tokens: 600,
        temperature: 0.7
      })
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (body) {
          throw new Error('HTTP ' + res.status + ' from ' + modelId + ': ' + body.slice(0, 160));
        });
      }
      return res.json();
    }).then(function (data) {
      var choice = data && data.choices && data.choices[0];
      var message = choice && choice.message;
      var content = message && (message.content || '');
      if (typeof content !== 'string' || !content.trim()) {
        throw new Error('empty content from ' + modelId);
      }
      return content;
    });
  }

  /*
   * One legal move for one player: one real call, one retry on an
   * illegal answer, then a forfeit. Demo mode simulates and says so.
   */
  function requestMove(modelId, context, opponentHistoryMoves) {
    if (!isLive()) {
      var demoParsed = {
        ok: true,
        move: Core.demoMove(opponentHistoryMoves),
        reasoning: 'Simulated move. No key was used.',
        confidence: Core.demoConfidence(opponentHistoryMoves),
        attemptsUsed: 1,
        forfeited: false,
        simulated: true
      };
      return new Promise(function (resolve) {
        setTimeout(function () { resolve(demoParsed); }, 350);
      });
    }

    var prompt = Core.buildPrompt(context);
    return callModel(modelId, prompt).then(function (raw1) {
      var first = Core.resolveMoveAttempts([raw1]);
      if (first.ok) { first.simulated = false; return first; }
      var retryPrompt = prompt +
        '\n\nYour previous answer was not valid: ' + first.error +
        '. Answer again with strict JSON only: {"move":"rock","reasoning":"one short sentence","confidence":0.5}';
      return callModel(modelId, retryPrompt).then(function (raw2) {
        var second = Core.resolveMoveAttempts([raw1, raw2]);
        second.simulated = false;
        return second;
      }).catch(function () {
        return { ok: false, forfeited: true, attemptsUsed: 2, simulated: false, error: 'retry call failed' };
      });
    }).catch(function (err) {
      return { ok: false, forfeited: true, attemptsUsed: 1, simulated: false, error: String(err && err.message || err) };
    });
  }

  /* ---------------- game flow ---------------- */

  function perspectiveHistory(match, side) {
    return match.rounds.map(function (r) {
      var mine = side === 'a' ? r.moveA : r.moveB;
      var theirs = side === 'a' ? r.moveB : r.moveA;
      var outcome = r.winner === 'draw' ? 'draw'
        : (side === 'a' ? r.winner === 'a' : r.winner === 'b') ? 'you won'
        : 'you lost';
      return { round: r.round, myMove: mine, opponentMove: theirs, outcome: outcome };
    });
  }

  function standingsSummary() {
    if (!league) return '';
    return Core.sortStandings(league.standings)
      .map(function (s) { return s.player + ' ' + s.leaguePoints + ' pts'; })
      .join(', ');
  }

  function buildContext(match, side) {
    var me = side === 'a' ? match.a : match.b;
    var opponent = side === 'a' ? match.b : match.a;
    var history = perspectiveHistory(match, side);
    var score = Core.matchScore(match);
    return {
      player: me,
      opponent: opponent,
      matchIndex: match.index,
      totalMatches: league.fixtures.length,
      roundNumber: match.rounds.length + 1,
      roundsPerMatch: league.roundsPerMatch,
      myRoundsWon: side === 'a' ? score.a : score.b,
      opponentRoundsWon: side === 'a' ? score.b : score.a,
      draws: score.draws,
      history: history,
      standingsSummary: standingsSummary()
    };
  }

  function playRound() {
    if (!league || league.finished || busy) return Promise.resolve();
    var match = league.fixtures[league.currentMatch];
    if (!match || match.finished) return Promise.resolve();
    busy = true;
    refreshControls();
    setFighterState('thinking', match);

    var oppMovesForA = match.rounds.map(function (r) { return r.moveB; });
    var oppMovesForB = match.rounds.map(function (r) { return r.moveA; });

    return Promise.all([
      requestMove(match.a, buildContext(match, 'a'), oppMovesForA),
      requestMove(match.b, buildContext(match, 'b'), oppMovesForB)
    ]).then(function (results) {
      var resA = results[0];
      var resB = results[1];
      var record = Core.recordRound(league, match.index, {
        moveA: resA.ok ? resA.move : null,
        moveB: resB.ok ? resB.move : null,
        reasoningA: resA.ok ? resA.reasoning : (resA.error || 'forfeited'),
        reasoningB: resB.ok ? resB.reasoning : (resB.error || 'forfeited'),
        confidenceA: resA.ok ? resA.confidence : null,
        confidenceB: resB.ok ? resB.confidence : null,
        forfeitA: !!resA.forfeited,
        forfeitB: !!resB.forfeited
      });
      record.simulated = !!(resA.simulated || resB.simulated);
      renderRound(match, record);
      renderStandings();
      renderFixtures();
      busy = false;
      refreshControls();
      if (league.finished) renderChampion();
    }).catch(function (err) {
      busy = false;
      refreshControls();
      appendLog('Round failed: ' + String(err && err.message || err), true);
    });
  }

  function autoPlay() {
    if (!league || league.finished || autoPlaying) return;
    autoPlaying = true;
    refreshControls();
    function step() {
      if (!league || league.finished) {
        autoPlaying = false;
        refreshControls();
        return;
      }
      playRound().then(function () {
        if (autoPlaying && league && !league.finished) {
          setTimeout(step, 500);
        } else {
          autoPlaying = false;
          refreshControls();
        }
      });
    }
    step();
  }

  function startLeague() {
    var players = selectedModels();
    if (players.length !== 4) {
      el.pickerMessage.textContent = 'Pick exactly 4 models before starting (' + players.length + ' picked).';
      el.pickerMessage.className = 'key-message err';
      return;
    }
    if (new Set(players).size !== 4) {
      el.pickerMessage.textContent = 'The 4 picks must be different models.';
      el.pickerMessage.className = 'key-message err';
      return;
    }
    league = Core.createLeague(players, 5);
    autoPlaying = false;
    el.matchLog.innerHTML = '';
    el.championBanner.hidden = true;
    appendLog('League started: ' + players.join(' vs ') + '. 6 matches, 5 rounds each.', false);
    renderAll();
    refreshControls();
  }

  function resetLeague() {
    league = null;
    autoPlaying = false;
    busy = false;
    el.matchTitle.textContent = 'No league running';
    el.matchScore.textContent = 'Pick 4 models and start.';
    el.nameA.textContent = '-'; el.nameB.textContent = '-';
    el.moveA.textContent = '?'; el.moveB.textContent = '?';
    el.metaA.textContent = 'waiting'; el.metaB.textContent = 'waiting';
    el.reasoningA.textContent = ''; el.reasoningB.textContent = '';
    el.fighterA.className = 'fighter'; el.fighterB.className = 'fighter';
    el.championBanner.hidden = true;
    el.standingsBody.innerHTML = '<tr><td colspan="9" class="empty">No matches played yet.</td></tr>';
    el.fixtureList.innerHTML = '';
    el.matchLog.innerHTML = '<p class="empty">Rounds will appear here as they are played.</p>';
    refreshControls();
  }

  /* ---------------- rendering ---------------- */

  function refreshControls() {
    var running = !!league && !league.finished;
    el.startBtn.disabled = busy || autoPlaying;
    el.nextRoundBtn.disabled = !running || busy || autoPlaying;
    el.autoBtn.disabled = !running || busy || autoPlaying;
    el.resetBtn.disabled = busy;
  }

  function setFighterState(state, match) {
    el.nameA.textContent = match.a;
    el.nameB.textContent = match.b;
    if (state === 'thinking') {
      el.moveA.textContent = '...';
      el.moveB.textContent = '...';
      el.metaA.textContent = isLive() ? 'calling model' : 'simulating';
      el.metaB.textContent = isLive() ? 'calling model' : 'simulating';
      el.reasoningA.textContent = '';
      el.reasoningB.textContent = '';
    }
  }

  function renderAll() {
    var match = league.fixtures[league.currentMatch] || league.fixtures[league.fixtures.length - 1];
    el.matchTitle.textContent = 'Match ' + (match.index + 1) + ' of 6: ' + match.a + ' vs ' + match.b;
    el.matchScore.textContent = 'First to win more of 5 rounds takes the match.';
    el.nameA.textContent = match.a;
    el.nameB.textContent = match.b;
    renderStandings();
    renderFixtures();
  }

  function renderRound(match, record) {
    var score = Core.matchScore(match);
    el.matchTitle.textContent = 'Match ' + (match.index + 1) + ' of 6: ' + match.a + ' vs ' + match.b;
    el.matchScore.textContent = 'Round ' + record.round + ' of ' + league.roundsPerMatch +
      ' - score ' + score.a + ' - ' + score.b + (score.draws ? ', ' + score.draws + ' drawn' : '');

    el.nameA.textContent = match.a;
    el.nameB.textContent = match.b;
    el.moveA.textContent = record.moveA || 'Forfeit';
    el.moveB.textContent = record.moveB || 'Forfeit';
    el.metaA.textContent = record.confidenceA != null
      ? 'model confidence ' + Math.round(record.confidenceA * 100) + '%' + (record.simulated ? ' (simulated)' : '')
      : (record.forfeitA ? 'forfeited this round' : '');
    el.metaB.textContent = record.confidenceB != null
      ? 'model confidence ' + Math.round(record.confidenceB * 100) + '%' + (record.simulated ? ' (simulated)' : '')
      : (record.forfeitB ? 'forfeited this round' : '');
    el.reasoningA.textContent = record.reasoningA ? '"' + record.reasoningA + '"' : '';
    el.reasoningB.textContent = record.reasoningB ? '"' + record.reasoningB + '"' : '';
    el.fighterA.className = 'fighter' + (record.winner === 'a' ? ' winner' : record.winner === 'b' ? ' loser' : '');
    el.fighterB.className = 'fighter' + (record.winner === 'b' ? ' winner' : record.winner === 'a' ? ' loser' : '');

    var winnerText = record.winner === 'draw' ? 'Draw'
      : record.winner === 'a' ? match.a + ' takes the round'
      : match.b + ' takes the round';
    var detail = match.a + ' played ' + (record.moveA || 'nothing (forfeit)') +
      ', ' + match.b + ' played ' + (record.moveB || 'nothing (forfeit)') + '.';
    appendLog(
      'Match ' + (match.index + 1) + ', round ' + record.round + ': ' + winnerText,
      false,
      detail + (record.simulated ? ' [SIMULATED - demo mode]' : '') +
        ((record.forfeitA || record.forfeitB) ? ' [FORFEIT]' : '')
    );

    if (match.finished) {
      var endText = match.winner
        ? 'Match ' + (match.index + 1) + ' over: ' + match.winner + ' wins ' +
          Math.max(score.a, score.b) + ' - ' + Math.min(score.a, score.b) + ' and takes 3 league points.'
        : 'Match ' + (match.index + 1) + ' over: drawn match, 1 league point each.';
      appendLog(endText, false, '', true);
      if (!league.finished) {
        var next = league.fixtures[league.currentMatch];
        el.matchTitle.textContent = 'Next: match ' + (next.index + 1) + ' of 6: ' + next.a + ' vs ' + next.b;
      }
    }
  }

  function renderStandings() {
    if (!league) return;
    var sorted = Core.sortStandings(league.standings);
    el.standingsBody.innerHTML = '';
    sorted.forEach(function (s, idx) {
      var tr = document.createElement('tr');
      if (league.finished && league.champion === s.player) tr.className = 'champion-row';
      var rounds = s.roundsWon + 'W / ' + s.roundsDrawn + 'D / ' + s.roundsLost + 'L';
      [String(idx + 1), s.player, String(s.played), String(s.matchWins),
       String(s.matchDraws), String(s.matchLosses), rounds,
       String(s.forfeits), String(s.leaguePoints)].forEach(function (cell) {
        var td = document.createElement('td');
        td.textContent = cell;
        tr.appendChild(td);
      });
      el.standingsBody.appendChild(tr);
    });
  }

  function renderFixtures() {
    if (!league) return;
    el.fixtureList.innerHTML = '';
    league.fixtures.forEach(function (match) {
      var li = document.createElement('li');
      var score = Core.matchScore(match);
      li.textContent = match.a + ' vs ' + match.b +
        (match.finished ? ' - finished ' + score.a + ' - ' + score.b
          : match.index === league.currentMatch ? ' - up now'
          : ' - not played');
      if (match.finished) li.className = 'done';
      else if (match.index === league.currentMatch) li.className = 'current';
      el.fixtureList.appendChild(li);
    });
  }

  function renderChampion() {
    var winnerRow = Core.sortStandings(league.standings)[0];
    el.championBanner.hidden = false;
    el.championBanner.textContent = 'Champion: ' + league.champion + ' - ' +
      winnerRow.leaguePoints + ' league points, ' + winnerRow.roundsWon +
      ' rounds won. League finished.';
    el.matchTitle.textContent = 'League finished';
    el.matchScore.textContent = 'All 6 matches played.';
    appendLog('League finished. Champion: ' + league.champion + '.', false, '', true);
    renderStandings();
    renderFixtures();
  }

  function appendLog(head, isError, detail, isMatchEnd) {
    var empty = el.matchLog.querySelector('.empty');
    if (empty) empty.remove();
    var div = document.createElement('div');
    div.className = 'log-entry' + (isMatchEnd ? ' match-end' : '');
    var headEl = document.createElement('div');
    headEl.className = 'log-head';
    headEl.textContent = head;
    if (isError) headEl.style.color = 'var(--bad)';
    div.appendChild(headEl);
    if (detail) {
      var detailEl = document.createElement('div');
      detailEl.className = 'log-detail';
      if (detail.indexOf('[SIMULATED') !== -1) {
        var parts = detail.split('[SIMULATED - demo mode]');
        detailEl.textContent = parts[0];
        var tag = document.createElement('span');
        tag.className = 'sim-tag';
        tag.textContent = ' SIMULATED (demo mode)';
        detailEl.appendChild(tag);
        if (parts[1]) detailEl.appendChild(document.createTextNode(parts[1]));
      } else if (detail.indexOf('[FORFEIT]') !== -1) {
        var fparts = detail.split('[FORFEIT]');
        detailEl.textContent = fparts[0];
        var ftag = document.createElement('span');
        ftag.className = 'forfeit-tag';
        ftag.textContent = ' FORFEIT';
        detailEl.appendChild(ftag);
      } else {
        detailEl.textContent = detail;
      }
      div.appendChild(detailEl);
    }
    el.matchLog.prepend(div);
  }

  /* ---------------- wire up ---------------- */

  el.customModel.addEventListener('input', refreshPickerMessage);
  el.startBtn.addEventListener('click', startLeague);
  el.nextRoundBtn.addEventListener('click', function () { playRound(); });
  el.autoBtn.addEventListener('click', autoPlay);
  el.resetBtn.addEventListener('click', resetLeague);

  initKey();
  initPicker();
  refreshControls();
})();
