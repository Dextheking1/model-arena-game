# Model Arena

[![Made with pollinations.ai](https://raw.githubusercontent.com/pollinations/pollinations/main/packages/ui/src/brand/badge-made-with.svg)](https://pollinations.ai/?ref=badge)

A game AI models play themselves.

Four language models play a rock-paper-scissors league against each
other on Pollinations. Nobody plays for them. Every move in every round
is a real model call: the model gets the full match history, the match
score, its opponent's move counts and the league standings, and it
answers with its own move, its own one-line reasoning, and its own
estimate of its chance of winning the round.

Built for Pollinations quest #19176, "A game that AI models play".

## The game

- Pick any 4 Pollinations models. A custom model id can be used too.
- Round robin league: 6 matches, every pair meets once.
- Each match is 5 rounds of rock-paper-scissors.
- Win a match: 3 league points. Drawn match: 1 point each.
- Tiebreaks: round difference, then rounds won, then fewest forfeits.
- After the last match the leader is crowned champion.

Why rock-paper-scissors: the rules fit in one line, so the whole game
is the models reading each other. A model that repeats itself gets
countered. A model that tracks the opponent's habits and adapts wins.
Every decision is legible: you see the move, the reasoning the model
gave for it, and the probability it put on itself, side by side with
what actually happened.

## How models play

For each move the app calls:

```
POST https://gen.pollinations.ai/v1/chat/completions
```

with the visitor's own key. The prompt carries the complete game
state and asks for strict JSON only:

```json
{"move":"rock","reasoning":"one short sentence","confidence":0.5}
```

`confidence` is the model's own probability of winning the round,
which matches how Pollinations decision models answer: a choice and
a probability.

Move handling:

- The response is parsed strictly. Code fences and short surrounding
  text are tolerated, the move and numbers are validated.
- An illegal or unparsable answer gets exactly one retry, with the
  error spelled out in the retry prompt.
- A second illegal answer forfeits the round to the opponent.
- Reasoning models are called with `reasoning_effort: "low"` and a
  generous `max_tokens`, so they return a move instead of timing out
  on their own thinking.

Both models in a round are called in parallel, so neither sees the
other's current move. They only see history.

## Bring your own Pollen (BYOP)

- Paste your Pollinations secret key (sk_...) in the app.
- The key is stored only in your browser, in localStorage.
- Requests go only to gen.pollinations.ai. There is no backend, no
  tracking, and no other host is called.
- The Validate button checks the key against `/account/balance` and
  shows your Pollen balance.
- Cost: one league is 60 small chat calls (plus the odd retry). On the
  default lineup each call costs a tiny fraction of 1 Pollen.

## Demo mode

No key? The arena still runs. In demo mode moves are simulated
locally by a simple counter-strategy, and every simulated move is
labelled as simulated in the banner, the fighter cards and the match
log. Demo mode never pretends to be a model call.

## Run it

It is a plain static site. No build step, no dependencies.

```
python3 -m http.server 8000
```

then open http://localhost:8000, or deploy the folder to any static
host such as GitHub Pages.

## Files

- `index.html` - the page
- `styles.css` - styling
- `app.js` - browser UI, key handling, model calls, live log
- `game-core.js` - game rules, move parsing, scoring, tournament
  progression, prompt building. Shared by the page and the tests.
- `tests/game-core.test.js` - automated tests for the core logic
- `SUBMISSION.md` - the app submission text for quest #19176

## Tests

```
npm test
```

29 tests cover move parsing (strict JSON, code fences, illegal
moves, confidence scaling), the retry and forfeit rule, round
scoring, league points, tiebreaks, full tournament progression to a
champion, prompt building and the demo strategy.
