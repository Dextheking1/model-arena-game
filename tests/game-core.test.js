'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../game-core.js');

/* ---------- move parsing ---------- */

test('parses strict JSON move', () => {
  const r = Core.parseModelMove('{"move":"rock","reasoning":"they favour scissors","confidence":0.6}');
  assert.equal(r.ok, true);
  assert.equal(r.move, 'rock');
  assert.equal(r.reasoning, 'they favour scissors');
  assert.equal(r.confidence, 0.6);
});

test('parses JSON inside a code fence', () => {
  const raw = '```json\n{"move":"paper","confidence":0.4}\n```';
  const r = Core.parseModelMove(raw);
  assert.equal(r.ok, true);
  assert.equal(r.move, 'paper');
});

test('parses JSON buried in short surrounding text', () => {
  const r = Core.parseModelMove('Here is my move: {"move":"scissors","probability":0.7} end');
  assert.equal(r.ok, true);
  assert.equal(r.move, 'scissors');
  assert.equal(r.confidence, 0.7);
});

test('normalises move case and accepts choice field', () => {
  const r = Core.parseModelMove('{"choice":"Rock","confidence":0.5}');
  assert.equal(r.ok, true);
  assert.equal(r.move, 'rock');
});

test('confidence sent as a percentage is scaled to 0..1', () => {
  const r = Core.parseModelMove('{"move":"rock","confidence":75}');
  assert.equal(r.confidence, 0.75);
});

test('confidence is clamped to 0..1', () => {
  const r = Core.parseModelMove('{"move":"rock","confidence":250}');
  assert.equal(r.confidence, 1);
});

test('missing confidence is allowed and returns null', () => {
  const r = Core.parseModelMove('{"move":"paper"}');
  assert.equal(r.ok, true);
  assert.equal(r.confidence, null);
});

test('rejects an illegal move', () => {
  const r = Core.parseModelMove('{"move":"lizard","confidence":0.9}');
  assert.equal(r.ok, false);
  assert.match(r.error, /illegal or missing move/);
});

test('rejects non JSON text', () => {
  const r = Core.parseModelMove('I choose rock, obviously.');
  assert.equal(r.ok, false);
});

test('rejects broken JSON', () => {
  const r = Core.parseModelMove('{"move": rock}');
  assert.equal(r.ok, false);
});

test('rejects empty and null responses', () => {
  assert.equal(Core.parseModelMove('').ok, false);
  assert.equal(Core.parseModelMove(null).ok, false);
  assert.equal(Core.parseModelMove(undefined).ok, false);
});

/* ---------- retry and forfeit ---------- */

test('resolveMoveAttempts uses the first legal attempt', () => {
  const r = Core.resolveMoveAttempts(['{"move":"rock","confidence":0.5}', '{"move":"paper"}']);
  assert.equal(r.ok, true);
  assert.equal(r.move, 'rock');
  assert.equal(r.attemptsUsed, 1);
  assert.equal(r.forfeited, false);
});

test('resolveMoveAttempts recovers on the retry', () => {
  const r = Core.resolveMoveAttempts(['not json at all', '{"move":"scissors","confidence":0.3}']);
  assert.equal(r.ok, true);
  assert.equal(r.move, 'scissors');
  assert.equal(r.attemptsUsed, 2);
  assert.equal(r.forfeited, false);
});

test('resolveMoveAttempts forfeits after two illegal answers', () => {
  const r = Core.resolveMoveAttempts(['nope', '{"move":"spock"}']);
  assert.equal(r.ok, false);
  assert.equal(r.forfeited, true);
  assert.equal(r.attemptsUsed, 2);
});

/* ---------- round rules ---------- */

test('decideRound covers all win, loss and draw cases', () => {
  assert.equal(Core.decideRound('rock', 'scissors'), 'a');
  assert.equal(Core.decideRound('scissors', 'paper'), 'a');
  assert.equal(Core.decideRound('paper', 'rock'), 'a');
  assert.equal(Core.decideRound('scissors', 'rock'), 'b');
  assert.equal(Core.decideRound('paper', 'scissors'), 'b');
  assert.equal(Core.decideRound('rock', 'paper'), 'b');
  assert.equal(Core.decideRound('rock', 'rock'), 'draw');
  assert.equal(Core.decideRound('paper', 'paper'), 'draw');
  assert.equal(Core.decideRound('scissors', 'scissors'), 'draw');
});

test('decideRound handles forfeits', () => {
  assert.equal(Core.decideRound(null, 'rock'), 'b');
  assert.equal(Core.decideRound('rock', null), 'a');
  assert.equal(Core.decideRound(null, null), 'draw');
});

/* ---------- tournament progression ---------- */

test('fixtures are a full round robin for 4 players', () => {
  const fixtures = Core.createFixtures(['m1', 'm2', 'm3', 'm4']);
  assert.equal(fixtures.length, 6);
  const pairs = fixtures.map((f) => [f.a, f.b].sort().join(' vs '));
  assert.equal(new Set(pairs).size, 6);
});

test('createLeague rejects anything but 4 players', () => {
  assert.throws(() => Core.createLeague(['m1', 'm2', 'm3']), /exactly 4/);
});

test('a match finishes after 5 rounds and awards 3 league points', () => {
  const league = Core.createLeague(['m1', 'm2', 'm3', 'm4'], 5);
  for (let i = 0; i < 5; i++) {
    Core.recordRound(league, 0, { moveA: 'rock', moveB: 'scissors' });
  }
  const match = league.fixtures[0];
  assert.equal(match.finished, true);
  assert.equal(match.winner, 'm1');
  const s1 = league.standings.find((s) => s.player === 'm1');
  const s2 = league.standings.find((s) => s.player === 'm2');
  assert.equal(s1.leaguePoints, 3);
  assert.equal(s2.leaguePoints, 0);
  assert.equal(s1.roundsWon, 5);
  assert.equal(s2.roundsLost, 5);
  assert.equal(league.currentMatch, 1);
});

test('a drawn match gives 1 league point each', () => {
  const league = Core.createLeague(['m1', 'm2', 'm3', 'm4'], 5);
  for (let i = 0; i < 5; i++) {
    Core.recordRound(league, 0, { moveA: 'paper', moveB: 'paper' });
  }
  const s1 = league.standings.find((s) => s.player === 'm1');
  const s2 = league.standings.find((s) => s.player === 'm2');
  assert.equal(s1.leaguePoints, 1);
  assert.equal(s2.leaguePoints, 1);
  assert.equal(league.fixtures[0].winner, null);
});

test('recording a round in a finished match throws', () => {
  const league = Core.createLeague(['m1', 'm2', 'm3', 'm4'], 5);
  for (let i = 0; i < 5; i++) Core.recordRound(league, 0, { moveA: 'rock', moveB: 'rock' });
  assert.throws(() => Core.recordRound(league, 0, { moveA: 'rock', moveB: 'rock' }), /already finished/);
});

test('forfeits are counted in the standings', () => {
  const league = Core.createLeague(['m1', 'm2', 'm3', 'm4'], 5);
  for (let i = 0; i < 5; i++) {
    Core.recordRound(league, 0, { moveA: 'rock', moveB: null, forfeitB: true });
  }
  const s2 = league.standings.find((s) => s.player === 'm2');
  assert.equal(s2.forfeits, 5);
  assert.equal(s2.roundsLost, 5);
});

test('a full scripted league crowns the dominant model as champion', () => {
  const players = ['alpha', 'beta', 'gamma', 'delta'];
  const league = Core.createLeague(players, 5);
  // alpha always plays rock, everyone else always plays scissors,
  // and in matches without alpha the first listed player plays paper.
  while (!league.finished) {
    const idx = league.currentMatch;
    const match = league.fixtures[idx];
    while (!match.finished) {
      let moveA;
      let moveB;
      if (match.a === 'alpha') { moveA = 'rock'; moveB = 'scissors'; }
      else if (match.b === 'alpha') { moveA = 'scissors'; moveB = 'rock'; }
      else { moveA = 'paper'; moveB = 'scissors'; }
      Core.recordRound(league, idx, { moveA, moveB });
    }
  }
  assert.equal(league.finished, true);
  assert.equal(league.champion, 'alpha');
  const sorted = Core.sortStandings(league.standings);
  assert.equal(sorted[0].player, 'alpha');
  assert.equal(sorted[0].leaguePoints, 9);
  assert.equal(sorted[0].matchWins, 3);
  league.standings.forEach((s) => assert.equal(s.played, 3));
});

test('standings tiebreak falls to round difference', () => {
  const standings = [
    { player: 'x', leaguePoints: 3, roundsWon: 4, roundsLost: 4, forfeits: 0 },
    { player: 'y', leaguePoints: 3, roundsWon: 6, roundsLost: 2, forfeits: 0 }
  ];
  assert.equal(Core.sortStandings(standings)[0].player, 'y');
});

/* ---------- prompt building ---------- */

test('buildPrompt includes history, score and the strict JSON instruction', () => {
  const prompt = Core.buildPrompt({
    player: 'model-a',
    opponent: 'model-b',
    matchIndex: 0,
    totalMatches: 6,
    roundNumber: 3,
    roundsPerMatch: 5,
    myRoundsWon: 1,
    opponentRoundsWon: 1,
    draws: 0,
    history: [
      { round: 1, myMove: 'rock', opponentMove: 'scissors', outcome: 'you won' },
      { round: 2, myMove: 'rock', opponentMove: 'paper', outcome: 'you lost' }
    ],
    standingsSummary: 'model-a 3 pts, model-b 0 pts'
  });
  assert.match(prompt, /You are: model-a/);
  assert.match(prompt, /opponent played paper/);
  assert.match(prompt, /Opponent move counts/);
  assert.match(prompt, /strict JSON only/);
  assert.match(prompt, /"move":"rock"/);
});

test('buildPrompt handles a first round with no history', () => {
  const prompt = Core.buildPrompt({
    player: 'model-a', opponent: 'model-b', matchIndex: 0, totalMatches: 6,
    roundNumber: 1, roundsPerMatch: 5, myRoundsWon: 0, opponentRoundsWon: 0,
    draws: 0, history: [], standingsSummary: ''
  });
  assert.match(prompt, /first round/);
});

/* ---------- demo strategy ---------- */

test('demoMove counters the most frequent opponent move', () => {
  const alwaysHigh = () => 0.99; // never triggers the random break
  assert.equal(Core.demoMove(['rock', 'rock', 'paper'], alwaysHigh), 'paper');
  assert.equal(Core.demoMove(['paper', 'paper', 'paper'], alwaysHigh), 'scissors');
  assert.equal(Core.demoMove(['scissors'], alwaysHigh), 'rock');
});

test('demoMove with no history returns a legal move', () => {
  const move = Core.demoMove([], () => 0);
  assert.ok(Core.MOVES.includes(move));
});

test('demoConfidence follows opponent predictability', () => {
  assert.equal(Core.demoConfidence([]), 0.34);
  assert.equal(Core.demoConfidence(['rock', 'rock', 'rock', 'paper']), 0.75);
});
