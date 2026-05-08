import { getBaselineModels } from "./pi-baseline.js";

for (const model of getBaselineModels()) {
  console.log(`${model.provider}/${model.id}\t${model.name}\t${model.api}\tcontext=${model.contextWindow}`);
}
