# Story 3 Manual Calibration Evidence

## Capture

- Date: 2026-05-18
- Provider path: `PiCodexLowerBandCompressionProvider`
- Provider: `openai-codex`
- Model lane: `gpt-5.4-mini`
- Reasoning effort: `low`
- Prompt versions: `lower_band_detailed_v1`, `lower_band_brief_v1`
- Command: one-off `node --import tsx --eval` invocation from repo root using the real GPT OAuth-backed provider
- Related log path: `.context-steward/debug/lower-band-compression.log`

## Conversation-Only Chunk Transcript

```text
> We need Story 3 to use the real GPT OAuth lower-band path when chunks close. Keep the close path non-blocking and keep artifact state lean.

● I found that the compression service and provider work when directly invoked, but maintenance was not constructing the scheduler in production. I am wiring async maintenance to create a lower-band scheduler, proving it with a fake slow provider, and keeping the real provider-backed tests in the default verify suite.

> Also leave manual calibration evidence so reviewers can see representative transcript, detailed output, brief output, and notes.

● I will capture a small reviewed transcript/output pair under the story artifacts and reference the provider-backed log path.
```

## Generated Detailed Output

```text
Story 3 should use the real GPT OAuth lower-band path when chunks close, with the close path remaining non-blocking and artifact state kept lean.

The issue found was that the compression service and provider already work when invoked directly, but production maintenance was not constructing the scheduler. The fix direction is to wire async maintenance so it creates a lower-band scheduler. This is being validated with a fake slow provider, while the real provider-backed tests stay in the default verify suite.

Manual calibration evidence also needs to be preserved so reviewers can inspect representative transcript, detailed output, brief output, and notes. A small reviewed transcript/output pair will be captured under the story artifacts, and the provider-backed log path will be referenced there.
```

## Generated Brief Output

```text
Story 3 should use the real GPT OAuth lower-band path on chunk close, with close remaining non-blocking and artifact state minimal. Root issue: maintenance was not constructing the scheduler in production even though direct service/provider invocation worked. Fix is to wire async maintenance to create a lower-band scheduler, validate with a fake slow provider, and keep real provider-backed tests in the default verify suite. Also capture manual calibration evidence in story artifacts: representative transcript, detailed output, brief output, notes, and reference the provider-backed log path.
```

## Review Notes

- Both outputs are free-form prose and intentionally do not preserve every `>` / `●` source marker.
- Detailed output preserves the main decision, the discovered wiring gap, the non-blocking requirement, the lean artifact constraint, the test strategy, and the manual evidence requirement.
- Brief output compresses more aggressively while retaining the durable decision, root issue, fix direction, and verification/evidence requirements.
- Artifact state remains lean in code: `status`, `text`, `errorCode` / `errorMessage`, and `updatedAt`; routing and provider metadata stay in logs/tests rather than persisted lower-band state.
