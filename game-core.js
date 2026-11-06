/*
 * Model Arena - core game logic.
 * Works in the browser (window.ModelArenaCore) and in Node (module.exports).
 * No network code lives here. The UI layer passes raw model responses in
 * and this module decides if a move is legal, who won, and who leads.
 */
(function (global) {
  'use strict';

  var MOVES = ['rock', 'paper', 'scissors'];

  var BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
  var COUNTER = { rock: 'paper', paper: 'scissors', scissors: 'rock' };

  var DEFAULT_MODELS = [
    { id: 'openai/gpt-5.4-nano', label: 'GPT-5.4 Nano' },
    { id: 'z-ai/glm-5.3-flash', label: 'GLM 5.3 Flash' },
    { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
    { id: 'moonshotai/kimi-k2.6', label: 'Kimi K2.6' },
    { id: 'mistralai/mistral-large-3', label: 'Mistral Large 3' },
    { id: 'meta/llama-3.3-70b-instruct', label: 'Llama 3.3 70B' },
    { id: 'openai/gpt-5.4-mini', label: 'GPT-5.4 Mini' },
    { id: 'x-ai/grok-4.3', label: 'Grok 4.3' }
  ];

  function normalizeMove(value) {
    if (typeof value !== 'string') return null;
    var v = value.trim().toLowerCase();
    if (MOVES.indexOf(v) !== -1) return v;
    // Accept a move named inside a short phrase, e.g. "I play rock."
    for (var i = 0; i < MOVES.length; i++) {
      if (v === MOVES[i] + '.' || v === MOVES[i] + '!') return MOVES[i];
    }
    return null;
  }

  function normalizeConfidence(value) {
    if (value === undefined || value === null || value === '') return null;
    var n = Number(value);
    if (!isFinite(n)) return null;
    if (n > 1 && n <= 100) n = n / 100; // model sent a percentage
    if (n < 0) n = 0;
    if (n > 1) n = 1;
    return Math.round(n * 1000) / 1000;
  }

  /*
   * Parse one raw model response into a move.
   * Accepts strict JSON, JSON in a code fence, or JSON buried in short text.
   * Returns { ok: true, move, reasoning, confidence } or { ok: false, error }.
   */
  function parseModelMove(raw) {
    if (raw === null || raw === undefined) {
      return { ok: false, error: 'empty response' };
    }
    var text = String(raw).trim();
    if (!text) return { ok: false, error: 'empty response' };

    var candidate = null;
    var start = text.indexOf('{');
    var end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        candidate = JSON.parse(text.slice(start, end + 1));
      } catch (e) {
        return { ok: false, error: 'response was not valid JSON' };
      }
    } else {
      return { ok: false, error: 'no JSON object in response' };
    }

    if (!candidate || typeof candidate !== 'object') {
      return { ok: false, error: 'JSON was not an object' };
    }

    var move = normalizeMove(candidate.move || candidate.choice || candidate.play);
    if (!move) {
      return { ok: false, error: 'illegal or missing move: ' + String(candidate.move || candidate.choice || '') };
    }

    var confidence = normalizeConfidence(
      candidate.confidence !== undefined ? candidate.confidence
        : candidate.probability !== undefined ? candidate.probability
        : candidate.prob
    );

    return {
      ok: true,
      move: move,
      reasoning: typeof candidate.reasoning === 'string' ? candidate.reasoning.slice(0, 280) : '',
      confidence: confidence
    };
  }

  /*
   * Retry rule, kept pure so it can be tested.
   * Given the raw responses from attempt 1 and the optional retry,
   * return the first legal move, or a forfeit if none is legal.
   */
  function resolveMoveAttempts(rawAttempts) {
    var attempts = Array.isArray(rawAttempts) ? rawAttempts : [];
    for (var i = 0; i < attempts.length; i++) {
      var parsed = parseModelMove(attempts[i]);
      if (parsed.ok) {
        parsed.attemptsUsed = i + 1;
        parsed.forfeited = false;
        return parsed;
      }
    }
    return {
      ok: false,
      forfeited: true,
      attemptsUsed: attempts.length,
      error: 'no legal move after ' + attempts.length + ' attempt(s)'
    };
  }

  function decideRound(moveA, moveB) {
    if (!moveA && !moveB) return 'draw';
    if (!moveA) return 'b'; // a forfeited
    if (!moveB) return 'a'; // b forfeited
    if (moveA === moveB) return 'draw';
    return BEATS[moveA] === moveB ? 'a' : 'b';
  }

  /* Round robin fixtures for exactly 4 players: 6 matches, each pair once. */
  function createFixtures(playerIds) {
    if (!Array.isArray(playerIds) || playerIds.length !== 4) {
      throw new Error('a league needs exactly 4 players');
    }
    var pairs = [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]];
    return pairs.map(function (pair, idx) {
      return {
        index: idx,
        a: playerIds[pair[0]],
        b: playerIds[pair[1]],
        rounds: [],
        finished: false,
        winner: null,
        leaguePointsAwarded: false
      };
    });
  }

  function emptyStanding(playerId) {
    return {
      player: playerId,
      played: 0,
      matchWins: 0,
      matchDraws: 0,
      matchLosses: 0,
      leaguePoints: 0,
      roundsWon: 0,
      roundsLost: 0,
      roundsDrawn: 0,
      forfeits: 0
    };
  }

  function createLeague(playerIds, roundsPerMatch) {
    return {
      players: playerIds.slice(),
      roundsPerMatch: roundsPerMatch || 5,
      fixtures: createFixtures(playerIds),
      standings: playerIds.map(emptyStanding),
      currentMatch: 0,
      finished: false,
      champion: null
    };
  }

  function recordRound(league, matchIndex, roundResult) {
    var match = league.fixtures[matchIndex];
    if (!match) throw new Error('no match at index ' + matchIndex);
    if (match.finished) throw new Error('match ' + matchIndex + ' is already finished');

    var winner = decideRound(roundResult.moveA || null, roundResult.moveB || null);
    var record = {
      round: match.rounds.length + 1,
      a: match.a,
      b: match.b,
      moveA: roundResult.moveA || null,
      moveB: roundResult.moveB || null,
      reasoningA: roundResult.reasoningA || '',
      reasoningB: roundResult.reasoningB || '',
      confidenceA: roundResult.confidenceA != null ? roundResult.confidenceA : null,
      confidenceB: roundResult.confidenceB != null ? roundResult.confidenceB : null,
      forfeitA: !!roundResult.forfeitA,
      forfeitB: !!roundResult.forfeitB,
      winner: winner
    };
    match.rounds.push(record);
    if (match.rounds.length >= league.roundsPerMatch) finishMatch(league, match);
    return record;
  }

  function matchScore(match) {
    var a = 0, b = 0, draws = 0;
    match.rounds.forEach(function (r) {
      if (r.winner === 'a') a++;
      else if (r.winner === 'b') b++;
      else draws++;
    });
    return { a: a, b: b, draws: draws };
  }

  function finishMatch(league, match) {
    match.finished = true;
    var score = matchScore(match);
    match.winner = score.a > score.b ? match.a : score.b > score.a ? match.b : null;

    var sa = league.standings.find(function (s) { return s.player === match.a; });
    var sb = league.standings.find(function (s) { return s.player === match.b; });
    sa.played++; sb.played++;
    sa.roundsWon += score.a; sa.roundsLost += score.b; sa.roundsDrawn += score.draws;
    sb.roundsWon += score.b; sb.roundsLost += score.a; sb.roundsDrawn += score.draws;
    match.rounds.forEach(function (r) {
      if (r.forfeitA) sa.forfeits++;
      if (r.forfeitB) sb.forfeits++;
    });

    if (!match.leaguePointsAwarded) {
      match.leaguePointsAwarded = true;
      if (match.winner === match.a) { sa.matchWins++; sb.matchLosses++; sa.leaguePoints += 3; }
      else if (match.winner === match.b) { sb.matchWins++; sa.matchLosses++; sb.leaguePoints += 3; }
      else { sa.matchDraws++; sb.matchDraws++; sa.leaguePoints += 1; sb.leaguePoints += 1; }
    }

    var next = league.fixtures.findIndex(function (f) { return !f.finished; });
    league.currentMatch = next;
    if (next === -1) {
      league.finished = true;
      league.champion = sortStandings(league.standings)[0].player;
    }
    return match;
  }

  function sortStandings(standings) {
    return standings.slice().sort(function (x, y) {
      if (y.leaguePoints !== x.leaguePoints) return y.leaguePoints - x.leaguePoints;
      var diffX = x.roundsWon - x.roundsLost;
      var diffY = y.roundsWon - y.roundsLost;
      if (diffY !== diffX) return diffY - diffX;
      if (y.roundsWon !== x.roundsWon) return y.roundsWon - x.roundsWon;
      if (x.forfeits !== y.forfeits) return x.forfeits - y.forfeits;
      return String(x.player).localeCompare(String(y.player));
    });
  }

  /*
   * The prompt sent to a model for one move. It carries the full game
   * state: league standings so far, this match score, and every move
   * both players have made in this match, so adaptation is possible.
   */
  function buildPrompt(context) {
    var lines = [];
    lines.push('You are playing in Model Arena, a rock-paper-scissors league for AI models.');
    lines.push('You are: ' + context.player + '. Your opponent is: ' + context.opponent + '.');
    lines.push('Match ' + (context.matchIndex + 1) + ' of ' + context.totalMatches +
      ', round ' + context.roundNumber + ' of ' + context.roundsPerMatch + '.');
    lines.push('Match score so far: you ' + context.myRoundsWon + ' - ' +
      context.opponentRoundsWon + ' opponent, ' + context.draws + ' drawn rounds.');
    if (context.history && context.history.length) {
      lines.push('Moves so far in this match (oldest first):');
      context.history.forEach(function (r) {
        lines.push('- Round ' + r.round + ': you played ' + (r.myMove || 'forfeit') +
          ', opponent played ' + (r.opponentMove || 'forfeit') + ' -> ' + r.outcome);
      });
      var oppMoves = context.history.map(function (r) { return r.opponentMove; })
        .filter(Boolean);
      if (oppMoves.length) {
        var counts = {};
        oppMoves.forEach(function (m) { counts[m] = (counts[m] || 0) + 1; });
        lines.push('Opponent move counts in this match: ' + JSON.stringify(counts) + '.');
      }
    } else {
      lines.push('This is the first round of the match. No moves yet.');
    }
    if (context.standingsSummary) {
      lines.push('League standings before this match: ' + context.standingsSummary + '.');
    }
    lines.push('Rules: rock beats scissors, scissors beats paper, paper beats rock. Same move is a draw.');
    lines.push('Pick your next move yourself. Try to outread the opponent from their history.');
    lines.push('Answer with strict JSON only, no other text, in exactly this shape:');
    lines.push('{"move":"rock","reasoning":"one short sentence","confidence":0.5}');
    lines.push('move must be one of rock, paper, scissors. confidence is your probability of winning this round, from 0 to 1.');
    return lines.join('\n');
  }

  /*
   * Demo mode strategy. Only used when there is no API key, and the UI
   * labels every demo move as simulated. Counters the opponent's most
   * frequent past move, with a seeded random break so matches vary.
   */
  function demoMove(opponentHistory, rng) {
    var random = typeof rng === 'function' ? rng : Math.random;
    var moves = (opponentHistory || []).filter(Boolean);
    if (!moves.length) {
      return MOVES[Math.floor(random() * 3)];
    }
    if (random() < 0.2) {
      return MOVES[Math.floor(random() * 3)];
    }
    var counts = {};
    moves.forEach(function (m) { counts[m] = (counts[m] || 0) + 1; });
    var mostFrequent = MOVES[0];
    MOVES.forEach(function (m) {
      if ((counts[m] || 0) > (counts[mostFrequent] || 0)) mostFrequent = m;
    });
    return COUNTER[mostFrequent];
  }

  function demoConfidence(opponentHistory) {
    var moves = (opponentHistory || []).filter(Boolean);
    if (!moves.length) return 0.34;
    var counts = {};
    moves.forEach(function (m) { counts[m] = (counts[m] || 0) + 1; });
    var top = Math.max(counts.rock || 0, counts.paper || 0, counts.scissors || 0);
    return Math.round((top / moves.length) * 100) / 100;
  }

  var api = {
    MOVES: MOVES,
    BEATS: BEATS,
    COUNTER: COUNTER,
    DEFAULT_MODELS: DEFAULT_MODELS,
    normalizeMove: normalizeMove,
    normalizeConfidence: normalizeConfidence,
    parseModelMove: parseModelMove,
    resolveMoveAttempts: resolveMoveAttempts,
    decideRound: decideRound,
    createFixtures: createFixtures,
    createLeague: createLeague,
    recordRound: recordRound,
    matchScore: matchScore,
    sortStandings: sortStandings,
    buildPrompt: buildPrompt,
    demoMove: demoMove,
    demoConfidence: demoConfidence
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.ModelArenaCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
