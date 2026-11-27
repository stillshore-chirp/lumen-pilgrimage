import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import ts from 'typescript';
import { finiteRecordedTail, selectSustainBank, measureSustainPressSupport, runAliasFixture } from './koto-recorded-sustain-study.mjs';
import { decodeMonoWav } from './koto-analysis.mjs';

const rate=48000;
const available=spawnSync('ffmpeg',['-version'],{stdio:'ignore'}).status===0;

test('finite recorded-tail processing retains the attack and rejects insufficient data or unlimited stretch', {skip:!available}, () => {
  const source=Float32Array.from({length:22800},(_,i)=>.2*Math.exp(-4*i/rate)*Math.sin(2*Math.PI*452.14*i/rate));
  const changed=finiteRecordedTail(source,{validEndSeconds:.405});
  assert.deepEqual(changed.samples.subarray(0,5760),source.subarray(0,5760));
  assert.ok(changed.diagnostics.effectiveTailFactor<=3);
  assert.ok(changed.diagnostics.alignmentCorrelation>.99);
  assert.equal(changed.diagnostics.appliedGain,1);
  assert.ok(changed.samples.every(Number.isFinite));
  assert.ok(Math.abs(changed.samples.at(-1))<1e-20);
  assert.throws(()=>finiteRecordedTail(source,{validEndSeconds:.213}),RangeError);
  assert.throws(()=>finiteRecordedTail(source,{validEndSeconds:.405,factor:3.01}),RangeError);
  assert.throws(()=>finiteRecordedTail(source,{validEndSeconds:.405,factor:NaN}),RangeError);
});

test('press support requires every millisecond through the fixed arrival window plus20ms, with static root choice', () => {
  const voice=Float32Array.from({length:rate},(_,i)=>i<Math.round(.638*rate)?.1*Math.sin(2*Math.PI*311.127*i/rate):0);
  assert.equal(measureSustainPressSupport(voice).pass,false);
  for(let i=0;i<Math.round(.75*rate);i++)voice[i]=.1*Math.sin(2*Math.PI*311.127*i/rate);
  assert.equal(measureSustainPressSupport(voice).pass,true);
  const bank=['low-240-candidate','mid-452','high-640','high-792'].map(id=>({id}));
  assert.equal(selectSustainBank({frequency:293.6648,pressSemitones:0},bank)[0],selectSustainBank({frequency:293.6648,pressSemitones:1},bank)[0]);
  assert.equal(selectSustainBank({frequency:293.6648},bank)[0].id,'low-240-candidate');
});

test('independent high-frequency input remains suppressed after time modification and+5semitone sample playback', {skip:!available}, () => {
  const result=runAliasFixture();assert.equal(result.pass,true);assert.ok(result.rejectionDb< -70);
});

const directory=process.env.KOTO_RECORDED_SUSTAIN_OUTPUT;
test('real30clip output satisfies actual UIv1, PCM/hash/gain, press margin, single-layer and frozen-reference contracts', {skip:!directory}, async()=>{
  const ui=await readFile(new URL('../src/dev/kotoAudition.ts',import.meta.url),'utf8');
  const ast=ts.createSourceFile('ui.ts',ui,ts.ScriptTarget.Latest,true);
  const names=new Set(['isRecord','record','string','number','list','sameOriginUrl','parseManifest','numbers','parseVisualization']);
  const functions=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.has(node.name?.text));assert.equal(functions.length,names.size);
  const js=ts.transpileModule(functions.map(node=>node.getText(ast)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  const parser=runInNewContext(js+';({parseManifest,parseVisualization})',{URL,location:{origin:'http://127.0.0.1:4191'},manifestUrl:new URL('http://127.0.0.1:4191/artifacts/sustain/manifest.json')});
  const original=JSON.parse(await readFile(resolve(directory,'manifest.json'))),parsed=parser.parseManifest(original);
  assert.equal(parsed.clips.length,30);assert.equal(original.clips.filter(clip=>clip.method==='recorded-sustain').length,16);
  assert.equal(original.clips.filter(clip=>clip.method==='recorded-sustain-color').length,4);
  assert.equal(original.coverage.strings,13);assert.equal(original.coverage.events,48);assert.ok(original.coverage.maximumTransposeSemitones<=5);
  assert.equal(original.experiments.performancePress.passCount,4);assert.equal(original.experiments.performanceSustain,true);
  assert.ok(original.eventCoverage.filter(row=>row.pressSemitones).every(row=>row.sustainPressSupport.pass));
  assert.ok(original.experiments.attackChecks.every(check=>check.first100msBitIdentical));
  assert.equal(original.experiments.notePostprocessApplied,false);assert.equal(original.experiments.dampControl.afterNonSilent,true);
  assert.equal(original.methods.find(method=>method.id==='production96').label,'旧候補（箏同定未達）');
  const color=original.experiments.excitation;
  assert.equal(color.status,'technical-gates-pass-timbre-unassessed');assert.deepEqual(color.failures,[]);
  assert.equal(color.referenceBitIdentical,true);assert.equal(color.dampBitIdentical,true);
  assert.equal(color.performancePress.passCount,4);assert.equal(color.performanceSustain,true);
  assert.ok(color.eventCoverage.filter(row=>row.pressSemitones).every(row=>row.sustainPressSupport.pass));
  assert.ok(color.selectionChecks.every(row=>row.identical));
  assert.ok(color.eventCoverage.every(row=>row.automaticRootEqualsStaticGroup&&row.excitation.tailFramesClipped===0));
  const selected=original.clips.find(clip=>clip.id===original.handoff.selectedScore);
  assert.equal(selected.method,'recorded-sustain-color');assert.equal(selected.measurements.gates.performancePress,true);
  const four=JSON.parse(await readFile(resolve(directory,original.handoff.processedBank)));
  assert.equal(four.samples.length,4);assert.deepEqual(four.samples.map(row=>row.id).sort(),['high-640','high-792','low-240-candidate','mid-452']);
  const low=original.roots.find(sample=>sample.id==='low-240-candidate');
  assert.ok(low.processing.support.pass);assert.ok(low.processing.requestedFactor<=3);
  assert.ok(low.processing.attempts.slice(0,-1).every(attempt=>!attempt.support.pass));
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  for(const clip of parsed.clips){
    const rawBytes=await readFile(resolve(directory,clip.rawWav)),pcmBytes=await readFile(resolve(directory,clip.matchedWav));
    const data=original.clips.find(item=>item.id===clip.id);assert.equal(hash(rawBytes),data.sha256.rawWav);assert.equal(hash(pcmBytes),data.sha256.matchedWav);
    if(data.reusedFrom)assert.equal(hash(rawBytes),data.reusedFrom.rawSha256);
    const raw=decodeMonoWav(rawBytes),pcm=decodeMonoWav(pcmBytes);assert.equal(raw.samples.length,clip.frames);assert.equal(pcm.samples.length,clip.frames);
    assert.equal(raw.sampleRate,clip.sampleRate);assert.equal(clip.frames/clip.sampleRate,clip.durationSeconds);
    const gain=10**((clip.matchGainDb+clip.commonSafetyGainDb)/20);let error=0;
    for(let i=0;i<clip.frames;i++)error=Math.max(error,Math.abs(raw.samples[i]*gain-pcm.samples[i]));assert.ok(error<=2/32768);
    parser.parseVisualization(JSON.parse(await readFile(resolve(directory,clip.visualization))));
  }
  assert.deepEqual(original.sourceDrift,[]);
});
