# User Prompt Smoothing Test Prompts

Source thread: `thread_2bbccbae-bf23-4a4c-a742-26528e6e5ab9`

These are real user messages selected from the largest canonical thread for prompt-smoothing eval. They are not model outputs and should not be mutated by this fixture file.

## Prompt 01: typos exploratory model perspective

- sourceOrder: `5`
- messageId: `message_18134ae6-38d5-41bd-848c-c7d5de506661`
- chars: `196`

```text
any thoguhts on the improved context and the ability to stay more coherent over long time horizsons interesting to you from the perspective of being a model that wants to be helpful and effective?
```

## Prompt 02: smart compact exploratory with uncertainty

- sourceOrder: `94`
- messageId: `message_c9328988-8a37-4fe9-b859-a4f13f6dcee0`
- chars: `570`

```text
I'm less worries about your ability to go and re-read the needful to get to the same place and more interested in smart compact as a periodic thing that runs that mostly isnt' terribly noticable to the agent or the user. it is only manual and being called out now because we are doing something we can't do with ehavy specs. runing and dialing in. this work isn't appropriate for  working out the smart compact nuances. it is for clearly thinking through the interlocking functional and techincal portions of smart compact and bulding those aroudn a harness. make sense?
```

## Prompt 03: verbosity calibration correction

- sourceOrder: `167`
- messageId: `message_b271e20a-4adb-4906-892c-6241b1a7f6ac`
- chars: `104`

```text
shorthand? or just an answer calibrated to the question more than calibrated to your bias for verbosity?
```

## Prompt 04: frustrated attention-spike correction

- sourceOrder: `291`
- messageId: `message_7f7ecfff-4ae0-4f6b-890d-878cc67ac63d`
- chars: `296`

```text
you did not continue. you just said you were going to continue then you stopped. if you do that again, you and i are going to have a big fucking problem. saying you are going to continue then stopping IS NOT FUCKING CONTINUING. so be clear CONTINUE CONTINUE CONTINEU FUCKING CONTINUE MOTHERFUCKER
```

## Prompt 05: long process-design prompt

- sourceOrder: `349`
- messageId: `message_e4831e6d-a0d0-4c2b-80a8-4c65b25318c3`
- chars: `2211`

```text
based on what you've seen would we beneift from making the story build process more granular. in the past I have used distinct phases. Skeleton (add or modify any necessary shapes or add stubs for new moethods or modify existing method signatures) so that the skeleton of the code changes are in place. Then you have tdd-red which is adding all the tests. you need skeleton to add tdd-red because otherwise you get compilation issues and failures unrelated to test assertions. at the end of tdd-red all tdd tests are in place and generally all are failing due to not implemented errors or assertion failures. now this can be combined into skeleton-red which is both. and frequently I did that. then there was a tdd-green phase. then a verifiaction phase and often I'd have fully baked prompts for skeleton-red, tdd-green, and verify. as models got better this seemed maybe less necessary. at least when working with gpt models. so now all the tests are given and we just have implementor and verifier. and they go back and forth. this simplifies and streamlines the build process. but buased on the various stories youve seen, would it be better to break down impliment/verify into more stages. It doesn't necessarily have to be skeleton-red, tdd-green, verify. it could be something else. with skeleton-red, tdd-green, verify it prevented laxer models from cutting corners as much as you could commit code after skeleton-red and ask questions if test files are changed in the green file to better detect reward hacking. But there are also broader coheisive/coherentcy issues that get missed whne you only focus on skeleton red green. so if we did use TDD as a way to break things down more granular, you may need another broad phase with an implementor looking at the story as a whole and making sure end to end it works as would be expected and to look for gaps that might arise in encorcing pure tdd phases. After goign through all of that, what do you think here? Would we benefit from more phases? if so how shoud we structure? Am i too dependent on gpt 5.x tendency to be very pedantic in the build and verify? could I use less capable less pedantic models with a finer grained staged story build process?
```

## Prompt 06: role ownership design prompt

- sourceOrder: `438`
- messageId: `message_30d09e1b-55b9-476c-9eed-5282c4d6eb97`
- chars: `801`

```text
and who should recommend, and finally decide which story gets which? here is who you have. Epic writer (story sharding is rough outline). Tech Design (typically follows epic story break down), Publish Epic (decides final scope and breakdown of stories), story enrichment agent (goes through tech design and pulls out key things to add to story and provides line numbered section references inside the story back to tech design) or epic-lead who orchestrateeds the story and configures the story final story implementation details before running or should the decision happen from the story-lead which is a non agent who is fed all the story info and given all the reciepts and ecents that happened in story build to review and decide next action on a story (story imple call, story verifier call, etc)
```

## Prompt 07: directness instruction

- sourceOrder: `492`
- messageId: `message_4b09c4a2-3388-4a67-9e87-20cb73fcc6c5`
- chars: `79`

```text
please answer the questions that I ask and dont answer the questiosn I dont ask
```

## Prompt 08: long tool truncation behavior explanation

- sourceOrder: `659`
- messageId: `message_13bd21e5-88e3-491d-9821-aace2375d877`
- chars: `910`

```text
so now what's interesteding is in the last few turns we were testing a feature that after 20k tokens in the full fidelity band, tool result messages were being truncated as you go. that's currently in place. so you were doing very large tool calls which were filling up the context but then getting truncated after 20k worth of messages down to 240 characters on the tool call result. did you notice any problems collecting information during that? were you finding noticing that you wanted to refer back to previous files you read but the content was gone? because based on the context % and how it was jumping around during your extended turn, a lot of tool call results were getting pulled to keep the context bounded and in a useful range. affectively did you notice anything in your reading and research that seemed to be challenging or disruptive around not being able to re-review previous info you had?
```

## Prompt 09: short typo regression-test prompt

- sourceOrder: `665`
- messageId: `message_869c571e-36d8-471a-9685-d4c4fdececda`
- chars: `123`

```text
Back again. we reworte how the tool call pruning was happening now we are testing it out to make sure it we didn't break it
```

## Prompt 10: path/task prompt with typo

- sourceOrder: `667`
- messageId: `message_71ea0d81-4252-4895-a181-d3a7340dd519`
- chars: `120`

```text
Ok let's go back to epic 1 story 00. I'd like yo uto find that and read that story beginning to end and give me thoughts
```

