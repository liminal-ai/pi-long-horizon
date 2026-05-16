# Further Chunking and Brain Dumping Notes

Status: exploratory notes, not final decisions.

These notes capture working thoughts about the next evolution of chunking,
detailed-band generation, and brief-band generation after the current
component-first smooth Turn work settles. The point of this document is to keep
the thinking alive without prematurely locking the system into names, strategy
labels, schemas, or implementation patterns.

## Current Mental Model

The current implemented lower-band mechanics are deliberately fake but useful.
Closed, smooth-ready Turns are concatenated into Chunks. Each Chunk stores
`smoothText`, and the lower-band artifacts are deterministic placeholders:

- detailed keeps roughly 30 percent of the chunk text
- brief keeps roughly 5 percent of the chunk text
- both are explicitly marked as non-semantic placeholders

That proved the mechanics: Chunks exist, Chunks can be selected into lower
bands, generated output can include one lower-band message per Chunk, and smart
compact can account for the emitted lower-band material.

But the current placeholder behavior is not the desired long-term behavior.

## Direction For The Next Detailed Band

The first real improvement should still be deterministic. Before introducing
semantic compression, the system can produce a cleaner conversation-only form
from the component-first smooth Turn state.

The deterministic conversation-only representation should be generated from
the smooth component layer, not by returning to canonical/raw message text.
Canonical messages remain the source truth, but lower-band prep should use the
cleaned smooth user prompt and assistant response components, then omit
thinking and tool components from that projection.

The normal Turn definition remains: one user prompt starts a Turn, and the Turn
contains everything that happens after that prompt until the next user prompt.
The deterministic transcript should therefore normally emit one `>` user block
for the Turn, followed by zero or more `●` assistant-visible blocks. Multiple
user prompts inside one Turn should be treated as an upstream segmentation or
import issue rather than a normal transcript shape.

The deterministic pass should:

- keep user content
- keep assistant/model response content, including intermediate
  conversation-visible assistant output
- omit tool calls and tool results
- omit thinking
- preserve source order and back-and-forth shape
- use very compact speaker markers

The assistant side should not be limited to only the final assistant response
for a turn. If the assistant emits conversation-visible response text during
the turn, such as reflections between reading file slices, that text belongs in
the lower-band conversation transcript. The exclusion is for thinking and tool
exchange components, not for non-final assistant-visible text.

When multiple assistant-visible outputs occur separately, preserve them as
separate assistant blocks by repeating the `●` marker. Do not add heavier
separator banners or metadata for this first deterministic transcript shape.
If a closed Turn has a user prompt but no assistant-visible output after
thinking and tool exchange components are removed, keep the `>` user block in
the lower-band transcript rather than excluding the Turn.
If the Turn has no ready user prompt component, it should not be eligible for
lower-band chunking. The user prompt component does not have to be
model-smoothed; deterministic preserved user text is sufficient. The important
requirement is that the `>` user block can be generated from ready smooth
component state.
More generally, all smooth components required to represent the Turn must be
generated before the Turn is eligible for lower-band chunking. If lower-band
chunking or smart compact preparation reaches a Turn whose smooth state is not
ready, the system may attempt a small number of synchronous smooth-component
generation retries. Those catch-up attempts should be visible on standard
error. If the required smooth components still cannot be produced, smart
compact should stop with a specific descriptive error rather than silently
dropping visible conversation content.

The target shape is intentionally simple:

```text
> user text

● assistant text

> next user text

● next assistant text
```

This mirrors the way copied Claude Code conversations can already be visually
understood with minimal speaker notation. The goal is not to make a polished
transcript. The goal is to give future model reads the back-and-forth quickly,
without dragging tool payloads or reasoning material through the lower bands.

For now, do not overfit naming. This could later become a strategy, a component
projection, a chunk-prep artifact, or something else. The important behavior is
the deterministic conversation-only representation.

## Why This Should Happen Before Semantic Compression

The deterministic conversation-only transcript is a better input for semantic
compression than the full smooth Chunk text.

Full smooth content may include:

- tool calls
- tool results
- thinking text
- execution details
- noisy intermediate state

Those are useful in the smooth band, but they are usually not what the detailed
or brief bands need. If a model is asked to compress a full tool-heavy chunk, it
spends attention filtering the transcript before it can summarize it. If the
system filters deterministically first, the semantic compression pass starts
with a clearer conversation substrate.

The broad pipeline under discussion is:

```text
canonical messages
-> smooth components
-> deterministic conversation-only per-Turn text
-> deterministic conversation-only Chunk transcript
-> gentle semantic compression for detailed band
-> more aggressive semantic compression for brief band
```

The deterministic transcript should probably be retained as an intermediate
artifact, not treated as a throwaway prompt string. It is likely useful both for
inspection and as the source for multiple compression passes.

## Chunk Sizing Reconsideration

The current chunk assembly sizes Chunks from the smooth Turn representation.
That made sense while lower-band artifacts were simple truncations of
`chunk.smoothText`.

If the future lower-band source is conversation-only text, then sizing Chunks
from full smooth text is probably wrong. Full smooth text includes thinking and
tools, while the future detailed and brief source will omit those. Tool-heavy
Turns could force premature Chunk boundaries even though their lower-band
conversation-only representation is small.

A better direction may be:

```text
smooth components
-> deterministic conversation-only Turn artifact
-> token-count that artifact
-> build Chunks from those per-Turn artifact counts
-> concatenate those artifacts into the Chunk transcript
```

In other words, Chunk boundaries should be based on the representation the
lower-band compression system will actually consume.

Unlike the rough routing estimate described below, this count likely needs to
be stable and persisted or at least reproducibly derived with a version/hash,
because it affects durable Chunk boundaries.

The deterministic conversation-only representation should be persisted at the
per-Turn level, or persisted as an equivalent per-Turn derived record with
provenance and token count. Once Chunk boundaries are based on this
representation, it is no longer just an internal formatting step. It is the
unit that decides durable Chunk membership and should be inspectable,
refreshable, and testable in its own right.

For the next phase, lower-band-native chunk sizing appears important enough to
include in the main scope rather than defer. Real semantic detailed/brief
outputs over chunks still sized from full smooth text would make the
compression real, but over the wrong unit of memory. That would especially
distort tool-heavy or thinking-heavy sessions where the conversation-only
lower-band source is much smaller than the smooth representation.

There is also a possible later refinement where a model looks near candidate
chunk boundaries and nudges splits to preserve topical continuity. That would
move chunking beyond purely deterministic size limits. For the first real
lower-band compression epic, chunk membership should remain deterministic.
Semantic boundary judgment is out of scope for the first pass because it would
make failures harder to isolate while the transcript source, compression
prompts, routing, and artifact lifecycle are still being proven. The design
should still avoid closing the door on future inference-based boundary
refinement.

## Distinguish Two Token Count Uses

There are at least two different token-sizing questions here, and they should
not be blended.

### Chunk Boundary Counts

Chunk boundary counts decide which Turns group together. These should be based
on the deterministic conversation-only Turn representation. Because they affect
stable stored state, they likely need to be accurate enough and durable enough
to reproduce or validate Chunk membership.

The important question is not final generated-session exactness. The important
question is stable Chunk sizing against the actual lower-band source material.
Anything that drives Chunk boundaries should persist actual/proper token
counts, not estimated counts. This applies to the per-Turn conversation-only
artifact count used for lower-band-native Chunk assembly. Rough `chars / 3.5`
estimates are only for runtime routing/retry decisions and logs.

### Compression Routing Estimate

After a Chunk transcript exists, the system may need to choose which model and
reasoning/thinking level should compress it. For that routing decision, a cheap
ephemeral estimate should be enough.

The proposed estimate is:

```text
estimatedTokens = ceil(characterCount / 3.5)
```

This estimate should not be stored as token metadata. It exists only at runtime
to pick a compression lane. It is not final context accounting and should not
be confused with smart compact's generated-session token accounting.

## Compression Lanes

The model routing policy is still open. The rough idea is that the size of the
deterministic Chunk transcript determines which OpenAI OAuth-backed Codex model
and reasoning/thinking level runs the compression.

This should use the same OpenAI OAuth-backed path currently being put in place
for smoothing inference, rather than introducing a separate API-key-based
provider surface for this specific work.

Exact model choices and thresholds can be tested later. For now, the important
idea is that routing is determined after deterministic transcript assembly,
using a cheap transient size estimate.

Current shoot-from-the-hip routing proposal:

All of these lanes should use the existing GPT OAuth inference path. For this
pass, do not introduce another provider path, API-key lane, or OpenRouter-style
surface for chunk compression. The current GPT OAuth path is the only inference
path assumed to be set up for this work.

| Estimated transcript tokens | Compression lane |
| --- | --- |
| `<= 1,000` | `gpt-5.4-mini` low |
| `> 1,000` and `<= 1,500` | `gpt-5.4-mini` medium |
| `> 1,500` and `<= 2,000` | `gpt-5.4-mini` high |
| `> 2,000` and `<= 3,000` | `gpt-5.4` medium |
| `> 3,000` and `<= 4,000` | `gpt-5.4` high |
| `> 4,000` | truncate compression input to `4,000` estimated tokens for now |

For chunks over the current `4,000` estimated-token ceiling, the system should
emit a visible warning to standard error. The intent is that the operator can
notice oversized chunks during dogfood without making this a hard failure yet.
Standard error is attractive because it should briefly appear in the console,
and it can also be captured/read later when diagnosing compression behavior.

This is not meant to be final routing policy. It is a starting point for
dogfood and later model/quality tests.

Detailed and brief semantic outputs should have strong compression-size
guidance with deterministic range checks, not hard first-pass failure. The
system should estimate input and output tokens by dividing character count by
`3.5`. The source size for this calculation is the deterministic
conversation-only Chunk transcript, not full smooth text. Detailed output
targets roughly `30%` of that source size, with an acceptable range of `15%` to
`50%`. Brief output targets roughly `5%` of that source size, with an
acceptable range of `1%` to `20%`.

If an output falls outside the allowed range, deterministic retry logic should
report that the output was outside the target range, provide the accepted range
and the previous attempt's estimated size, and ask the summarization lane to
try again. Attempts 1 and 2 use the routed lane. Attempt 3 escalates to
`gpt-5.5` medium and accepts its first response regardless of size. Retries and
escalations should be logged clearly.
Retry prompts should preserve the attempt history within the active generation
session. When asking for a retry, the system should show the previous attempt,
the expected token range, and where the previous attempt landed relative to
that range. The retry should make clear what size correction is needed while
retaining the original source transcript as the grounding material.

Retry and escalation activity should be logged operationally, but the full
attempt history should not be stored in the source-of-truth Chunk state. The
Chunk should store the final accepted derived output and necessary status/error
metadata, not every retry turn.

The final accepted detailed/brief artifact should stay lean. Do not store model
selection, reasoning effort, prompt version, routing estimates, estimated token
counts, compression ratios, escalation details, or retry history on the
source-of-truth artifact record. Those details can be kept in operational logs.
The artifact record should store the final derived text and the minimum
readiness/status/error data needed by the runtime. The minimum stored state is
likely an explicit status (`ready`, `failed`, `pending`/`not_ready`), final text
when ready, last error code/message when failed, and a generated/updated
timestamp if useful for operator visibility.

Before implementing the final compression behavior, run an evaluation pass
similar to the smoothing-inference exploration. The eval should use real
conversation-only Chunk transcripts across the proposed size ranges and compare
actual outputs. The goal is to measure:

- compression quality
- factual/intent accuracy
- token usage
- latency/speed
- whether the selected model/reasoning lane is sufficient
- prompt behavior and prompt variants

The routing thresholds and prompt should be adjusted from those measurements
rather than treated as settled from the initial table.

The initial eval/calibration work is expected to be a paired human+agent
activity, likely with the user and this agent or another GPT-5.5 agent working
through real smoothed Turns and Chunks, trying different models, prompts, and
size ranges until the basic behavior is credible. This should produce useful
test fixtures and evidence, but it should not be over-formalized as a separate
runtime product surface before the first implementation pass.

A full eval harness may be premature for this epic. Product fit and summary
quality will initially depend on human dogfood judgment, feel, and comparative
review more than on raw eval metrics. Formal evals become more useful once the
lower-band product surface is coherent enough that metrics can produce
decision-ready signal for prompt/model changes.

Operational inspection is still in scope for the first real lower-band
compression epic. This is distinct from formal eval. The operator should be
able to see which closed Chunks are lower-band-ready, whether the deterministic
conversation-only transcript exists, whether detailed and brief outputs exist
or failed, the last error summary for failures, whether smart compact had to
perform synchronous catch-up generation, and which Chunk/band blocked compact
if preparation fails. Automatic quality scoring, model comparison dashboards,
and formal eval reporting can wait.

For this phase, polished migration of existing placeholder lower-band Chunk
state is not required. Existing PI sessions may be cleared, and a new
long-horizon dogfood session can be built up under the new mechanics. Previous
migration effort has been useful, but this chunking basis changes enough that a
fresh session is acceptable. The system should still avoid silently treating
old deterministic placeholder outputs as valid real semantic lower-band
outputs.

The fresh long-horizon dogfood session should not become a formal epic
acceptance path. It is useful calibration and practical validation work, but
the epic should not require a specific dogfood scenario as part of its formal
requirements.

## Detailed And Brief Relationship

The deterministic conversation-only Chunk transcript is likely the source for
both lower-band outputs:

- detailed: gentle semantic compression
- brief: more aggressive semantic compression

The brief output should probably not be generated from the detailed output by
default. Generating both from the deterministic transcript keeps both outputs
anchored to the same cleaner source material and avoids compounding omissions
from one compression pass into another.

Because detailed and brief share the same deterministic source transcript, they
may be generated as sibling model calls. In practice, this could mean firing off
two inference requests at the same time, likely using the same routed model and
reasoning/thinking lane but with different prompts:

- one prompt produces the gentler detailed-band compression
- one prompt produces the more aggressive brief-band compression

Both outputs should be stored back on Chunk state as derived artifacts owned by
the source-of-truth thread data. The deterministic transcript remains the
shared source for both outputs, while the detailed and brief artifacts capture
two different compression levels over that source.

That does not settle the final prompting or implementation shape. It only
captures the current intuition: keep an uncompressed deterministic transcript,
then generate multiple lower-fidelity views from it.

Both detailed and brief semantic compression should be included in the first
real lower-band compression epic. They share the deterministic chunk transcript
source and the provider/routing substrate, so splitting brief into a later epic
would duplicate the core machinery and leave the lower-band system half-real.
Brief should still be treated as its own lane, not as "shorter detailed": it
needs separate prompts, separate quality expectations, and separate evaluation
coverage.

Detailed and brief should use the same lower-band Chunk structure and the same
deterministic conversation-only Chunk transcript as source. Their output
compression targets and prompts differ, but they should not have separate
Chunk groupings in this epic.

The deterministic conversation-only lower-band Chunk transcript should not
replace the existing smooth text representation. Smooth text remains its own
band/source representation. Lower-band transcript state is separate and exists
because detailed/brief compression consume a different conversation-only view.

## Open Questions

- Should the conversation-only Turn artifact be stored directly on each Turn,
  on Chunk state, or in a separate derived-artifact area?
- Should Chunk membership be rebuilt from conversation-only Turn counts, or
  should there be a migration path from existing smooth-sized Chunks?
- What level of exactness is required for per-Turn conversation-only counts?
- How should multi-assistant conversations eventually be represented beyond
  the simple `●` marker?
- Should detailed compression preserve turn boundaries, or is the whole Chunk
  compressed as a continuous conversation?
- What inspection surfaces are needed so a human can compare full smooth,
  conversation-only transcript, detailed compression, and brief compression?
- How much of this should be implemented before the model-backed semantic pass?

## Readiness, Freshness, And Closed Chunk Immutability

The current implementation has some closed-Chunk derived-state refresh behavior:
closed Chunks can refresh their smooth text from source Turns and clear lower
band placeholders if the materialized smooth text changes. That behavior should
not be treated as an intentional product invariant without review. It may be an
agent-added implementation convenience rather than an explicit design decision.

The desired direction is simpler:

- canonical messages are not rewritten during normal operation
- closed Chunk membership should not be edited in place
- derivation recipe changes should be handled as migrations or rebuilds, not
  as ordinary "stale artifact" refresh
- if a Chunk needs to be rebuilt under new chunking rules, the old Chunk should
  go away or be superseded by a newly created Chunk structure rather than have
  membership silently changed
- record-level state should stay as simple as possible: a message, Turn, or
  Chunk should indicate whether all required derived outputs for that record
  are present and usable

For the first real lower-band compression epic, avoid introducing a complicated
per-artifact freshness matrix unless a real runtime transition needs it.
Inspection can still report which derived outputs are present, missing, failed,
or degraded, but smart compact readiness should probably remain a simple
record-level question.

The normal generation point for lower-band Chunk outputs should be Chunk close.
When a Chunk closes, the system should generate or persist the deterministic
conversation-only Chunk transcript and then trigger async or alternate-worker
generation for the semantic detailed/brief outputs for that Chunk. Model-backed
compression should not have to block the deterministic close path. If async
semantic generation fails, it should retry a small number of times before
recording a failed/not-ready state.

If a selected Chunk is missing required lower-band output, smart compact may
attempt a synchronous catch-up generation for the missing output. This is an
abnormal repair path, not the expected steady state. It should write a visible
standard-error warning so the operator can see that selected lower-band text had
to be regenerated during compact preparation. If the required output still
cannot be generated, smart compact should fail with a specific error identifying
which Chunk and band could not be produced.

After this epic, selected lower-band outputs should not silently fall back to
deterministic placeholder truncation. If detailed or brief generation fails
after retries and catch-up generation cannot produce the selected band, the
Chunk remains not ready for that band and smart compact fails specifically.
Placeholder fallback may be considered later only as an explicit
operator-controlled degraded mode, not as the default behavior.

Stronger constraint: the new real lower-band capabilities should replace the
old deterministic placeholder generation path. Do not keep placeholder
generation as a backward-compatibility shim, silent fallback, or normal degraded
mode. Backward compatibility to useless mocks creates false green paths and
prevents testing the proper functioning of the real system. This application
currently has no external users requiring compatibility with placeholder
outputs, so the mock path should be removed or made impossible to select as
runtime lower-band behavior.

Tests that currently assert deterministic placeholder detailed/brief behavior
should be removed or rewritten around the real lower-band functionality. The
test suite should fail if the old placeholder path remains reachable as normal
runtime behavior. Unit tests can still mock boundaries where appropriate, but
the new inference integrations need a small number of full integration tests as
part of higher-order sign-off. These integration tests should prove the real
GPT OAuth-backed path can run end-to-end for the basic detailed/brief cases;
they do not need to cover every edge case or become brittle quality evals.
The integration tests should be genuinely integrated: they should exercise the
real GPT OAuth-backed inference path end-to-end rather than replacing it with an
in-process service mock.

The real integration tests should run through a separate verification command
or test group rather than the normal fast in-process test loop. Other products
have used a shape like `verify-green` for in-process/service-mock tests and
`verify-all` for the full gate, but the exact command names should follow this
repo. Story acceptance should require both groups: the fast in-process tests
and the curated full integration tests. The integration group should fail when
required integrations, OAuth credentials, network access, or model wiring are
not configured correctly; it should not silently skip the core integration
surface.
Every story in the epic should require both verification levels to pass as part
of acceptance once the commands/test groups exist. The exact command names are
not decided here; they should be discovered from or added to this repo during
Tech Design/implementation.

The fast/default verification bucket should not be understood as narrow
function-by-function unit tests. It should primarily contain AC-level service
mock tests: in-process tests that enter through meaningful service or command
surfaces, mock only external calls, and exercise as much of the required logic
pathway for each acceptance criterion as practical. These tests balance fast
iteration, broad code-path coverage, and high signal that the feature behavior
is correct and coherent. The full integration bucket should be smaller and
should prove that real component connections, external inference wiring, OAuth
configuration, and tested-environment assumptions actually work.

## Current Takeaway

The emerging shape is:

1. Finish component-first smooth Turn mechanics.
2. Build a deterministic conversation-only per-Turn representation from those
   components.
3. Size Chunks from that representation instead of full smooth text.
4. Store or reproducibly derive the deterministic Chunk transcript.
5. Use that transcript for both gentle detailed compression and aggressive
   brief compression.
6. Use cheap ephemeral token estimates only for compression-model routing.

Nothing here is final. This is the working direction to revisit once the smooth
component work has landed and the current failing tests/fixtures have been
reconciled.
