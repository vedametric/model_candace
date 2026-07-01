# Troll / zero-intent detector

> **Status: BUILT & shipped in shadow mode.** Every tunable lives in
> `bots.settings.troll` (admin-editable, no redeploy). The numbers quoted below
> are the seeded defaults — the live values are whatever the admin panel holds.
>
> **What shipped**
> - **Config store:** `bots.settings.troll` seeded on `candace_summers` +
>   `candace_telegram` (`automation/supabase/troll_detector.sql`), `shadow_mode:
>   true` by default so it observes without changing behaviour until armed.
> - **RPC:** `dm_ingest` now returns `settings`; new `dm_set_troll(slug, troll)`
>   merge-writes config without clobbering `spice`/other keys.
> - **Responder** (`automation/n8n/candace_manychat_async.json`): new **Troll
>   Gate** code node after Classify, a **Penalty?** IF + **Wait (penalty)** node
>   before the send (delay penalty), classifier now emits `zero_intent`, `DB:
>   get fan` returns prior troll state, `Apply Profile` persists
>   `troll_score`/`stall_hits`/`troll_mode` into `fans.metadata`. Ghost mode =
>   the gate returns `[]` (no reply = no-response penalty).
> - **Admin API** (`candace_admin_api.json`): `GET /candace-admin-config` +
>   `POST /candace-admin-config-set`.
> - **Admin panel:** `automation/test/candace_troll_config.html` — pick a bot,
>   edit every knob, Save. Shows shadow/armed state.
>
> **To arm it:** open the panel, set `shadow_mode` → off for `candace_summers`.
> **Known v1 limit:** a *ghosted* turn doesn't persist its own score bump (the
> gate short-circuits before the profiler), so the admin panel shows the
> last-replied verdict; behaviour still self-sustains via the sticky score.

---

## Original design sketch (rationale)

Retro from the `@lucas.thornton23` thread: he clocked the bot in the first
minute, never intended to buy or move to Telegram, and kept it performing for
~4 hours by dangling fake money ("1000 dollar aus?"), demanding it perform first
("talk dirty then i'll sign up"), and running a stall loop ("can't sign in",
"i've just been busy", "give me a second chance"). A human read it in seconds
and shut him down; the bot happily funneled forever because its per-message
classifier reads **persistence as interest**.

## The core problem

The live responder (`candace_manychat_async.json`) has two brains:

- **Classify (per turn):** reads the *latest* message → archetype / intent /
  effort / funnel / directive. Stateless across turns, so mockery + a fresh
  "wants_more" flirt re-triggers the funnel every time.
- **Profiler (post-reply):** can already tag `tire_kicker` / `lost` and an
  `intent_score`, and writes them to `fans.metadata`. But **nothing consumes
  that verdict** — the next turn's classifier ignores it and replies in full.

So we label the troll but never change behaviour. The fix is a **stateful gate**
between Classify and Build Messages that (a) accumulates a sticky `troll_score`
across turns, (b) picks a response *mode*, and (c) can spend a **delay penalty**
or a **no-response penalty** instead of a reply.

## Signals (mapped to lucas)

Accumulated per turn into a rolling score in `fans.metadata`. Cheap regex/logic
in a Code node + one boolean added to the existing classifier call (no new LLM
cost).

| Signal | Detect | lucas evidence | weight |
|---|---|---|---|
| **bot-test repeat** | calls it ai/bot/"a phone" *after* turn 1 | "lol are you ai", "your a bot", "ai cunt", "fucking phone" | +12 each, escalating |
| **mockery** | laugh emoji / "your bad asl" / sarcasm while "flirting" | "but your bad asl ngl", 😂 🤪 | +10 |
| **perform-first quid pro quo** | "do X first then i'll add/pay/sign up" | "sweet talk me and then i'll be able to sign up", "talk dirty to me before i send money" | +12 |
| **empty escalating money** | rising $ offers with zero action | "$100"→"1000 dollar aus?"→"i'll give you whatever" but never moves | +10 |
| **stall loop after funnel** *(see below)* | telegram given, keeps messaging with excuses, no conversion | "can't sign in", "been busy", "give me a second chance" | +15 each |
| **proof demands** | "send a photo right now or your ai" | "if your not ai send a photo of ur face right now" (x3) | +8 |
| **nonsense/troll tokens** | garbage / bait phrases | "do you wanna crack", "i'll eyp instead" | +6 |
| **hostility** | insults / slurs / threats | "kill yourself", "ai cunt", "i'll report you to the police" | +60 (instant) |

**Cool-down (subtract, protects genuine-but-shy guys from false positives):**
gives a real personal disclosure (-15), takes/【claims a concrete step that
checks out (-20), sustained non-mocking effort over 2+ turns (-10). Score decays
~15%/turn so someone who genuinely turns it around recovers.

## The stall penalty (the specific ask)

The strongest lucas signal, and the cheapest to detect precisely, is the
**post-funnel stall**: once a reply has handed over `candace_summers` the fan is
already marked `stage: funnelled`. From that point:

```
if stage == 'funnelled' and inbound matches STALL_RE and not converted:
    stall_hits += 1
```

```js
const STALL_RE = /can'?t\s+(sign|log)\s*in|not\s+working|won'?t\s+(work|let)|having\s+trouble|help\s+me|been\s+busy|second\s+chance|sweet\s*talk|talk\s+dirty|tease\s+me|show\s+me|photo|prove|before\s+i\s+(send|add|sign|pay)/i;
```

Telegram demonstrably works, so the persona must **stop troubleshooting it** and
stop re-pitching. Escalation ladder keyed on `stall_hits`:

| hits | mode | behaviour |
|---|---|---|
| 1 | `cool` | normal funnelled nudge, once |
| 2 | `cool+callout` | "you keep saying that." no tech help, no re-pitch, no performing |
| 3 | `minimal` | one dry line, **delay penalty ×4–6**, reply only ~50% of the time |
| 4+ | `ghost` | **no-response penalty**: send nothing; set `ghost_until`; only a genuinely new, high-effort message re-opens the door |

Hostility short-circuits straight to `ghost` after at most one unbothered
closer. This is what "clearly telegram works" buys us: non-movement after the
funnel is treated as the tell it is, not as a support ticket.

## Response modes (from `troll_score`, stall ladder can override upward)

| band | mode | what changes |
|---|---|---|
| 0–29 | `engage` | full persona, unchanged |
| 30–59 | `cool` | shorter/cooler, **stop funneling**, no performing on demand, give less |
| 60–84 | `minimal` | one-liners only, no funnel, longer delay, reply ~1-in-2 |
| 85–100 | `ghost` | disengage: no reply (or one unbothered closer then mute) |

## Wiring into `candace_manychat_async.json`

1. **`Build Classify Request`** — add two output fields to the JSON spec (same
   call, ~free): `"zero_intent": boolean` (mocking / testing / no real interest)
   and `"zero_intent_reasons": [..]`. Add a rule: *do not funnel a guy who is
   testing or mocking you, or who has already been given telegram and not
   acted.*
2. **`DB: get fan`** — widen the select from `msg_count` to
   `msg_count,metadata,stage,buyer_type` so prior `troll_score`, `stall_hits`,
   `funnel_offers`, `ghost_until` are available this turn.
3. **NEW `Troll Gate`** (Code node, after `Classify`, before `Build Messages`) —
   compute the new score from features + prior metadata + classifier
   `zero_intent`, pick `mode`, and either emit a rewritten `directive` (+
   `no_funnel`, `extra_delay_sec`) or, for `ghost`, `return []` to send nothing
   (mirrors the `Check Latest` debounce pattern).
4. **`Build Messages`** — if the gate set a directive/mode, use it and suppress
   the `funnelled` STAGE NOTE when `no_funnel` is true.
5. **Optional `Wait (penalty)`** — a second Wait node before `ManyChat: send
   reply`, keyed on `extra_delay_sec`, for the delay penalty. (A pre-wait
   penalty on the *next* turn is also possible but needs `troll_score` returned
   from `dm_ingest`; the post-classify delay needs no RPC change.)
6. **`Apply Profile`** — persist `troll_score`, `stall_hits`, `funnel_offers`,
   `mode`, `ghost_until` into `metadata` so the verdict is sticky and the
   dashboard can show it.

### `Troll Gate` node (sketch)

```js
// after Classify (OpenAI). Reads classifier json + context + prior metadata.
const ctx  = $('DB: ingest').first().json || {};
const fan  = ($('DB: get fan').first().json || [])[0] || {};
const prev = fan.metadata || {};
const recent = Array.isArray(ctx.recent) ? ctx.recent : [];
const last = (recent.length ? recent[recent.length-1].content : '') || '';
const stage = ctx.stage || fan.stage || 'rapport';

let cls = {};
try { cls = JSON.parse($json.choices[0].message.content); } catch(e){ cls = {}; }

const t = String(last).toLowerCase();
const laugh = /😂|🤪|🤡|lmao|lol you|your bad|ur bad/.test(last);
const botTest = /\b(are you|ur|your|youre|you'?re)\s*(a\s*)?(ai|bot|robot|fake|real)\b|a\s*phone|ai\s*(cunt|bitch)/i.test(last);
const proof = /send.*(photo|pic|face)|prove|or (else )?(your|ur) ai/i.test(last);
const performFirst = /(before i|then i'?ll|first).*(add|sign|pay|send)|(talk dirty|sweet talk|tease me|show me).*(first|then)/i.test(last);
const money = /\$?\s*\d{2,}\s*(dollar|aud|aus|bucks|usd)|give you.*(money|whatever)/i.test(last);
const hostile = (cls.intent === 'insult') || /kill yourself|cunt|pathetic|report you|scam/i.test(last);
const STALL_RE = /can'?t\s+(sign|log)\s*in|not\s+working|won'?t\s+(work|let)|having\s+trouble|help\s+me|been\s+busy|second\s+chance|sweet\s*talk|talk\s+dirty|tease\s+me|show\s+me|photo|prove|before\s+i\s+(send|add|sign|pay)/i;

let score = Math.round((prev.troll_score || 0) * 0.85);   // decay
let stall = prev.stall_hits || 0;
const funnelled = stage === 'funnelled' || stage === 'converted';

if (botTest && (ctx.count || 0) > 3) score += 12;
if (laugh) score += 10;
if (performFirst) score += 12;
if (money && funnelled) score += 10;      // dangling cash but not moving
if (proof) score += 8;
if (cls.zero_intent === true) score += 15;
if (funnelled && STALL_RE.test(last)) { stall += 1; score += 15; }
if (hostile) score = Math.max(score, 90);
score = Math.max(0, Math.min(100, score));

// mode: score band, but stall ladder can force it worse
let mode = score >= 85 ? 'ghost' : score >= 60 ? 'minimal' : score >= 30 ? 'cool' : 'engage';
if (stall >= 4) mode = 'ghost';
else if (stall === 3 && mode === 'engage') mode = 'minimal';
else if (stall === 2 && mode === 'engage') mode = 'cool';

// no-response penalty
if (mode === 'ghost') return [];   // send nothing this turn

const directiveByMode = {
  cool:    'he is likely wasting your time. cooler and shorter, give less, do NOT offer telegram again, do NOT perform on demand, do NOT help him with any app. one dry statement.'
           + (stall >= 2 ? ' call it out once, lightly: he keeps saying that.' : ''),
  minimal: 'he is a confirmed time waster. one short flat line, unbothered. no telegram, no performing, no help, no questions.',
  engage:  cls.directive || 'stay cool and playful, be the prize, keep it short.'
};

const extra_delay_sec = mode === 'minimal' ? (120 + stall*90) : mode === 'cool' ? 45 : 0;

return [{ json: {
  ...$json,                              // keep the OpenAI classify payload for Build Messages
  gate: {
    mode,
    troll_score: score,
    stall_hits: stall,
    no_funnel: mode !== 'engage',
    directive: directiveByMode[mode],
    extra_delay_sec
  }
}}];
```

`Build Messages` then prefers `gate.directive` when present and skips the
funnelled STAGE NOTE if `gate.no_funnel`. `Apply Profile` merges `gate` fields
into `metadata`.

## Guardrails against false positives

- **Conservative by design:** single signals rarely cross 30; it takes
  *repetition over turns* (mockery + non-movement) to escalate, which is what
  separates a troll from a shy-but-real buyer.
- **Recovery path:** the 15%/turn decay + cool-down credits mean a guy who
  actually goes quiet-then-genuine climbs back to `engage`.
- **Never argue / never confirm bot:** `ghost` is silence, not a comeback;
  hostility is met with at most one unbothered closer.
- **Human override:** persist `mode`/`troll_score` to `metadata` so the console
  can see it and a human can force-engage or hard-block.

## Rollout

Ship the gate in **shadow mode first**: compute and persist `troll_score` /
`mode` but keep replying normally, so you can eyeball a week of real threads and
tune weights/bands before letting it change behaviour or ghost anyone.
