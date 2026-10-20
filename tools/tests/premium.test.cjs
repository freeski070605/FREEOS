const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../../apps/api-server/dist/services/premium/core.js');
const { videoAdapter, codingAdapter, mapVideoFinding, reviewEditingPlan } = require('../../apps/api-server/dist/services/premium/adapters.js');
const { premiumVideoGate } = require('../../apps/api-server/dist/services/premium/iteration.js');
const { effectDensityReview } = require('../../apps/api-server/dist/services/premium/renderQuality.js');

const registry = () => { const r = new core.PremiumRegistry(); r.registerAdapter(videoAdapter); r.registerAdapter(codingAdapter); return r; };
const profile = (target = 'professional') => videoAdapter.buildProductionProfile('test edit', target);
const run = (target = 'professional') => core.createRun('task', 'test edit', profile(target));
const artifact = (id = 'a', version = 1, source = []) => ({ artifactId: id, type: 'edit-plan', domain: 'video', sourceArtifacts: source, version, status: 'produced', lineage: { sourceArtifactIds: source, operation: 'test', evaluationIds: [], ...(version > 1 ? { previousVersionId: source[0] } : {}) } });
const finding = (id, severity = 'warning') => ({ id, domain: 'video', artifactId: 'a', category: 'creative', severity, description: id, evidence: [], confidence: 1, repairable: true, suggestedSkillCategories: ['repair'] });
const evaluation = (id, findings = [], scores = [], reviewType = 'executed-artifact') => ({ id, evaluatorId: 'video.editing-core.plan-critic', artifactId: 'a', reviewType, dimensionScores: scores, findings, evidence: [], confidence: 1, status: 'complete', source: 'test' });
const scores = [ { dimensionId: 'editorial', score: 1, confidence: 1, measurementType: 'deterministic' }, { dimensionId: 'render', score: 1, confidence: 1, measurementType: 'render' } ];

test('quality targets validate and set increasing repair depth', () => { for (const q of core.QUALITY_TARGETS) assert.equal(core.qualityTarget(q), q); assert.throws(() => core.qualityTarget('ultra')); assert.ok(profile('maximum').allowedRepairIterations > profile('draft').allowedRepairIterations); });
test('domain, skill, evaluator and benchmark registrations reject duplicates', () => { const r = registry(); assert.throws(() => r.registerDomain(videoAdapter)); assert.throws(() => r.registerSkill(videoAdapter.getSkills()[0])); assert.throws(() => r.registerEvaluator(videoAdapter.getEvaluators()[0])); r.registerBenchmark({ id:'b', domain:'video', fixture:'fixture', qualityTarget:'draft', expectedProperties:[], regressionRules:[] }); assert.throws(() => r.registerBenchmark({ id:'b', domain:'video', fixture:'fixture', qualityTarget:'draft', expectedProperties:[], regressionRules:[] })); });
test('capability selection respects quality and availability', () => { const r = registry(); for (const [id, quality, available] of [['fast',.4,true],['best',1,true],['offline',2,false]]) r.registerCapability({ id, provider:'test', type:'model', domains:['video'], taskTypes:['planning'], localOrRemote:'local', available, qualityProfile:quality, speedProfile:id==='fast'?1:100, costProfile:0, supportedInputs:[], supportedOutputs:[], limitations:[] }); assert.equal(core.selectCapability(r,'video.edit.plan',profile('premium')).selected.id,'best'); r.capabilities.get('best').available=false; assert.equal(core.selectCapability(r,'video.edit.plan',profile('premium')).selected.id,'fast'); r.capabilities.get('fast').available=false; assert.throws(() => core.selectCapability(r,'video.edit.plan',profile('premium')), /capability-unavailable/); });
test('director plan rejects invented skills, capabilities, cycles and missing inputs', () => { const r=registry(), p=profile(); const base={ goals:[], stages:[...p.requiredStages], skillIds:['video.edit.plan','video.evidence.analyze','video.finish'], capabilityIds:[], dependencies:{'video.edit.plan':['video.evidence.analyze']}, artifactIds:[], finishingSkillIds:['video.finish'] }; core.validatePlan(base,p,r,[]); assert.throws(() => core.validatePlan({...base,skillIds:['invented']},p,r,[])); assert.throws(() => core.validatePlan({...base,capabilityIds:['invented']},p,r,[])); assert.throws(() => core.validatePlan({...base,artifactIds:['missing']},p,r,[])); assert.throws(() => core.validatePlan({...base,dependencies:{'video.edit.plan':['video.evidence.analyze'],'video.evidence.analyze':['video.edit.plan']}},p,r,[])); });
test('lineage checks source and version', () => { const x=run(); core.addArtifact(x,artifact()); core.addArtifact(x,artifact('b',2,['a'])); assert.equal(x.artifacts[1].lineage.previousVersionId,'a'); assert.throws(() => core.addArtifact(x,artifact('c',3,['a']))); assert.throws(() => core.addArtifact(x,artifact('d',1,['unknown']))); });
test('evaluations aggregate confidence while preserving measurement types', () => { const v=core.aggregateEvaluations([evaluation('e1',[],[{dimensionId:'editorial',score:.2,confidence:1,measurementType:'test'}]),evaluation('e2',[],[{dimensionId:'editorial',score:1,confidence:.5,measurementType:'critic'}])]); assert.ok(v.dimensions.editorial.score > .2 && v.dimensions.editorial.score < 1); assert.deepEqual(v.dimensions.editorial.measurementTypes,['test','critic']); });
test('latest evaluator result supersedes old findings without deleting history', () => { const all=[evaluation('old',[finding('m','material')],scores),evaluation('new',[],scores)]; assert.equal(all.length,2); assert.equal(core.qualityGate(profile(),core.currentEvaluations(all)).outcome,'PASS'); });
test('quality gate passes, warns and rejects missing required dimensions or material findings', () => { assert.equal(core.qualityGate(profile(),[evaluation('e',[],scores)]).outcome,'PASS'); assert.equal(core.qualityGate(profile(),[evaluation('e',[finding('w')],scores)]).outcome,'PASS_WITH_WARNINGS'); assert.equal(core.qualityGate(profile(),[evaluation('e',[finding('m','material')],scores)]).outcome,'FAIL'); assert.equal(core.qualityGate(profile(),[evaluation('e',[],scores.slice(0,1))]).outcome,'FAIL'); assert.equal(core.qualityGate(profile(),[evaluation('e',[],scores,'plan')]).outcome,'FAIL'); assert.equal(core.qualityGate(profile(),[evaluation('e',[finding('m','material')],scores)],{userId:'owner',reason:'explicit decision'}).outcome,'PASS_WITH_WARNINGS'); });
test('executed artifact review cannot be replaced by plan review', () => { assert.throws(() => core.executedArtifactReview('a',[evaluation('e',[],scores,'plan')])); assert.equal(core.executedArtifactReview('a',[evaluation('e',[finding('m','material')],scores)]).repairRecommended,true); });
test('repair requires grounded registered skill and capability, and bounded iterations', () => { const r=registry(), x=run('standard'); core.addArtifact(x,artifact()); r.registerCapability({id:'c',provider:'test',type:'tool',domains:['video'],taskTypes:['repair'],localOrRemote:'local',available:true,qualityProfile:1,speedProfile:1,costProfile:0,supportedInputs:[],supportedOutputs:[],limitations:[]}); const repair={id:'r',findingIds:['f'],skillId:'video.edit.repair',capabilityId:'c',inputArtifactIds:['a'],parameters:{strength:1},expectedQualityEffect:'resolve f'}; core.validateRepairPlan({repairs:[repair]},[finding('f')],x,r); assert.throws(() => core.validateRepairPlan({repairs:[{...repair,skillId:'fake'}]},[finding('f')],x,r)); assert.throws(() => core.validateRepairPlan({repairs:[{...repair,capabilityId:'fake'}]},[finding('f')],x,r)); core.recordRepair(x,{repairs:[repair]},[evaluation('before',[finding('f')])],[evaluation('after',[finding('new')])]); assert.deepEqual(x.repairs[0].resolvedFindingIds,['f']); assert.deepEqual(x.repairs[0].introducedFindingIds,['new']); assert.throws(() => core.validateRepairPlan({repairs:[repair]},[finding('f')],x,r)); });
test('plateau detection is bounded by recent passes', () => { const x=run('maximum'); x.repairs=[{resolvedFindingIds:[],introducedFindingIds:[]},{resolvedFindingIds:[],introducedFindingIds:[]}]; assert.match(core.plateauReason(x),/No findings/); });
test('video adapter maps Editing Core findings as plan review', () => { const f=mapVideoFinding({code:'continuity',severity:'invalid',start:1,end:2,evidence:'cut'},'a',0); assert.equal(f.severity,'blocking'); const reviewed=reviewEditingPlan({decisions:[],evidence:{finalCriticFindings:[{code:'continuity',severity:'material',start:1,end:2,evidence:'cut'}]}},artifact()); assert.equal(reviewed.reviewType,'plan'); assert.equal(reviewed.findings.length,1); assert.ok(videoAdapter.getFinishers().length); });
test('failure taxonomy includes safety-relevant outcomes', () => { assert.ok(core.FAILURE_CODES.includes('capability-unavailable')); assert.ok(core.FAILURE_CODES.includes('validation-failure')); assert.ok(core.FAILURE_CODES.includes('resource-limit')); });
test('bounded loop repairs only with approval and stores outcome', async () => {
  const r=registry(), x=run('standard'); core.addArtifact(x,artifact());
  r.registerCapability({id:'c',provider:'test',type:'tool',domains:['video'],taskTypes:['repair'],localOrRemote:'local',available:true,qualityProfile:1,speedProfile:1,costProfile:0,supportedInputs:[],supportedOutputs:[],limitations:[]});
  const repair={id:'r',findingIds:['f'],skillId:'video.edit.repair',capabilityId:'c',inputArtifactIds:['a'],parameters:{strength:1},expectedQualityEffect:'remove f'};
  const planner={plan:()=>({repairs:[repair]})};
  const executor={authorize:()=>true,execute:async()=>({...artifact('b',2,['a']),generatedBySkill:'video.edit.repair',generatedByCapability:'c'})};
  let calls=0; const evaluate=async()=>++calls===1?[evaluation('before',[finding('f','material')],[scores[0]])]:[evaluation('after',[],[scores[0]])];
  const gate=await core.runBoundedRepairLoop(x,x.artifacts[0],r,planner,executor,evaluate);
  assert.equal(gate.outcome,'PASS'); assert.equal(x.repairs.length,1); assert.deepEqual(x.repairs[0].resolvedFindingIds,['f']); assert.equal(x.status,'accepted');
});
test('repair execution cannot bypass approval', async () => {
  const r=registry(), x=run('standard'); core.addArtifact(x,artifact());
  r.registerCapability({id:'c',provider:'test',type:'tool',domains:['video'],taskTypes:['repair'],localOrRemote:'local',available:true,qualityProfile:1,speedProfile:1,costProfile:0,supportedInputs:[],supportedOutputs:[],limitations:[]});
  const planner={plan:()=>({repairs:[{id:'r',findingIds:['f'],skillId:'video.edit.repair',capabilityId:'c',inputArtifactIds:['a'],parameters:{},expectedQualityEffect:'remove f'}]})};
  const executor={authorize:()=>false,execute:async()=>{throw new Error('must not execute')}};
  const gate=await core.runBoundedRepairLoop(x,x.artifacts[0],r,planner,executor,async()=>[evaluation('before',[finding('f','material')],[scores[0]])]);
  assert.equal(gate.outcome,'FAIL'); assert.equal(x.status,'rejected'); assert.equal(x.repairs.length,0);
});
test('finishing is a separate approved stage with lineage', async () => {
  const r=registry(), x=run(); core.addArtifact(x,artifact());
  r.registerCapability({id:'c',provider:'test',type:'tool',domains:['video'],taskTypes:['finishing'],localOrRemote:'local',available:true,qualityProfile:1,speedProfile:1,costProfile:0,supportedInputs:[],supportedOutputs:[],limitations:[]});
  const executor={authorize:()=>true,execute:async()=>({...artifact('b',2,['a']),generatedBySkill:'video.finish',generatedByCapability:'c'})};
  await core.runFinishing(x,x.artifacts[0],'video.finish','c',r,executor);
  assert.equal(x.currentStage,'finishing'); assert.equal(x.artifacts.length,2);
});
test('premium video gate requires an actual registered render analysis', () => {
  const x = run();
  core.addArtifact(x, artifact('plan'));
  x.evaluations.push({ ...evaluation('plan-review', [], [{ dimensionId: 'editorial', score: 1, confidence: 1, measurementType: 'critic' }], 'plan'), artifactId: 'plan' });
  assert.equal(premiumVideoGate(x).outcome, 'FAIL');
  const review = { ...artifact('review'), type: 'video-review-render', reference: 'review-v1.mp4', metadata: { probe: { width: 320 } } };
  core.addArtifact(x, review);
  x.videoIteration = { stage: 'accepted', artifactId: 'review' };
  x.evaluations.push({ ...evaluation('render-review', [], [{ dimensionId: 'render', score: 1, confidence: 1, measurementType: 'pixels' }, { dimensionId: 'artifact-integrity', score: 1, confidence: 1, measurementType: 'ffprobe' }]), evaluatorId: 'video.render.review-analyzer', artifactId: 'review', source: 'real-render-quality' });
  assert.equal(premiumVideoGate(x).outcome, 'PASS');
  x.videoIteration.stage = 'rendering-review';
  assert.equal(premiumVideoGate(x).outcome, 'FAIL');
});
test('registered render evaluator refuses preset metrics and executor defaults to unapproved', async () => {
  assert.throws(() => videoAdapter.getEvaluators().find(e => e.id === 'video.render.review-analyzer').evaluate(artifact('review'), profile()), /actual ffprobe/);
  const r = registry();
  r.registerCapability({ id: 'render', provider: 'test', type: 'render', domains: ['video'], taskTypes: ['render'], localOrRemote: 'local', available: true, qualityProfile: 1, speedProfile: 1, costProfile: 0, supportedInputs: [], supportedOutputs: [], limitations: [] });
  r.registerExecutor({ id: 'adobe-worker.review-render', supportedSkills: ['video.render.review'], supportedCapabilities: ['render'], riskLevel: 'medium', requiresApproval: true, execute: async () => { throw Error('should not run'); } });
  await assert.rejects(() => core.executeSkillWithApproval(r, 'video.render.review', 'render', artifact('review'), {}), /approval required/);
});
test('effect removal repair is registered and bounded to an inspected target', () => {
  const r = registry(), x = run(); core.addArtifact(x, artifact());
  r.registerCapability({ id: 'adobe', provider: 'Adobe', type: 'repair', domains: ['video'], taskTypes: ['repair'], localOrRemote: 'local', available: true, qualityProfile: 1, speedProfile: 1, costProfile: 0, supportedInputs: [], supportedOutputs: [], limitations: [] });
  const repair = { id: 'effect-remove', findingIds: ['haze'], skillId: 'video.effect.remove', capabilityId: 'adobe', inputArtifactIds: ['a'], parameters: { trackIndex: 0, clipStart: 1, clipEnd: 2, componentMatchName: 'ADBE Gaussian Blur' }, expectedQualityEffect: 'remove inspected blur' };
  core.validateRepairPlan({ repairs: [repair] }, [finding('haze', 'material')], x, r);
  assert.throws(() => core.validateRepairPlan({ repairs: [{ ...repair, parameters: { ...repair.parameters, clipEnd: 8000 } }] }, [finding('haze')], x, r), /Unbounded/);
  assert.throws(() => core.validateRepairPlan({ repairs: [{ ...repair, parameters: { ...repair.parameters, componentMatchName: 'x'.repeat(201) } }] }, [finding('haze')], x, r), /Unbounded/);
});
test('effect density review respects style intent and preserves lineage metrics', () => {
  const media = { ...artifact('effects'), metadata: { effectExecutions: Array.from({ length: 6 }, (_, i) => ({ skillId: 'video.effect.flash', timelineStart: i, timelineEnd: i + .2 })) } };
  const ordinary = effectDensityReview(media, 10, 'quiet interview');
  const stylized = effectDensityReview(media, 10, 'rapid glitch music video');
  assert.equal(ordinary.metrics.flashFrequency, .6);
  assert.equal(ordinary.findings[0].severity, 'material');
  assert.equal(stylized.findings.length, 0);
});
