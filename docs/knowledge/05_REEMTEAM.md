# ReemTeam

Status: APPROVED / CANONICAL
Owner: Drew / DFB
Approved: 2026-10-05

## Product identity

ReemTeam is a DFB-owned social card-game and gaming/community IP built around the Reem card game. It should become more than a basic card-table app: the target is a recognizable social gaming culture with a trustworthy rules engine, table identity, competition, persistent player identity, community, content, and multiple monetization paths.

The experience should feel like pulling up to somebody's crib to play cards, not entering a sterile casino interface.

Core principle: if ReemTeam becomes technically impressive but stops feeling like sitting at the table playing Reem, DFB built the wrong product.

## Canonical rules

The following are locked unless Drew explicitly changes them.

Deck:
- 40-card deck.
- Ace = 1.
- J/Q/K = 10.

Hand:
- 5 cards per player.

Turn order:
DRAW -> optional SPREAD/HIT -> DISCARD.

Drop:
- A player may Drop only before drawing.

Sets:
- 3–4 cards of the same rank.

Runs:
- 3+ cards of the same suit.
- Ace is low.

Hitting:
- Players may hit existing spreads.
- First hit creates a 2-round lock.
- Each additional hit adds +1 round to the lock.

Reem:
- Reem ends the game immediately.
- Reem pays double stake/value.

Automatic wins:
- Dealt 50 = single-stake automatic win.
- Dealt 47 = single-stake automatic win.
- 41 on first turn = triple-stake win.
- 11 or under on first turn = triple-stake win.

Game endings:
- Reem,
- resolved Drop,
- stock exhaustion.

If stock is exhausted, lowest point total wins.

These rules belong in canonical rules records and versioning, not regenerated from model memory.

## Rules engine principles

Rules logic must remain separate from presentation so the same engine can support web, mobile, 2D, Unreal/3D, AI simulations, replay, tournaments, and spectators.

The engine should determine legal actions, turn order, scoring, sets/runs, hits, locks, Drop, Reem, stock exhaustion, and winners independently of UI.

Where possible, game behavior should be deterministic from shuffled deck + player actions + rules version. Preserve event history for replay, debugging, verification, simulation, and dispute resolution.

Match/event history should record meaningful events such as game creation, shuffle/deal, draws, spreads, hits, discards, Drop/Reem, disconnects, and result.

## Brand and social identity

Core framing: Pull Up To The Crib.

Conceptual rooms/environments include:
- Pull Up To The Crib — primary social/lobby identity.
- Quick Smoke — fast/casual play.
- Friday Night Reem — social/event competitive atmosphere.
- Crown Room — higher-prestige environment.

These should eventually differ through environment, lighting, music, spectators/social energy, progression/access, and visual identity rather than acting only as menu labels.

Original table design included ten tables: two each at $1, $5, $10, $20, and $50 with up to four seats. Preserve this as historical/current product design while separating any real-money implementation from the core product because legal/platform/compliance requirements may limit cash play.

## Real-money separation

Core product = Reem game + social platform.
Competitive economy = points, progression, rankings, events, virtual values.
Real-money play = separate legal/business track requiring explicit analysis of law, licensing, age, geography, payments, platform rules, risk, compliance, and approval.

The product should remain viable even without unrestricted cash tables.

## Table experience

Players should clearly understand turn, cards, legal actions, table spreads, hit eligibility, lock status, Drop availability, stake/value, game history, and result without the UI feeling like a spreadsheet.

Important identity features:
- Table Pulse: communicates tension/momentum/important plays and may later feed HUD, spectators, highlights, and commentary.
- Receipt UI: result breakdown with winner, ending type, final hands/points, stake/value, Reem multiplier, net result, and important plays.
- Run It Back: quick rematch flow that preserves the social table experience.

## 3D crib direction

ReemTeam continues toward a 3D social-table experience in Unreal.

Core components:
- crib environment,
- table/chairs,
- avatars,
- card interactions,
- sit/stand,
- movement and movement lock during active table play,
- camera behavior,
- table HUD,
- social/lobby spaces.

Gameplay state and social state are distinct. While seated in an active game, movement should be appropriately constrained and the table prioritized. Outside games, movement supports social presence and discovery.

## Player identity and avatars

Player accounts should eventually include username/profile, avatar, game history, wins/losses, Reems, Drops, streaks, ranking/rep, achievements, cosmetics, social relationships, eligible rooms/tables, and moderation state.

Player profile should tell a competitive story rather than only show total wins.

Avatar roadmap:
- v1: presets,
- later: clothing, accessories, hairstyles, emotes, table animations, reactions, badges, frames, and social customization.

Cosmetics should not provide unfair gameplay advantage.

## Seats and game state

Seat positions are stable game entities during a hand: Seat 1–4. Player account and seat are not the same concept. Stable seats support turn order, replay, spectators, AI, debugging, and results.

## AI players

AI should fill empty seats, support solo practice, teach rules, simulate games, test rules, and eventually express different play styles.

AI must operate through the same legal-action interface as humans and should not receive hidden cheating information outside explicit debug/test modes.

Potential behavior styles include aggressive, conservative, Drop-heavy, risk-taking, spread-focused, hit-focused, or other tactical personalities.

Use large-scale AI simulation to detect impossible states, rules bugs, game-length distribution, scoring edge cases, lock issues, stock-exhaustion behavior, and strategy patterns.

## Multiplayer architecture

The server should be authoritative for meaningful game state. Clients request actions; server/rules engine validates; state updates; result broadcasts.

Clients do not decide their own cards, legality, winner, score, or Drop success.

Historical technical foundation includes React, Node, MongoDB, Socket.IO, Redis, PWA functionality, and later Unreal-based client work. Preserve useful backend/platform concepts instead of assuming Unreal invalidates them.

Reconnect, AFK, leave/rage-quit, and abandonment behavior need explicit policies that may differ between casual, ranked, tournament, and any regulated money environment.

## Game modes and progression

Potential game modes:
- Casual.
- Ranked.
- Private/invite.
- Event/tournament.
- Practice/AI.

Progression may include XP/Rep, levels, badges, room access, cosmetics, titles, seasonal ranking, and achievements.

Ranked systems must account for skill plus card randomness and should be researched/tested before implementation rather than overreacting to single-game variance.

Potential achievements: first Reem, triple win, comeback, long streak, wins across room tiers, Run It Back success, session achievements, and other authentic game moments.

## Social and community

Potential social systems:
- friends,
- recent players,
- invites,
- private tables,
- crews/groups,
- spectators,
- emotes/reactions,
- voice/chat later with moderation.

Crews may support group records, identity, events, and rivalry.

Spectator mode should support tournaments/featured tables/content while never exposing private cards to active participants.

Tournaments may support elimination, bracket, round robin, points leaderboard, crew/team events, or seasonal championships.

Seasons can provide ranked ladder, tournaments, challenges, cosmetics, leaderboards, and championship cadence.

## Content engine

Gameplay should create content candidates automatically over time:
- wild Reems,
- Drops,
- comebacks,
- high-stakes/competitive moments,
- rivalries,
- streaks,
- tournaments,
- social moments,
- strategy clips.

Shareable post-game receipts can become organic marketing. Social content should use the game's own vocabulary: Pull Up To The Crib, Run It Back, Reem, Drop, Table Pulse, Crown Room, etc.

Potential content prompts include "You dropping this hand?", "Would you hit this?", strategy debates, rankings, highlights, rivalries, tournaments, and funny table moments rather than generic download ads.

Streaming may eventually include Twitch, YouTube, featured tables, tournaments, commentary, and short-form derivatives.

## ReemTeamHQ

ReemTeamHQ should become the internal admin/CRM/operations console behind the product.

Potential areas:
- Product: releases, bugs, roadmap, development.
- Players: accounts, growth, retention, reports.
- Games: active tables, history, anomalies.
- Community: tournaments, events, moderation.
- Business: revenue, memberships/cosmetics/payments where appropriate.
- Content: major moments, clips, promotions.
- Support: player issues and disputes.

## Analytics

Track as the product matures:
- new accounts,
- DAU/WAU/MAU,
- retention D1/D7/D30,
- games/player,
- session length,
- average table fill,
- time-to-match,
- rematch rate,
- churn,
- room popularity,
- ranked/tournament participation,
- invite/referral behavior.

Early product question: do people who play want to play another game? Rematch and return behavior may matter more than raw downloads initially.

## Monetization

ReemTeam should have viable monetization independent of real-money tables. Potential lower-regulatory-risk paths:
- cosmetics,
- premium avatar assets,
- room/table themes,
- emotes/profile customization,
- season passes/memberships,
- premium social/private environments,
- sponsorship,
- carefully managed advertising,
- merchandise,
- physical Reem deck/table products,
- events/tournaments where appropriate.

No pay-to-win mechanics.

Physical branded cards can support offline adoption, merch, events, teaching, and QR links back to rules/app/community.

## Teaching new players

New players must be able to learn without Drew personally explaining the game.

Use interactive tutorial, searchable rules reference, practice AI table, and contextual legality help. Teach through play: cards/points -> draw/discard -> spreads -> sets/runs -> hits -> Drop -> Reem -> special first-turn wins.

## Rules versioning

Track ruleset version, effective date, changes, reason, and matches played under each version. Never silently change rules and leave historical match records ambiguous.

## Testing and reliability

Testing layers:
- unit rules tests,
- large AI simulation,
- multiplayer synchronization,
- reconnect/recovery,
- UI/legal-action presentation,
- play testing,
- load testing,
- abuse/exploit testing.

Anti-cheat should use server authority plus anomaly monitoring for impossible requests, suspicious patterns, collusion indicators, automation/bot behavior, and exploits without treating every unusual statistic as proof of cheating.

Moderation should support reports, evidence, queues, warnings, suspension/ban, and appeals with human judgment for significant enforcement.

## Platform architecture

Conceptual long-term layers:
RULES ENGINE -> GAME SERVER -> REALTIME/MATCH SERVICE -> PLAYER/SOCIAL SERVICES -> ECONOMY/PROGRESSION -> ANALYTICS -> clients (Unreal, Web, future mobile).

Web remains useful for accounts, rankings, profiles, tournaments, stats, rules, community, history, and marketing even if 3D gameplay lives in Unreal.

Mobile should eventually be considered because quick card sessions fit touch/mobile use, but the product does not need to solve every client platform immediately.

## FREEOS role

FREEOS should manage or assist with roadmap, canonical rules, bugs, development, testing, simulation, content, player feedback, analytics, community, tournaments, support, monetization experiments, business research, and learning.

Knowledge categories should separate:
- Canonical Rules,
- Product,
- Technical,
- Art & Brand,
- Community,
- Business,
- Analytics,
- Ideas,
- History.

Idea does not equal active feature.

## Roadmap stages

1. Core game certainty: rules engine stable, legal moves verified, AI completes games, Drop/Reem/hit locks stable, event history/replay, simulation tests.
2. Great playable table: polished interaction/HUD, receipt, Run It Back, reliable multiplayer, reconnect, private/social play.
3. 3D crib experience: avatar, lobby, sit/stand, table environments, social presence, Table Pulse, room identities.
4. Identity/progression: profiles, stats, achievements, rep, ranked, cosmetics.
5. Community: friends, invites, spectators, tournaments, crews, seasons.
6. Content engine: match highlights, receipts, streamed tables, player stories.
7. Monetization: start with cosmetics, membership, environments, merch, sponsorship; evaluate real-money play separately.

## Initial 90-day direction

Days 1–30: audit canonical rule implementation, complete automated rules tests, simulate many hands, identify edge cases, lock game-event schema, ensure AI reliably finishes games, finalize clean round/game manager. Deliverable: rules engine we trust.

Days 31–60: polish card interaction/HUD/spread-hit feedback/Drop/Reem/receipt/Run It Back/reconnect-leave behavior/basic multiplayer. Deliverable: complete-feeling playable session.

Days 61–90: polished single crib, movement, sit/stand, avatar proof, table integration, social lobby, invite/private table flow, promotional gameplay capture. Deliverable: a proof people can watch and immediately understand.

## Closed test and launch

Test with people who know Reem and people who do not. Existing players answer whether it feels like Reem; new players answer whether it is understandable and enjoyable without personal instruction.

Classify feedback as bug, usability issue, rules misunderstanding, balance concern, feature request, aesthetic preference, social request, or monetization request. Repeated patterns matter more than isolated suggestions.

Launch phases: pre-launch culture/content -> closed beta -> open beta -> full launch only after gameplay trust, onboarding, multiplayer reliability, and acceptable retention.

## Business thesis

Turn an authentic social card game into an owned digital gaming culture with competitive play, community, entertainment, and monetization while keeping the rules trustworthy and the table experience at the center. Technology should expand the culture rather than sterilize it.
