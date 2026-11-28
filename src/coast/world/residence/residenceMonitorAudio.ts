import { Quaternion, Vector3 } from 'three';
import type { WorldMonitorPlaybackFactory } from '../../../monitor/monitorAudio';
import { residenceRoomWet, residenceSoundPath } from './residenceAcoustics';
import { createResidenceAcousticPathModel, type ResidenceAcousticPath } from './residenceAcousticPaths';
import { acousticDoorSnapshot, type AcousticPoint } from './residenceAcousticScene';
import { createRoomImpulse, RESIDENCE_ROOM_RESPONSES } from './residenceAudioSamples';
import type { ResidenceDoorOpenness } from './residencePortalAcoustics';

export interface ResidenceMonitorAudioOptions {
  readonly doorOpenness: ResidenceDoorOpenness;
  readonly balconyDoor: () => number;
  readonly latency?: (context: AudioContext) => ResidenceAudioBranchLatencyProfile | undefined;
}

export interface ResidenceAudioBranchLatencyProfile {
  readonly sampleRate: number;
  readonly wetDelaySeconds: number;
}

type GainRamp = { from: number; target: number; start: number; end: number };

function rampGain(parameter: AudioParam, ramp: GainRamp, target: number, now: number, seconds: number): void {
  if (target === ramp.target && seconds > 0) return;
  const current = now >= ramp.end ? ramp.target
    : ramp.from + (ramp.target - ramp.from) * (now - ramp.start) / (ramp.end - ramp.start);
  parameter.cancelScheduledValues(now);
  parameter.setValueAtTime(seconds ? current : target, now);
  if (seconds) parameter.linearRampToValueAtTime(target, now + seconds);
  ramp.from = seconds ? current : target;
  ramp.target = target;
  ramp.start = now;
  ramp.end = now + seconds;
}

function directionGain(forward: Vector3, source: Vector3, first: AcousticPoint): number {
  const toward = new Vector3(first.x - source.x, first.y - source.y, first.z - source.z);
  if (toward.lengthSq() < 1e-10) return 1;
  const angle = Math.acos(Math.max(-1, Math.min(1, forward.dot(toward.normalize())))) * 180 / Math.PI;
  if (angle <= 50) return 1;
  if (angle >= 120) return .28;
  return 1 - .72 * (angle - 50) / 70;
}

// The upstream owner supplies mono emitters after channel selection/LFE filtering,
// and a destination before its mode/master controls. This factory owns only nodes
// between those two boundaries, including one room-response bank per playback.
export function createResidenceMonitorPlaybackFactory(options: ResidenceMonitorAudioOptions): WorldMonitorPlaybackFactory {
  const factory: WorldMonitorPlaybackFactory = (context, destination, emitters) => {
    // Retain the existing realtime room clock while native warm-response
    // comparisons decide whether a context-specific DSP correction is needed.
    const latency = options.latency ? options.latency(context) : { sampleRate: context.sampleRate, wetDelaySeconds: 0 };
    if (!latency || latency.sampleRate !== context.sampleRate || !Number.isFinite(latency.wetDelaySeconds)
      || latency.wetDelaySeconds < 0 || latency.wetDelaySeconds > .1) {
      throw new Error('Residence audio preparation has not completed for this context');
    }
    const nodes: AudioNode[] = [];
    const model = createResidenceAcousticPathModel();
    const own = <T extends AudioNode>(node: T): T => { nodes.push(node); return node; };
    try {
      const wet = own(context.createGain());
      const wetClock = own(context.createDelay(.2));
      wetClock.delayTime.value = latency.wetDelaySeconds;
      wet.connect(wetClock);
      const rooms = RESIDENCE_ROOM_RESPONSES.map((profile, index) => {
        const level = own(context.createGain());
        level.gain.value = 0;
        const convolver = own(context.createConvolver());
        convolver.normalize = false;
        convolver.buffer = createRoomImpulse(context, profile, 713 + index * 217);
        wetClock.connect(level).connect(convolver).connect(destination);
        return level;
      });
      const channels = emitters.map(emitter => {
        const input = own(context.createGain());
        input.channelCount = 1;
        input.channelCountMode = 'explicit';
        input.channelInterpretation = 'discrete';
        const paths = Array.from({ length: 3 }, () => {
          const filter = own(context.createBiquadFilter());
          filter.type = 'lowpass';
          filter.Q.value = -.75;
          const dry = own(context.createGain());
          const send = own(context.createGain());
          dry.gain.value = 0;
          send.gain.value = 0;
          const panner = own(context.createPanner());
          panner.panningModel = 'HRTF';
          panner.rolloffFactor = 0;
          panner.coneInnerAngle = 360;
          panner.coneOuterAngle = 360;
          const taps = Array.from({ length: 2 }, (_, index) => {
            const delay = own(context.createDelay(1));
            const level = own(context.createGain());
            level.gain.value = Number(index === 0);
            input.connect(delay).connect(level).connect(filter);
            return { delay, level };
          });
          filter.connect(dry).connect(panner).connect(destination);
          filter.connect(send).connect(wet);
          const gainRamp = (): GainRamp => ({ from: 0, target: 0, start: 0, end: 0 });
          return { taps, activeTap: 0, previousDelay: -1, availableAt: 0, filter, dry, send, panner,
            key: '', retireAt: 0, fresh: true, dryRamp: gainRamp(), sendRamp: gainRamp() };
        });
        return { emitter, input, paths, position: new Vector3(), rotation: new Quaternion() };
      });
      let disposed = false;
      let initialized = false;
      let nextUpdate = 0;
      const listenerPosition = new Vector3();
      const forward = new Vector3();
      return {
        inputs: channels.map(channel => channel.input),
        setQuality(_value) { nextUpdate = 0; },
        update(listener) {
          const now = context.currentTime;
          if (disposed || now < nextUpdate) return;
          nextUpdate = now + .05;
          listener.getWorldPosition(listenerPosition);
          const apply = (parameter: AudioParam, value: number, glide = .035) => {
            if (initialized) parameter.setTargetAtTime(value, now, glide);
            else parameter.setValueAtTime(value, now);
          };
          const state = acousticDoorSnapshot(options.doorOpenness);
          const wetMix = residenceRoomWet(listenerPosition, options.balconyDoor(), options.doorOpenness);
          for (const [index, room] of rooms.entries()) {
            apply(room.gain, wetMix[index] * RESIDENCE_ROOM_RESPONSES[index].send, .08);
          }
          for (const channel of channels) {
            const { emitter, paths, position, rotation } = channel;
            emitter.object.getWorldPosition(position);
            emitter.object.getWorldQuaternion(rotation);
            forward.set(0, 0, 1).applyQuaternion(rotation);
            const result = model.solve(position, listenerPosition, state);
            const candidates = result.invalidRoom ? residenceSoundPath(listenerPosition, position, options.doorOpenness).paths : result.paths;
            const selected = candidates;
            const keyed = new Map(selected.map(path => [`${path.kind}:${path.ids.join('|')}`, path]));
            for (const slot of paths) {
              if (!slot.key || keyed.has(slot.key) || slot.retireAt) continue;
              rampGain(slot.dry.gain, slot.dryRamp, 0, now, .04);
              rampGain(slot.send.gain, slot.sendRamp, 0, now, .04);
              slot.retireAt = now + .04;
            }
            const assigned = new Map<typeof paths[number], ResidenceAcousticPath>();
            for (const [key, path] of keyed) {
              let slot = paths.find(candidate => candidate.key === key);
              if (!slot) {
                slot = paths.find(candidate => !candidate.key
                  || (!keyed.has(candidate.key) && candidate.retireAt > 0 && candidate.retireAt <= now));
                if (!slot) continue;
                slot.key = key;
                slot.fresh = true;
              } else if (slot.retireAt > 0 && slot.retireAt <= now) slot.fresh = true;
              slot.retireAt = 0;
              assigned.set(slot, path);
            }
            for (const [slot, path] of assigned) {
              const fresh = slot.fresh || !initialized;
              const configure = (parameter: AudioParam, value: number, glide = .035) => {
                if (fresh) parameter.setValueAtTime(value, now);
                else parameter.setTargetAtTime(value, now, glide);
              };
              const cone = directionGain(forward, position, path.first);
              // Preserve the monitor's established 3 m / .8 source-distance curve,
              // applied to the travelled route once. The common path reports a
              // 1 m inverse-distance pressure, so replace that factor here.
              const monitorSpreading = 1 / (1 + .8 * (Math.max(3, path.length) / 3 - 1));
              const level = cone * monitorSpreading * Math.max(1, path.length);
              rampGain(slot.dry.gain, slot.dryRamp, path.lowGain * level, now, initialized ? .035 : 0);
              rampGain(slot.send.gain, slot.sendRamp, path.diffuseGain * level, now, initialized ? .035 : 0);
              configure(slot.filter.frequency, Math.min(context.sampleRate * .49,
                110 + 17_890 * path.highGain ** 2 / Math.max(1e-18, path.lowGain ** 2)), .04);
              const delay = Math.min(.99, path.delay);
              if (fresh) {
                for (const tap of slot.taps) tap.delay.delayTime.setValueAtTime(delay, now);
                for (const [index, tap] of slot.taps.entries()) {
                  tap.level.gain.cancelScheduledValues(now);
                  tap.level.gain.setValueAtTime(Number(index === 0), now);
                }
                slot.activeTap = 0;
                slot.previousDelay = delay;
                slot.availableAt = now;
              } else if (now >= slot.availableAt && Math.abs(delay - slot.previousDelay) > 1e-6) {
                // Change only the inaudible tap, preserving source history and
                // avoiding a ramp of delay time that would bend the signal pitch.
                const nextTap = 1 - slot.activeTap;
                slot.taps[nextTap].delay.delayTime.setValueAtTime(delay, now);
                for (const [tapIndex, tap] of slot.taps.entries()) {
                  tap.level.gain.cancelScheduledValues(now);
                  tap.level.gain.setValueAtTime(Number(tapIndex === slot.activeTap), now);
                  tap.level.gain.linearRampToValueAtTime(Number(tapIndex === nextTap), now + .04);
                }
                slot.activeTap = nextTap;
                slot.previousDelay = delay;
                slot.availableAt = now + .04;
              }
              configure(slot.panner.positionX, path.arrival.x);
              configure(slot.panner.positionY, path.arrival.y);
              configure(slot.panner.positionZ, path.arrival.z);
              slot.fresh = false;
            }
          }
          initialized = true;
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          for (const node of nodes) node.disconnect();
          model.dispose();
        },
      };
    } catch (error) {
      for (const node of nodes) node.disconnect();
      model.dispose();
      throw error;
    }
  };
  return factory;
}
